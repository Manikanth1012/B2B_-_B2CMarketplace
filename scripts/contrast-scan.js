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
           unverified: [{ text, selector }] }  (text on a gradient or image: check by eye)

   Limits: it sees solid colours only. Text over an image or gradient has no
   single background; the nearest solid ancestor colour is used and a gradient
   headline (transparent text) is skipped, so those need an eye. Run it in each
   theme / viewport you care about. */
(() => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
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
  const backgroundOf = (el) => {
    const layers = []
    for (let e = el; e; e = e.parentElement) {
      const ecs = getComputedStyle(e)
      const c = parse(ecs.backgroundColor)
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
    /* Transparent text is a gradient headline or a hidden label: not scorable. */
    if (!fgRaw || fgRaw.a === 0 || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue
    const bg = backgroundOf(el)
    if (!bg) { unverified.push({ text: text.slice(0, 60), selector: selectorOf(el) }); continue }
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
