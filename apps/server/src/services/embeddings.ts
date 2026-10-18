import { env } from '../env'

/** Voyage AI embeddings (multilingual). Returns null when no key is configured. */
export async function embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][] | null> {
  if (!env.voyageKey || texts.length === 0) return null
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 64) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.voyageKey}` },
      body: JSON.stringify({ input: texts.slice(i, i + 64), model: env.voyageModel, input_type: inputType }),
    })
    if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] }
    out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding))
  }
  return out
}
