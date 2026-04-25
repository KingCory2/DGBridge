export const NEONE_ENDPOINTS = [
  { methods: ['GET'], path: '/', description: 'Retrieve Server Information' },
  { methods: ['POST'], path: '/logistics-objects/', description: 'Create Logistics Object' },
  { methods: ['GET', 'PATCH', 'POST', 'HEAD'], path: '/logistics-objects/{logisticsObjectId}', description: 'Retrieve, change, or verify Logistics Object' },
  { methods: ['GET'], path: '/logistics-objects/{logisticsObjectId}/audit-trail', description: 'Retrieve Audit Trail of a Logistics Object' },
  { methods: ['GET', 'POST', 'HEAD'], path: '/logistics-objects/{logisticsObjectId}/logistics-events', description: 'Create or retrieve Logistics Events' },
  { methods: ['GET'], path: '/logistics-objects/{logisticsObjectId}/logistics-events/{logisticsEventId}', description: 'Retrieve a specific Logistics Event' },
  { methods: ['GET', 'POST'], path: '/subscriptions', description: 'Create or retrieve Subscription information' },
  { methods: ['GET', 'PATCH', 'DELETE', 'HEAD'], path: '/action-requests/{actionRequestId}', description: 'Retrieve or update Action Request' },
  { methods: ['POST'], path: '/notifications', description: 'Receive Notifications' },
  { methods: ['POST'], path: '/access-delegations', description: 'Create Access Delegation Request' },
]

export function extractPathParams(path) {
  const matches = path.match(/\{([^}]+)\}/g)
  return matches ? matches.map(m => m.slice(1, -1)) : []
}
