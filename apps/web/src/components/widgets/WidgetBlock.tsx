import { type WidgetAttrs, issuesText, orbitWidgetSchema } from '@nc/shared'
import { Suspense, lazy, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorNote } from '../ui'
import { OrbitView } from './OrbitView'
import { WidgetFrame } from './WidgetFrame'

/** Calculator and plot blocks need the calculator engine (math.js); it loads only for pages that have them. */
const CalculatorWidgetBlock = lazy(() => import('./CalculatorWidgetBlock'))

type Props = {
  attrs: Record<string, unknown>
  editable: boolean
  onChange: (attrs: WidgetAttrs) => void
  onDelete: () => void
}

/** An orbit diagram block; it is adjusted in place and saved from the diagram. */
function OrbitWidgetBlock({ attrs, editable, onChange, onDelete }: Props) {
  const { t } = useTranslation()
  const parsed = useMemo(() => orbitWidgetSchema.safeParse(attrs), [attrs])
  return (
    <WidgetFrame title={t('widget.orbit')} editable={editable} onDelete={onDelete}>
      {parsed.success ? (
        <OrbitView
          body={parsed.data.body}
          elements={parsed.data.elements}
          view={parsed.data.view ?? undefined}
          onSave={editable ? (saved) => onChange({ kind: 'orbit', ...saved }) : undefined}
        />
      ) : (
        <div className="p-5">
          <ErrorNote
            error={t('widget.invalid', {
              error: issuesText(parsed.error),
            })}
          />
        </div>
      )}
    </WidgetFrame>
  )
}

/**
 * An embedded calculator, plot or orbit diagram. Orbit blocks are drawn without the calculator engine, so pages
 * with only orbit diagrams stay light; calculator and plot blocks load it.
 */
export default function WidgetBlock(props: Props) {
  if (props.attrs.kind === 'orbit') return <OrbitWidgetBlock {...props} />
  return (
    <Suspense fallback={<div className="h-24 rounded-[12px] border border-line bg-surface" />}>
      <CalculatorWidgetBlock {...props} />
    </Suspense>
  )
}
