export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'nc.theme'

export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {}
}

export function initializeTheme() {
  document.documentElement.dataset.theme = getTheme()
}
