// Role-based page visibility configuration
export const ROLE_PAGES = {
  airline:   ['dg-awb'],
  shipper:   ['dg-awb', 'dgd-form'],
//   developer: ['one-record', 'graph-db', 'neone', 'xsdg-converter', 'dgd-form', 'dg-awb', 'pdf-viewer'],
  gha:       ['dg-awb'],
}

export function canAccess(role, pageId) {
  return ROLE_PAGES[role]?.includes(pageId) ?? false
}
