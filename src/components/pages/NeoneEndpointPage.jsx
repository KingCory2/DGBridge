import { useState } from 'react'
import { NEONE_ENDPOINTS, extractPathParams } from '../../constants/neoneRoutes'
import { fetchAccessToken } from '../../services/neoneApi'

const methodColor = { GET: 'method-get', POST: 'method-post', PATCH: 'method-patch', DELETE: 'method-delete', HEAD: 'method-head' }

export default function NeoneEndpointPage({ neoneBaseUrl, neoneTokenUrl }) {
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [selectedMethod, setSelectedMethod] = useState('')
  const [pathParams, setPathParams] = useState({})
  const [requestBody, setRequestBody] = useState('')
  const [responseText, setResponseText] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const selectEndpoint = (idx) => {
    if (selectedIdx === idx) { setSelectedIdx(null); return }
    const ep = NEONE_ENDPOINTS[idx]
    setSelectedIdx(idx)
    setSelectedMethod(ep.methods[0])
    const paramObj = {}
    extractPathParams(ep.path).forEach(p => { paramObj[p] = '' })
    setPathParams(paramObj)
    setRequestBody('')
    setResponseText('')
  }

  const buildUrl = () => {
    if (selectedIdx === null) return ''
    let path = NEONE_ENDPOINTS[selectedIdx].path
    Object.entries(pathParams).forEach(([k, v]) => {
      path = path.replace(`{${k}}`, encodeURIComponent(v))
    })
    return `${neoneBaseUrl.replace(/\/$/, '')}${path}`
  }

  const handleSend = async () => {
    setIsLoading(true)
    setResponseText('Loading...')
    try {
      const accessToken = await fetchAccessToken(neoneTokenUrl)
      const options = {
        method: selectedMethod,
        headers: {
          'Content-Type': 'application/ld+json',
          Accept: 'application/ld+json',
          Authorization: `Bearer ${accessToken}`
        }
      }
      if (['POST', 'PATCH'].includes(selectedMethod) && requestBody.trim()) {
        options.body = requestBody
      }
      const response = await fetch(buildUrl(), options)
      const text = await response.text()
      let formatted = text
      try { formatted = JSON.stringify(JSON.parse(text), null, 2) } catch {}
      setResponseText(`HTTP ${response.status} ${response.statusText}\n\n${formatted}`)
    } catch (err) {
      setResponseText(`Request failed:\n${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const selectedEp = selectedIdx !== null ? NEONE_ENDPOINTS[selectedIdx] : null

  return (
    <div className="neone-page">
      <div className="neone-header">
        <h1>NEOne Endpoint</h1>
        <span className="neone-base-label">Base URL: <code>{neoneBaseUrl}</code></span>
      </div>
      <div className="neone-endpoints-table">
        {NEONE_ENDPOINTS.map((ep, idx) => (
          <div key={idx} className={`neone-endpoint-row ${selectedIdx === idx ? 'neone-row-active' : ''}`} onClick={() => selectEndpoint(idx)}>
            <div className="neone-methods">
              {ep.methods.map(m => <span key={m} className={`method-badge ${methodColor[m]}`}>{m}</span>)}
            </div>
            <div className="neone-path">{ep.path}</div>
            <div className="neone-desc">{ep.description}</div>
          </div>
        ))}
      </div>

      {selectedEp && (
        <div className="neone-request-panel">
          <div className="neone-request-row">
            <div className="neone-method-btns">
              {selectedEp.methods.map(m => (
                <button key={m} className={`method-btn ${methodColor[m]} ${selectedMethod === m ? 'method-btn-active' : ''}`} onClick={() => setSelectedMethod(m)}>{m}</button>
              ))}
            </div>
            <input className="neone-url-input" readOnly value={buildUrl()} />
          </div>

          {Object.keys(pathParams).length > 0 && (
            <div className="neone-params">
              <h4>Path Parameters</h4>
              {Object.keys(pathParams).map(param => (
                <div className="form-group" key={param}>
                  <label>{param}</label>
                  <input type="text" value={pathParams[param]} onChange={e => setPathParams(prev => ({ ...prev, [param]: e.target.value }))} placeholder={`Enter ${param}`} />
                </div>
              ))}
            </div>
          )}

          {['POST', 'PATCH'].includes(selectedMethod) && (
            <div className="neone-body">
              <h4>Request Body (JSON-LD)</h4>
              <textarea className="neone-body-input" value={requestBody} onChange={e => setRequestBody(e.target.value)} placeholder='{"@context": "https://onerecord.iata.org/ns/cargo", ...}' />
            </div>
          )}

          <button className="query-btn" onClick={handleSend} disabled={isLoading}>
            {isLoading ? 'Sending...' : 'Send Request'}
          </button>

          {responseText && (
            <textarea className="query-result-box" readOnly value={responseText} />
          )}
        </div>
      )}
    </div>
  )
}
