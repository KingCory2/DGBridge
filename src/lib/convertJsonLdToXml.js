import rdf from 'rdf-ext'
import JsonLdSerializer from '@rdfjs/serializer-jsonld'
import jsonld from 'jsonld'
import { JSONLD_CONTEXT as CONTEXT } from '../constants/ontology'

function parseTerm(s) {
  s = s.trim()
  if (s.startsWith('<') && s.endsWith('>')) return rdf.namedNode(s.slice(1, -1))
  if (s.startsWith('_:')) return rdf.blankNode(s.slice(2))
  const dtMatch = s.match(/^"(.*)"\^\^<(.+)>$/s)
  if (dtMatch) return rdf.literal(dtMatch[1], rdf.namedNode(dtMatch[2]))
  const langMatch = s.match(/^"(.*)"@([\w-]+)$/s)
  if (langMatch) return rdf.literal(langMatch[1], langMatch[2])
  const plainMatch = s.match(/^"(.*)"$/s)
  if (plainMatch) return rdf.literal(plainMatch[1])
  return null
}

async function buildDataset(jsonLdObj) {
  console.debug('[jsonld→xml] Serializing JSON-LD to N-Quads via jsonld.toRDF…')
  const nquads = await jsonld.toRDF(jsonLdObj, { format: 'application/n-quads' })
  const lines = nquads.split('\n').filter(l => l.trim())
  console.debug(`[jsonld→xml] N-Quads generated: ${lines.length} triples`)
  const ds = rdf.dataset()
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(\S+)\s+(.+?)\s*\.\s*$/)
    if (!m) continue
    const subject = parseTerm(m[1])
    const predicate = parseTerm(m[2])
    const object = parseTerm(m[3])
    if (subject && predicate && object) ds.add(rdf.quad(subject, predicate, object))
  }
  console.debug(`[jsonld→xml] rdf-ext Dataset built: ${ds.size} quads`)
  return ds
}

async function rdfNormalize(root) {
  console.debug('[jsonld→xml] Step 2: rdfNormalize — JSON-LD → rdf-ext Dataset → compact…')
  const existingCtx = root['@context']
  const mergedCtx = typeof existingCtx === 'object' && existingCtx !== null
    ? { ...CONTEXT, ...existingCtx }
    : CONTEXT
  const ds = await buildDataset({ ...root, '@context': mergedCtx })
  console.debug('[jsonld→xml] Serializing Dataset via @rdfjs/serializer-jsonld…')
  const serializer = new JsonLdSerializer()
  const stream = serializer.import(ds.toStream())
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : JSON.stringify(chunk))
  }
  const flatGraph = JSON.parse(chunks.join(''))
  console.debug(`[jsonld→xml] Flat @graph nodes after rdf-ext round-trip: ${flatGraph.length}`)

  // rdf-ext serializer emits one JSON-LD node per triple — merge them by subject
  const subjectMap = new Map()
  for (const node of flatGraph) {
    const id = node['@id']
    if (id === undefined) continue
    if (!subjectMap.has(id)) { subjectMap.set(id, { ...node }); continue }
    const ex = subjectMap.get(id)
    for (const [k, v] of Object.entries(node)) {
      if (k === '@id') continue
      if (!(k in ex)) { ex[k] = v; continue }
      if (k === '@type') {
        const et = Array.isArray(ex['@type']) ? ex['@type'] : [ex['@type']]
        const nt = Array.isArray(v) ? v : [v]
        const merged = [...new Set([...et, ...nt])]
        ex['@type'] = merged.length === 1 ? merged[0] : merged
      } else {
        const ea = Array.isArray(ex[k]) ? ex[k] : [ex[k]]
        const na = Array.isArray(v) ? v : [v]
        const all = [...ea, ...na]
        const seen = new Set()
        const deduped = all.filter(i => { const s = JSON.stringify(i); if (seen.has(s)) return false; seen.add(s); return true })
        ex[k] = deduped.length === 1 ? deduped[0] : deduped
      }
    }
  }
  const mergedFlatGraph = Array.from(subjectMap.values())
  console.debug(`[jsonld→xml] Merged graph nodes: ${mergedFlatGraph.length}`)
  const compacted = await jsonld.compact({ '@graph': mergedFlatGraph }, CONTEXT)
  console.debug('[jsonld→xml] rdfNormalize complete')
  return compacted
}

function hasType(node, type) {
  return node?.['@type'] === type || (Array.isArray(node?.['@type']) && node['@type'].includes(type))
}

