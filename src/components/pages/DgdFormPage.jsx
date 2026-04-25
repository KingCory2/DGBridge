import { useState } from 'react'
import jsonld from 'jsonld'
import rdf from 'rdf-ext'
import { fetchAccessToken } from '../../services/neoneApi'
import { NS_CARGO, NS_XSD, NS_RDF_TYPE } from '../../constants/ontology'
import { DEFAULT_NEONE_BASE_URL } from '../../constants/defaults'

// ── N-Quads helpers (no extra packages needed) ────────────────────────────────
function termToNt(term) {
  if (term.termType === 'NamedNode') return `<${term.value}>`
  if (term.termType === 'BlankNode') return `_:${term.value}`
  const dt = term.datatype ? term.datatype.value : 'http://www.w3.org/2001/XMLSchema#string'
  const escaped = term.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  return `"${escaped}"^^<${dt}>`
}
function datasetToNQuads(ds) {
  return [...ds].map(q => `${termToNt(q.subject)} ${termToNt(q.predicate)} ${termToNt(q.object)} .`).join('\n')
}
// ─────────────────────────────────────────────────────────────────────────────

const JSONLD_FORMATS = [
  { id: 'compacted', label: 'Compacted' },
  { id: 'expanded',  label: 'Expanded'  },
  { id: 'flattened', label: 'Flattened' },
  { id: 'framed',    label: 'Framed'    },
]

async function applyJsonLdFormat(doc, format) {
  const ctx = doc['@context']
  switch (format) {
    case 'compacted':
      return jsonld.compact(doc, ctx)
    case 'expanded':
      return jsonld.expand(doc)
    case 'flattened':
      return jsonld.flatten(doc, ctx)
    case 'framed': {
      const frame = {
        '@context': ctx,
        '@type': 'https://onerecord.iata.org/ns/cargo#Shipment',
        'https://onerecord.iata.org/ns/cargo#waybill': {
          '@type': 'https://onerecord.iata.org/ns/cargo#Waybill'
        },
        'https://onerecord.iata.org/ns/cargo#pieces': {
          '@type': 'https://onerecord.iata.org/ns/cargo#PieceDg',
          'https://onerecord.iata.org/ns/cargo#dgDeclaration': {
            '@type': 'https://onerecord.iata.org/ns/cargo#DgDeclaration'
          }
        }
      }
      return jsonld.frame(doc, frame)
    }
    default:
      return doc
  }
}

const emptyRow = () => ({ unId: '', properShippingName: '', classDivision: '', subsidiaryhazard: '', packingGroup: '', quantity: '', packingInst: '', authorization: '' })

