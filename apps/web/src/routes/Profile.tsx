import { Link } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, ErrorNote, Field, SectionHeader, btn, inputCls } from '../components/ui'
import { changePassword, updateUser, useSession } from '../lib/auth'

export function Profile() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const [name, setName] = useState(session?.user.name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    setSavingProfile(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const result = await updateUser({ name: name.trim() })
      if (result.error) setProfileError(result.error.message ?? t('common.error'))
      else setProfileSaved(true)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setSavingProfile(false)
    }
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setChangingPassword(true)
    setPasswordError(null)
    setPasswordChanged(false)
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatch'))
      setChangingPassword(false)
      return
    }
    try {
      const result = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) {
        setPasswordError(result.error.message ?? t('common.error'))
      } else {
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setPasswordChanged(true)
      }
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setChangingPassword(false)
    }
  }

  if (!session) return null

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header>
        <h1 className="m-0 text-[36px] font-extrabold tracking-[-0.025em]">{t('profile.title')}</h1>
        <p className="mb-0 mt-2 text-muted">{t('profile.subtitle')}</p>
      </header>

      <Link
        to="/backup"
        className="rounded-[12px] border border-line bg-surface p-5 font-semibold text-ink no-underline hover:border-line-strong"
      >
        {t('backup.title')} →
      </Link>

      <Card className="flex flex-col gap-5 p-6">
        <SectionHeader title={t('profile.details')} />
        <form onSubmit={saveProfile} className="flex flex-col gap-5">
          <Field label={t('auth.name')} htmlFor="profile-name">
            <input
              id="profile-name"
              className={inputCls}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="name"
            />
          </Field>
          <Field label={t('auth.email')} htmlFor="profile-email">
            <input
              id="profile-email"
              type="email"
              className={`${inputCls} text-muted`}
              value={session.user.email}
              readOnly
              autoComplete="email"
            />
          </Field>
          <ErrorNote error={profileError} />
          {profileSaved && (
            <p role="status" className="m-0 text-sm text-ok">
              {t('profile.profileSaved')}
            </p>
          )}
          <div>
            <button type="submit" className={btn('primary')} disabled={savingProfile || !name.trim()}>
              {savingProfile ? t('profile.saving') : t('profile.saveProfile')}
            </button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-5 p-6">
        <SectionHeader title={t('profile.changePassword')} />
        <form onSubmit={submitPassword} className="flex flex-col gap-5">
          <Field label={t('profile.currentPassword')} htmlFor="current-password">
            <input
              id="current-password"
              type="password"
              className={inputCls}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('profile.newPassword')} htmlFor="new-password">
            <input
              id="new-password"
              type="password"
              minLength={8}
              className={inputCls}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('profile.confirmPassword')} htmlFor="confirm-password">
            <input
              id="confirm-password"
              type="password"
              minLength={8}
              className={inputCls}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
          <ErrorNote error={passwordError} />
          {passwordChanged && (
            <p role="status" className="m-0 text-sm text-ok">
              {t('profile.passwordChanged')}
            </p>
          )}
          <div>
            <button
              type="submit"
              className={btn('primary')}
              disabled={changingPassword || newPassword.length < 8 || confirmPassword.length < 8}
            >
              {changingPassword ? t('profile.changingPassword') : t('profile.updatePassword')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}
