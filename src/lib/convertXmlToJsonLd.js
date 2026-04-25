import rdf from 'rdf-ext'
import JsonLdSerializer from '@rdfjs/serializer-jsonld'
import jsonld from 'jsonld'
import { JSONLD_CONTEXT as CONTEXT } from '../constants/ontology'

async function buildDataset(jsonLdObj) {
  console.debug('[xml→jsonld] Serializing JSON-LD to N-Quads via jsonld.toRDF…')
  const nquads = await jsonld.toRDF(jsonLdObj, { format: 'application/n-quads' })
  const lines = nquads.split('\n').filter(l => l.trim())
  console.debug(`[xml→jsonld] N-Quads generated: ${lines.length} triples`)
  const ds = rdf.dataset()
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(\S+)\s+(.+?)\s*\.\s*$/)
    if (!m) continue
    const subject = parseTerm(m[1])
    const predicate = parseTerm(m[2])
    const object = parseTerm(m[3])
    if (subject && predicate && object) {
      ds.add(rdf.quad(subject, predicate, object))
    }
  }
  console.debug(`[xml→jsonld] rdf-ext Dataset built: ${ds.size} quads`)
  return ds
}

function parseTerm(s) {
  s = s.trim()
  if (s.startsWith('<') && s.endsWith('>')) return rdf.namedNode(s.slice(1, -1))
  if (s.startsWith('_:')) return rdf.blankNode(s.slice(2))
  // literal
  const dtMatch = s.match(/^"(.*)"\^\^<(.+)>$/s)
  if (dtMatch) return rdf.literal(dtMatch[1], rdf.namedNode(dtMatch[2]))
  const langMatch = s.match(/^"(.*)"@([\w-]+)$/s)
  if (langMatch) return rdf.literal(langMatch[1], langMatch[2])
  const plainMatch = s.match(/^"(.*)"$/s)
  if (plainMatch) return rdf.literal(plainMatch[1])
  return null
}

async function datasetToJsonLd(ds, format, context) {
  console.debug('[xml→jsonld] Serializing rdf-ext Dataset via @rdfjs/serializer-jsonld…')
  const serializer = new JsonLdSerializer()
  const stream = serializer.import(ds.toStream())
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : JSON.stringify(chunk))
  }
  const flatGraph = JSON.parse(chunks.join(''))
  console.debug(`[xml→jsonld] Flat @graph nodes from serializer: ${flatGraph.length}`)
  const expanded = { '@graph': flatGraph }

  if (format === 'flat') {
    const compacted = await jsonld.compact(expanded, context)
    // re-expand to flat @graph preserving compacted curies
    const flatCompacted = await jsonld.flatten(compacted, context)
    console.debug('[xml→jsonld] Output format: flat @graph')
    return JSON.stringify(flatCompacted, null, 2)
  }

  // nested: frame around cargo:Shipment root
  const framed = await jsonld.compact(expanded, context)
  console.debug('[xml→jsonld] Output format: nested')
  return JSON.stringify(framed, null, 2)
}

function flattenToGraph(shipmentObj, context) {
  const nodes = []
  const counters = {}
  const extracted = new WeakMap()

  const EXTRACT_TYPES = new Set([
    'cargo:Shipment', 'cargo:Waybill', 'cargo:DgDeclaration',
    'cargo:PieceDg', 'cargo:Piece', 'cargo:ProductDg', 'cargo:Product',
    'cargo:ItemDg', 'cargo:Party', 'cargo:LogisticsAgent', 'cargo:Organization'
  ])

  function typeToSlug(type) {
    const types = Array.isArray(type) ? type : [type]
    for (const t of types) {
      const base = t.replace('cargo:', '').toLowerCase()
      if (base === 'piecedg' || base === 'piece') return 'piece'
      if (base === 'productdg' || base === 'product') return 'product'
      if (base === 'itemdg') return 'item'
      if (base === 'dgdeclaration') return 'dgdeclaration'
      if (base === 'waybill') return 'waybill'
      if (base === 'shipment') return 'shipment'
      if (base === 'party') return 'party'
      if (base === 'logisticsagent' || base === 'organization') return 'org'
    }
    return (Array.isArray(type) ? type[0] : type).replace('cargo:', '').toLowerCase()
  }

  function shouldExtract(obj) {
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']]
    return types.some(t => EXTRACT_TYPES.has(t))
  }

  function makeId(slug) {
    counters[slug] = (counters[slug] || 0) + 1
    return `https://api.example.com/logistics-objects/${slug}-${counters[slug]}`
  }

  function processValue(value) {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(processValue)
    if (value['@value'] !== undefined) return value
    if (value['@id'] && !value['@type']) return value
    if (extracted.has(value)) return { '@id': extracted.get(value) }

    if (shouldExtract(value)) {
      const slug = typeToSlug(value['@type'])
      const id = makeId(slug)
      extracted.set(value, id)
      const node = { '@id': id }
      for (const [k, v] of Object.entries(value)) {
        node[k] = processValue(v)
      }
      nodes.push(node)
      return { '@id': id }
    }

    const result = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = processValue(v)
    }
    return result
  }

  const shipmentId = makeId('shipment')
  extracted.set(shipmentObj, shipmentId)
  const shipmentNode = { '@id': shipmentId }
  for (const [k, v] of Object.entries(shipmentObj)) {
    shipmentNode[k] = processValue(v)
  }
  nodes.unshift(shipmentNode)

  return { '@context': context, '@graph': nodes }
}