async function buildJsonLd(form, neoneBaseUrl) {
  const base = (neoneBaseUrl || DEFAULT_NEONE_BASE_URL).replace(/\/$/, '')
  const awb = form.airWaybillNo || 'unknown'
  const slug = awb.replace(/[^a-zA-Z0-9-]/g, '-')
  const ctx = {
    '@vocab': NS_CARGO,
    cargo: NS_CARGO,
    xsd: NS_XSD
  }

  // Namespace shortcuts
  const cargo = rdf.namespace(NS_CARGO)
  const xsd   = rdf.namespace(NS_XSD)
  const rdfType = rdf.namedNode(NS_RDF_TYPE)

  // Named nodes for every logistics object
  const shipment   = rdf.namedNode(`${base}/logistics-objects/shipment-${slug}`)
  const waybill    = rdf.namedNode(`${base}/logistics-objects/waybill-${slug}`)
  const shipper    = rdf.namedNode(`${base}/logistics-objects/party-shipper-${slug}`)
  const consignee  = rdf.namedNode(`${base}/logistics-objects/party-consignee-${slug}`)
  const dept       = rdf.namedNode(`${base}/logistics-objects/location-dept-${slug}`)
  const dest       = rdf.namedNode(`${base}/logistics-objects/location-dest-${slug}`)
  const decl       = rdf.namedNode(`${base}/logistics-objects/dgdeclaration-${slug}`)

  const ds = rdf.dataset()
  const add = (s, p, o) => ds.add(rdf.quad(s, p, o))

  // ── Shipment ──
  add(shipment, rdfType, cargo('Shipment'))
  add(shipment, cargo('waybill'), waybill)

  // ── Waybill ──
  add(waybill, rdfType, cargo('Waybill'))
  add(waybill, cargo('waybillType'), rdf.literal('Master'))
  const awbParts = awb.match(/^(\d+)-(\d+)$/)
  add(waybill, cargo('waybillNumber'), rdf.literal(awbParts ? awbParts[2] : awb))
  if (awbParts) add(waybill, cargo('waybillPrefix'), rdf.literal(awbParts[1]))
  add(waybill, cargo('involvedParties'), shipper)
  add(waybill, cargo('involvedParties'), consignee)
  if (form.airportDeparture)  add(waybill, cargo('departureLocation'), dept)
  if (form.airportDestination) add(waybill, cargo('arrivalLocation'), dest)

  // ── Departure location ──
  if (form.airportDeparture) {
    add(dept, rdfType, cargo('Location'))
    add(dept, cargo('locationName'), rdf.literal(form.airportDeparture))
  }

  // ── Arrival location ──
  if (form.airportDestination) {
    add(dest, rdfType, cargo('Location'))
    add(dest, cargo('locationName'), rdf.literal(form.airportDestination))
  }

  // ── Shipper ──
  add(shipper, rdfType, cargo('Organization'))
  if (form.shipper.name) add(shipper, cargo('name'), rdf.literal(form.shipper.name))
  if (form.shipper.address1) {
    const shipperAddr = rdf.blankNode(`shipperAddr-${slug}`)
    add(shipper, cargo('address'), shipperAddr)
    add(shipperAddr, rdfType, cargo('Address'))
    const street = [form.shipper.address1, form.shipper.address2].filter(Boolean).join(', ')
    add(shipperAddr, cargo('streetAddress'), rdf.literal(street))
    if (form.shipper.cityStateZip) add(shipperAddr, cargo('cityName'),    rdf.literal(form.shipper.cityStateZip))
    if (form.shipper.country)      add(shipperAddr, cargo('countryCode'), rdf.literal(form.shipper.country))
  }

  // ── Consignee ──
  add(consignee, rdfType, cargo('Organization'))
  if (form.consignee.name) add(consignee, cargo('name'), rdf.literal(form.consignee.name))
  if (form.consignee.address1) {
    const consigneeAddr = rdf.blankNode(`consigneeAddr-${slug}`)
    add(consignee, cargo('address'), consigneeAddr)
    add(consigneeAddr, rdfType, cargo('Address'))
    const street = [form.consignee.address1, form.consignee.address2].filter(Boolean).join(', ')
    add(consigneeAddr, cargo('streetAddress'), rdf.literal(street))
    if (form.consignee.cityStateZip) add(consigneeAddr, cargo('cityName'),    rdf.literal(form.consignee.cityStateZip))
    if (form.consignee.country)      add(consigneeAddr, cargo('countryCode'), rdf.literal(form.consignee.country))
  }

  // ── DgDeclaration ──
  add(decl, rdfType, cargo('DgDeclaration'))
  add(decl, cargo('aircraftLimitationInformation'), rdf.literal(form.aircraftType))
  add(decl, cargo('hazardTypeCode'), rdf.literal(form.shipmentType === 'radioactive' ? 'RADIOACTIVE' : 'NON-RADIOACTIVE'))
  if (form.shipperRefNo)      add(decl, cargo('shipperReference'),     rdf.literal(form.shipperRefNo))
  if (form.additionalHandling) add(decl, cargo('handlingInformation'), rdf.literal(form.additionalHandling))
  if (form.signatoryName)     add(decl, cargo('consignorSignatory'),   rdf.literal(form.signatoryName))
  if (form.signDate)          add(decl, cargo('declarationDate'),      rdf.literal(form.signDate, xsd('date')))
  add(decl, cargo('involvedParties'), shipper)
  add(decl, cargo('involvedParties'), consignee)
  if (form.airportDeparture)   add(decl, cargo('departureLocation'), dept)
  if (form.airportDestination) add(decl, cargo('arrivalLocation'),   dest)

  // ── Pieces ──
  const filteredRows = form.dgRows.filter(r => r.unId || r.properShippingName)
  filteredRows.forEach((row, i) => {
    const piece   = rdf.namedNode(`${base}/logistics-objects/piecedg-${slug}-${i + 1}`)
    const product = rdf.blankNode(`productDg-${slug}-${i}`)

    add(shipment, cargo('pieces'), piece)
    add(decl, cargo('issuedForPiece'), piece)

    add(piece, rdfType, cargo('PieceDg'))
    add(piece, cargo('dgDeclaration'), decl)
    add(piece, cargo('hasDgProductData'), product)

    add(product, rdfType, cargo('ProductDg'))
    if (row.unId)             add(product, cargo('unNumber'),                 rdf.literal(row.unId))
    if (row.properShippingName) add(product, cargo('properShippingName'),     rdf.literal(row.properShippingName))
    if (row.classDivision)    add(product, cargo('dgClassCode'),              rdf.literal(row.classDivision))
    if (row.subsidiaryhazard) add(product, cargo('subsidiaryHazardClassCodes'), rdf.literal(row.subsidiaryhazard))
    if (row.packingGroup)     add(product, cargo('packingGroupCode'),         rdf.literal(row.packingGroup))
    if (row.packingInst)      add(product, cargo('packingInstructionNumber'), rdf.literal(row.packingInst))
    if (row.authorization)    add(product, cargo('specialServiceRequest'),   rdf.literal(row.authorization))
  })

  // ── Serialize dataset → N-Quads → JSON-LD (expanded) → compacted ──
  const nq = datasetToNQuads(ds)
  const expanded = await jsonld.fromRDF(nq, { format: 'application/n-quads' })
  return jsonld.compact(expanded, ctx)
}

