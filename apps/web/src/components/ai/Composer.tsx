import type { AiAttachment, AiMode } from '@nc/shared'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl, photoAttachment } from '../../lib/image'
import { btn } from '../ui'

/** Photos per message; the server accepts at most this many. */
const MAX_PHOTOS = 3

/** Where a question is written: text, photos (pasted or chosen), and send or stop. */
export function Composer({
  mode,
  input,
  onInput,
  photos,
  onPhotos,
  onSend,
  onStop,
  streaming,
  configured,
  onError,
}: {
  mode: AiMode
  input: string
  onInput: (text: string) => void
  photos: AiAttachment[]
  onPhotos: (photos: AiAttachment[]) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  configured: boolean
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const addPhotos = async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    onError(null)
    try {
      const added = await Promise.all(images.slice(0, MAX_PHOTOS).map((f) => photoAttachment(f)))
      onPhotos([...photos, ...added].slice(0, MAX_PHOTOS))
    } catch {
      onError(t('ai.photoError'))
    }
  }

  return (
    <form
      className="flex flex-col gap-2.5 rounded-[16px] border border-line-strong bg-surface p-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        onSend()
      }}
    >
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <textarea
        id="composer"
        rows={3}
        value={input}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSend()
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return
          e.preventDefault()
          addPhotos(files)
        }}
        placeholder={t(`ai.placeholder.${mode}`)}
        className="resize-y border-0 bg-transparent px-2 py-1.5 text-base outline-none"
      />
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-3 px-2 pt-2">
          {photos.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: photos are only added or removed by position
            <div key={i} className="relative">
              <img
                src={attachmentUrl(a)}
                alt={t('ai.photo', { n: i + 1 })}
                className="h-20 w-20 rounded-lg border border-line object-cover"
              />
              <button
                type="button"
                aria-label={t('ai.removePhoto', { n: i + 1 })}
                className="absolute -right-2 -top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-sm text-ink"
                onClick={() => onPhotos(photos.filter((_, k) => k !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addPhotos(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className={btn('secondary', 'sm')}
          disabled={photos.length >= MAX_PHOTOS}
          onClick={() => fileInput.current?.click()}
        >
          {t('ai.addPhoto')}
        </button>
        <span className="text-[13px] text-muted">{t('ai.disclaimer')}</span>
        <span className="flex-1" />
        {streaming ? (
          <button type="button" className={btn('secondary')} onClick={onStop}>
            {t('ai.stop')}
          </button>
        ) : (
          <button
            type="submit"
            className={btn('ai')}
            disabled={!configured || (!input.trim() && !photos.length)}
          >
            {t(`modes.${mode}`)}
          </button>
        )}
      </div>
    </form>
  )
}
