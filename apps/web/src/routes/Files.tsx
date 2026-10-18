import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDrop } from '../components/FileDrop'
import { TrashIcon } from '../components/Icons'
import { Empty, FileBadge, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { bytes, timeAgo } from '../lib/format'

export function Files() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const editable = courses.data?.filter((c) => c.role !== 'viewer') ?? []
  const [courseId, setCourseId] = useState<string>()
  const target = courseId ?? editable[0]?.id
  const files = useQuery({
    queryKey: ['files', 'all'],
    queryFn: () => api.files.list(),
    refetchInterval: (q) =>
      q.state.data?.some((f) => f.status === 'uploaded' || f.status === 'processing') ? 2000 : false,
  })
  const remove = useMutation({
    mutationFn: api.files.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  })
  const courseName = (id: string) => courses.data?.find((c) => c.id === id)?.name

  return (
    <div className="flex max-w-[1100px] flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('files.title')}</h1>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="up-course" className="text-[13px] font-semibold text-muted">
            {t('files.course')}
          </label>
          <select
            id="up-course"
            className={inputCls}
            value={target ?? ''}
            onChange={(e) => setCourseId(e.target.value)}
          >
            {editable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <FileDrop courseId={target} />
      {files.data?.length === 0 && <Empty>{t('files.none')}</Empty>}
      {!!files.data?.length && (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <tbody>
              {files.data.map((f) => (
                <tr key={f.id} className="border-t border-line-soft first:border-0">
                  <td className="w-16 py-3 pl-5">
                    <FileBadge name={f.name} />
                  </td>
                  <td className="py-3 font-medium">
                    <a href={api.files.url(f.id, true)} target="_blank" rel="noreferrer" className="text-ink">
                      {f.name}
                    </a>
                    {f.error && <div className="text-xs text-danger">{f.error}</div>}
                  </td>
                  <td className="py-3 text-muted">{courseName(f.courseId)}</td>
                  <td className="py-3 font-mono text-xs text-muted">{bytes(f.size)}</td>
                  <td
                    className={`py-3 text-xs font-semibold ${f.status === 'indexed' ? 'text-ok' : f.status === 'failed' ? 'text-danger' : 'text-muted'}`}
                  >
                    {t(`files.status.${f.status}`)}
                  </td>
                  <td className="py-3 text-muted">{timeAgo(f.createdAt)}</td>
                  <td className="py-3 pr-3 text-right">
                    <button
                      type="button"
                      aria-label={`${t('files.remove')} ${f.name}`}
                      onClick={() => remove.mutate(f.id)}
                      className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-line-soft"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
