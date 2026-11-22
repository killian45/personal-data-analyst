import { useId, useState } from 'react'

import { formatMeasureValue } from '../../analysis/format'
import type { Measure } from '../../analysis/measures'
import { formulaDaily, fromEditorText, toEditorText } from '../../formulas/display'
import { deleteFormula, newFormulaId, saveFormula, validateFormulaDefinition } from '../../formulas/formulas'
import type { FormulaDefinition, FormulaDisplay } from '../../formulas/formulas'
import { messages } from '../../i18n'

/**
 * "My formulas" (Phase 6 step 4): create, edit and delete custom measures.
 * The formula text names measures in [square brackets]; it is checked by
 * the app's own safe parser (src/formulas/parser.ts) — never run as code.
 */

interface Draft {
  id: string | null
  name: string
  text: string
  display: FormulaDisplay
  unit: string
}

const EMPTY: Draft = { id: null, name: '', text: '', display: 'number', unit: '' }
const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm'
const buttonClass = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50'

function check(draft: Draft, measures: readonly Measure[]): { definition: FormulaDefinition | null; error: string } {
  if (draft.text.trim() === '') return { definition: null, error: '' }
  try {
    const definition = validateFormulaDefinition({
      id: draft.id ?? 'f_preview0',
      name: draft.name.trim() || 'Preview',
      unit: draft.display === 'number' ? draft.unit : null,
      display: draft.display,
      expression: fromEditorText(draft.text, measures),
    })
    return { definition, error: '' }
  } catch (error) {
    return { definition: null, error: error instanceof Error ? error.message : messages().formulas.cannotRead }
  }
}

