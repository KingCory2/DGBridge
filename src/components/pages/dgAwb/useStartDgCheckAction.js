import { useState } from 'react'
import { fetchDgToken, createAcceptanceCheck } from '../../../services/dgApi'

export function useStartDgCheckAction(setAwbs, officeIdentifier) {
  const [loading, setLoading] = useState(null)

  const handler = async (awb) => {
    setLoading(awb.id)
    try {
      const token = await fetchDgToken()
      const result = await createAcceptanceCheck(officeIdentifier, token)
      const checkId = result?.acceptanceCheckId
      if (!checkId) throw new Error('No acceptanceCheckId returned from server')
      setAwbs(prev => prev.map(a =>
        a.id === awb.id
          ? { ...a, acceptanceCheckId: checkId, statusIndex: 2, statusUpdatedAt: new Date().toISOString() }
          : a
      ))
    } catch (err) {
      alert(`DG Check failed: ${err.message}`)
    } finally {
      setLoading(null)
    }
  }

  return { handler, loading }
}
