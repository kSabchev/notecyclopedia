import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Theme, getTheme, setTheme } from '../lib/theme'
import { MoonIcon, SunIcon } from './Icons'

export function ThemeToggle() {
  const { t } = useTranslation()
  const [theme, setCurrentTheme] = useState<Theme>(getTheme)
  const nextTheme = theme === 'light' ? 'dark' : 'light'

  return (
    <button
      type="button"
      aria-label={t(`theme.switchTo${nextTheme === 'dark' ? 'Dark' : 'Light'}`)}
      aria-pressed={theme === 'dark'}
      onClick={() => {
        setTheme(nextTheme)
        setCurrentTheme(nextTheme)
      }}
      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted hover:bg-bg"
    >
      {theme === 'light' ? <MoonIcon size={16} /> : <SunIcon size={16} />}
      {t(theme === 'light' ? 'theme.dark' : 'theme.light')}
    </button>
  )
}
