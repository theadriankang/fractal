// Turns a File into what the Edge Function sends to Claude.
// PDFs and images go as base64 (Claude reads them natively); .docx is converted to text
// in the browser; .txt/.csv are read as text. Files are never uploaded to storage.

export const ACCEPT = '.pdf,.docx,.txt,.csv,.png,.jpg,.jpeg'
export const MAX_FILES = 5
export const MAX_BYTES = 10 * 1024 * 1024

const ext = (name) => name.toLowerCase().split('.').pop()

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

export function validateFile(file) {
  if (!ACCEPT.split(',').includes('.' + ext(file.name))) return `${file.name}: unsupported type`
  if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB`
  return null
}

export async function readAttachment(file) {
  const e = ext(file.name)
  if (e === 'pdf') return { name: file.name, kind: 'pdf', data: await toBase64(file) }
  if (e === 'png' || e === 'jpg' || e === 'jpeg')
    return { name: file.name, kind: 'image', mediaType: e === 'png' ? 'image/png' : 'image/jpeg', data: await toBase64(file) }
  if (e === 'docx') {
    const { default: mammoth } = await import('mammoth/mammoth.browser')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { name: file.name, kind: 'text', data: value }
  }
  return { name: file.name, kind: 'text', data: await file.text() }
}