function parseJson(jsonText) {
  try {
    return JSON.parse(jsonText)
  } catch {
    throw new Error('Invalid JSON: ' + jsonText.slice(0, 80))
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : (value ? [value] : [])
}

function createResolver(graph) {
  const byId = (id) => graph.find(node => node['@id'] === id)

  return (ref) => {
    if (!ref) return null
    if (typeof ref === 'string') return byId(ref) || null
    if (ref['@id']) return byId(ref['@id']) || null
    return ref
  }
}

function resolveLinkedNode(ref, resolve) {
  if (!ref) return null
  if (typeof ref === 'object' && ref['@type']) return ref
  return resolve(ref)
}

const CARGO_VOCAB = 'https://onerecord.iata.org/ns/cargo#'

// Property name aliases: maps alternative cargo: property names to the ones the converter expects
const CARGO_PROP_ALIASES = {
  'cargo:hasDgProductData': 'cargo:contentProducts',
  'cargo:dgClassCode': 'cargo:hazardClassificationId',
  'cargo:packingGroupCode': 'cargo:packagingDangerLevelCode',
  'cargo:streetAddress': 'cargo:streetAddressLines',
  'cargo:countryCode': 'cargo:country',
}

// Normalize a JSON-LD document that uses @vocab shorthand instead of cargo: prefix.
// Expands bare type strings and property keys, applies known aliases, and synthesizes
// cargo:Party wrappers for bare Organization nodes found in involvedParties arrays.
function applyVocabNormalization(root) {
  const ctx = root['@context']
  if (!ctx || ctx['@vocab'] !== CARGO_VOCAB) return root

  function expandKey(key) {
    if (key.startsWith('@') || key.includes(':')) return key
    const prefixed = 'cargo:' + key
    return CARGO_PROP_ALIASES[prefixed] || prefixed
  }

  function expandTypeStr(t) {
    if (!t || t.includes(':') || t.startsWith('http')) return t
    return 'cargo:' + t
  }

  function processNode(node) {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(processNode)
    if (node['@value'] !== undefined) return node
    const result = {}
    for (const [k, v] of Object.entries(node)) {
      if (k === '@type') {
        const types = Array.isArray(v) ? v : [v]
        result['@type'] = types.map(expandTypeStr)
      } else {
        result[expandKey(k)] = processNode(v)
      }
    }
    return result
  }

  const rawGraph = root['@graph']
  const graph = rawGraph
    ? (Array.isArray(rawGraph) ? rawGraph : [rawGraph])
    : [root]
  const expandedGraph = graph.map(processNode)

  // Build @id index for the expanded graph
  const byId = Object.fromEntries(expandedGraph.filter(n => n['@id']).map(n => [n['@id'], n]))

  // Synthesize cargo:Party wrappers for bare Organization nodes found in involvedParties
  const wrappedOrgIds = new Set()
  const synthParties = []
  expandedGraph.forEach(node => {
    toArray(node['cargo:involvedParties']).forEach((ref, idx) => {
      const id = ref?.['@id'] || (typeof ref === 'string' ? ref : null)
      if (!id || wrappedOrgIds.has(id)) return
      const org = byId[id]
      if (!org) return
      if (hasType(org, 'cargo:Party')) return
      if (!hasType(org, 'cargo:Organization') && !hasType(org, 'cargo:LogisticsAgent')) return
      wrappedOrgIds.add(id)

      // Derive role from @id pattern, fall back to position
      const idLower = id.toLowerCase()
      let role
      if (idLower.includes('shipper') || idLower.includes('consignor')) role = 'SHP'
      else if (idLower.includes('consignee')) role = 'CNE'
      else role = idx === 0 ? 'SHP' : idx === 1 ? 'CNE' : 'ASSOC'

      synthParties.push({
        '@id': id + '-party',
        '@type': 'cargo:Party',
        'cargo:partyDetails': org,
        'cargo:partyRole': { '@id': 'participantIdentifier:' + role },
      })
    })
  })

  return { ...root, '@graph': [...expandedGraph, ...synthParties] }
}

function normalizeGraph(root) {
  const isNested = !root['@graph'] && hasType(root, 'cargo:Shipment')
  const rawGraph = root['@graph']
  const graph = rawGraph
    ? (Array.isArray(rawGraph) ? rawGraph : [rawGraph])
    : (Array.isArray(root) ? root : [root])
  const byType = (type) => graph.filter(node => hasType(node, type))
  const resolve = createResolver(graph)

  if (isNested) {
    const piecesArr = toArray(root['cargo:pieces'])
    const firstPiece = piecesArr[0]

    return {
      isNested,
      resolve,
      waybillNode: resolveLinkedNode(root['cargo:waybill'], resolve),
      declNode: firstPiece?.['cargo:dgDeclaration'] || null,
      piecesArr,
      partiesArr: toArray(root['cargo:involvedParties'])
    }
  }

  return {
    isNested,
    resolve,
    waybillNode: byType('cargo:Waybill')[0] || null,
    declNode: byType('cargo:DgDeclaration')[0] || null,
    piecesArr: byType('cargo:PieceDg'),
    partiesArr: byType('cargo:Party')
  }
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getVal(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      let value = obj[key]
      // Unwrap single-element arrays (can arise from merged graph nodes)
      if (Array.isArray(value) && value.length === 1) value = value[0]
      if (value === null || value === undefined) continue
      if (typeof value === 'object' && value['@value'] !== undefined) return String(value['@value'])
      if (typeof value === 'boolean') return String(value)
      if (typeof value === 'number') return String(value)
      if (typeof value === 'string') return value
    }
  }

  return null
}

function getMeasure(obj, key, resolv) {
  const measureRef = obj && obj[key]
  if (!measureRef) return null
  const measure = (resolv && measureRef['@id'] && !measureRef['cargo:numericalValue'])
    ? (resolveLinkedNode(measureRef, resolv) || measureRef)
    : measureRef
  if (!measure) return null

  const value = measure['cargo:numericalValue']?.['@value'] ?? measure['cargo:numericalValue']
  if (value === undefined || value === null || value === '') return null
  const unitRef = measure['cargo:unit']?.['@id'] || ''
  const unit = unitRef.split('#')[1] || 'KGM'

  return { val: String(value), unit }
}

function getLocCode(locObj) {
  const codes = locObj?.['cargo:locationCodes']
  if (Array.isArray(codes) && codes.length > 0) return codes[0]['cargo:code'] || ''
  if (codes && codes['cargo:code']) return codes['cargo:code']
  return ''
}

function getRoleCode(party) {
  const role = party['cargo:partyRole']
  const roleId = (typeof role === 'string' ? role : role?.['@id']) || ''
  return roleId.split(':').pop().split('#').pop().split('/').pop()
}

function orgOf(party, resolve) {
  if (!party) return null

  const ref = party['cargo:partyDetails']
  if (!ref) return null
  if (typeof ref === 'object' && ref['@type']) return ref
  return resolve(ref)
}

function addrOf(org, resolve) {
  if (!org) return null

  const loc = org['cargo:basedAtLocation']
  if (loc) {
    const locObj = resolveLinkedNode(loc, resolve)
    return locObj?.['cargo:address'] || null
  }

  return org['cargo:address'] || null
}

