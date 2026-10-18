import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brand } from '../components/Layout'
import { ErrorNote, Field, btn, inputCls } from '../components/ui'
import { signIn, signUp } from '../lib/auth'

export function Login() {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res =
      mode === 'in'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name, locale: i18n.language } as Parameters<
            typeof signUp.email
          >[0])
    setBusy(false)
    if (res.error) setError(res.error.message ?? t('common.error'))
    // Full reload so the session is read fresh everywhere.
    else window.location.assign('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-[400px] flex-col gap-5 rounded-[16px] border border-line bg-surface p-8"
      >
        <Brand />
        <div>
          <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em]">
            {mode === 'in' ? t('auth.signIn') : t('auth.signUp')}
          </h1>
          <p className="m-0 text-muted">{t('auth.subtitle')}</p>
        </div>
        {mode === 'up' && (
          <Field label={t('auth.name')} htmlFor="name">
            <input
              id="name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </Field>
        )}
        <Field label={t('auth.email')} htmlFor="email">
          <input
            id="email"
            type="email"
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>
        <Field label={t('auth.password')} htmlFor="password">
          <input
            id="password"
            type="password"
            minLength={8}
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className={btn('primary')} disabled={busy}>
          {mode === 'in' ? t('auth.signIn') : t('auth.signUp')}
        </button>
        <p className="m-0 text-sm text-muted">
          {mode === 'in' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
          <button
            type="button"
            className="cursor-pointer font-semibold text-accent underline"
            onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
          >
            {mode === 'in' ? t('auth.signUp') : t('auth.signIn')}
          </button>
        </p>
      </form>
    </div>
  )
}
