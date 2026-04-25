import { useState } from 'react'
import { fetchDgToken, fetchAcceptanceCheck, fetchLogisticsObject, importXsdgToAcceptanceCheck, fetchDgCheckRequestUrl } from '../../../services/dgApi'
import { fetchAccessToken } from '../../../services/neoneApi'
import { convertJsonLdToXml } from '../../../lib/convertJsonLdToXml'

const SKIP_IMPORT_STATUSES = [
  'awaiting-document-check',
  'documentation-check-in-progress',
  'awaiting-packaging-check',
]

export function useDoDgCheckAction(ghaSettings, neoneBaseUrl, neoneTokenUrl) {
  const [loading, setLoading] = useState(null)

  const handler = async (awb) => {
    if (!awb.acceptanceCheckId) {
      alert('No Acceptance Check ID found for this AWB.')
      return
    }
    setLoading(awb.id)
    try {
      // Step 1: authenticate with DG API
      const dgToken = await fetchDgToken()

      // Step 2: check current acceptance check status
      const acceptanceCheck = await fetchAcceptanceCheck(awb.acceptanceCheckId, dgToken)
      const status = acceptanceCheck?.acceptanceCheckStatus

      if (status === 'awaiting-file') {
        // Full flow: fetch logistics object, convert to XML, import XSDG
        const neoneToken = await fetchAccessToken(neoneTokenUrl)
        const loUrl = `${neoneBaseUrl}/logistics-objects/shipment-${awb.awb}?embedded=true`
        const logisticsObject = await fetchLogisticsObject(loUrl, neoneToken)
        const xml = await convertJsonLdToXml(JSON.stringify(logisticsObject))
        await importXsdgToAcceptanceCheck(awb.acceptanceCheckId, xml, dgToken)
      } else if (!SKIP_IMPORT_STATUSES.includes(status)) {
        throw new Error(`Cannot proceed: acceptance check is in unexpected status "${status}"`)
      }
      // For SKIP_IMPORT_STATUSES: skip the XSDG import and go straight to the request URL

      // Final step: request access URL and open in new window
      const result = await fetchDgCheckRequestUrl(
        awb.acceptanceCheckId,
        ghaSettings.userIdentifier,
        ghaSettings.userName ?? '',
        dgToken
      )
      const url = result?.requestedUrl
      if (!url) throw new Error('No requestedUrl returned from server')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      alert(`DG Check failed: ${err.message}`)
    } finally {
      setLoading(null)
    }
  }

  return { handler, loading }
}
