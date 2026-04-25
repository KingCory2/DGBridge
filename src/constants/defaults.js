// ── URL / Endpoint defaults ──────────────────────────────────────────────────
export const DEFAULT_NEONE_BASE_URL = import.meta.env.VITE_NEONE_BASE_URL || 'http://localhost:8080'
export const DEFAULT_NEONE_TOKEN_URL = import.meta.env.VITE_NEONE_TOKEN_URL || 'http://localhost:8989/realms/neone/protocol/openid-connect/token'
export const DEFAULT_GRAPHDB_ENDPOINT = import.meta.env.VITE_GRAPHDB_ENDPOINT || 'http://localhost:7200/repositories/my-repo'

// ── Application defaults ─────────────────────────────────────────────────────
export const DEFAULT_OFFICE_IDENTIFIER = import.meta.env.VITE_OFFICE_IDENTIFIER || 'HKG'

// ── localStorage keys ────────────────────────────────────────────────────────
export const LS_AWB_KEY = 'dg-awbs'
export const LS_GHA_SETTINGS_KEY = 'dg-gha-settings'

// ── Timing ───────────────────────────────────────────────────────────────────
export const NOTIFICATION_DISMISS_MS = 3000
export const JWT_EXPIRY_BUFFER_MS = 30_000

// ── AWB ───────────────────────────────────────────────────────────────────────
export const AWB_SERIAL_MIN = 1_000_000
export const AWB_SERIAL_MAX = 9_000_000
export const AWB_VALIDATION_REGEX = /^\d{3}-\d{8}$/
export const AWB_INPUT_MAX_LENGTH = 12

// ── ONE Record API ───────────────────────────────────────────────────────────
export const ONE_RECORD_API_VERSION_HEADER = 'application/ld+json; version=2.0.0-dev'

// ── GraphDB ──────────────────────────────────────────────────────────────────
export const DEFAULT_SPARQL_QUERY = 'SELECT * WHERE { ?s ?p ?o } LIMIT 100'
