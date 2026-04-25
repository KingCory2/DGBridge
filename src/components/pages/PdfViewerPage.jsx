import { useState } from 'react'

const pdfModules = import.meta.glob('../../../pdf/*.pdf', { query: '?url', import: 'default', eager: true })

const staticPdfs = Object.entries(pdfModules).map(([path, url]) => ({
  name: path.split('/').pop(),
  url,
}))

const API_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJ1bmlxdWVfbmFtZSI6Ik9LRUUiLCJyb2xlIjpbIndlYi1zZXJ2aWNlIl0sImlzcyI6Imh0dHBzOi8vcWEtZGdhdXRvY2hlY2suaWF0YS5vcmcvIiwiYXVkIjoiejZzRWZnbFF0TG8iLCJleHAiOjE3NzY5MTcwMjgsIm5iZiI6MTc3NjkwOTgyOCwiQWNjZXB0YW5jZUNoZWNrUGVybWlzc2lvbnMiOiI3In0.ia4tmPGq6s2yV9K1PJvoCDlgQK9kH6rZbjhA0HCUm-e_P4RKnTvKqPBIITySihJ8VYkMJfIIPPxa7PuusmfOIQ'

export default function PdfViewerPage() {
  const [fetchedPdfs, setFetchedPdfs] = useState([])
  const allPdfs = [...staticPdfs, ...fetchedPdfs]
  const [selected, setSelected] = useState(staticPdfs.length > 0 ? staticPdfs[0] : null)
  const [checkId, setCheckId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const fetchReport = async () => {
    const id = checkId.trim()
    if (!id) return
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch(
        `https://qa-dgautocheck.iata.org/api/v1/acceptance-checks/${encodeURIComponent(id)}/report/pdf`,
        { headers: { Authorization: `Bearer ${API_TOKEN}` } }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const entry = { name: `AcceptanceCheck-${id}.pdf`, url, isBlob: true }
      setFetchedPdfs(prev => [...prev, entry])
      setSelected(entry)
    } catch (err) {
      setFetchError(err.message)
    } finally {
      setFetching(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: '16px', minHeight: 0 }}>
      {/* Left panel: PDF list */}
      <div style={{
        width: '240px',
        flexShrink: 0,
        overflowY: 'auto',
        borderRight: '1px solid #e2e8f0',
        paddingRight: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {/* Fetch from API */}
        <div style={{
          padding: '12px',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          background: '#f8fafc',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Fetch Report
          </div>
          <input
            type="text"
            value={checkId}
            onChange={e => setCheckId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchReport()}
            placeholder="Acceptance Check ID"
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: '13px',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              marginBottom: '8px',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          <button
            onClick={fetchReport}
            disabled={fetching || !checkId.trim()}
            style={{
              width: '100%',
              padding: '7px',
              fontSize: '13px',
              fontWeight: 600,
              background: fetching || !checkId.trim() ? '#94a3b8' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: fetching || !checkId.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {fetching ? 'Fetching…' : 'Fetch PDF'}
          </button>
          {fetchError && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444', wordBreak: 'break-word' }}>
              {fetchError}
            </div>
          )}
        </div>

        <h3 style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: 600,
          color: '#64748b',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          PDF Files
        </h3>
        {allPdfs.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '14px' }}>No PDF files found.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {allPdfs.map((pdf) => (
              <li
                key={pdf.url}
                onClick={() => setSelected(pdf)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  marginBottom: '4px',
                  fontSize: '14px',
                  background: selected?.url === pdf.url ? '#3b82f6' : 'transparent',
                  color: selected?.url === pdf.url ? '#fff' : '#1e293b',
                  fontWeight: selected?.url === pdf.url ? 600 : 400,
                  wordBreak: 'break-all',
                  transition: 'background 0.15s',
                }}
              >
                <span>📄</span>
                <span>{pdf.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right panel: PDF preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selected ? (
          <>
            <div style={{
              marginBottom: '8px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#64748b',
            }}>
              {selected.name}
            </div>
            <iframe
              src={selected.url}
              title={selected.name}
              style={{
                flex: 1,
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                width: '100%',
                minHeight: '500px',
              }}
            />
          </>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#94a3b8',
            fontSize: '14px',
          }}>
            Select a PDF from the list to preview it.
          </div>
        )}
      </div>
    </div>
  )
}
