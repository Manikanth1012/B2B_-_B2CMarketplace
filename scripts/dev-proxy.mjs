/* A same-origin proxy in front of Supabase, for environments where the *browser*
   cannot reach the project host but Node can.
 *
 * You do not need this on a normal developer machine — `npm run dev` talks to
 * Supabase directly. It exists for sandboxes and CI containers whose egress policy
 * resets the browser's connection to the project host while leaving Node's alone
 * (Claude Code's remote environment is one: Chromium gets net::ERR_CONNECTION_RESET
 * for the Supabase host, `curl` and Node do not).
 *
 * Usage:
 *   npm run build                       # or: npm run dev, see below
 *   node scripts/dev-proxy.mjs          # serves dist/ on :4180, proxies /sb/*
 *
 * Point the app at it when you build:
 *   VITE_SUPABASE_URL="http://127.0.0.1:4180/sb" npm run build
 *
 * Everything the browser touches is then 127.0.0.1, so there is no CORS to satisfy
 * and no certificate to trust; the outbound request leaves from this process.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 4180)
const UPSTREAM = process.env.SUPABASE_UPSTREAM ?? process.env.VITE_SUPABASE_URL_REAL
const DIST = path.resolve('dist')

if (!UPSTREAM) {
  console.error('Set SUPABASE_UPSTREAM to the real project URL, e.g.')
  console.error('  SUPABASE_UPSTREAM=https://<ref>.supabase.co node scripts/dev-proxy.mjs')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

/* Hop-by-hop headers describe one connection and must not be relayed onto another. */
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection'])

http.createServer(async (req, res) => {
  if (req.url.startsWith('/sb/')) {
    const headers = { ...req.headers }
    delete headers.host
    delete headers.connection
    delete headers['content-length']

    const chunks = []
    for await (const c of req) chunks.push(c)

    try {
      const upstream = await fetch(UPSTREAM + req.url.slice(3), {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      const out = {}
      upstream.headers.forEach((v, k) => { if (!DROP_RESPONSE.has(k)) out[k] = v })
      res.writeHead(upstream.status, out)
      res.end(body)
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ proxyError: String(e) }))
    }
    return
  }

  /* Single-page app: anything that is not a real file is the app's own route. */
  let file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]))
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html')
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`dev-proxy: http://127.0.0.1:${PORT}  ->  ${UPSTREAM}`)
})
