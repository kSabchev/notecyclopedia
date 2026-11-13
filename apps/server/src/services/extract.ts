import { readFile } from 'node:fs/promises'
import type Anthropic from '@anthropic-ai/sdk'
import { OfficeParser } from 'officeparser'
import { extractText } from 'unpdf'
import { aiConfigured, createMessage, modelFor, withoutImages } from './claude-client'
import { IMAGE_TRANSCRIPTION_PROMPT } from './prompts'

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
  if (mime.startsWith('text/') || /\.(md|txt|csv|script|missionplan)$/i.test(name))
    return buf.toString('utf8')
  const ast = await OfficeParser.parseOffice(buf)
  const out = await ast.to('text')
  return String((out as { value: unknown }).value ?? '')
}

/** Transcribe an image (whiteboard photo, scanned page) to text. Null when AI is not configured. */
export async function describeImage(buf: Buffer, mime: string, userId: string): Promise<string | null> {
  if (!aiConfigured()) return null
  const media = (
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg'
  ) as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelFor('image'),
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          {
            type: 'text',
            text: IMAGE_TRANSCRIPTION_PROMPT,
          },
        ],
      },
    ],
  }
  const res = await createMessage(request, {
    operation: 'image-transcription',
    userId,
    logRequest: withoutImages(request),
  })
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
}