function renderAddress(org, indent, resolve) {
  const addr = addrOf(org, resolve)
  const address = addr ? resolveLinkedNode(addr, resolve) : null
  const indentation = ' '.repeat(indent)
  let xml = indentation + '<ram:PostalStructuredAddress>\n'

  if (address) {
    const postcode = getVal(address, 'cargo:postalCode', 'cargo:textualPostCode')
    if (postcode) xml += indentation + '  <ram:PostcodeCode>' + escXml(postcode) + '</ram:PostcodeCode>\n'

    const streets = address['cargo:streetAddressLines']
    const rawStreet = Array.isArray(streets) ? streets[0] : streets
    const street = rawStreet
      ? (typeof rawStreet === 'object' && rawStreet['@value'] !== undefined ? String(rawStreet['@value']) : (typeof rawStreet === 'string' ? rawStreet : null))
      : null
    xml += indentation + '  <ram:StreetName>' + escXml(street || '') + '</ram:StreetName>\n'

    const city = getVal(address, 'cargo:cityName')
    xml += indentation + '  <ram:CityName>' + escXml(city || '') + '</ram:CityName>\n'

    const countryRaw = address['cargo:country']
    const countryNode = countryRaw ? resolveLinkedNode(countryRaw, resolve) : null
    const countryId = typeof countryRaw === 'string' ? countryRaw
      : (countryNode?.['cargo:code'] || getVal(countryNode, 'cargo:code') || countryRaw?.['@id']?.split('/').pop() || '')
    xml += indentation + '  <ram:CountryID>' + escXml(countryId || 'XX') + '</ram:CountryID>\n'

    const region = getVal(address, 'cargo:regionName', 'cargo:regionCode')
    if (region) xml += indentation + '  <ram:CountrySubDivisionName>' + escXml(region) + '</ram:CountrySubDivisionName>\n'

    const poBox = getVal(address, 'cargo:postOfficeBox')
    if (poBox) xml += indentation + '  <ram:PostOfficeBox>' + escXml(poBox) + '</ram:PostOfficeBox>\n'
  } else {
    xml += indentation + '  <ram:StreetName></ram:StreetName>\n'
    xml += indentation + '  <ram:CityName></ram:CityName>\n'
    xml += indentation + '  <ram:CountryID>XX</ram:CountryID>\n'
  }

  xml += indentation + '</ram:PostalStructuredAddress>\n'
  return xml
}

function renderContact(org, indent, resolve) {
  const personsRaw = org?.['cargo:contactPersons']
  const personsArr = Array.isArray(personsRaw) ? personsRaw : (personsRaw ? [personsRaw] : [])
  const personRef = personsArr[0] || null
  const person = personRef ? resolveLinkedNode(personRef, resolve) : null
  const indentation = ' '.repeat(indent)
  let xml = indentation + '<ram:DefinedTradeContact>\n'

  if (person) {
    const first = getVal(person, 'cargo:firstName') || ''
    const last = getVal(person, 'cargo:lastName') || ''
    const salutation = getVal(person, 'cargo:salutation') || ''
    const fullName = ([first, last].filter(Boolean).join(' ') + (salutation ? ', ' + salutation : '')).trim()
    if (fullName) xml += indentation + '  <ram:PersonName>' + escXml(fullName) + '</ram:PersonName>\n'

    const department = getVal(person, 'cargo:department', 'cargo:jobTitle')
    if (department) xml += indentation + '  <ram:DepartmentName>' + escXml(department) + '</ram:DepartmentName>\n'

    const contactsRaw = person['cargo:contactDetails']
    const contactsArr = Array.isArray(contactsRaw) ? contactsRaw : (contactsRaw ? [contactsRaw] : [])
    const phoneRef = contactsArr[0] || null
    const phoneDetail = phoneRef ? resolveLinkedNode(phoneRef, resolve) : null
    const phone = phoneDetail ? getVal(phoneDetail, 'cargo:textualValue', 'cargo:contactDescription') : null
    if (phone) {
      xml += indentation + '  <ram:DirectTelephoneCommunication>\n'
      xml += indentation + '    <ram:CompleteNumber>' + escXml(phone) + '</ram:CompleteNumber>\n'
      xml += indentation + '  </ram:DirectTelephoneCommunication>\n'
    }
  }

  xml += indentation + '</ram:DefinedTradeContact>\n'
  return xml
}

function renderPartyBlock(party, tag, indent, resolve) {
  const org = party ? orgOf(party, resolve) : null
  const indentation = ' '.repeat(indent)
  let xml = indentation + '<ram:' + tag + '>\n'

  const name = getVal(org, 'cargo:name', 'cargo:companyName') || ''
  xml += indentation + '  <ram:Name>' + escXml(name) + '</ram:Name>\n'

  xml += renderAddress(org, indent + 2, resolve)
  xml += renderContact(org, indent + 2, resolve)
  xml += indentation + '</ram:' + tag + '>\n'
  return xml
}

function renderMessageHeader(awb, now) {
  let xml = '  <rsm:MessageHeaderDocument>\n'
  xml += '    <ram:ID>' + escXml(awb || '') + '</ram:ID>\n'
  xml += '    <ram:Name>XML Shippers Declaration for Dangerous Goods</ram:Name>\n'
  xml += '    <ram:TypeCode>890</ram:TypeCode>\n'
  xml += '    <ram:IssueDateTime>' + now + '</ram:IssueDateTime>\n'
  xml += '    <ram:PurposeCode>CREATION</ram:PurposeCode>\n'
  xml += '    <ram:VersionID>5.00</ram:VersionID>\n'
  xml += '    <ram:ConversationID>1</ram:ConversationID>\n'
  xml += '  </rsm:MessageHeaderDocument>\n'
  return xml
}

