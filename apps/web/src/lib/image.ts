import type { AiAttachment } from '@nc/shared'

/**
 * A photo as a JPEG attachment whose long edge is at most `maxEdge` px. Claude reads images up to about
 * this size at full detail, so sending more only costs upload time.
 */
export async function photoAttachment(file: Blob, maxEdge = 1568): Promise<AiAttachment> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read the image')
  // JPEG has no transparency; a white background keeps screenshots of dark text readable.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
}

export const attachmentUrl = (a: AiAttachment) => `data:${a.mediaType};base64,${a.data}`
