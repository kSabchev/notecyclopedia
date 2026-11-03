import type { Locale } from './types'

const NAMES: Record<Locale, string> = { en: 'English', bg: 'Bulgarian' }

/**
 * The language to write in for AI text about some notes, named for a prompt. Notes here are Bulgarian or
 * English, so Cyrillic letters decide it; formulas add Latin letters to Bulgarian notes, hence the low
 * threshold. With too little text to tell (e.g. a section that is mostly numbers), `fallback` is used, which
 * should be the reader's interface language. Telling the model the language is more reliable than asking it
 * to match the notes.
 */
export function notesLanguage(text: string, fallback: Locale = 'en'): string {
  const cyrillic = text.match(/[Ѐ-ӿ]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  if (cyrillic + latin < 40) return NAMES[fallback]
  return cyrillic >= latin * 0.25 ? NAMES.bg : NAMES.en
}