function validateForm(form) {
  const errs = {}
  if (!form.airWaybillNo.trim()) errs['airWaybillNo'] = 'Required'
  if (!form.shipper.name.trim()) errs['shipper.name'] = 'Required'
  if (!form.shipper.address1.trim()) errs['shipper.address1'] = 'Required'
  if (!form.consignee.name.trim()) errs['consignee.name'] = 'Required'
  if (!form.consignee.address1.trim()) errs['consignee.address1'] = 'Required'
  const filledRows = form.dgRows.filter(r => r.unId || r.properShippingName || r.classDivision)
  if (filledRows.length === 0) {
    errs['dgRows'] = 'At least one dangerous good must be specified'
  } else {
    form.dgRows.forEach((row, i) => {
      if ((row.properShippingName || row.classDivision) && !row.unId) errs[`dgRows.${i}.unId`] = 'Required'
      if ((row.unId || row.classDivision) && !row.properShippingName) errs[`dgRows.${i}.properShippingName`] = 'Required'
      if ((row.unId || row.properShippingName) && !row.classDivision) errs[`dgRows.${i}.classDivision`] = 'Required'
    })
  }
  if (!form.signatoryName.trim()) errs['signatoryName'] = 'Required'
  if (!form.signDate) errs['signDate'] = 'Required'
  if (!form.signature.trim()) errs['signature'] = 'Required'
  return errs
}

