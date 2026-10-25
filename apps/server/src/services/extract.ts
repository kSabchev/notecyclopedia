import { readFile } from 'node:fs/promises'
import { OfficeParser } from 'officeparser'
import { extractText } from 'unpdf'
import { describeImage } from './claude'

/** Pull plain text out of an uploaded file. Images are transcribed by Claude when a key is configured. */
export async function extractFileText(
  filePath: string,
  mime: string,
  name: string,
  userId: string,
): Promise<string> {
  const buf = await readFile(filePath)
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true })
    return text
  }
  if (mime.startsWith('image/')) {
    return (await describeImage(buf, mime, userId)) ?? ''
  }
  if (mime.startsWith('text/') || /\.(md|txt|csv)$/i.test(name)) return buf.toString('utf8')
  const ast = await OfficeParser.parseOffice(buf)
  const out = await ast.to('text')
  return String((out as { value: unknown }).value ?? '')
}
