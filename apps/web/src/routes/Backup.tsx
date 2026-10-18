import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, ErrorNote, Field, SectionHeader, btn } from '../components/ui'
import { type BackupImportResult, type BackupSummary, api } from '../lib/api'

export function Backup() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BackupSummary | null>(null)
  const [result, setResult] = useState<BackupImportResult | null>(null)
  const previewBackup = useMutation({
    mutationFn: api.backup.preview,
    onSuccess: (summary) => {
      setPreview(summary)
      setResult(null)
    },
  })
  const importBackup = useMutation({
    mutationFn: api.backup.import,
    onSuccess: (importResult) => {
      setResult(importResult)
      setPreview(null)
      void queryClient.invalidateQueries()
    },
  })

  const chooseFile = (selected: File | undefined) => {
    setFile(selected ?? null)
    setPreview(null)
    setResult(null)
    previewBackup.reset()
    importBackup.reset()
  }

  const importCopy = () => {
    if (file && window.confirm(t('backup.confirmImport', { name: file.name }))) {
      importBackup.mutate(file)
    }
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header>
        <h1 className="m-0 text-[36px] font-extrabold tracking-[-0.025em]">{t('backup.title')}</h1>
        <p className="mb-0 mt-2 text-muted">{t('backup.subtitle')}</p>
      </header>

      <Card className="flex flex-col gap-5 p-6">
        <SectionHeader title={t('backup.exportTitle')} />
        <p className="m-0 text-sm text-muted">{t('backup.exportDescription')}</p>
        <div>
          <a href={api.backup.exportUrl()} className={btn('primary')}>
            {t('backup.download')}
          </a>
        </div>
      </Card>

      <Card className="flex flex-col gap-5 p-6">
        <SectionHeader title={t('backup.importTitle')} />
        <p className="m-0 text-sm text-muted">{t('backup.importDescription')}</p>
        <Field label={t('backup.archiveFile')} htmlFor="backup-file">
          <input
            id="backup-file"
            type="file"
            accept=".zip,application/zip"
            disabled={previewBackup.isPending || importBackup.isPending}
            className="block min-h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:font-semibold file:text-accent"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </Field>
        {file && <p className="m-0 text-sm text-muted">{file.name}</p>}
        <ErrorNote error={previewBackup.error ?? importBackup.error} />
        <div>
          <button
            type="button"
            className={btn('secondary')}
            disabled={!file || previewBackup.isPending || importBackup.isPending}
            onClick={() => {
              setPreview(null)
              if (file) previewBackup.mutate(file)
            }}
          >
            {previewBackup.isPending ? t('backup.checking') : t('backup.preview')}
          </button>
        </div>

        {preview && (
          <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface-2 p-4">
            <div>
              <h3 className="m-0 font-bold">{t('backup.previewTitle')}</h3>
              <p className="mb-0 mt-1 text-sm text-muted">
                {t('backup.previewDate', { date: new Date(preview.createdAt).toLocaleString() })}
              </p>
            </div>
            <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 text-sm">
              <li>{t('backup.courses', { count: preview.courses })}</li>
              <li>{t('backup.pages', { count: preview.pages })}</li>
              <li>{t('backup.revisions', { count: preview.revisions })}</li>
              <li>{t('backup.calculators', { count: preview.calculators })}</li>
              <li>{t('backup.files', { count: preview.files })}</li>
            </ul>
            <p className="m-0 text-sm font-semibold text-accent">{t('backup.copyNotice')}</p>
            <div>
              <button
                type="button"
                className={btn('primary')}
                disabled={importBackup.isPending}
                onClick={importCopy}
              >
                {importBackup.isPending ? t('backup.importing') : t('backup.createCopy')}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface-2 p-4"
          >
            <h3 className="m-0 font-bold">{t('backup.importSuccess')}</h3>
            <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 text-sm">
              <li>{t('backup.courses', { count: result.courses })}</li>
              <li>{t('backup.pages', { count: result.pages })}</li>
              <li>{t('backup.calculators', { count: result.calculators })}</li>
              <li>{t('backup.files', { count: result.files })}</li>
            </ul>
            {result.warnings.map((warning) => (
              <p key={warning} className="m-0 text-sm text-danger">
                {t(`backup.warnings.${warning}`)}
              </p>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