const DUMMY_DATA = {
  airWaybillNo: '501-19870056',
  pageNumber: '1',
  totalPages: '1',
  shipperRefNo: '',
  shipper: {
    name: 'FASHION',
    address1: '11, Ramon y Cajal',
    address2: '15006 La Coruna',
    cityStateZip: 'La Coruna',
    country: 'ES Spain',
    phone: '0034 (981) 55 47 33'
  },
  consignee: {
    name: 'Wild Market',
    address1: '100, Rene-Levesque Blvd. West',
    address2: 'H2Z 1V5 Montreal Quebec',
    cityStateZip: 'Montreal Quebec',
    country: 'CA Canada',
    phone: '011 448 4050'
  },
  aircraftType: 'passenger-and-cargo',
  airportDeparture: 'Barcelona ES BCN',
  airportDestination: 'Montreal-Dorval Apt CA YUL',
  shipmentType: 'non-radioactive',
  dgRows: [{
    unId: 'UN2339',
    properShippingName: '2-Bromobutane',
    classDivision: '3',
    subsidiaryhazard: '',
    packingGroup: 'II',
    quantity: '2 L',
    packingInst: '305',
    authorization: ''
  }],
  additionalHandling: 'Health Department\n24 hour number: +34 (981) 34 23 99',
  signatoryName: 'B. Smith / Dispatch Officer',
  signDate: '2026-04-22',
  signature: 'B. Smith'
}