function renderBusinessHeader(declNode, resolve) {
  let xml = '  <rsm:BusinessHeaderDocument>\n'

  const processType = getVal(declNode, 'cargo:processType') || 'ORIGINAL'
  xml += '    <ram:ProcessType>' + escXml(processType) + '</ram:ProcessType>\n'

  const headerNotes = getVal(declNode, 'cargo:headerNotes')
  if (headerNotes) {
    xml += '    <ram:IncludedHeaderNote>\n'
    xml += '      <ram:Content>' + escXml(headerNotes) + '</ram:Content>\n'
    xml += '    </ram:IncludedHeaderNote>\n'
  }

  const declDate = getVal(declNode, 'cargo:declarationDate')
  const shipperDeclText = getVal(declNode, 'cargo:shipperDeclarationText')
  const consignorSign = getVal(declNode, 'cargo:consignorSignatory')
  const consignorAuthPerson = getVal(declNode, 'cargo:consignorAuthPersonName')
  const declPlace = declNode?.['cargo:declarationPlace']
  const declPlaceName = typeof declPlace === 'string' ? declPlace : (resolve(declPlace)?.['cargo:locationName'] || declPlace?.['cargo:locationName'])

  xml += '    <ram:SignatoryConsignorAuthentication>\n'
  xml += '      <ram:ActualDateTime>' + escXml(declDate || new Date().toISOString().slice(0, 19)) + '</ram:ActualDateTime>\n'
  xml += '      <ram:Statement>' + escXml(shipperDeclText || '') + '</ram:Statement>\n'
  xml += '      <ram:Signatory>' + escXml(consignorSign || '') + '</ram:Signatory>\n'
  if (declPlaceName) {
    xml += '      <ram:IssueAuthenticationLocation>\n'
    xml += '        <ram:Name>' + escXml(declPlaceName) + '</ram:Name>\n'
    xml += '      </ram:IssueAuthenticationLocation>\n'
  }
  xml += '      <ram:ProviderConsignorAuthenticationParty>\n'
  xml += '        <ram:DefinedConsignorAuthenticationContact>\n'
  xml += '          <ram:PersonName>' + escXml(consignorAuthPerson || '') + '</ram:PersonName>\n'
  xml += '        </ram:DefinedConsignorAuthenticationContact>\n'
  xml += '      </ram:ProviderConsignorAuthenticationParty>\n'
  xml += '    </ram:SignatoryConsignorAuthentication>\n'

  const declarantDate = getVal(declNode, 'cargo:declarantSignatureDate')
  const complianceText = getVal(declNode, 'cargo:complianceDeclarationText')
  const declarantSign = getVal(declNode, 'cargo:declarantSignatory')
  const declarantOrg = getVal(declNode, 'cargo:declarantOrganization')
  const declarantContact = getVal(declNode, 'cargo:declarantContact')
  if (declarantDate || complianceText || declarantSign || declarantOrg) {
    xml += '    <ram:SignatoryDeclarantAuthentication>\n'
    if (declarantDate) xml += '      <ram:ActualDateTime>' + escXml(declarantDate) + '</ram:ActualDateTime>\n'
    if (complianceText) xml += '      <ram:Statement>' + escXml(complianceText) + '</ram:Statement>\n'
    if (declarantSign) xml += '      <ram:Signatory>' + escXml(declarantSign) + '</ram:Signatory>\n'
    if (declarantOrg || declarantContact) {
      xml += '      <ram:ProviderAuthenticationParty>\n'
      if (declarantOrg) xml += '        <ram:Name>' + escXml(declarantOrg) + '</ram:Name>\n'
      if (declarantContact) {
        xml += '        <ram:DefinedTradeContact>\n'
        xml += '          <ram:PersonName>' + escXml(declarantContact) + '</ram:PersonName>\n'
        xml += '        </ram:DefinedTradeContact>\n'
      }
      xml += '      </ram:ProviderAuthenticationParty>\n'
    }
    xml += '    </ram:SignatoryDeclarantAuthentication>\n'
  }

  const driverDate = getVal(declNode, 'cargo:driverSignatureDate')
  const driverSign = getVal(declNode, 'cargo:driverSignatory')
  if (driverDate || driverSign) {
    xml += '    <ram:SignatoryDriverAuthentication>\n'
    if (driverDate) xml += '      <ram:ActualDateTime>' + escXml(driverDate) + '</ram:ActualDateTime>\n'
    if (driverSign) xml += '      <ram:Signatory>' + escXml(driverSign) + '</ram:Signatory>\n'
    xml += '    </ram:SignatoryDriverAuthentication>\n'
  }

  xml += '  </rsm:BusinessHeaderDocument>\n'
  return xml
}

const SHP_ROLES = new Set(['shp', 'shipper', 'cnor', 'consignor'])
const CNE_ROLES = new Set(['cne', 'consignee', 'cnee'])

function renderParties(partiesArr, resolve) {
  const matchRole = (party, roleSet) => roleSet.has(getRoleCode(party).toLowerCase())
  let shipperParty = partiesArr.find(p => matchRole(p, SHP_ROLES))
    ?? (partiesArr.length > 0 ? partiesArr[0] : null)
  let consigneeParty = partiesArr.find(p => matchRole(p, CNE_ROLES))
    ?? (partiesArr.length > 1 ? partiesArr.find(p => p !== shipperParty) : null)

  let xml = ''
  xml += renderPartyBlock(shipperParty, 'ConsignorParty', 6, resolve)
  xml += renderPartyBlock(consigneeParty, 'ConsigneeParty', 6, resolve)

  const otherParties = partiesArr.filter(party => party !== shipperParty && party !== consigneeParty)
  otherParties.forEach(party => {
    const roleCode = getRoleCode(party)
    const org = orgOf(party, resolve)
    let partyXml = '      <ram:AssociatedParty>\n'
    const name = getVal(org, 'cargo:name', 'cargo:companyName')
    if (name) partyXml += '        <ram:Name>' + escXml(name) + '</ram:Name>\n'
    partyXml += '        <ram:RoleCode>' + escXml(roleCode) + '</ram:RoleCode>\n'
    partyXml += renderAddress(org, 8, resolve)
    partyXml += renderContact(org, 8, resolve)
    partyXml += '      </ram:AssociatedParty>\n'
    xml += partyXml
  })

  return xml
}

