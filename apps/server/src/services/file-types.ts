import path from 'node:path'

const text = 'text/plain; charset=utf-8'

/**
 * Uploadable file types by extension. The served content type comes from this table, never from the
 * type the browser claimed at upload, so a file cannot be served as HTML or script.
 */
const FILE_TYPES: Record<string, { mime: string; inline: boolean }> = {
  pdf: { mime: 'application/pdf', inline: true },
  png: { mime: 'image/png', inline: true },
  jpg: { mime: 'image/jpeg', inline: true },
  jpeg: { mime: 'image/jpeg', inline: true },
  gif: { mime: 'image/gif', inline: true },
  webp: { mime: 'image/webp', inline: true },
  txt: { mime: text, inline: true },
  md: { mime: text, inline: true },
  csv: { mime: text, inline: true },
  rtf: { mime: 'application/rtf', inline: false },
  doc: { mime: 'application/msword', inline: false },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false },
  ppt: { mime: 'application/vnd.ms-powerpoint', inline: false },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inline: false },
  xls: { mime: 'application/vnd.ms-excel', inline: false },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false },
  odt: { mime: 'application/vnd.oasis.opendocument.text', inline: false },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', inline: false },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', inline: false },
}

const extensionOf = (name: string) => path.extname(name).slice(1).toLowerCase()

/** The type for a file name, or null when that extension may not be uploaded. */
export function fileType(name: string): { mime: string; inline: boolean } | null {
  return FILE_TYPES[extensionOf(name)] ?? null
}