export default function DgdFormPage({ neoneBaseUrl, neoneTokenUrl, initialAwb = '', viewOnly = false, onClose, onSubmitSuccess }) {
  const [form, setForm] = useState({
    airWaybillNo: initialAwb,
    pageNumber: '1',
    totalPages: '1',
    shipperRefNo: '',
    shipper: { name: '', address1: '', address2: '', cityStateZip: '', country: '', phone: '' },
    consignee: { name: '', address1: '', address2: '', cityStateZip: '', country: '', phone: '' },
    aircraftType: 'passenger-and-cargo',
    airportDeparture: '',
    airportDestination: '',
    shipmentType: 'non-radioactive',
    dgRows: [emptyRow()],
    additionalHandling: '',
    signatoryName: '',
    signDate: new Date().toISOString().split('T')[0],
    signature: '',
  })
  const [jsonLdFormat, setJsonLdFormat] = useState('compacted')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResponse, setSubmitResponse] = useState(null)
  const [submitSuccess, setSubmitSuccess] = useState(null) // { awb, locationId }
  const [previewJson, setPreviewJson] = useState(null)
  const [errors, setErrors] = useState({})

  const updateField = (path, value) => {
    setErrors(prev => { const next = { ...prev }; delete next[path]; return next })
    setForm(prev => {
      const next = { ...prev }
      const parts = path.split('.')
      if (parts.length === 1) {
        next[parts[0]] = value
      } else {
        next[parts[0]] = { ...prev[parts[0]], [parts[1]]: value }
      }
      return next
    })
  }

  const updateRow = (idx, field, value) => {
    setErrors(prev => { const next = { ...prev }; delete next[`dgRows.${idx}.${field}`]; delete next['dgRows']; return next })
    setForm(prev => {
      const rows = prev.dgRows.map((r, i) => i === idx ? { ...r, [field]: value } : r)
      return { ...prev, dgRows: rows }
    })
  }

  const addRow = () => setForm(prev => ({ ...prev, dgRows: [...prev.dgRows, emptyRow()] }))
  const removeRow = (idx) => setForm(prev => ({ ...prev, dgRows: prev.dgRows.filter((_, i) => i !== idx) }))

  const fillDummy = () => {
    setErrors({})
    setSubmitResponse(null)
    setPreviewJson(null)
    setForm({ ...DUMMY_DATA, airWaybillNo: initialAwb || DUMMY_DATA.airWaybillNo })
  }

  const handlePreview = async () => {
    const errs = validateForm(form)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    setSubmitResponse(null)
    try {
      const doc = await buildJsonLd(form, neoneBaseUrl)
      const result = await applyJsonLdFormat(doc, jsonLdFormat)
      setPreviewJson(JSON.stringify(result, null, 2))
    } catch (err) {
      setPreviewJson(`Error applying format: ${err.message}`)
    }
  }

  const handleSubmit = async () => {
    const errs = validateForm(form)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setIsSubmitting(true)
    setSubmitResponse(null)
    try {
      const accessToken = await fetchAccessToken(neoneTokenUrl)
      const endpoint = `${(neoneBaseUrl || 'http://localhost:8080').replace(/\/$/, '')}/logistics-objects`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ld+json',
          Accept: 'application/ld+json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(await applyJsonLdFormat(await buildJsonLd(form, neoneBaseUrl), jsonLdFormat), null, 2)
      })
      const locationHeader = res.headers.get('Location')
      const text = await res.text()
      let formatted = text
      try { formatted = JSON.stringify(JSON.parse(text), null, 2) } catch {}
      let loMessage = ''
      if (res.ok && locationHeader) {
        try { await navigator.clipboard.writeText(locationHeader) } catch {}
        loMessage = `\nThe Created LO id is : ${locationHeader} [Copied to clipboard]`
      }
      setSubmitResponse({ ok: res.ok, text: `HTTP ${res.status} ${res.statusText}${loMessage}\n\n${formatted}` })
      if (res.ok) {
        setSubmitSuccess({ awb: form.airWaybillNo, locationId: locationHeader })
      }
    } catch (err) {
      setSubmitResponse({ ok: false, text: `Request failed:\n${err.message}` })
    } finally {
      setIsSubmitting(false)
    }
  }

  const tf = (id, value, onChange, placeholder = '', extra = {}, error = '') => (
    <>
      <input
        type="text"
        id={id}
        className={`dgd-input${error ? ' dgd-input-error' : ''}${extra.disabled ? ' dgd-input-readonly' : ''}`}
        value={value}
        onChange={e => !extra.disabled && onChange(e.target.value)}
        placeholder={placeholder}
        {...extra}
      />
      {error && <span className="dgd-field-error">{error}</span>}
    </>
  )

  return (
    <div className="dgd-form-page">
      {viewOnly && (
        <div className="dgd-viewonly-banner">
          <span>� AWB <strong>{initialAwb}</strong> pre-filled — AWB number locked</span>
          {onClose && <button className="dgd-viewonly-close" onClick={onClose}>← Back to DG AWB</button>}
        </div>
      )}
      <div className="dgd-form-paper">
        {/* ── Title bar ── */}
        <div className="dgd-title-bar">
          <div className="dgd-title-text">
            <strong>SHIPPER'S DECLARATION FOR DANGEROUS GOODS</strong>
          </div>
          <div className="dgd-iata-logo">IATA</div>
        </div>

        {/* ── Row 1: Shipper + AWB block ── */}
        <div className="dgd-row1">
          <div className="dgd-shipper-block dgd-block">
            <div className="dgd-block-label">Shipper</div>
            {tf('shipper-name', form.shipper.name, v => updateField('shipper.name', v), 'Company / Name', {}, errors['shipper.name'])}
            {tf('shipper-addr1', form.shipper.address1, v => updateField('shipper.address1', v), 'Address line 1', {}, errors['shipper.address1'])}
            {tf('shipper-addr2', form.shipper.address2, v => updateField('shipper.address2', v), 'Address line 2')}
            {tf('shipper-city', form.shipper.cityStateZip, v => updateField('shipper.cityStateZip', v), 'City / State / ZIP')}
            {tf('shipper-country', form.shipper.country, v => updateField('shipper.country', v), 'Country')}
            {tf('shipper-phone', form.shipper.phone, v => updateField('shipper.phone', v), 'Phone')}
          </div>
          <div className="dgd-awb-block dgd-block">
            <div className="dgd-awb-row">
              <label>Air Waybill No.</label>
              {tf('awbno', form.airWaybillNo, v => updateField('airWaybillNo', v), '000-00000000', { disabled: viewOnly }, errors['airWaybillNo'])}
            </div>
            <div className="dgd-awb-row dgd-pages-row">
              <label>Page</label>
              <input type="number" className="dgd-input dgd-page-num" min="1" value={form.pageNumber}
                onChange={e => updateField('pageNumber', e.target.value)} />
              <span>of</span>
              <input type="number" className="dgd-input dgd-page-num" min="1" value={form.totalPages}
                onChange={e => updateField('totalPages', e.target.value)} />
              <span>Pages</span>
            </div>
            <div className="dgd-awb-row">
              <label>Shipper's Reference No. <em>(optional)</em></label>
              {tf('shipperref', form.shipperRefNo, v => updateField('shipperRefNo', v), 'optional')}
            </div>
          </div>
        </div>

        {/* ── Consignee ── */}
        <div className="dgd-block dgd-consignee-block">
          <div className="dgd-block-label">Consignee</div>
          {tf('cons-name', form.consignee.name, v => updateField('consignee.name', v), 'Company / Name', {}, errors['consignee.name'])}
          {tf('cons-addr1', form.consignee.address1, v => updateField('consignee.address1', v), 'Address line 1', {}, errors['consignee.address1'])}
          {tf('cons-addr2', form.consignee.address2, v => updateField('consignee.address2', v), 'Address line 2')}
          {tf('cons-city', form.consignee.cityStateZip, v => updateField('consignee.cityStateZip', v), 'City / State / ZIP')}
          {tf('cons-country', form.consignee.country, v => updateField('consignee.country', v), 'Country')}
          {tf('cons-phone', form.consignee.phone, v => updateField('consignee.phone', v), 'Phone')}
        </div>

        {/* ── Warning ── */}
        <div className="dgd-warning-block">
          <div className="dgd-warning-title">WARNING</div>
          <p>Failure to comply in all respects with the applicable Dangerous Goods Regulations may be in breach of the applicable law, subject to legal penalties.</p>
          <p className="dgd-warning-copies">Two completed and signed copies of this Declaration must be handed to the operator.</p>
        </div>

        {/* ── Transport Details ── */}
        <div className="dgd-transport-section">
          <div className="dgd-transport-left">
            <div className="dgd-section-title">TRANSPORT DETAILS</div>
            <div className="dgd-transport-limitations">
              <p>This shipment is within the limitations prescribed for: <em>(delete non-applicable)</em></p>
              <div className="dgd-radio-group dgd-aircraft-radios">
                <label className={`dgd-radio-box ${form.aircraftType === 'passenger-and-cargo' ? 'dgd-radio-box-crossed' : ''}`}>
                  <input type="radio" name="aircraftType" value="passenger-and-cargo"
                    checked={form.aircraftType === 'passenger-and-cargo'}
                    onChange={e => updateField('aircraftType', e.target.value)} />
                  PASSENGER AND CARGO AIRCRAFT
                </label>
                <label className={`dgd-radio-box ${form.aircraftType === 'cargo-only' ? 'dgd-radio-box-crossed' : ''}`}>
                  <input type="radio" name="aircraftType" value="cargo-only"
                    checked={form.aircraftType === 'cargo-only'}
                    onChange={e => updateField('aircraftType', e.target.value)} />
                  CARGO AIRCRAFT ONLY
                </label>
              </div>
            </div>
            <div className="dgd-airport-row">
              <div className="dgd-airport-field">
                <label>Airport of Departure <em>(optional)</em>:</label>
                {tf('dept', form.airportDeparture, v => updateField('airportDeparture', v), 'e.g. Barcelona ES BCN')}
              </div>
            </div>
            <div className="dgd-airport-row">
              <div className="dgd-airport-field">
                <label>Airport of Destination <em>(optional)</em>:</label>
                {tf('dest', form.airportDestination, v => updateField('airportDestination', v), 'e.g. Montreal-Dorval CA YUL')}
              </div>
            </div>
          </div>
          <div className="dgd-transport-right">
            <div className="dgd-section-title">Shipment type: <em>(delete non-applicable)</em></div>
            <div className="dgd-radio-group dgd-shipment-radios">
              <label className={`dgd-radio-box ${form.shipmentType === 'non-radioactive' ? 'dgd-radio-box-selected' : ''}`}>
                <input type="radio" name="shipmentType" value="non-radioactive"
                  checked={form.shipmentType === 'non-radioactive'}
                  onChange={e => updateField('shipmentType', e.target.value)} />
                NON-RADIOACTIVE
              </label>
              <label className={`dgd-radio-box ${form.shipmentType === 'radioactive' ? 'dgd-radio-box-selected' : ''}`}>
                <input type="radio" name="shipmentType" value="radioactive"
                  checked={form.shipmentType === 'radioactive'}
                  onChange={e => updateField('shipmentType', e.target.value)} />
                RADIOACTIVE
              </label>
            </div>
          </div>
        </div>

        {/* ── Nature and Quantity of Dangerous Goods ── */}
        <div className="dgd-goods-section">
          <div className="dgd-section-title">NATURE AND QUANTITY OF DANGEROUS GOODS</div>
          <div className="dgd-section-subtitle">Dangerous Goods Identification</div>
          <div className="dgd-table-wrapper">
            <table className="dgd-table">
              <thead>
                <tr>
                  <th>UN or<br/>ID No.</th>
                  <th>Proper Shipping Name</th>
                  <th>Class or Division<br/><span className="dgd-th-sub">(subsidiary hazard)</span></th>
                  <th>Packing<br/>Group</th>
                  <th>Quantity and Type of Packing</th>
                  <th>Packing<br/>Inst.</th>
                  <th>Authorization</th>
                  <th className="dgd-th-action"></th>
                </tr>
              </thead>
              <tbody>
                {form.dgRows.map((row, idx) => (
                  <tr key={idx}>
                    <td>
                      <input className={`dgd-input dgd-cell-input${errors[`dgRows.${idx}.unId`] ? ' dgd-input-error' : ''}`} value={row.unId} onChange={e => updateRow(idx, 'unId', e.target.value)} placeholder="UN1234" />
                      {errors[`dgRows.${idx}.unId`] && <span className="dgd-field-error">{errors[`dgRows.${idx}.unId`]}</span>}
                    </td>
                    <td>
                      <input className={`dgd-input dgd-cell-input${errors[`dgRows.${idx}.properShippingName`] ? ' dgd-input-error' : ''}`} value={row.properShippingName} onChange={e => updateRow(idx, 'properShippingName', e.target.value)} placeholder="Proper shipping name" />
                      {errors[`dgRows.${idx}.properShippingName`] && <span className="dgd-field-error">{errors[`dgRows.${idx}.properShippingName`]}</span>}
                    </td>
                    <td>
                      <input className={`dgd-input dgd-cell-input dgd-cell-narrow${errors[`dgRows.${idx}.classDivision`] ? ' dgd-input-error' : ''}`} value={row.classDivision} onChange={e => updateRow(idx, 'classDivision', e.target.value)} placeholder="3" />
                      {errors[`dgRows.${idx}.classDivision`] && <span className="dgd-field-error">{errors[`dgRows.${idx}.classDivision`]}</span>}
                      <input className="dgd-input dgd-cell-input dgd-cell-narrow" value={row.subsidiaryhazard} onChange={e => updateRow(idx, 'subsidiaryhazard', e.target.value)} placeholder="(sub)" style={{marginTop: '2px'}} />
                    </td>
                    <td><input className="dgd-input dgd-cell-input dgd-cell-narrow" value={row.packingGroup} onChange={e => updateRow(idx, 'packingGroup', e.target.value)} placeholder="II" /></td>
                    <td><input className="dgd-input dgd-cell-input" value={row.quantity} onChange={e => updateRow(idx, 'quantity', e.target.value)} placeholder="e.g. 2 L" /></td>
                    <td><input className="dgd-input dgd-cell-input dgd-cell-narrow" value={row.packingInst} onChange={e => updateRow(idx, 'packingInst', e.target.value)} placeholder="305" /></td>
                    <td><input className="dgd-input dgd-cell-input" value={row.authorization} onChange={e => updateRow(idx, 'authorization', e.target.value)} /></td>
                    <td>
                      {form.dgRows.length > 1 && (
                        <button className="dgd-remove-row-btn" onClick={() => removeRow(idx)} title="Remove row">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="dgd-add-row-btn" onClick={addRow}>+ Add Row</button>
          {errors['dgRows'] && <span className="dgd-field-error dgd-rows-error">{errors['dgRows']}</span>}
        </div>

        {/* ── Additional Handling Information ── */}
        <div className="dgd-block dgd-handling-block">
          <div className="dgd-block-label">Additional Handling Information</div>
          <textarea
            className="dgd-input dgd-textarea"
            value={form.additionalHandling}
            onChange={e => updateField('additionalHandling', e.target.value)}
            placeholder="Enter any additional handling information..."
            rows={3}
          />
        </div>

        {/* ── Declaration + Signatory ── */}
        <div className="dgd-declaration-section">
          <div className="dgd-declaration-text">
            I hereby declare that the contents of this consignment are fully and accurately described above by the proper
            shipping name, and are classified, packaged marked and labelled/placarded, and are in all respects in proper
            condition for transport according to applicable international and national governmental regulations. I declare
            that all of the applicable air transport requirements have been met.
          </div>
          <div className="dgd-signatory-block">
            <div className="dgd-signatory-field">
              <label>Name of Signatory</label>
              {tf('signatory', form.signatoryName, v => updateField('signatoryName', v), 'Full name / Title', {}, errors['signatoryName'])}
            </div>
            <div className="dgd-signatory-field">
              <label>Date</label>
              <input type="date" className={`dgd-input${errors['signDate'] ? ' dgd-input-error' : ''}`} value={form.signDate}
                onChange={e => updateField('signDate', e.target.value)} />
              {errors['signDate'] && <span className="dgd-field-error">{errors['signDate']}</span>}
            </div>
            <div className="dgd-signatory-field">
              <label>Signature <em>(See warning above)</em></label>
              {tf('signature', form.signature, v => updateField('signature', v), 'Type name as signature', {}, errors['signature'])}
            </div>
          </div>
        </div>

        {/* ── Submit ── */}
        <div className="dgd-submit-section">
          {/* <div className="dgd-format-toggle-row">
            <span className="dgd-format-label">JSON-LD Format:</span>
            <div className="dgd-format-toggle">
              {JSONLD_FORMATS.map(f => (
                <button
                  key={f.id}
                  className={`dgd-format-btn${jsonLdFormat === f.id ? ' dgd-format-btn-active' : ''}`}
                  onClick={() => { setJsonLdFormat(f.id); setPreviewJson(null) }}
                  type="button"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div> */}
          <div className="dgd-submit-row">
            <button
              className="dgd-submit-btn"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting…' : '🆕 Create DGD'}
            </button>
            {/* <button
              className="dgd-preview-btn"
              onClick={handlePreview}
              disabled={isSubmitting}
              type="button"
            >
              👁 Preview JSON-LD
            </button> */}
            <button
              className="dgd-dummy-btn"
              onClick={fillDummy}
              disabled={isSubmitting}
              type="button"
            >
              ✍️ Fill with Dummy Data
            </button>
          </div>
          {previewJson && !submitResponse && (
            <div className="dgd-submit-response dgd-response-preview">
              <div className="dgd-preview-header">
                <span>Preview — {JSONLD_FORMATS.find(f => f.id === jsonLdFormat)?.label}</span>
                <button className="dgd-preview-close" onClick={() => setPreviewJson(null)} type="button">✕</button>
              </div>
              <pre>{previewJson}</pre>
            </div>
          )}
          {submitResponse && !submitSuccess && (
            <div className={`dgd-submit-response ${submitResponse.ok ? 'dgd-response-ok' : 'dgd-response-err'}`}>
              <pre>{submitResponse.text}</pre>
            </div>
          )}

        {submitSuccess && (
          <div className="settings-overlay">
            <div className="settings-modal dgd-success-modal">
              <div className="settings-modal-header">
                <h2>✅ DGD Created</h2>
              </div>
              <div className="settings-modal-body">
                <p>The Shipper's Dangerous Goods Declaration for AWB <strong>{submitSuccess.awb}</strong> was created successfully.</p>
              </div>
              <div className="settings-modal-footer">
                <button
                  className="btn-primary"
                  onClick={() => {
                    setSubmitSuccess(null)
                    if (onSubmitSuccess) onSubmitSuccess(submitSuccess.awb)
                  }}
                >
                  ← Back to DG AWB
                </button>
              </div>
            </div>
          </div>
        )}
        </div>

      </div>
    </div>
  )
}
