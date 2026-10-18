import type { AiMode } from '@nc/shared'
import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { AiPortal, type AiSearch } from './routes/AiPortal'
import { Backup } from './routes/Backup'
import { Calculators } from './routes/Calculators'
import { Files } from './routes/Files'
import { Formulas } from './routes/Formulas'
import { Home } from './routes/Home'
import { Login } from './routes/Login'
import { PageEdit, PageNew } from './routes/PageEdit'
import { PageView } from './routes/PageView'
import { Profile } from './routes/Profile'
import { CourseView, Wiki } from './routes/Wiki'

const rootRoute = createRootRoute({ component: Outlet })

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: Login })

/** Everything behind sign-in, rendered inside the sidebar layout. */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: Layout })

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const MODES: AiMode[] = ['ask', 'summarize', 'solve', 'calculator']

const routes = [
  createRoute({ getParentRoute: () => appRoute, path: '/', component: Home }),
  createRoute({ getParentRoute: () => appRoute, path: '/wiki', component: Wiki }),
  createRoute({ getParentRoute: () => appRoute, path: '/courses/$courseId', component: CourseView }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/pages/new',
    component: PageNew,
    validateSearch: (s: Record<string, unknown>): { courseId?: string } => ({ courseId: str(s.courseId) }),
  }),
  createRoute({ getParentRoute: () => appRoute, path: '/pages/$pageId', component: PageView }),
  createRoute({ getParentRoute: () => appRoute, path: '/pages/$pageId/edit', component: PageEdit }),
  createRoute({ getParentRoute: () => appRoute, path: '/formulas', component: Formulas }),
  createRoute({ getParentRoute: () => appRoute, path: '/calculators', component: Calculators }),
  createRoute({ getParentRoute: () => appRoute, path: '/calculators/$calcId', component: Calculators }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/ai',
    component: AiPortal,
    validateSearch: (s: Record<string, unknown>): AiSearch => ({
      mode: MODES.includes(s.mode as AiMode) ? (s.mode as AiMode) : undefined,
      q: str(s.q),
      pageId: str(s.pageId),
      thread: str(s.thread),
    }),
  }),
  createRoute({ getParentRoute: () => appRoute, path: '/files', component: Files }),
  createRoute({ getParentRoute: () => appRoute, path: '/profile', component: Profile }),
  createRoute({ getParentRoute: () => appRoute, path: '/backup', component: Backup }),
] as const

const routeTree = rootRoute.addChildren([loginRoute, appRoute.addChildren([...routes])])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
