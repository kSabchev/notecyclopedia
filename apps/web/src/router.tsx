import type { AiMode } from '@nc/shared'
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'
import { Layout } from './components/Layout'
import type { AiSearch } from './routes/AiPortal'

const rootRoute = createRootRoute({ component: Outlet })

const Login = lazyRouteComponent(() => import('./routes/Login'), 'Login')
const Home = lazyRouteComponent(() => import('./routes/Home'), 'Home')
const Wiki = lazyRouteComponent(() => import('./routes/Wiki'), 'Wiki')
const CourseView = lazyRouteComponent(() => import('./routes/Wiki'), 'CourseView')
const PageEdit = lazyRouteComponent(() => import('./routes/PageEdit'), 'PageEdit')
const PageNew = lazyRouteComponent(() => import('./routes/PageEdit'), 'PageNew')
const PageView = lazyRouteComponent(() => import('./routes/PageView'), 'PageView')
const PageReview = lazyRouteComponent(() => import('./routes/PageReview'), 'PageReview')
const Formulas = lazyRouteComponent(() => import('./routes/Formulas'), 'Formulas')
const Calculators = lazyRouteComponent(() => import('./routes/Calculators'), 'Calculators')
const Constants = lazyRouteComponent(() => import('./routes/Constants'), 'Constants')
const AiPortal = lazyRouteComponent(() => import('./routes/AiPortal'), 'AiPortal')
const Files = lazyRouteComponent(() => import('./routes/Files'), 'Files')
const Profile = lazyRouteComponent(() => import('./routes/Profile'), 'Profile')
const Backup = lazyRouteComponent(() => import('./routes/Backup'), 'Backup')
const AdminClaudeUsage = lazyRouteComponent(() => import('./routes/AdminClaudeUsage'), 'AdminClaudeUsage')

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
  createRoute({ getParentRoute: () => appRoute, path: '/pages/$pageId/review', component: PageReview }),
  createRoute({ getParentRoute: () => appRoute, path: '/pages/$pageId/edit', component: PageEdit }),
  createRoute({ getParentRoute: () => appRoute, path: '/formulas', component: Formulas }),
  createRoute({ getParentRoute: () => appRoute, path: '/calculators', component: Calculators }),
  createRoute({
    getParentRoute: () => appRoute,
    path: '/calculators/constants',
    component: Constants,
  }),
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
  createRoute({ getParentRoute: () => appRoute, path: '/admin/claude-usage', component: AdminClaudeUsage }),
] as const

const routeTree = rootRoute.addChildren([loginRoute, appRoute.addChildren([...routes])])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