export function FormulaManager({
  measures,
  formulas,
  onChange,
}: {
  /** Measures a formula can use (not other formulas). */
  measures: readonly Measure[]
  formulas: readonly FormulaDefinition[]
  onChange: (formulas: FormulaDefinition[]) => void
}) {
  const t = messages().formulas
  const id = useId()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [insert, setInsert] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const checked = draft ? check(draft, measures) : null
  const preview = checked?.definition ? formulaDaily(checked.definition, measures) : null
  // Only used to format the preview value; its label and group are never shown.
  const previewMeasure: Measure | null = checked?.definition
    ? { id: 'preview', label: 'Preview', group: 'My formulas', kind: draft!.display === 'duration' ? 'duration' : 'number', unit: draft!.display === 'number' ? draft!.unit.trim() || null : null, per: 'day', daily: [] } // i18n-ignore
    : null

  async function save() {
    if (!draft || !checked?.definition) return
    setError('')
    try {
      const list = await saveFormula({ ...checked.definition, id: draft.id ?? newFormulaId(), name: draft.name })
      onChange(list)
      setMessage(draft.id ? t.updated : t.added)
      setDraft(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.saveFailed)
    }
  }

  async function remove(formulaId: string) {
    setError('')
    try {
      onChange(await deleteFormula(formulaId))
      setConfirmDelete(null)
      setMessage(t.deleted)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.deleteFailed)
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id={`${id}-title`} className="text-lg font-semibold">{t.title}</h3>
      <p className="text-sm text-slate-600">
        {t.introStart} <code>{t.exampleOne}</code> {t.or} <code>{t.exampleTwo}</code>
        {t.introEnd}
      </p>

      {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {formulas.length > 0 && (
        <ul className="rounded-lg border border-slate-200">
          {formulas.map((formula) => {
            const series = formulaDaily(formula, measures)
            return (
              <li key={formula.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-3 text-sm first:border-t-0">
                <div className="min-w-0">
                  <p className="font-medium">{formula.name}</p>
                  <p className="break-words font-mono text-xs text-slate-600">{toEditorText(formula.expression, measures)}</p>
                  <p className="text-xs text-slate-500">
                    {formula.display === 'duration' ? t.duration : t.number(formula.unit)} ·{' '}
                    {series.status === 'ok'
                      ? t.daysWithValue(series.daily.length)
                      : series.status === 'missing-measures' ? t.missingMeasure : t.unreadable}
                  </p>
                </div>
                <div className="flex gap-2">
                  {confirmDelete === formula.id ? (
                    <>
                      <button type="button" className={`${buttonClass} border-red-200 text-red-700`} onClick={() => void remove(formula.id)}>{t.confirmDelete}</button>
                      <button type="button" className={buttonClass} onClick={() => setConfirmDelete(null)}>{messages().common.cancel}</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-label={t.editNamed(formula.name)}
                        onClick={() => {
                          setMessage('')
                          setDraft({ id: formula.id, name: formula.name, text: toEditorText(formula.expression, measures), display: formula.display, unit: formula.unit ?? '' })
                        }}
                      >
                        {messages().common.edit}
                      </button>
                      <button type="button" className={buttonClass} aria-label={t.deleteNamed(formula.name)} onClick={() => setConfirmDelete(formula.id)}>{messages().common.delete}</button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!draft ? (
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => {
            setMessage('')
            setDraft({ ...EMPTY })
          }}
        >
          {t.newFormula}
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div>
            <label htmlFor={`${id}-name`} className="mb-1 block text-xs font-medium text-slate-600">{t.name}</label>
            <input id={`${id}-name`} className={inputClass} maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>

          <div>
            <label htmlFor={`${id}-text`} className="mb-1 block text-xs font-medium text-slate-600">{t.formula}</label>
            <textarea
              id={`${id}-text`}
              className={`${inputClass} font-mono`}
              rows={2}
              maxLength={2000}
              value={draft.text}
              placeholder={t.exampleOne}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-insert`} className="text-xs font-medium text-slate-600">{t.insertMeasure}</label>
              <select id={`${id}-insert`} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" value={insert} onChange={(event) => setInsert(event.target.value)}>
                <option value="">{t.choose}</option>
                {measures.map((measure) => <option key={measure.id} value={measure.label}>{measure.label}</option>)}
              </select>
              <button
                type="button"
                className={buttonClass}
                disabled={insert === ''}
                onClick={() => setDraft({ ...draft, text: `${draft.text}${draft.text && !draft.text.endsWith(' ') ? ' ' : ''}[${insert}]` })}
              >
                {t.insert}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-display`} className="mb-1 block text-xs font-medium text-slate-600">{t.showAs}</label>
              <select id={`${id}-display`} className={inputClass} value={draft.display} onChange={(event) => setDraft({ ...draft, display: event.target.value as FormulaDisplay })}>
                <option value="number">{t.asNumber}</option>
                <option value="duration">{t.asDuration}</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-unit`} className="mb-1 block text-xs font-medium text-slate-600">{t.unit}</label>
              <input
                id={`${id}-unit`}
                className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                maxLength={20}
                disabled={draft.display === 'duration'}
                value={draft.display === 'duration' ? '' : draft.unit}
                placeholder={draft.display === 'duration' ? t.unitDurationPlaceholder : t.unitPlaceholder}
                onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
              />
              {draft.display === 'duration' && (
                <p className="mt-1 text-xs text-slate-500">{t.durationNote}</p>
              )}
            </div>
          </div>

          <p role="status" className={`text-xs ${checked?.error ? 'text-red-700' : 'text-slate-600'}`}>
            {checked?.error
              ? checked.error
              : preview?.status === 'ok' && previewMeasure
                ? preview.daily.length > 0
                  ? t.preview(preview.daily.length, preview.daily.at(-1)!.date.split('-').reverse().join('/'), formatMeasureValue(previewMeasure, preview.daily.at(-1)!.value as number))
                  : t.noDayYet
                : t.typeToPreview}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!checked?.definition || draft.name.trim() === ''}
              onClick={() => void save()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draft.id ? t.saveChanges : t.save}
            </button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>{messages().common.cancel}</button>
          </div>
        </div>
      )}
    </section>
  )
}
