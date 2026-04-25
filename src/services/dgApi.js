import { JWT_EXPIRY_BUFFER_MS, ONE_RECORD_API_VERSION_HEADER } from '../constants/defaults'

export const DG_API_BASE = import.meta.env.VITE_DG_API_BASE || 'https://qa-dgautocheck.iata.org'
const DG_CLIENT_ID = import.meta.env.VITE_DG_CLIENT_ID
const DG_CLIENT_SECRET = import.meta.env.VITE_DG_CLIENT_SECRET

/** @type {{ token: string, expiresAt: number } | null} */
let _dgTokenCache = null

/**
 * Reads the `exp` claim from a JWT and returns an expiry timestamp in ms,
 * with a 30-second early-expiry buffer. Falls back to 30 s from now if the
 * token cannot be decoded or has no `exp`.
 * @param {string} token
 * @returns {number}
 */
function getJwtExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000 - JWT_EXPIRY_BUFFER_MS
    }
  } catch (_) { /* malformed token — fall through */ }
  return Date.now() + JWT_EXPIRY_BUFFER_MS
}

export async function fetchDgToken() {
  if (_dgTokenCache && _dgTokenCache.expiresAt > Date.now()) {
    return _dgTokenCache.token
  }
  const params = new URLSearchParams()
  params.append('grant_type', 'client_credentials')
  params.append('client_id', DG_CLIENT_ID)
  params.append('client_secret', DG_CLIENT_SECRET)
  const res = await fetch(`${DG_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  _dgTokenCache = {
    token: data.access_token,
    expiresAt: getJwtExpiry(data.access_token),
  }
  return _dgTokenCache.token
}

export async function fetchAcceptanceCheck(acceptanceCheckId, token) {
  const res = await fetch(`${DG_API_BASE}/api/v1/acceptance-checks/${encodeURIComponent(acceptanceCheckId)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Acceptance check failed: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function createAcceptanceCheck(officeIdentifier, token) {
  const params = new URLSearchParams()
  params.append('officeIdentifier', officeIdentifier)
  const res = await fetch(`${DG_API_BASE}/api/v1/acceptance-checks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${token}`,
    },
    body: params,
  })
  if (!res.ok) throw new Error(`Create acceptance check failed: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchLogisticsObject(url, token) {
  const res = await fetch(url, {
    headers: {
      'Accept': ONE_RECORD_API_VERSION_HEADER,
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!res.ok) throw new Error(`Failed to fetch logistics object: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchAcceptanceCheckPdf(acceptanceCheckId, token) {
  const res = await fetch(
    `${DG_API_BASE}/api/v1/acceptance-checks/${encodeURIComponent(acceptanceCheckId)}/report/pdf`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Failed to fetch acceptance check PDF: ${res.status} ${res.statusText}`)
  return res.arrayBuffer()
}

export async function importXsdgToAcceptanceCheck(acceptanceCheckId, xmlBody, token) {
  const res = await fetch(
    `${DG_API_BASE}/api/v1/acceptance-checks/${encodeURIComponent(acceptanceCheckId)}/import/xsdg`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': `Bearer ${token}`,
      },
      body: xmlBody,
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[import/xsdg] ${res.status}\n${body}`)
  }
  return res
}

export async function fetchDgCheckRequestUrl(acceptanceCheckId, userIdentifier, userName, token) {
  const params = new URLSearchParams()
  params.append('userIdentifier', userIdentifier)
  params.append('userName', userName)
  const res = await fetch(
    `${DG_API_BASE}/api/v1/acceptance-checks/${encodeURIComponent(acceptanceCheckId)}/request-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
      },
      body: params,
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[request-url] ${res.status}\n${body}`)
  }
  const data = await res.json()
  if (data?.status === 'error') throw new Error(`[request-url] server error:\n${data.message}`)
  return data
}
