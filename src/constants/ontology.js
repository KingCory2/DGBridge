// Shared RDF / JSON-LD namespace URIs and context used across the application.

export const NS_CARGO = 'https://onerecord.iata.org/ns/cargo#'
export const NS_CODE_LISTS = 'https://onerecord.iata.org/ns/code-lists/'
export const NS_CODE_LISTS_HASH = 'https://onerecord.iata.org/ns/code-lists#'
export const NS_UNECE = 'https://vocabulary.uncefact.org/'
export const NS_PARTICIPANT_ID = 'https://onerecord.iata.org/ns/code-lists/ParticipantIdentifier#'
export const NS_PACKAGING_DANGER = 'https://onerecord.iata.org/ns/code-lists/PackagingDangerLevelCode#'
export const NS_XSD = 'http://www.w3.org/2001/XMLSchema#'
export const NS_RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

/** Full JSON-LD @context used when serialising ONE Record cargo documents. */
export const JSONLD_CONTEXT = {
  cargo: NS_CARGO,
  ccodes: NS_CODE_LISTS_HASH,
  unece: NS_UNECE,
  participantIdentifier: NS_PARTICIPANT_ID,
  packagingDangerLevelCode: NS_PACKAGING_DANGER,
  xsd: NS_XSD,
}
