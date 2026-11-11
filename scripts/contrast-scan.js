/* In-browser WCAG contrast scanner.

   Walks every visible text node on the current page, works out the colour the
   text is really painted in and the colour it really sits on, and reports any
   that fall under AA: 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px and
   bold).

   Two ways to use it. Neither needs a build step; the file has no imports.
     1. DevTools: open the page, paste this whole file into the Console and
        press Enter. The result object is printed (and is the value of the
        last expression).
     2. Browser automation: pass the file's text to a "run JS in page" tool
        (e.g. the Chrome extension's javascript_tool). The final line is an
        expression that evaluates to the result object, so the tool returns it.

   Result: { checked, failures: [{ text, ratio, fg, bg, selector }],
           unverified: [{ text, selector, colour? }] }  (text on a gradient or image, or in a
           colour this file cannot parse -- `colour` then holds that colour's text: check by eye)

   Limits: it reads rgb(), color(srgb …) and oklch() colours; any other colour
   syntax is reported as `unverified`. It sees solid colours only. Text over an image or gradient has no
   single background; the nearest solid ancestor colour is used and a gradient
   headline (transparent text) is skipped, so those need an eye. Run it in each
   theme / viewport you care about. */
(() => {
  /* Colour parsing. Returns {r, g, b, a} (channels 0-255) or null when the
     text is a colour this file cannot read; callers list those as `unverified`
     and never skip them. Understood: rgb()/rgba(), color(srgb …), oklch(…).
     Anything else (lab, hsl, color-mix, display-p3 …) returns null. */
  const num = (t, pctScale) => {
    if (t === 'none') return 0
    const v = parseFloat(t)
    if (isNaN(v)) return NaN
    return t.endsWith('%') ? v / 100 * pctScale : v
  }
  const alphaOf = (t) => (t === undefined ? 1 : num(t, 1))
  const hueDeg = (t) => {
    if (t === 'none') return 0
    const v = parseFloat(t)
    if (/turn$/.test(t)) return v * 360
    if (/grad$/.test(t)) return v * 0.9
    if (/rad$/.test(t)) return v * 180 / Math.PI
    return v
  }
  const clamp01 = (v) => Math.min(1, Math.max(0, v))
  const encode = (v) => { v = clamp01(v); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) }
  /* OKLCH -> OKLab -> linear sRGB -> gamma sRGB, clamped to the gamut. */
  const oklchToRgb = (L, C, H) => {
    const h = H * Math.PI / 180
    const a = C * Math.cos(h), b = C * Math.sin(h)
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3)
    return {
      r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    }
  }
  const parse = (s) => {
    const m = String(s).trim().toLowerCase().match(/^([a-z-]+)\((.*)\)$/)
    if (!m) return null
    const fn = m[1]
    const [body, alpha] = m[2].split('/').map((x) => x.trim())
    const p = body.split(/[\s,]+/).filter(Boolean)
    let c = null
    if (fn === 'rgb' || fn === 'rgba') {
      /* Legacy comma syntax carries alpha as a fourth value. */
      const al = alpha !== undefined ? alpha : p[3]
      if (p.length < 3) return null
      c = { r: num(p[0], 255), g: num(p[1], 255), b: num(p[2], 255), a: alphaOf(al) }
    } else if (fn === 'color' && p[0] === 'srgb' && p.length === 4) {
      c = { r: num(p[1], 1) * 255, g: num(p[2], 1) * 255, b: num(p[3], 1) * 255, a: alphaOf(alpha) }
    } else if (fn === 'oklch' && p.length === 3) {
      const rgb = oklchToRgb(num(p[0], 1), num(p[1], 0.4), hueDeg(p[2]))
      c = { ...rgb, a: alphaOf(alpha) }
    }
    if (!c || [c.r, c.g, c.b, c.a].some((v) => isNaN(v))) return null
    return { r: Math.min(255, Math.max(0, c.r)), g: Math.min(255, Math.max(0, c.g)), b: Math.min(255, Math.max(0, c.b)), a: clamp01(c.a) }
  }
  /* Lay `top` over opaque `under`. */
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  })
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

  /* Effective opacity: the product of every ancestor's opacity. */
  const opacityOf = (el) => {
    let o = 1
    for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
    return o
  }
  /* Effective background: composite each ancestor's background, nearest on
     top, onto white (the canvas) once an opaque one is reached or we run out.
     Returns null when a gradient or image is painted before any opaque colour:
     the text then has no single background, and is listed as `unverified`. */
  let unparsed = null
  const backgroundOf = (el) => {
    unparsed = null
    const layers = []
    for (let e = el; e; e = e.parentElement) {
      const ecs = getComputedStyle(e)
      const raw = ecs.backgroundColor
      const c = parse(raw)
      if (!c && raw && raw !== 'transparent') { unparsed = raw; return null }
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break }
      if (ecs.backgroundImage && ecs.backgroundImage !== 'none') return null
    }
    return layers.reduceRight((under, layer) => over(layer, under), { r: 255, g: 255, b: 255, a: 1 })
  }
  const selectorOf = (el) => {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      if (e.id) { parts.unshift(s + '#' + e.id); break }
      const cls = [...e.classList].slice(0, 2).join('.')
      if (cls) s += '.' + cls
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  const failures = []
  const unverified = []
  let checked = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.trim()
    const el = n.parentElement
    if (!text || !el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || !visible(el)) continue
    const cs = getComputedStyle(el)
    const fgRaw = parse(cs.color)
    /* A text colour this file cannot read is listed, never skipped. */
    if (!fgRaw) { unverified.push({ text: text.slice(0, 60), selector: selectorOf(el), colour: cs.color }); continue }
    /* Transparent text is a gradient headline or a hidden label: not scorable. */
    if (fgRaw.a === 0 || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue
    const bg = backgroundOf(el)
    if (!bg) {
      unverified.push({ text: text.slice(0, 60), selector: selectorOf(el), ...(unparsed ? { colour: unparsed } : {}) })
      continue
    }
    const fg = over({ ...fgRaw, a: fgRaw.a * opacityOf(el) }, bg)
    const size = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 700
    const large = size >= 24 || (size >= 18.66 && bold)
    const need = large ? 3 : 4.5
    checked++
    const r = ratio(fg, bg)
    if (r < need) {
      failures.push({ text: text.slice(0, 60), ratio: Math.round(r * 100) / 100, fg: hex(fg), bg: hex(bg), selector: selectorOf(el) })
    }
  }
  return { checked, failures, unverified }
})()
