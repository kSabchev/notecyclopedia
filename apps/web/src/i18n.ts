import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Dict } from './locales/en'

type Language = 'en' | 'bg'

/** Each language is its own chunk, so a page downloads only the text of the language it shows. */
const loaders: Record<Language, () => Promise<Dict>> = {
  en: () => import('./locales/en').then((m) => m.en),
  bg: () => import('./locales/bg').then((m) => m.bg),
}

async function load(lng: Language) {
  if (!i18n.hasResourceBundle(lng, 'translation'))
    i18n.addResourceBundle(lng, 'translation', await loaders[lng]())
}

const saved = (() => {
  try {
    return localStorage.getItem('nc.lang')
  } catch {
    return null
  }
})()
const initial: Language =
  saved === 'en' || saved === 'bg' ? saved : navigator.language.startsWith('bg') ? 'bg' : 'en'

/** Resolves once the active language's text is loaded; render the app after it. */
export const i18nReady = loaders[initial]().then((dict) =>
  i18n.use(initReactI18next).init({
    resources: { [initial]: { translation: dict } },
    partialBundledLanguages: true,
    lng: initial,
    // Both languages have every key (bg is typed against en), so there is nothing to fall back to.
    fallbackLng: false,
    interpolation: { escapeValue: false },
  }),
)

export async function setLanguage(lng: Language) {
  await load(lng)
  await i18n.changeLanguage(lng)
  document.documentElement.lang = lng
  try {
    localStorage.setItem('nc.lang', lng)
  } catch {}
}

export default i18n
