import * as pdfjsLib from 'pdfjs-dist'

// Configure the worker once at module level.
// Works in both browser page components and plain async contexts (hooks, services).
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).href
}

/**
 * Extracts the full plain text from a PDF ArrayBuffer.
 * Reconstructs lines by grouping text items with similar Y coordinates.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>}
 */
export async function extractPdfText(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const textParts = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    let prevY = null
    for (const item of content.items) {
      if (item.str === undefined) continue
      const y = item.transform ? Math.round(item.transform[5]) : null
      if (prevY !== null && y !== null && Math.abs(y - prevY) > 2) {
        textParts.push('\n')
      }
      textParts.push(item.str)
      if (item.hasEOL) textParts.push('\n')
      prevY = y
    }
    textParts.push('\n\n')
  }
  return textParts.join('')
}
