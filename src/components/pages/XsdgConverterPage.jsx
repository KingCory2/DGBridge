import { useState } from 'react'
import { convertXmlToJsonLd } from '../../lib/convertXmlToJsonLd'
import { convertJsonLdToXml } from '../../lib/convertJsonLdToXml'

const XML_PLACEHOLDER = `<?xml version="1.0" encoding="UTF-8"?>\n<rsm:ShippersDeclarationForDangerousGoods\n    xmlns:rsm="iata:shippersdeclarationfordangerousgoods:1"\n    xmlns:ram="iata:datamodel:3"\n    ...>\n  ...\n</rsm:ShippersDeclarationForDangerousGoods>`
const JSON_PLACEHOLDER = `// Flat @graph format:\n{\n  "@context": { "cargo": "https://onerecord.iata.org/ns/cargo#", ... },\n  "@graph": [ { "@type": "cargo:DgDeclaration", ... }, ... ]\n}\n\n// — or nested format —\n{\n  "@type": "cargo:Shipment",\n  "cargo:pieces": [ ... ]\n}`

export default function XsdgConverterPage() {
  const [direction, setDirection] = useState('xml2json') // 'xml2json' | 'json2xml'
  const [jsonLdFormat, setJsonLdFormat] = useState('nested') // 'nested' | 'flat'
  const [leftInput, setLeftInput] = useState('')
  const [rightOutput, setRightOutput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const handleConvert = async () => {
    setError('')
    setRightOutput('')
    try {
      if (direction === 'xml2json') {
        setRightOutput(await convertXmlToJsonLd(leftInput.trim(), jsonLdFormat))
      } else {
        setRightOutput(await convertJsonLdToXml(leftInput.trim()))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSwap = () => {
    setDirection(d => d === 'xml2json' ? 'json2xml' : 'xml2json')
    setLeftInput(rightOutput)
    setRightOutput('')
    setError('')
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(rightOutput).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleClear = () => { setLeftInput(''); setRightOutput(''); setError('') }

  const isXml2Json = direction === 'xml2json'

  return (
    <div className="converter-page">
      <div className="converter-header">
        <h1>XSDG ⇄ ONE Record Converter</h1>
        <span className="converter-subtitle">Transforms between Shipper's Declaration for Dangerous Goods XML and IATA ONE Record JSON-LD</span>
      </div>
      <div className="converter-toolbar">
        <button className="query-btn" onClick={handleConvert} disabled={!leftInput.trim()}>
          {isXml2Json ? '⇒ XML → JSON-LD' : '⇒ JSON-LD → XML'}
        </button>
        {isXml2Json && (
          <div className="format-toggle" title="JSON-LD output serialization">
            <button
              className={`format-toggle-btn${jsonLdFormat === 'nested' ? ' active' : ''}`}
              onClick={() => setJsonLdFormat('nested')}
            >Nested</button>
            <button
              className={`format-toggle-btn${jsonLdFormat === 'flat' ? ' active' : ''}`}
              onClick={() => setJsonLdFormat('flat')}
            >Flat @graph</button>
          </div>
        )}
        <button className="swap-btn" onClick={handleSwap} title="Swap direction (moves output to input)">⇄ Swap</button>
        <button className="clear-btn" onClick={handleClear}>Clear</button>
      </div>
      <div className="converter-panels">
        <div className="converter-panel">
          <div className="converter-panel-header">
            <span className="converter-panel-title">{isXml2Json ? 'XSDG XML Input' : 'ONE Record JSON-LD Input'}</span>
            <span className={`converter-panel-badge ${isXml2Json ? 'xml' : 'jsonld'}`}>{isXml2Json ? 'XML' : 'JSON-LD'}</span>
          </div>
          <textarea
            className="converter-textarea"
            value={leftInput}
            onChange={e => setLeftInput(e.target.value)}
            placeholder={isXml2Json ? XML_PLACEHOLDER : JSON_PLACEHOLDER}
            spellCheck={false}
          />
        </div>
        <div className="converter-divider">⇒</div>
        <div className="converter-panel">
          <div className="converter-panel-header">
            <span className="converter-panel-title">{isXml2Json ? 'ONE Record JSON-LD Output' : 'XSDG XML Output'}</span>
            <span className={`converter-panel-badge ${isXml2Json ? 'jsonld' : 'xml'}`}>{isXml2Json ? 'JSON-LD' : 'XML'}</span>
            {rightOutput && (
              <button className={`copy-btn ${copied ? 'copy-btn-done' : ''}`} onClick={handleCopy}>
                {copied ? '✓ Copied!' : '⧉ Copy'}
              </button>
            )}
          </div>
          {error
            ? <div className="converter-error"><strong>Error:</strong> {error}</div>
            : <textarea
                className="converter-textarea converter-output"
                readOnly
                value={rightOutput}
                placeholder={isXml2Json ? 'ONE Record JSON-LD graph will appear here…' : 'XSDG XML will appear here…'}
                spellCheck={false}
              />
          }
        </div>
      </div>
    </div>
  )
}
