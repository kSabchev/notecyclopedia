import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { UploadIcon } from './Icons'
import { ErrorNote } from './ui'

export function FileDrop({
  courseId,
  pageId,
  lectureNumber,
  compact = false,
  onUploaded,
}: {
  courseId: string | undefined
  pageId?: string
  /** Upload as the original of this lecture (one file at a time). */
  lectureNumber?: number
  compact?: boolean
  onUploaded?: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const id = useId()
  const [over, setOver] = useState(false)
  const upload = useMutation({
    mutationFn: (files: File[]) => {
      if (!courseId) throw new Error(t('course.none'))
      return api.files.upload(courseId, files, pageId, lectureNumber)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files'] })
      onUploaded?.()
    },
  })
  const send = (list: FileList | null) => list?.length && upload.mutate([...list])

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          send(e.dataTransfer.files)
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border-[1.5px] border-dashed text-center ${compact ? 'p-5' : 'px-5 py-7'} ${over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2'}`}
      >
        <UploadIcon size={26} className="text-muted" />
        <span className="font-semibold">{upload.isPending ? t('common.loading') : t('files.drop')}</span>
        <span className="text-[13px] text-muted">{t('files.formats')}</span>
      </label>
      <input
        id={id}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          send(e.target.files)
          e.target.value = ''
        }}
      />
      <ErrorNote error={upload.error} />
    </div>
  )
}