export async function convertXmlToJsonLd(xmlText, format = 'nested') {
  const RAM_NS = 'iata:datamodel:3'
  const RSM_NS = 'iata:shippersdeclarationfordangerousgoods:1'

  const getEl = (parent, ns, name) => {
    if (!parent) return null
    for (const child of parent.children) {
      if (child.namespaceURI === ns && child.localName === name) return child
    }
    return null
  }
  const getEls = (parent, ns, name) => {
    if (!parent) return []
    return Array.from(parent.children).filter(c => c.namespaceURI === ns && c.localName === name)
  }
  const getText = (parent, ns, name) => {
    const el = getEl(parent, ns, name)
    return el ? el.textContent.trim() : null
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const parseErr = doc.querySelector('parsererror')
  if (parseErr) throw new Error('Invalid XML: ' + parseErr.textContent.split('\n')[0])

  const masterCons = getEl(doc.documentElement, RSM_NS, 'MasterConsignment')
  if (!masterCons) throw new Error('No <rsm:MasterConsignment> element found')
  const houseCons = getEl(masterCons, RAM_NS, 'IncludedHouseConsignment')
  if (!houseCons) throw new Error('No <ram:IncludedHouseConsignment> element found')

  // AWB: prefer MessageHeaderDocument/ID, then AssociatedReferenceDocument TypeCode 741, then CarrierAssignedID
  const msgHeader = getEl(doc.documentElement, RSM_NS, 'MessageHeaderDocument')
  const msgId = msgHeader ? getText(msgHeader, RAM_NS, 'ID') : null
  const assocRefDocs = getEls(houseCons, RAM_NS, 'AssociatedReferenceDocument')
  const assocRefDoc = assocRefDocs.find(el => getText(el, RAM_NS, 'TypeCode') === '741')
  const assocRefId = assocRefDoc ? getText(assocRefDoc, RAM_NS, 'ID') : null
  const awbNumber = msgId || assocRefId || getText(masterCons, RAM_NS, 'CarrierAssignedID')

  // Locations
  const originLocEl = getEl(houseCons, RAM_NS, 'OriginLocation')
  const destLocEl = getEl(houseCons, RAM_NS, 'FinalDestinationLocation')
  const originId = getText(originLocEl, RAM_NS, 'ID') || 'UNKNOWN'
  const originName = getText(originLocEl, RAM_NS, 'Name') || originId
  const destId = getText(destLocEl, RAM_NS, 'ID') || 'UNKNOWN'
  const destName = getText(destLocEl, RAM_NS, 'Name') || destId
  const originLocObj = { '@type': 'cargo:Location', 'cargo:locationName': originName, 'cargo:locationCodes': [{ '@type': 'cargo:CodeListElement', 'cargo:code': originId }] }
  const destLocObj = { '@type': 'cargo:Location', 'cargo:locationName': destName, 'cargo:locationCodes': [{ '@type': 'cargo:CodeListElement', 'cargo:code': destId }] }

  // Build party inline
  const buildParty = (partyEl, roleCode) => {
    if (!partyEl) return null
    const name = getText(partyEl, RAM_NS, 'Name')
    const addrEl = getEl(partyEl, RAM_NS, 'PostalStructuredAddress')
    const contactEl = getEl(partyEl, RAM_NS, 'DefinedTradeContact')
    const orgObj = { '@type': ['cargo:LogisticsAgent', 'cargo:Organization'] }
    if (name) orgObj['cargo:name'] = name
    if (addrEl) {
      const addr = { '@type': 'cargo:Address' }
      const street = getText(addrEl, RAM_NS, 'StreetName')
      const postcode = getText(addrEl, RAM_NS, 'PostcodeCode')
      const city = getText(addrEl, RAM_NS, 'CityName')
      const countryId = getText(addrEl, RAM_NS, 'CountryID')
      const region = getText(addrEl, RAM_NS, 'CountrySubDivisionName')
      const poBox = getText(addrEl, RAM_NS, 'PostOfficeBox')
      if (street) addr['cargo:streetAddressLines'] = [street]
      if (postcode) addr['cargo:postalCode'] = postcode
      if (city) addr['cargo:cityName'] = city
      if (countryId) addr['cargo:country'] = { '@type': 'cargo:CodeListElement', 'cargo:code': countryId }
      if (region) addr['cargo:regionName'] = region
      if (poBox) addr['cargo:postOfficeBox'] = poBox
      orgObj['cargo:basedAtLocation'] = { '@type': 'cargo:Location', 'cargo:address': addr }
    }
    if (contactEl) {
      const personName = getText(contactEl, RAM_NS, 'PersonName')
      const dept = getText(contactEl, RAM_NS, 'DepartmentName')
      const phoneEl = getEl(contactEl, RAM_NS, 'DirectTelephoneCommunication')
      const phone = phoneEl ? getText(phoneEl, RAM_NS, 'CompleteNumber') : null
      if (personName || phone) {
        const personObj = { '@type': ['cargo:Person', 'cargo:Actor'] }
        if (personName) {
          const commaIdx = personName.indexOf(',')
          if (commaIdx !== -1) {
            personObj['cargo:lastName'] = personName.slice(0, commaIdx).trim()
            const rest = personName.slice(commaIdx + 1).trim()
            if (rest && !rest.includes(' ')) personObj['cargo:salutation'] = rest
            else if (rest) personObj['cargo:firstName'] = rest
          } else {
            const parts = personName.split(' ')
            personObj['cargo:firstName'] = parts.length > 1 ? parts.slice(0, -1).join(' ') : personName
            if (parts.length > 1) personObj['cargo:lastName'] = parts[parts.length - 1]
          }
        }
        if (dept) personObj['cargo:department'] = dept
        if (phone) personObj['cargo:contactDetails'] = [{ '@type': 'cargo:ContactDetail', 'cargo:contactDetailType': { '@type': 'cargo:PHONE_NUMBER' }, 'cargo:textualValue': phone }]
        orgObj['cargo:contactPersons'] = [personObj]
      }
    }
    return {
      '@type': 'cargo:Party',
      'cargo:partyDetails': orgObj,
      'cargo:partyRole': { '@id': 'participantIdentifier:' + roleCode }
    }
  }

  // Build line items
  const tradeTx = getEl(houseCons, RAM_NS, 'RelatedCommercialTradeTransaction')
  const lineItems = tradeTx ? getEls(tradeTx, RAM_NS, 'IncludedCommercialTradeLineItem') : []
  const packageEls = tradeTx ? getEls(tradeTx, RAM_NS, 'SpecifiedLogisticsPackage') : []
  const overpackEls = tradeTx ? getEls(tradeTx, RAM_NS, 'SpecifiedOverpackPackage') : []

  const lineItemMap = {}
  lineItems.forEach((lineItem, idx) => {
    const seqNum = getText(lineItem, RAM_NS, 'SequenceNumeric') || String(idx + 1)
    const info = getText(lineItem, RAM_NS, 'Information')
    const deliveryEl = getEl(lineItem, RAM_NS, 'SpecifiedProductTradeDelivery')
    const regGoodsEl = deliveryEl ? getEl(deliveryEl, RAM_NS, 'SpecifiedProductRegulatedGoods') : null
    const dgEl = regGoodsEl ? getEl(regGoodsEl, RAM_NS, 'ApplicableProductDangerousGoods') : null
    if (!dgEl) return

    const productDgObj = { '@type': ['cargo:Product', 'cargo:ProductDg'] }
    const unNum = getText(dgEl, RAM_NS, 'UNDGIdentificationCode'); if (unNum) productDgObj['cargo:unNumber'] = unNum
    const psn = getText(dgEl, RAM_NS, 'ProperShippingName'); if (psn) productDgObj['cargo:properShippingName'] = psn
    const techName = getText(dgEl, RAM_NS, 'TechnicalName'); if (techName) productDgObj['cargo:technicalName'] = techName
    const hazClass = getText(dgEl, RAM_NS, 'HazardClassificationID'); if (hazClass) productDgObj['cargo:hazardClassificationId'] = hazClass
    const addHazClasses = getEls(dgEl, RAM_NS, 'AdditionalHazardClassificationID')
    if (addHazClasses.length > 0) productDgObj['cargo:additionalHazardClassificationId'] = addHazClasses.map(e => e.textContent.trim()).filter(Boolean)
    const pkgLevel = getText(dgEl, RAM_NS, 'PackagingDangerLevelCode')
    if (pkgLevel) productDgObj['cargo:packagingDangerLevelCode'] = { '@id': 'packagingDangerLevelCode:' + pkgLevel }
    const pi = getText(dgEl, RAM_NS, 'PackingInstructionTypeCode'); if (pi) productDgObj['cargo:packingInstructionNumber'] = pi
    const sp = getText(dgEl, RAM_NS, 'SpecialProvisionID'); if (sp) productDgObj['cargo:specialProvisionId'] = sp
    const auth = getText(dgEl, RAM_NS, 'AuthorizationInformation'); if (auth) productDgObj['cargo:authorizationInformation'] = auth
    const expComp = getText(dgEl, RAM_NS, 'ExplosiveCompatibilityGroupCode'); if (expComp) productDgObj['cargo:explosiveCompatibilityGroupCode'] = expComp
    const rq = getText(dgEl, RAM_NS, 'ReportableQuantity'); if (rq) productDgObj['cargo:reportableQuantity'] = rq
    const placardId = getText(dgEl, RAM_NS, 'UpperPartOrangeHazardPlacardID'); if (placardId) productDgObj['cargo:hazardPlacardId'] = placardId
    const marinePollutant = getText(dgEl, RAM_NS, 'MarinePollutantIndicator'); if (marinePollutant) productDgObj['cargo:marinePollutantIndicator'] = marinePollutant === 'true'
    const tunnelCode = getText(dgEl, RAM_NS, 'TunnelRestrictionCode'); if (tunnelCode) productDgObj['cargo:tunnelRestrictionCode'] = tunnelCode
    const hazCat = getText(dgEl, RAM_NS, 'HazardCategoryCode'); if (hazCat) productDgObj['cargo:hazardCategoryCode'] = hazCat
    const imdgEl = getEl(dgEl, RAM_NS, 'IMDGSegregationGroupCode'); if (imdgEl) productDgObj['cargo:imdgSegregationGroupCode'] = imdgEl.textContent.trim()
    const mkTempMeasure = (el) => {
      if (!el) return null
      const mEl = getEl(el, RAM_NS, 'ActualMeasure')
      if (!mEl) return null
      return { '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(mEl.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (mEl.getAttribute('unitCode') || 'CEL') } }
    }
    const flashTemp = mkTempMeasure(getEl(dgEl, RAM_NS, 'FlashpointTemperatureMeasurement')); if (flashTemp) productDgObj['cargo:flashpointTemperature'] = flashTemp
    const ctrlTemp = mkTempMeasure(getEl(dgEl, RAM_NS, 'ControlTemperatureMeasurement')); if (ctrlTemp) productDgObj['cargo:controlTemperature'] = ctrlTemp
    const emergTemp = mkTempMeasure(getEl(dgEl, RAM_NS, 'EmergencyTemperatureMeasurement')); if (emergTemp) productDgObj['cargo:emergencyTemperature'] = emergTemp
    const suppEl = getEl(dgEl, RAM_NS, 'SupplementaryInformation')
    if (suppEl) {
      const isSuffix = getText(suppEl, RAM_NS, 'SuffixIndicator') === 'true'
      const suppContent = getText(suppEl, RAM_NS, 'Content')
      if (suppContent) productDgObj[isSuffix ? 'cargo:supplementaryInfoSuffix' : 'cargo:supplementaryInfoPrefix'] = suppContent
    }
    const radioEl = getEl(dgEl, RAM_NS, 'RadioactiveMaterial')
    if (radioEl) {
      const radioObj = { '@type': 'cargo:DgProductRadioactive' }
      const fissRef = getText(radioEl, RAM_NS, 'FissileExceptionReference'); if (fissRef) radioObj['cargo:fissileExceptionReference'] = fissRef
      const fissInd = getText(radioEl, RAM_NS, 'FissileExceptionIndicator'); if (fissInd) radioObj['cargo:fissileExceptionIndicator'] = fissInd === 'true'
      const isotopeEls = getEls(radioEl, RAM_NS, 'ApplicableRadioactiveIsotope')
      if (isotopeEls.length > 0) {
        radioObj['cargo:isotopes'] = isotopeEls.map(iso => {
          const isoObj = { '@type': 'cargo:DgRadioactiveIsotope' }
          const isoId = getText(iso, RAM_NS, 'ID'); if (isoId) isoObj['cargo:isotopeId'] = isoId
          const isoName = getText(iso, RAM_NS, 'Name'); if (isoName) isoObj['cargo:isotopeName'] = isoName
          const actEl = getEl(iso, RAM_NS, 'ActivityLevelMeasure')
          if (actEl) isoObj['cargo:activityLevelMeasure'] = { '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(actEl.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (actEl.getAttribute('unitCode') || 'GBQ') } }
          const physChem = getText(iso, RAM_NS, 'PhysicalChemicalFormNote'); if (physChem) isoObj['cargo:physicalChemicalForm'] = physChem
          const specForm = getText(iso, RAM_NS, 'SpecialFormIndicator'); if (specForm) isoObj['cargo:specialFormIndicator'] = specForm === 'true'
          const lowDisp = getText(iso, RAM_NS, 'LowDispersibleIndicator'); if (lowDisp) isoObj['cargo:lowDispersibleIndicator'] = lowDisp === 'true'
          return isoObj
        })
      }
      productDgObj['cargo:radioactiveMaterial'] = radioObj
    }

    // ItemDg (describedObjects) with net weight
    const itemObj = { '@type': ['cargo:ItemDg'] }
    const netWeightEl = getEl(dgEl, RAM_NS, 'NetWeightMeasure')
    if (netWeightEl) {
      itemObj['cargo:netWeightMeasure'] = {
        '@type': 'cargo:Value',
        'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (netWeightEl.getAttribute('unitCode') || 'KGM') },
        'cargo:numericalValue': parseFloat(netWeightEl.textContent.trim())
      }
    }
    if (info) itemObj['cargo:goodsDescription'] = info

    lineItemMap[seqNum] = { productDgObj, itemObj }
  })

  // Emergency contacts from ApplicableTransportDangerousGoods attached to each ItemDg
  const transportDgEl = getEl(houseCons, RAM_NS, 'ApplicableTransportDangerousGoods')
  const emergContactEls = transportDgEl ? getEls(transportDgEl, RAM_NS, 'EmergencyDangerousGoodsContact') : []
  const emergContactObjs = emergContactEls.map(ecEl => {
    const personName = getText(ecEl, RAM_NS, 'PersonName')
    const phoneEl = getEl(ecEl, RAM_NS, 'DirectEmergencyTelephoneCommunication')
    const phone = phoneEl ? getText(phoneEl, RAM_NS, 'CompleteNumber') : null
    const addInfo = phoneEl ? getText(phoneEl, RAM_NS, 'AdditionalInformation') : null
    const ecObj = { '@type': ['cargo:Person', 'cargo:Actor'] }
    if (personName) ecObj['cargo:firstName'] = personName
    if (phone || addInfo) {
      ecObj['cargo:contactDetails'] = [{
        '@type': 'cargo:ContactDetail',
        'cargo:contactDetailType': { '@type': 'cargo:PHONE_NUMBER' },
        'cargo:textualValue': [phone, addInfo].filter(Boolean).join(' — ')
      }]
    }
    return ecObj
  })

  // Finalise: attach emergencyContact to itemObj and describedObjects to productDgObj
  Object.values(lineItemMap).forEach(({ productDgObj, itemObj }) => {
    if (emergContactObjs.length > 0) itemObj['cargo:emergencyContact'] = emergContactObjs
    productDgObj['cargo:describedObjects'] = [itemObj]
  })

  // Build pieces
  const buildPieceDg = (pkgEl, isOverpack) => {
    const seqNum = getText(pkgEl, RAM_NS, 'SequenceNumeric') || '1'
    const pieceObj = { '@type': ['cargo:Piece', 'cargo:PieceDg'] }
    const allPackedInd = getText(pkgEl, RAM_NS, 'AllPackedInOneIndicator')
    if (allPackedInd !== null) pieceObj['cargo:allPackedInOneIndicator'] = allPackedInd === 'true'

    const pkgTypeEl = getEl(pkgEl, RAM_NS, 'UsedSupplyChainPackaging')
    if (pkgTypeEl) {
      const typeName = getText(pkgTypeEl, RAM_NS, 'Type')
      const typeCode = getText(pkgTypeEl, RAM_NS, 'TypeCode')
      if (typeName || typeCode) {
        const ptObj = { '@type': 'cargo:PackagingType' }
        if (typeName) ptObj['cargo:description'] = typeName
        if (typeCode) ptObj['cargo:packagingTypeCode'] = typeCode
        pieceObj['cargo:packagingType'] = ptObj
      }
    }

    const qty = getText(pkgEl, RAM_NS, 'ItemQuantity'); if (qty) pieceObj['cargo:slac'] = parseInt(qty, 10)
    const gwEl = getEl(pkgEl, RAM_NS, 'GrossWeightMeasure')
    if (gwEl) pieceObj['cargo:grossWeight'] = { '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(gwEl.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (gwEl.getAttribute('unitCode') || 'KGM') } }
    const dimEl = getEl(pkgEl, RAM_NS, 'LinearSpatialDimension')
    if (dimEl) {
      const wEl = getEl(dimEl, RAM_NS, 'WidthMeasure')
      const lEl = getEl(dimEl, RAM_NS, 'LengthMeasure')
      const hEl = getEl(dimEl, RAM_NS, 'HeightMeasure')
      if (wEl || lEl || hEl) {
        const dims = { '@type': 'cargo:Dimensions' }
        const mkMeasure = (el) => ({ '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(el.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (el.getAttribute('unitCode') || 'CMT') } })
        if (wEl) dims['cargo:width'] = mkMeasure(wEl)
        if (lEl) dims['cargo:length'] = mkMeasure(lEl)
        if (hEl) dims['cargo:height'] = mkMeasure(hEl)
        pieceObj['cargo:dimensions'] = dims
      }
    }
    const seriesStart = getText(pkgEl, RAM_NS, 'SeriesStartID'); if (seriesStart) pieceObj['cargo:seriesStartId'] = seriesStart
    const seriesEnd = getText(pkgEl, RAM_NS, 'SeriesEndID'); if (seriesEnd) pieceObj['cargo:seriesEndId'] = seriesEnd
    const allPackedInfo = getText(pkgEl, RAM_NS, 'AllPackedInOneInformation'); if (allPackedInfo) pieceObj['cargo:allPackedInOneInformation'] = allPackedInfo
    const qVal = getText(pkgEl, RAM_NS, 'QValueNumeric'); if (qVal) pieceObj['cargo:qValueNumeric'] = parseFloat(qVal)
    const netExpQEl = getEl(pkgEl, RAM_NS, 'NetExplosiveQuantity')
    if (netExpQEl) pieceObj['cargo:netExplosiveQuantity'] = { '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(netExpQEl.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (netExpQEl.getAttribute('unitCode') || 'KGM') } }
    const netExpQText = getText(pkgEl, RAM_NS, 'NetExplosiveQuantityText'); if (netExpQText) pieceObj['cargo:netExplosiveQuantityText'] = netExpQText
    if (isOverpack) {
      const opSummary = getText(pkgEl, RAM_NS, 'OverpackNetQuantitySummary'); if (opSummary) pieceObj['cargo:overpackNetQuantitySummary'] = opSummary
    }
    const pkgDeliveryEl = getEl(pkgEl, RAM_NS, 'SpecifiedPackagedTradeDelivery')
    const pkgRegGoodsEl = pkgDeliveryEl ? getEl(pkgDeliveryEl, RAM_NS, 'SpecifiedPackagedRegulatedGoods') : null
    const pkgDgEl = pkgRegGoodsEl ? getEl(pkgRegGoodsEl, RAM_NS, 'ApplicablePackagedDangerousGoods') : null
    const pkgRadioEl = pkgDgEl ? getEl(pkgDgEl, RAM_NS, 'PackagedRadioactiveMaterial') : null
    if (pkgRadioEl) {
      const raObj = { '@type': 'cargo:DgProductRadioactive' }
      const rtc = getText(pkgRadioEl, RAM_NS, 'TypeCode'); if (rtc) raObj['cargo:dgRaTypeCode'] = rtc
      const ti = getText(pkgRadioEl, RAM_NS, 'TransportIndexNumeric'); if (ti) raObj['cargo:transportIndexNumeric'] = parseFloat(ti)
      const csi = getText(pkgRadioEl, RAM_NS, 'CriticalitySafetyIndexNumeric'); if (csi) raObj['cargo:criticalitySafetyIndexNumeric'] = parseFloat(csi)
      pieceObj['cargo:overpackT1'] = raObj
    }

    // Link corresponding line item product
    const pkgLineRef = getEl(pkgEl, RAM_NS, 'IncludedPackagedTradeLineItem')
    const pkgLineSeq = pkgLineRef ? getText(pkgLineRef, RAM_NS, 'SequenceNumeric') : null
    const productDgObjs = pkgLineSeq && lineItemMap[pkgLineSeq]
      ? [lineItemMap[pkgLineSeq].productDgObj]
      : Object.values(lineItemMap).map(e => e.productDgObj)
    if (productDgObjs.length > 0) pieceObj['cargo:contentProducts'] = productDgObjs

    return pieceObj
  }

  const pieces = [
    ...packageEls.map(el => buildPieceDg(el, false)),
    ...overpackEls.map(el => buildPieceDg(el, true))
  ]

  // Build DgDeclaration
  const businessHeader = getEl(doc.documentElement, RSM_NS, 'BusinessHeaderDocument')
  const sigConsEl = businessHeader ? getEl(businessHeader, RAM_NS, 'SignatoryConsignorAuthentication') : null
  const sigDeclEl = businessHeader ? getEl(businessHeader, RAM_NS, 'SignatoryDeclarantAuthentication') : null
  const sigDriverEl = businessHeader ? getEl(businessHeader, RAM_NS, 'SignatoryDriverAuthentication') : null

  const dgDeclObj = { '@type': 'cargo:DgDeclaration' }
  dgDeclObj['cargo:departureLocation'] = originLocObj
  dgDeclObj['cargo:arrivalLocation'] = destLocObj
  if (sigConsEl) {
    const declDate = getText(sigConsEl, RAM_NS, 'ActualDateTime'); if (declDate) dgDeclObj['cargo:declarationDate'] = { '@type': 'xsd:dateTime', '@value': declDate }
    const statement = getText(sigConsEl, RAM_NS, 'Statement'); if (statement) dgDeclObj['cargo:shipperDeclarationText'] = statement
    const issueLocEl = getEl(sigConsEl, RAM_NS, 'IssueAuthenticationLocation')
    if (issueLocEl) { const locName = getText(issueLocEl, RAM_NS, 'Name'); if (locName) dgDeclObj['cargo:declarationPlace'] = { '@type': 'cargo:Location', 'cargo:locationName': locName } }
    const signatory = getText(sigConsEl, RAM_NS, 'Signatory'); if (signatory) dgDeclObj['cargo:consignorSignatory'] = signatory
    const provConsPartyEl = getEl(sigConsEl, RAM_NS, 'ProviderConsignorAuthenticationParty')
    if (provConsPartyEl) {
      const consAuthContact = getEl(provConsPartyEl, RAM_NS, 'DefinedConsignorAuthenticationContact')
      const personName = consAuthContact ? getText(consAuthContact, RAM_NS, 'PersonName') : null
      if (personName) dgDeclObj['cargo:consignorAuthPersonName'] = personName
    }
  }
  if (sigDeclEl) {
    const declDate = getText(sigDeclEl, RAM_NS, 'ActualDateTime'); if (declDate) dgDeclObj['cargo:declarantSignatureDate'] = { '@type': 'xsd:dateTime', '@value': declDate }
    const statement = getText(sigDeclEl, RAM_NS, 'Statement'); if (statement) dgDeclObj['cargo:complianceDeclarationText'] = statement
    const signatory = getText(sigDeclEl, RAM_NS, 'Signatory'); if (signatory) dgDeclObj['cargo:declarantSignatory'] = signatory
    const providerEl = getEl(sigDeclEl, RAM_NS, 'ProviderAuthenticationParty')
    if (providerEl) {
      const orgName = getText(providerEl, RAM_NS, 'Name'); if (orgName) dgDeclObj['cargo:declarantOrganization'] = orgName
      const cEl = getEl(providerEl, RAM_NS, 'DefinedTradeContact')
      if (cEl) { const pn = getText(cEl, RAM_NS, 'PersonName'); if (pn) dgDeclObj['cargo:declarantContact'] = pn }
    }
  }
  if (sigDriverEl) {
    const driverDate = getText(sigDriverEl, RAM_NS, 'ActualDateTime'); if (driverDate) dgDeclObj['cargo:driverSignatureDate'] = { '@type': 'xsd:dateTime', '@value': driverDate }
    const driverSign = getText(sigDriverEl, RAM_NS, 'Signatory'); if (driverSign) dgDeclObj['cargo:driverSignatory'] = driverSign
  }
  if (transportDgEl) {
    const hazTypeCode = getText(transportDgEl, RAM_NS, 'HazardTypeCode'); if (hazTypeCode) dgDeclObj['cargo:hazardTypeCode'] = hazTypeCode
    const aircraftLim = getText(transportDgEl, RAM_NS, 'AircraftLimitationInformation'); if (aircraftLim) dgDeclObj['cargo:aircraftLimitationInformation'] = aircraftLim
    const complianceDecl = getText(transportDgEl, RAM_NS, 'ComplianceDeclarationInformation'); if (complianceDecl) dgDeclObj['cargo:complianceDeclarationText'] = complianceDecl
    const shipperDecl = getText(transportDgEl, RAM_NS, 'ShipperDeclarationInformation'); if (shipperDecl && !dgDeclObj['cargo:shipperDeclarationText']) dgDeclObj['cargo:shipperDeclarationText'] = shipperDecl
  }
  const handlingEl = getEl(houseCons, RAM_NS, 'HandlingInstructions')
  if (handlingEl) {
    const desc = getText(handlingEl, RAM_NS, 'Description'); if (desc) dgDeclObj['cargo:handlingInformation'] = desc
    const excl = getText(handlingEl, RAM_NS, 'ExclusiveUsageIndicator'); if (excl) dgDeclObj['cargo:exclusiveUseIndicator'] = excl === 'true'
  }
  if (businessHeader) {
    const headerNoteEl = getEl(businessHeader, RAM_NS, 'IncludedHeaderNote')
    if (headerNoteEl) { const content = getText(headerNoteEl, RAM_NS, 'Content'); if (content) dgDeclObj['cargo:headerNotes'] = content }
    const processType = getText(businessHeader, RAM_NS, 'ProcessType'); if (processType) dgDeclObj['cargo:processType'] = processType
  }

  // Attach dgDeclaration to each piece
  pieces.forEach(p => { p['cargo:dgDeclaration'] = dgDeclObj })

  // Build parties
  const shpPartyObj = buildParty(getEl(houseCons, RAM_NS, 'ConsignorParty'), 'SHP')
  const cnePartyObj = buildParty(getEl(houseCons, RAM_NS, 'ConsigneeParty'), 'CNE')
  const assocPartyObjs = getEls(houseCons, RAM_NS, 'AssociatedParty').map((el, i) => {
    const roleCode = getText(el, RAM_NS, 'RoleCode') || ('ASSOC' + i)
    return buildParty(el, roleCode)
  }).filter(Boolean)
  const involvedParties = [shpPartyObj, cnePartyObj, ...assocPartyObjs].filter(Boolean)

  // Build waybill
  let waybillObj = null
  if (awbNumber) {
    const parts = awbNumber.split('-')
    const prefix = parts.length > 1 ? parts[0] : null
    const number = parts.length > 1 ? parts.slice(1).join('-') : awbNumber
    waybillObj = { '@type': 'cargo:Waybill', 'cargo:waybillType': { '@type': 'cargo:WaybillType', '@id': 'cargo:MASTER' } }
    if (prefix) waybillObj['cargo:waybillPrefix'] = prefix
    if (number) waybillObj['cargo:waybillNumber'] = number
  }

  // Root Shipment
  const shipmentObj = { '@type': 'cargo:Shipment' }
  const consignorAssignedId = getText(houseCons, RAM_NS, 'ConsignorAssignedID')
  if (consignorAssignedId) shipmentObj['cargo:shippingRefNo'] = consignorAssignedId
  const totalGrossEl = getEl(houseCons, RAM_NS, 'IncludedTareGrossWeightMeasure')
  if (totalGrossEl) shipmentObj['cargo:totalGrossWeight'] = { '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(totalGrossEl.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (totalGrossEl.getAttribute('unitCode') || 'KGM') } }
  const totalTareEl = getEl(houseCons, RAM_NS, 'TotalTareWeightMeasure')
  if (totalTareEl) shipmentObj['cargo:totalTareWeight'] = { '@type': 'cargo:Value', 'cargo:numericalValue': parseFloat(totalTareEl.textContent.trim()), 'cargo:unit': { '@id': 'unece:UnitMeasureCode#' + (totalTareEl.getAttribute('unitCode') || 'KGM') } }
  if (pieces.length > 0) shipmentObj['cargo:pieces'] = pieces
  if (involvedParties.length > 0) shipmentObj['cargo:involvedParties'] = involvedParties
  if (waybillObj) shipmentObj['cargo:waybill'] = waybillObj

  // Build intermediate JSON-LD object for rdf-ext ingestion
  console.debug('[xml→jsonld] Step 1: XML parsed, DOM mapping complete')
  console.debug('[xml→jsonld] Shipment keys:', Object.keys(shipmentObj))
  const jsonLdObj = { '@context': CONTEXT, ...shipmentObj }

  // Convert to RDF dataset via jsonld.toRDF → rdf-ext, then serialize back to JSON-LD
  console.debug('[xml→jsonld] Step 2: Building rdf-ext Dataset…')
  const ds = await buildDataset(jsonLdObj)
  console.debug('[xml→jsonld] Step 3: Serializing Dataset → JSON-LD…')
  const result = await datasetToJsonLd(ds, format, CONTEXT)
  console.debug(`[xml→jsonld] Done. Output length: ${result.length} chars`)
  return result
}
