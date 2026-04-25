import { useState } from 'react'
import { DEFAULT_SPARQL_QUERY } from '../../constants/defaults'

export default function GraphDbPage({ graphdbEndpoint }) {
  const [sparqlQuery, setSparqlQuery] = useState(DEFAULT_SPARQL_QUERY)
  const [queryResult, setQueryResult] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [httpMethod, setHttpMethod] = useState('GET')

  const handleRunQuery = async () => {
    setIsLoading(true)
    setQueryResult('Loading...')
    try {
      const fetchOptions = httpMethod === 'POST'
        ? {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/sparql-results+json'
            },
            body: `query=${encodeURIComponent(sparqlQuery)}`
          }
        : {
            method: 'GET',
            headers: { Accept: 'application/sparql-results+json' }
          }
      const url = httpMethod === 'GET'
        ? `${graphdbEndpoint}?query=${encodeURIComponent(sparqlQuery)}`
        : graphdbEndpoint
      const response = await fetch(url, fetchOptions)
      if (!response.ok) {
        setQueryResult(`Error: ${response.status} ${response.statusText}`)
        return
      }
      const data = await response.json()
      const bindings = data.results?.bindings ?? []
      if (bindings.length === 0) {
        setQueryResult('Query returned no results.')
        return
      }
      const vars = data.head?.vars ?? []
      const lines = bindings.map((row, i) => {
        const parts = vars.map(v => `${v}=${row[v]?.value ?? ''}`)
        return `[${i + 1}] ${parts.join('  ')}`
      })
      setQueryResult(`Results (${bindings.length}):\n\n${lines.join('\n')}`)
    } catch (err) {
      setQueryResult(`Failed to reach GraphDB:\n${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="graph-db-page">
      <h1>GraphDB Endpoint Testing</h1>
      <div className="sparql-input-section">
        <label htmlFor="sparqlQuery"><strong>SPARQL Query</strong></label>
        <textarea
          id="sparqlQuery"
          className="sparql-input-box"
          value={sparqlQuery}
          onChange={(e) => setSparqlQuery(e.target.value)}
          placeholder="Enter your SPARQL query here..."
          spellCheck={false}
        />
      </div>
      <div className="sparql-controls">
        <div className="method-toggle">
          {['GET', 'POST'].map(m => (
            <button
              key={m}
              className={`method-toggle-btn method-toggle-${m.toLowerCase()} ${httpMethod === m ? 'method-toggle-active' : ''}`}
              onClick={() => setHttpMethod(m)}
            >{m}</button>
          ))}
        </div>
        <button className="query-btn" onClick={handleRunQuery} disabled={isLoading || !sparqlQuery.trim()}>
          {isLoading ? 'Running...' : 'Run Query'}
        </button>
      </div>
      {queryResult !== '' && (
        <textarea
          className="query-result-box"
          readOnly
          value={queryResult}
        />
      )}
    </div>
  )
}
