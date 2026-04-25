import { JSDOM } from 'jsdom'
import { convertXmlToJsonLd } from '../src/lib/convertXmlToJsonLd.js'
import { convertJsonLdToXml } from '../src/lib/convertJsonLdToXml.js'

// Polyfill DOMParser for convertXmlToJsonLd (uses browser API internally)
if (!globalThis.DOMParser) {
  globalThis.DOMParser = new JSDOM('').window.DOMParser
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendRaw(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendError(res, status, message) {
  const body = JSON.stringify({ error: message })
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function parseUrl(req) {
  return new URL(req.url, 'http://localhost')
}

function makeHandler() {
  return async (req, res, next) => {
    if (req.method !== 'POST') return next()

    const { pathname, searchParams } = parseUrl(req)

    if (pathname === '/api/convert/xml-to-jsonld') {
      let input
      try { input = await readBody(req) } catch (e) { return sendError(res, 500, e.message) }
      if (!input.trim()) return sendError(res, 400, 'Request body is empty')
      const format = searchParams.get('format') ?? 'nested'
      try {
        const output = await convertXmlToJsonLd(input, format)
        return sendRaw(res, 200, 'application/json', output)
      } catch (e) {
        return sendError(res, 500, e.message)
      }
    }

    if (pathname === '/api/convert/jsonld-to-xml') {
      let input
      try { input = await readBody(req) } catch (e) { return sendError(res, 500, e.message) }
      if (!input.trim()) return sendError(res, 400, 'Request body is empty')
      try {
        const output = await convertJsonLdToXml(input)
        return sendRaw(res, 200, 'application/xml', output)
      } catch (e) {
        return sendError(res, 500, e.message)
      }
    }

    next()
  }
}

export default function convertApiPlugin() {
  return {
    name: 'convert-api',
    configureServer(server) {
      server.middlewares.use(makeHandler())
    },
    configurePreviewServer(server) {
      server.middlewares.use(makeHandler())
    },
  }
}
