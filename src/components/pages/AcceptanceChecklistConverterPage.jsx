import { useState, useRef, useCallback } from 'react'
import { extractPdfText as extractPdfTextLib } from '../../lib/extractPdfText'
import { convertPdfToCheckJsonLd } from '../../lib/convertPdfToCheckJsonLd'
import { fetchAccessToken } from '../../services/neoneApi'
import { DEFAULT_NEONE_BASE_URL, DEFAULT_NEONE_TOKEN_URL } from '../../constants/defaults'

export default function AcceptanceChecklistConverterPage() {
  const [pdfText, setPdfText] = useState('')
  const [jsonLdOutput, setJsonLdOutput] = useState('')
  const [awbOverride, setAwbOverride] = useState('')
  const [neoneBaseUrl, setNeoneBaseUrl] = useState(DEFAULT_NEONE_BASE_URL)
  const [neoneTokenUrl, setNeoneTokenUrl] = useState(DEFAULT_NEONE_TOKEN_URL)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [postStatus, setPostStatus] = useState(null) // { ok: bool, message: string } | null
  const [posting, setPosting] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [showPostSettings, setShowPostSettings] = useState(false)
  const fileInputRef = useRef(null)

  // ── PDF extraction ──────────────────────────────────────────────────────────
  const extractPdfText = useCallback(async (file) => {
    setError('')
    setJsonLdOutput('')
    setPdfText('')
    setPostStatus(null)
    setLoading(true)
    setFileName(file.name)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const extracted = await extractPdfTextLib(arrayBuffer)
      setPdfText(extracted)
      return extracted
    } catch (err) {
      setError('Failed to extract PDF text: ' + err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Convert extracted text → JSON-LD ───────────────────────────────────────
  const handleConvert = useCallback(async (textOverride) => {
    const text = textOverride ?? pdfText
    if (!text.trim()) { setError('No PDF text to convert. Please upload a PDF first.'); return }
    setError('')
    setPostStatus(null)
    try {
      const result = convertPdfToCheckJsonLd(text, awbOverride.trim(), neoneBaseUrl.trim() || DEFAULT_NEONE_BASE)
      setJsonLdOutput(result)
    } catch (err) {
      setError('Conversion error: ' + err.message)
    }
  }, [pdfText, awbOverride, neoneBaseUrl])

  // ── File selection ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      setError('Please select a valid PDF file.')
      return
    }
    const text = await extractPdfText(file)
    if (text) await handleConvert(text)
  }, [extractPdfText, handleConvert])

  const handleFileInput = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = () => setIsDragOver(false)

  // ── Copy ────────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(jsonLdOutput).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Clear ───────────────────────────────────────────────────────────────────
  const handleClear = () => {
    setPdfText('')
    setJsonLdOutput('')
    setError('')
    setFileName('')
    setPostStatus(null)
    setAwbOverride('')
  }

  // ── POST to ONE Record ──────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!jsonLdOutput) { setError('Nothing to post. Convert a PDF first.'); return }
    setPosting(true)
    setPostStatus(null)
    setError('')
    try {
      const token = await fetchAccessToken(neoneTokenUrl.trim() || DEFAULT_TOKEN_URL)
      const base = neoneBaseUrl.trim().replace(/\/$/, '') || DEFAULT_NEONE_BASE
      const res = await fetch(`${base}/logistics-objects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ld+json',
          'Authorization': `Bearer ${token}`,
        },
        body: jsonLdOutput,
      })
      if (res.ok) {
        const location = res.headers.get('Location') || `${base}/logistics-objects (no Location header)`
        setPostStatus({ ok: true, message: `Created: ${location}` })
      } else {
        const errText = await res.text()
        setPostStatus({ ok: false, message: `HTTP ${res.status} ${res.statusText}: ${errText}` })
      }
    } catch (err) {
      setPostStatus({ ok: false, message: err.message })
    } finally {
      setPosting(false)
    }
  }

  const awbDetected = (() => {
    if (!pdfText) return null
    const m = pdfText.match(/\b(\d{3}[-\s]\d{8})\b/)
    return m ? m[1].replace(/\s/, '-') : null
  })()

  return (
    <div className="converter-page">
      <div className="converter-header">
        <h1>📋 Acceptance Checklist → ONE Record</h1>
        <span className="converter-subtitle">
          Upload a DG Acceptance Checklist PDF and convert it to an IATA ONE Record <code>cargo:Check</code> JSON-LD object
        </span>
      </div>

      {/* ── Upload zone ── */}
      <div
        className={`acl-upload-zone${isDragOver ? ' acl-upload-zone--dragover' : ''}${pdfText ? ' acl-upload-zone--filled' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
        aria-label="Upload PDF"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        {loading ? (
          <span className="acl-upload-label">⏳ Extracting text from PDF…</span>
        ) : pdfText ? (
          <span className="acl-upload-label">
            ✅ <strong>{fileName}</strong> — <span className="acl-upload-hint">Click or drop to replace</span>
          </span>
        ) : (
          <span className="acl-upload-label">
            📂 Drop a PDF here or <span className="acl-upload-link">click to browse</span>
            <span className="acl-upload-hint">Accepts DG Acceptance Checklist PDFs</span>
          </span>
        )}
      </div>

      {/* ── AWB override (only visible when auto-detection succeeds or fails) ── */}
      {pdfText && (
        <div className="acl-awb-row">
          <label className="acl-awb-label">AWB number:</label>
          {awbDetected ? (
            <span className="acl-awb-detected">🔍 Auto-detected: <strong>{awbDetected}</strong></span>
          ) : (
            <span className="acl-awb-detected acl-awb-miss">⚠ Not found in PDF</span>
          )}
          <input
            className="acl-awb-input"
            type="text"
            placeholder={awbDetected ? 'Override (optional)' : 'Enter AWB e.g. 516-00000013'}
            value={awbOverride}
            onChange={e => setAwbOverride(e.target.value)}
          />
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="converter-toolbar">
        <button
          className="query-btn"
          onClick={() => handleConvert()}
          disabled={!pdfText.trim() || loading}
        >
          ⇒ Convert to JSON-LD
        </button>
        <button className="clear-btn" onClick={handleClear}>Clear</button>
      </div>

      {/* ── Two-panel output ── */}
      <div className="converter-panels">
        {/* Left: extracted PDF text */}
        <div className="converter-panel">
          <div className="converter-panel-header">
            <span className="converter-panel-title">Extracted PDF Text</span>
            <span className="converter-panel-badge xml">TEXT</span>
          </div>
          <textarea
            className="converter-textarea"
            readOnly
            value={pdfText}
            placeholder="PDF text will appear here after upload…"
            spellCheck={false}
          />
        </div>

        <div className="converter-divider">⇒</div>

        {/* Right: JSON-LD output */}
        <div className="converter-panel">
          <div className="converter-panel-header">
            <span className="converter-panel-title">ONE Record JSON-LD Output</span>
            <span className="converter-panel-badge jsonld">JSON-LD</span>
            {jsonLdOutput && (
              <button className={`copy-btn${copied ? ' copy-btn-done' : ''}`} onClick={handleCopy}>
                {copied ? '✓ Copied!' : '⧉ Copy'}
              </button>
            )}
          </div>
          {error
            ? <div className="converter-error"><strong>Error:</strong> {error}</div>
            : <textarea
                className="converter-textarea converter-output"
                readOnly
                value={jsonLdOutput}
                placeholder="cargo:Check JSON-LD will appear here after conversion…"
                spellCheck={false}
              />
          }
        </div>
      </div>

      {/* ── ONE Record POST section ── */}
      {/* {jsonLdOutput && (
        <div className="acl-post-section">
          <button
            className="acl-post-toggle"
            onClick={() => setShowPostSettings(s => !s)}
          >
            {showPostSettings ? '▲ Hide' : '▼ Post to ONE Record endpoint'}
          </button>

          {showPostSettings && (
            <div className="acl-post-form">
              <div className="acl-post-fields">
                <label className="acl-post-label">neone Base URL</label>
                <input
                  className="acl-post-input"
                  type="text"
                  value={neoneBaseUrl}
                  onChange={e => setNeoneBaseUrl(e.target.value)}
                  placeholder={DEFAULT_NEONE_BASE}
                />
                <label className="acl-post-label">Token URL</label>
                <input
                  className="acl-post-input"
                  type="text"
                  value={neoneTokenUrl}
                  onChange={e => setNeoneTokenUrl(e.target.value)}
                  placeholder={DEFAULT_TOKEN_URL}
                />
              </div>
              <button
                className="query-btn"
                onClick={handlePost}
                disabled={posting}
                style={{ marginTop: '0.5rem' }}
              >
                {posting ? '⏳ Posting…' : '🚀 POST to ONE Record'}
              </button>
              {postStatus && (
                <div className={`acl-post-result${postStatus.ok ? ' acl-post-result--ok' : ' acl-post-result--err'}`}>
                  {postStatus.ok ? '✅ ' : '❌ '}{postStatus.message}
                </div>
              )}
            </div>
          )}
        </div>
      )} */}
    </div>
  )
}
