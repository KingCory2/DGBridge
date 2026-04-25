import { JWT_EXPIRY_BUFFER_MS } from '../constants/defaults'

/** @type {Map<string, { token: string, expiresAt: number }>} */
const _tokenCache = new Map()

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

export async function fetchAccessToken(tokenUrl) {
  const cached = _tokenCache.get(tokenUrl)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token
  }

  const params = new URLSearchParams()
  params.append('grant_type', 'client_credentials')
  params.append('client_id', import.meta.env.VITE_NEONE_CLIENT_ID || 'neone-client')
  params.append('client_secret', import.meta.env.VITE_NEONE_CLIENT_SECRET || 'lx7ThS5aYggdsMm42BP3wMrVqKm9WpNY')
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Failed to obtain access token:\nHTTP ${res.status} ${res.statusText}\n\n${errText}`)
  }
  const data = await res.json()
  _tokenCache.set(tokenUrl, {
    token: data.access_token,
    expiresAt: getJwtExpiry(data.access_token),
  })
  return data.access_token
}
