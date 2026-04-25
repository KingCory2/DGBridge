import { DEFAULT_NEONE_BASE_URL } from '../constants/defaults'
import { NS_CARGO, NS_CODE_LISTS } from '../constants/ontology'

/**
 * Parses the plain text extracted from an EVA Air (or compatible)
 * Dangerous Goods Acceptance Checklist PDF and produces a cargo:Check JSON-LD
 * object conforming to the IATA ONE Record ontology.
 *
 * @param {string} pdfText   Full text extracted from all pages of the PDF
 * @param {string} [awbOverride]  AWB number to use if auto-extraction fails (e.g. "516-00000013")
 * @param {string} [neoneBaseUrl] Base URL for logistics-object IRIs (default: "http://localhost:8080")
 * @returns {string}  Pretty-printed JSON-LD string
 */
export function convertPdfToCheckJsonLd(pdfText, awbOverride = '', neoneBaseUrl = DEFAULT_NEONE_BASE_URL) {
  // ── 1. AWB number ───────────────────────────────────────────────────────────
  const awbMatch = pdfText.match(/\b(\d{3}[-\s]\d{8})\b/)
  const awbRaw = awbMatch ? awbMatch[1].replace(/\s/, '-') : awbOverride.trim()
  const awbId = awbRaw.replace(/[^0-9-]/g, '') || 'unknown'

  // ── 2. Action date/time ─────────────────────────────────────────────────────
  // Use the current timestamp as the actionStartTime — the moment the user
  // performs the conversion. Parsing dates from a PDF is unreliable (form dates,
  // flight dates, and check dates all appear before/after question blocks).
  const actionDate = new Date().toISOString()

  // ── 3. Template name ────────────────────────────────────────────────────────
  // Grab first non-blank line that looks like a title (≥10 chars, no leading digits)
  const allLines = pdfText.split(/\r?\n/).map(l => l.trim())
  const lines = allLines.filter(Boolean)
  // Restrict question scanning to the body (after the cover page) to avoid
  // false positives from date/number patterns in the header (e.g. "25 Apr 2026").
  const bodyStart = pdfText.search(/\bacceptance\s+check\s+report\b/i)
  const bodyLines = (bodyStart >= 0 ? pdfText.slice(bodyStart) : pdfText)
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let templateName = 'Dangerous Goods Acceptance Checklist'
  for (const line of lines.slice(0, 30)) {
    if (line.length >= 10 && !/^\d+[.)]\s/.test(line) && !/^(page|date|flight|awb|mawb|hawb)/i.test(line)) {
      templateName = line
      break
    }
  }

  // ── 4. Questions parsing ────────────────────────────────────────────────────
  // Matches numbered questions in the IATA DG AutoCheck PDF format:
  //   "1 Text", "19A Text", "40A Text"  — space-delimited (the main format in this PDF)
  //   "17-CAG-09. Text"                 — hyphenated sub-item with period
  //   "SGG-01: Text", "SQ-08: Text"     — state/operator sub-provisions with colon
  // Requires ≥10 chars of question text to filter out false positives.
  const questionRegex = /^\s*(\d{1,3}[A-Za-z]?(?:[-][A-Z0-9-]+)?|[A-Z]{2,6}-\d{2,3})[.):\s]\s*(.{10,})/i
  // Standalone answer token on its own line
  const standaloneAnswerRegex = /^(Yes|No|N\/A|YES|NO|N_A|NA|Pass|Fail)$/i
  // Inline answer in question text
  const answerInlineRegex = /\b(Yes|No|N\/A|YES|NO|N_A|NA|Pass|Fail)\b/i
  // Note annotation: "Note by user : <text>" or "Note by <name> : <text>"
  const noteRegex = /^Note\s+by\s+\S+\s*:\s*(.+)/i
  // Packaging section boundary: the line is exactly the word "Packaging" (PDF section header)
  const packagingBoundaryRegex = /^packaging$/i

  const SECTION_DOC  = 'Dangerous Goods Acceptance - Document Check'
  const SECTION_PKG  = 'Dangerous Goods Acceptance - Packaging Check'

  const questions = []
  let currentSection = SECTION_DOC
  let i = 0
  while (i < bodyLines.length) {
    const line = bodyLines[i]

    // Switch section when we hit the standalone "Packaging" header line.
    if (packagingBoundaryRegex.test(line) && currentSection === SECTION_DOC) {
      currentSection = SECTION_PKG
      i++
      continue
    }

    const qMatch = line.match(questionRegex)
    if (qMatch) {
      const qNum = qMatch[1]
      let qText = qMatch[2].trim()

      // Collect continuation lines until the next numbered question.
      // Blank lines are skipped because PDF text extraction often inserts
      // blank lines within a single question's text.
      let j = i + 1
      while (j < bodyLines.length) {
        const next = bodyLines[j]
        if (questionRegex.test(next)) break                // next question starts
        if (packagingBoundaryRegex.test(next)) break       // section boundary
        if (standaloneAnswerRegex.test(next.trim())) break // standalone answer token
        if (noteRegex.test(next.trim())) break             // note annotation — stop before it
        if (next.trim() === '') { j++; continue }          // skip blank lines
        qText += ' ' + next.trim()
        j++
      }

      // Determine answer: standalone token on the next non-blank line takes priority,
      // then fall back to an inline token anywhere in the question text.
      let answerText = ''
      if (j < bodyLines.length && standaloneAnswerRegex.test(bodyLines[j].trim())) {
        answerText = normalizeAnswer(bodyLines[j].trim())
        j++ // consumed
      } else {
        const inlineAns = qText.match(answerInlineRegex)
        if (inlineAns) {
          answerText = normalizeAnswer(inlineAns[1])
          // Strip the answer token and unchecked-box markers ("- -") from question text
          qText = qText
            .replace(answerInlineRegex, '')
            .replace(/ - - | - -$|^- - /g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
        }
      }

      // Capture optional "Note by user : ..." line immediately after the answer
      let noteText = ''
      if (j < bodyLines.length) {
        const noteMatch = bodyLines[j].trim().match(noteRegex)
        if (noteMatch) {
          noteText = noteMatch[1].trim()
          j++
        }
      }

      questions.push({
        number: qNum,
        section: currentSection,
        text: qText,
        answer: answerText || 'N/A',
        note: noteText,
      })
      i = j
      continue
    }
    i++
  }

  // ── 5. Overall result ───────────────────────────────────────────────────────
  const resultMatch = pdfText.match(/\b(ACCEPTED|REJECTED|PASSED|FAILED|PASS|FAIL)\b/i)
  let overallPassed = true
  if (resultMatch) {
    const r = resultMatch[1].toUpperCase()
    overallPassed = r === 'ACCEPTED' || r === 'PASSED' || r === 'PASS'
  } else {
    // Heuristic: all answers must be "Yes" or "N/A" to pass
    overallPassed = questions.every(q => q.answer === 'Yes' || q.answer === 'N/A')
  }

  // ── 6. Certifier name ───────────────────────────────────────────────────────
  // Extract the full operator name from the "Operators" field on the cover page.
  // The value includes periods, parentheses and digits, e.g. "Singapore Airlines Limited. (SQ-618)".
  let firstName = 'Placeholder'
  const operatorMatch = pdfText.match(/\boperators?\b[:\s]+([^\n\r]{2,80})/i)
  if (operatorMatch) {
    firstName = operatorMatch[1].trim().replace(/\s+/g, ' ')
  }

  // ── 7. Build cargo:Check JSON-LD ────────────────────────────────────────────
  const base = neoneBaseUrl.replace(/\/$/, '')
  const checkJsonLd = {
    '@context': {
      cargo: NS_CARGO,
      cl: NS_CODE_LISTS,
    },
    '@type': 'cargo:Check',
    'cargo:name': 'Dangerous Goods Acceptance Check',
    'cargo:checkedObject': {
      '@id': `${base}/logistics-objects/shipment-${awbId}`,
    },
    'cargo:checker': {
      '@type': 'cargo:Actor',
      'cargo:name': 'IATA DG AutoCheck',
      'cargo:associatedOrganization': {
        '@type': 'cargo:Organization',
        'cargo:name': 'IATA DG AutoCheck',
      },
    },
    'cargo:actionStartTime': {
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
      '@value': actionDate,
    },
    'cargo:usedTemplate': {
      '@type': 'cargo:CheckTemplate',
      'cargo:name': templateName,
      'cargo:templatePurpose': 'Dangerous goods acceptance check',
      'cargo:questions': questions.map(q => ({
        '@type': 'cargo:Question',
        'cargo:questionNumber': q.number,
        'cargo:questionSection': q.section,
        'cargo:longText': q.text,
        'cargo:answerOptionsText': 'Yes|No|N/A',
        'cargo:answerOptionsValue': 'YES|NO|NA',
        'cargo:answer': {
          '@type': 'cargo:Answer',
          'cargo:value': q.answer,
          ...(q.note ? { 'cargo:text': q.note } : {}),
        },
      })),
    },
    'cargo:checkTotalResult': {
      '@type': 'cargo:CheckTotalResult',
      'cargo:passed': {
        '@type': 'http://www.w3.org/2001/XMLSchema#boolean',
        '@value': String(overallPassed),
      },
      'cargo:checkRemark': `DG acceptance checklist completed by IATA DG AutoCheck. Result: ${overallPassed ? 'passed' : 'failed'}.`,
      'cargo:certifiedByActor': {
        '@type': 'cargo:Person',
        'cargo:firstName': firstName,
        'cargo:jobTitle': 'Dangerous Goods Acceptance Certifier',
      },
    },
  }

  return JSON.stringify(checkJsonLd, null, 2)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeAnswer(raw) {
  const s = raw.trim().toUpperCase()
  if (s === 'YES' || s === 'PASS' || s === 'PASSED' || s === 'ACCEPTED') return 'Yes'
  if (s === 'NO' || s === 'FAIL' || s === 'FAILED' || s === 'REJECTED') return 'No'
  return 'N/A'
}
