import { fetchDgToken, DG_API_BASE } from '../../../services/dgApi'

export function useViewChecklistAction() {
  const handleViewChecklist = async (awb) => {
    const url = awb.acceptanceCheckReportUrl ||
      `${DG_API_BASE}/api/v1/acceptance-checks/${encodeURIComponent(awb.acceptanceCheckId)}/report/pdf`
    try {
      const token = await fetchDgToken()
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Report fetch failed: ${res.status} ${res.statusText}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const win = window.open(blobUrl, '_blank', 'noopener,noreferrer')
      if (win) win.addEventListener('unload', () => URL.revokeObjectURL(blobUrl))
    } catch (err) {
      alert(`Failed to open report: ${err.message}`)
    }
  }

  return handleViewChecklist
}
