import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import i18n, { i18nReady } from './i18n'
import { initializeTheme } from './lib/theme'
import { router } from './router'
import './styles.css'

// After an update, a page opened before it may ask for a file the new build no longer has. Reload once to get
// the new build; the flag stops a loop if the file is missing for another reason.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('nc.reloadedForUpdate')) return
    sessionStorage.setItem('nc.reloadedForUpdate', '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () => {
  try {
    setTimeout(() => sessionStorage.removeItem('nc.reloadedForUpdate'), 10_000)
  } catch {}
})
initializeTheme()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
})

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
i18nReady.then(() => {
  document.documentElement.lang = i18n.language
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
})
