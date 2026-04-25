import { useState } from 'react'
import { fetchDgToken, fetchAcceptanceCheck, fetchAcceptanceCheckPdf } from '../../../services/dgApi'
import { fetchAccessToken } from '../../../services/neoneApi'
import { extractPdfText } from '../../../lib/extractPdfText'
import { convertPdfToCheckJsonLd } from '../../../lib/convertPdfToCheckJsonLd'
import {
  DEFAULT_NEONE_BASE_URL,
  DEFAULT_NEONE_TOKEN_URL,
  NOTIFICATION_DISMISS_MS,
} from '../../../constants/defaults'

export function useRefreshAction(setAwbs, neoneBaseUrl = DEFAULT_NEONE_BASE_URL, neoneTokenUrl = DEFAULT_NEONE_TOKEN_URL) {
  const [loading, setLoading] = useState(null)
  const [notification, setNotification] = useState(null)

  const notify = (text, type) => {
    setNotification({ text, type })
    setTimeout(() => setNotification(null), NOTIFICATION_DISMISS_MS)
  }

  const handler = async (awb) => {
    setLoading(awb.id)
    try {
      const token = await fetchDgToken()
      const result = await fetchAcceptanceCheck(awb.acceptanceCheckId, token)

      let newStatusIndex = awb.statusIndex
      let newStatusUpdatedAt = awb.statusUpdatedAt
      const reportLink = result._links?.find(l => l.description === 'Acceptance Check Report')?.url

      if (result.acceptanceCheckStatus === 'completed') {
        newStatusIndex = 5
        newStatusUpdatedAt =
          result.acceptanceCheckSignOff?.signedOffOn ||
          result.packagingCheck?.completedOn ||
          new Date().toISOString()
      } else if (result.packagingCheck?.completedOn) {
        newStatusIndex = 4
        newStatusUpdatedAt = result.packagingCheck.completedOn
      } else if (result.documentationCheck?.completedOn) {
        newStatusIndex = 3
        newStatusUpdatedAt = result.documentationCheck.completedOn
      } else if (result.verification?.completedOn) {
        newStatusIndex = 2
        newStatusUpdatedAt = result.verification.completedOn
      }

      const checkResult = result.acceptanceCheckSignOff?.result ?? null

      if (newStatusIndex === awb.statusIndex) {
        notify('Already up to date.', 'info')
      } else {
        notify('Status updated.', 'success')
      }

      setAwbs(prev => prev.map(a =>
        a.id === awb.id
          ? {
              ...a,
              statusIndex: newStatusIndex,
              statusUpdatedAt: newStatusUpdatedAt,
              ...(reportLink ? { acceptanceCheckReportUrl: reportLink } : {}),
              ...(checkResult !== null ? { checkResult } : {}),
            }
          : a
      ))

      // ── When status just reached "DG Check Completed" (index 5) ──────────
      // Fetch the PDF, convert it to ONE Record JSON-LD, and POST to neone.
      if (newStatusIndex === 5 && awb.statusIndex !== 5) {
        try {
          const pdfBuffer   = await fetchAcceptanceCheckPdf(awb.acceptanceCheckId, token)
          const pdfText     = await extractPdfText(pdfBuffer)
          const base        = (neoneBaseUrl || DEFAULT_NEONE_BASE).replace(/\/$/, '')
          const jsonLd      = convertPdfToCheckJsonLd(pdfText, awb.awb, base)
          const neoneToken  = await fetchAccessToken(neoneTokenUrl || DEFAULT_NEONE_TOKEN_URL)
          const postRes     = await fetch(`${base}/logistics-objects`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/ld+json',
              'Authorization': `Bearer ${neoneToken}`,
            },
            body: jsonLd,
          })
          if (!postRes.ok) {
            const errText = await postRes.text()
            notify(`Check JSON-LD posted failed: ${postRes.status} ${errText}`, 'error')
          } else {
            const location = postRes.headers.get('Location') || `${base}/logistics-objects`
            notify(`Check JSON-LD posted: ${location}`, 'success')
          }
        } catch (postErr) {
          notify(`Check JSON-LD post error: ${postErr.message}`, 'error')
        }
      }
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(null)
    }
  }

  return { handler, loading, notification }
}