export async function convertJsonLdToXml(jsonText) {
  console.debug('[jsonld→xml] Step 1: Parsing JSON-LD input…')
  let root = parseJson(jsonText)
  if (!Array.isArray(root) && !root['@graph'] && !root['@type']) {
    throw new Error('Unrecognized JSON-LD format: expected an @graph array or a top-level cargo object with @type')
  }
  root = applyVocabNormalization(Array.isArray(root) ? { '@graph': root } : root)
  console.debug('[jsonld→xml] Vocab normalization applied')
  root = await rdfNormalize(root)
  console.debug('[jsonld→xml] Step 3: Normalizing graph structure…')
  const { isNested, resolve, waybillNode, declNode, piecesArr, partiesArr } = normalizeGraph(root)
  console.debug(`[jsonld→xml] Graph: isNested=${isNested}, pieces=${piecesArr.length}, parties=${partiesArr.length}`)

  const prefix = getVal(waybillNode, 'cargo:waybillPrefix')
  const num = getVal(waybillNode, 'cargo:waybillNumber')
  const awb = prefix && num ? prefix + '-' + num : (num || prefix || '')
  const now = new Date().toISOString().slice(0, 19)

  let xml = '<?xml version="1.0" encoding="utf-8"?>\n'
  xml += '<rsm:ShippersDeclarationForDangerousGoods xmlns:rsm="iata:shippersdeclarationfordangerousgoods:1" xmlns:ccts="urn:un:unece:uncefact:documentation:standard:CoreComponentsTechnicalSpecification:2" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:8" xmlns:ram="iata:datamodel:3">\n'

  xml += renderMessageHeader(awb, now)
  xml += renderBusinessHeader(declNode, resolve)

  // MasterConsignment
  xml += '  <rsm:MasterConsignment>\n'
  xml += '    <ram:IncludedHouseConsignment>\n'

  // Parties
  xml += renderParties(partiesArr, resolve)

  // Locations from declNode
  const deptLocRef = declNode?.['cargo:departureLocation']
  const arrLocRef = declNode?.['cargo:arrivalLocation']
  const deptLoc = deptLocRef ? (deptLocRef['@type'] ? deptLocRef : resolve(deptLocRef)) : null
  const arrLoc = arrLocRef ? (arrLocRef['@type'] ? arrLocRef : resolve(arrLocRef)) : null
  if (deptLoc) {
    const code = getLocCode(deptLoc); const locName = getVal(deptLoc, 'cargo:locationName')
    xml += '      <ram:OriginLocation>\n'
    xml += '        <ram:ID>' + escXml(code || '') + '</ram:ID>\n'
    if (locName) xml += '        <ram:Name>' + escXml(locName) + '</ram:Name>\n'
    xml += '      </ram:OriginLocation>\n'
  }
  if (arrLoc) {
    const code = getLocCode(arrLoc); const locName = getVal(arrLoc, 'cargo:locationName')
    xml += '      <ram:FinalDestinationLocation>\n'
    xml += '        <ram:ID>' + escXml(code || '') + '</ram:ID>\n'
    if (locName) xml += '        <ram:Name>' + escXml(locName) + '</ram:Name>\n'
    xml += '      </ram:FinalDestinationLocation>\n'
  }

  // Handling instructions
  const handlingInfo = getVal(declNode, 'cargo:handlingInformation')
  const exclusiveUse = getVal(declNode, 'cargo:exclusiveUseIndicator')
  if (handlingInfo || exclusiveUse) {
    xml += '      <ram:HandlingInstructions>\n'
    if (handlingInfo) xml += '        <ram:Description>' + escXml(handlingInfo) + '</ram:Description>\n'
    if (exclusiveUse) xml += '        <ram:ExclusiveUsageIndicator>' + escXml(exclusiveUse) + '</ram:ExclusiveUsageIndicator>\n'
    xml += '      </ram:HandlingInstructions>\n'
  }

  // AssociatedReferenceDocument — AWB (TypeCode 741)
  if (awb) {
    xml += '      <ram:AssociatedReferenceDocument>\n'
    xml += '        <ram:ID>' + escXml(awb) + '</ram:ID>\n'
    xml += '        <ram:TypeCode>741</ram:TypeCode>\n'
    xml += '        <ram:Name>Master air waybill</ram:Name>\n'
    xml += '      </ram:AssociatedReferenceDocument>\n'
  }

  // CommercialTradeTransaction
  xml += '      <ram:RelatedCommercialTradeTransaction>\n'

  // Line items — deduplicated products across all pieces
  const renderedProductIds = new Set()
  let lineSeq = 0
  piecesArr.forEach(pieceRef => {
    const piece = isNested ? pieceRef : (pieceRef['@type'] ? pieceRef : resolve(pieceRef))
    if (!piece) return
    const contentProducts = Array.isArray(piece['cargo:contentProducts']) ? piece['cargo:contentProducts'] : (piece['cargo:contentProducts'] ? [piece['cargo:contentProducts']] : [])
    contentProducts.forEach(productRef => {
      const product = productRef['@type'] ? productRef : resolve(productRef)
      if (!product) return
      const productKey = getVal(product, 'cargo:unNumber') || JSON.stringify(product).slice(0, 80)
      if (renderedProductIds.has(productKey)) return
      renderedProductIds.add(productKey)
      lineSeq++
      const describedObjs = Array.isArray(product['cargo:describedObjects']) ? product['cargo:describedObjects'] : (product['cargo:describedObjects'] ? [product['cargo:describedObjects']] : [])
      const itemRef = describedObjs[0] || null
      const itemObj = itemRef ? resolveLinkedNode(itemRef, resolve) : null

      xml += '        <ram:IncludedCommercialTradeLineItem>\n'
      xml += '          <ram:SequenceNumeric>' + lineSeq + '</ram:SequenceNumeric>\n'
      xml += '          <ram:SpecifiedProductTradeDelivery>\n'
      xml += '            <ram:SpecifiedProductRegulatedGoods>\n'
      xml += '              <ram:ApplicableProductDangerousGoods>\n'

      const unNum = getVal(product, 'cargo:unNumber'); if (unNum) xml += '                <ram:UNDGIdentificationCode>' + escXml(unNum) + '</ram:UNDGIdentificationCode>\n'
      const pkgLevelRef = product['cargo:packagingDangerLevelCode']
      const pkgLevel = pkgLevelRef ? (typeof pkgLevelRef === 'string' ? pkgLevelRef : (pkgLevelRef['@id']?.split(':').pop() || null)) : null
      if (pkgLevel) xml += '                <ram:PackagingDangerLevelCode>' + escXml(pkgLevel) + '</ram:PackagingDangerLevelCode>\n'
      const pi = getVal(product, 'cargo:packingInstructionNumber'); if (pi) xml += '                <ram:PackingInstructionTypeCode>' + escXml(pi) + '</ram:PackingInstructionTypeCode>\n'
      const hazClass = getVal(product, 'cargo:hazardClassificationId'); if (hazClass) xml += '                <ram:HazardClassificationID>' + escXml(hazClass) + '</ram:HazardClassificationID>\n'
      const addClasses = product['cargo:additionalHazardClassificationId']
      if (addClasses) (Array.isArray(addClasses) ? addClasses : [addClasses]).forEach(c => { xml += '                <ram:AdditionalHazardClassificationID>' + escXml(c) + '</ram:AdditionalHazardClassificationID>\n' })
      if (itemObj) {
        const nw = getMeasure(itemObj, 'cargo:netWeightMeasure', resolve); if (nw) xml += '                <ram:NetWeightMeasure unitCode="' + escXml(nw.unit) + '">' + escXml(nw.val) + '</ram:NetWeightMeasure>\n'
      }
      const psn = getVal(product, 'cargo:properShippingName'); if (psn) xml += '                <ram:ProperShippingName>' + escXml(psn) + '</ram:ProperShippingName>\n'
      const techName = getVal(product, 'cargo:technicalName'); if (techName) xml += '                <ram:TechnicalName>' + escXml(techName) + '</ram:TechnicalName>\n'
      const hazCat = getVal(product, 'cargo:hazardCategoryCode'); if (hazCat) xml += '                <ram:HazardCategoryCode>' + escXml(hazCat) + '</ram:HazardCategoryCode>\n'
      const sp = getVal(product, 'cargo:specialProvisionId'); if (sp) xml += '                <ram:SpecialProvisionID>' + escXml(sp) + '</ram:SpecialProvisionID>\n'
      const auth = getVal(product, 'cargo:authorizationInformation'); if (auth) xml += '                <ram:AuthorizationInformation>' + escXml(auth) + '</ram:AuthorizationInformation>\n'
      const placardId = getVal(product, 'cargo:hazardPlacardId'); if (placardId) xml += '                <ram:UpperPartOrangeHazardPlacardID>' + escXml(placardId) + '</ram:UpperPartOrangeHazardPlacardID>\n'
      const marinePollutant = getVal(product, 'cargo:marinePollutantIndicator'); if (marinePollutant) xml += '                <ram:MarinePollutantIndicator>' + escXml(marinePollutant) + '</ram:MarinePollutantIndicator>\n'
      const tunnelCode = getVal(product, 'cargo:tunnelRestrictionCode'); if (tunnelCode) xml += '                <ram:TunnelRestrictionCode>' + escXml(tunnelCode) + '</ram:TunnelRestrictionCode>\n'
      const imdg = getVal(product, 'cargo:imdgSegregationGroupCode'); if (imdg) xml += '                <ram:IMDGSegregationGroupCode>' + escXml(imdg) + '</ram:IMDGSegregationGroupCode>\n'
      const expComp = getVal(product, 'cargo:explosiveCompatibilityGroupCode'); if (expComp) xml += '                <ram:ExplosiveCompatibilityGroupCode>' + escXml(expComp) + '</ram:ExplosiveCompatibilityGroupCode>\n'
      const rq = getVal(product, 'cargo:reportableQuantity'); if (rq) xml += '                <ram:ReportableQuantity>' + escXml(rq) + '</ram:ReportableQuantity>\n'
      const mkTempEl = (tagName, key) => { const m = getMeasure(product, key, resolve); if (m) { xml += '                <ram:' + tagName + '>\n                  <ram:ActualMeasure unitCode="' + escXml(m.unit) + '">' + escXml(m.val) + '</ram:ActualMeasure>\n                </' + 'ram:' + tagName + '>\n' } }
      mkTempEl('FlashpointTemperatureMeasurement', 'cargo:flashpointTemperature')
      mkTempEl('ControlTemperatureMeasurement', 'cargo:controlTemperature')
      mkTempEl('EmergencyTemperatureMeasurement', 'cargo:emergencyTemperature')
      const suppPrefix = getVal(product, 'cargo:supplementaryInfoPrefix', 'cargo:supplementaryInfoSuffix')
      const isSuffix = product['cargo:supplementaryInfoSuffix'] !== undefined
      if (suppPrefix) {
        xml += '                <ram:SupplementaryInformation>\n'
        xml += '                  <ram:SuffixIndicator>' + (isSuffix ? 'true' : 'false') + '</ram:SuffixIndicator>\n'
        xml += '                  <ram:Content>' + escXml(suppPrefix) + '</ram:Content>\n'
        xml += '                </ram:SupplementaryInformation>\n'
      }
      const radioMat = product['cargo:radioactiveMaterial']
      if (radioMat) {
        const ra = radioMat['@type'] ? radioMat : resolve(radioMat)
        if (ra) {
          xml += '                <ram:RadioactiveMaterial>\n'
          const fissRef2 = getVal(ra, 'cargo:fissileExceptionReference'); if (fissRef2) xml += '                  <ram:FissileExceptionReference>' + escXml(fissRef2) + '</ram:FissileExceptionReference>\n'
          const fissInd = getVal(ra, 'cargo:fissileExceptionIndicator'); if (fissInd) xml += '                  <ram:FissileExceptionIndicator>' + escXml(fissInd) + '</ram:FissileExceptionIndicator>\n'
          const isotopes = ra['cargo:isotopes']
          ;(Array.isArray(isotopes) ? isotopes : isotopes ? [isotopes] : []).forEach(iso => {
            xml += '                  <ram:ApplicableRadioactiveIsotope>\n'
            const isoId = getVal(iso, 'cargo:isotopeId'); if (isoId) xml += '                    <ram:ID>' + escXml(isoId) + '</ram:ID>\n'
            const isoName = getVal(iso, 'cargo:isotopeName'); if (isoName) xml += '                    <ram:Name>' + escXml(isoName) + '</ram:Name>\n'
            const act = getMeasure(iso, 'cargo:activityLevelMeasure', resolve); if (act) xml += '                    <ram:ActivityLevelMeasure unitCode="' + escXml(act.unit) + '">' + escXml(act.val) + '</ram:ActivityLevelMeasure>\n'
            const physChem = getVal(iso, 'cargo:physicalChemicalForm'); if (physChem) xml += '                    <ram:PhysicalChemicalFormNote>' + escXml(physChem) + '</ram:PhysicalChemicalFormNote>\n'
            const specForm = getVal(iso, 'cargo:specialFormIndicator'); if (specForm) xml += '                    <ram:SpecialFormIndicator>' + escXml(specForm) + '</ram:SpecialFormIndicator>\n'
            const lowDisp = getVal(iso, 'cargo:lowDispersibleIndicator'); if (lowDisp) xml += '                    <ram:LowDispersibleIndicator>' + escXml(lowDisp) + '</ram:LowDispersibleIndicator>\n'
            xml += '                  </ram:ApplicableRadioactiveIsotope>\n'
          })
          xml += '                </ram:RadioactiveMaterial>\n'
        }
      }
      xml += '              </ram:ApplicableProductDangerousGoods>\n'
      xml += '            </ram:SpecifiedProductRegulatedGoods>\n'
      xml += '          </ram:SpecifiedProductTradeDelivery>\n'
      xml += '        </ram:IncludedCommercialTradeLineItem>\n'
    })
  })

  // If no DG products were found, emit a minimal placeholder to satisfy IncludedCommercialTradeLineItem minOccurs="1"
  if (lineSeq === 0) {
    xml += '        <ram:IncludedCommercialTradeLineItem>\n'
    xml += '          <ram:SequenceNumeric>1</ram:SequenceNumeric>\n'
    xml += '          <ram:SpecifiedProductTradeDelivery>\n'
    xml += '            <ram:SpecifiedProductRegulatedGoods>\n'
    xml += '              <ram:ApplicableProductDangerousGoods>\n'
    xml += '                <ram:UNDGIdentificationCode></ram:UNDGIdentificationCode>\n'
    xml += '                <ram:HazardClassificationID></ram:HazardClassificationID>\n'
    xml += '                <ram:ProperShippingName></ram:ProperShippingName>\n'
    xml += '              </ram:ApplicableProductDangerousGoods>\n'
    xml += '            </ram:SpecifiedProductRegulatedGoods>\n'
    xml += '          </ram:SpecifiedProductTradeDelivery>\n'
    xml += '        </ram:IncludedCommercialTradeLineItem>\n'
  }

  // Packages
  let pkgSeq = 0
  piecesArr.forEach((pieceRef) => {
    const piece = isNested ? pieceRef : (pieceRef['@type'] ? pieceRef : resolve(pieceRef))
    if (!piece) return
    pkgSeq++
    const isOverpack = !!piece['cargo:overpackNetQuantitySummary'] || getVal(piece, 'cargo:isOverpack') === 'true'
    const tag = isOverpack ? 'SpecifiedOverpackPackage' : 'SpecifiedLogisticsPackage'
    let s = '        <ram:' + tag + '>\n'
    // 1. ItemQuantity (required for both types)
    const slac = getVal(piece, 'cargo:slac')
    s += '          <ram:ItemQuantity>' + escXml(slac || '0') + '</ram:ItemQuantity>\n'
    // 2. GrossWeightMeasure
    const gw = getMeasure(piece, 'cargo:grossWeight', resolve); if (gw) s += '          <ram:GrossWeightMeasure unitCode="' + escXml(gw.unit) + '">' + escXml(gw.val) + '</ram:GrossWeightMeasure>\n'
    // 3. SequenceNumeric
    s += '          <ram:SequenceNumeric>' + pkgSeq + '</ram:SequenceNumeric>\n'
    if (isOverpack) {
      // OverpackPackageType order: OverpackNetQuantitySummary, LinearSpatialDimension, SpecifiedPackagedTradeDelivery, IncludedPackagedTradeLineItem
      const overpackSummary = getVal(piece, 'cargo:overpackNetQuantitySummary'); if (overpackSummary) s += '          <ram:OverpackNetQuantitySummary>' + escXml(overpackSummary) + '</ram:OverpackNetQuantitySummary>\n'
      const dimsOver = resolveLinkedNode(piece['cargo:dimensions'], resolve)
      if (dimsOver) {
        s += '          <ram:LinearSpatialDimension>\n'
        const w = getMeasure(dimsOver, 'cargo:width', resolve); if (w) s += '            <ram:WidthMeasure unitCode="' + escXml(w.unit) + '">' + escXml(w.val) + '</ram:WidthMeasure>\n'
        const l = getMeasure(dimsOver, 'cargo:length', resolve); if (l) s += '            <ram:LengthMeasure unitCode="' + escXml(l.unit) + '">' + escXml(l.val) + '</ram:LengthMeasure>\n'
        const h = getMeasure(dimsOver, 'cargo:height', resolve); if (h) s += '            <ram:HeightMeasure unitCode="' + escXml(h.unit) + '">' + escXml(h.val) + '</ram:HeightMeasure>\n'
        s += '          </ram:LinearSpatialDimension>\n'
      }
    } else {
      // LogisticsPackageType: AllPackedInOneIndicator (req), AllPackedInOneInformation, QValueNumeric, LinearSpatialDimension, UsedSupplyChainPackaging (req)
      const allPacked = getVal(piece, 'cargo:allPackedInOneIndicator')
      s += '          <ram:AllPackedInOneIndicator>' + escXml(allPacked ?? 'false') + '</ram:AllPackedInOneIndicator>\n'
      const allPackedInfo = getVal(piece, 'cargo:allPackedInOneInformation'); if (allPackedInfo) s += '          <ram:AllPackedInOneInformation>' + escXml(allPackedInfo) + '</ram:AllPackedInOneInformation>\n'
      const qVal = getVal(piece, 'cargo:qValueNumeric'); if (qVal) s += '          <ram:QValueNumeric>' + escXml(qVal) + '</ram:QValueNumeric>\n'
      const dims = resolveLinkedNode(piece['cargo:dimensions'], resolve)
      if (dims) {
        s += '          <ram:LinearSpatialDimension>\n'
        const w = getMeasure(dims, 'cargo:width', resolve); if (w) s += '            <ram:WidthMeasure unitCode="' + escXml(w.unit) + '">' + escXml(w.val) + '</ram:WidthMeasure>\n'
        const l = getMeasure(dims, 'cargo:length', resolve); if (l) s += '            <ram:LengthMeasure unitCode="' + escXml(l.unit) + '">' + escXml(l.val) + '</ram:LengthMeasure>\n'
        const h = getMeasure(dims, 'cargo:height', resolve); if (h) s += '            <ram:HeightMeasure unitCode="' + escXml(h.unit) + '">' + escXml(h.val) + '</ram:HeightMeasure>\n'
        s += '          </ram:LinearSpatialDimension>\n'
      }
      // UsedSupplyChainPackaging (required): TypeCode (opt) first, then Type (req)
      const pkgType = resolveLinkedNode(piece['cargo:packagingType'], resolve)
      s += '          <ram:UsedSupplyChainPackaging>\n'
      const typeCode = pkgType ? getVal(pkgType, 'cargo:packagingTypeCode') : null
      const typeName = pkgType ? getVal(pkgType, 'cargo:description', 'cargo:packagingTypeDescription') : null
      if (typeCode) s += '            <ram:TypeCode>' + escXml(typeCode) + '</ram:TypeCode>\n'
      s += '            <ram:Type>' + escXml(typeName || '') + '</ram:Type>\n'
      s += '          </ram:UsedSupplyChainPackaging>\n'
    }
    // SpecifiedPackagedTradeDelivery (radioactive, both types)
    const raObj = piece['cargo:overpackT1']
    if (raObj) {
      const ra = raObj['@type'] ? raObj : resolve(raObj)
      if (ra) {
        s += '          <ram:SpecifiedPackagedTradeDelivery>\n            <ram:SpecifiedPackagedRegulatedGoods>\n              <ram:ApplicablePackagedDangerousGoods>\n                <ram:PackagedRadioactiveMaterial>\n'
        const rtc = getVal(ra, 'cargo:dgRaTypeCode'); if (rtc) s += '                  <ram:TypeCode>' + escXml(rtc) + '</ram:TypeCode>\n'
        const ti = getVal(ra, 'cargo:transportIndexNumeric'); if (ti) s += '                  <ram:TransportIndexNumeric>' + escXml(ti) + '</ram:TransportIndexNumeric>\n'
        const csi = getVal(ra, 'cargo:criticalitySafetyIndexNumeric'); if (csi) s += '                  <ram:CriticalitySafetyIndexNumeric>' + escXml(csi) + '</ram:CriticalitySafetyIndexNumeric>\n'
        s += '                </ram:PackagedRadioactiveMaterial>\n              </ram:ApplicablePackagedDangerousGoods>\n            </ram:SpecifiedPackagedRegulatedGoods>\n          </ram:SpecifiedPackagedTradeDelivery>\n'
      }
    }
    // IncludedPackagedTradeLineItem
    s += '          <ram:IncludedPackagedTradeLineItem>\n'
    s += '            <ram:SequenceNumeric>' + pkgSeq + '</ram:SequenceNumeric>\n'
    s += '          </ram:IncludedPackagedTradeLineItem>\n'
    s += '        </ram:' + tag + '>\n'
    xml += s
  })

  xml += '      </ram:RelatedCommercialTradeTransaction>\n'

  // ApplicableTransportDangerousGoods — collect emergency contacts from describedObjects
  const hazTypeCode = getVal(declNode, 'cargo:hazardTypeCode')
  const aircraftLim = getVal(declNode, 'cargo:aircraftLimitationInformation')
  const emergencyContacts = []
  piecesArr.forEach(pieceRef => {
    const piece = isNested ? pieceRef : (pieceRef['@type'] ? pieceRef : resolve(pieceRef))
    if (!piece) return
    const cps = Array.isArray(piece['cargo:contentProducts']) ? piece['cargo:contentProducts'] : (piece['cargo:contentProducts'] ? [piece['cargo:contentProducts']] : [])
    cps.forEach(productRef => {
      const product = productRef['@type'] ? productRef : resolve(productRef)
      if (!product) return
      const dos = Array.isArray(product['cargo:describedObjects']) ? product['cargo:describedObjects'] : (product['cargo:describedObjects'] ? [product['cargo:describedObjects']] : [])
      dos.forEach(itemRef => {
        const item = itemRef['@type'] ? itemRef : resolve(itemRef)
        if (!item) return
        const ec = item['cargo:emergencyContact']
        const ecArr = Array.isArray(ec) ? ec : (ec ? [ec] : [])
        ecArr.forEach(ecRef => { const ecObj = ecRef['@type'] ? ecRef : resolve(ecRef); if (ecObj) emergencyContacts.push(ecObj) })
      })
    })
  })
  // Fallback: legacy emergencyContact on DgDeclaration
  if (emergencyContacts.length === 0 && declNode?.['cargo:emergencyContact']) {
    const ec = declNode['cargo:emergencyContact']
    const ecArr = Array.isArray(ec) ? ec : [ec]
    ecArr.forEach(ecRef => { const ecObj = ecRef['@type'] ? ecRef : resolve(ecRef); if (ecObj) emergencyContacts.push(ecObj) })
  }

  if (hazTypeCode || aircraftLim || emergencyContacts.length > 0) {
    xml += '      <ram:ApplicableTransportDangerousGoods>\n'
    xml += '        <ram:HazardTypeCode>' + escXml(hazTypeCode || 'CAO') + '</ram:HazardTypeCode>\n'
    xml += '        <ram:AircraftLimitationInformation>' + escXml(aircraftLim || '') + '</ram:AircraftLimitationInformation>\n'
    const complText = getVal(declNode, 'cargo:complianceDeclarationText'); if (complText) xml += '        <ram:ComplianceDeclarationInformation>' + escXml(complText) + '</ram:ComplianceDeclarationInformation>\n'
    const shipDecl = getVal(declNode, 'cargo:shipperDeclarationText'); if (shipDecl) xml += '        <ram:ShipperDeclarationInformation>' + escXml(shipDecl) + '</ram:ShipperDeclarationInformation>\n'
    emergencyContacts.forEach(ec => {
      const ecContacts = ec['cargo:contactDetails']
      const ecPhone = Array.isArray(ecContacts) ? ecContacts[0] : ecContacts
      const phoneVal = ecPhone ? getVal(ecPhone, 'cargo:textualValue', 'cargo:contactDescription') : null
      if (!phoneVal) return
      const firstName = getVal(ec, 'cargo:firstName')
      const lastName = getVal(ec, 'cargo:lastName')
      const personName = firstName || lastName || null
      xml += '        <ram:EmergencyDangerousGoodsContact>\n'
      if (personName) xml += '          <ram:PersonName>' + escXml(personName) + '</ram:PersonName>\n'
      const parts = phoneVal.split(' \u2014 ')
      xml += '          <ram:DirectEmergencyTelephoneCommunication>\n'
      xml += '            <ram:CompleteNumber>' + escXml(parts[0]) + '</ram:CompleteNumber>\n'
      if (parts[1]) xml += '            <ram:AdditionalInformation>' + escXml(parts[1]) + '</ram:AdditionalInformation>\n'
      xml += '          </ram:DirectEmergencyTelephoneCommunication>\n'
      xml += '        </ram:EmergencyDangerousGoodsContact>\n'
    })
    xml += '      </ram:ApplicableTransportDangerousGoods>\n'
  }

  xml += '    </ram:IncludedHouseConsignment>\n'
  xml += '  </rsm:MasterConsignment>\n'
  xml += '</rsm:ShippersDeclarationForDangerousGoods>'
  console.debug(`[jsonld→xml] Done. XML output length: ${xml.length} chars`)
  return xml
}
