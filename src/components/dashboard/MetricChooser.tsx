import { useId } from 'react'

import { messages } from '../../i18n'
import { REGISTRY_DUPLICATES } from '../../settings/dashboardMetrics'
import { metricsFor } from '../../stats/registry'
import type { SubjectType } from '../../stats/subjects'

export interface Choice {
  id: string
  name: string
  description: string
}

interface MetricChooserProps {
  subject: SubjectType
  /** Standard statistics and section-specific values that can be shown. */
  builtIns: readonly Choice[]
  selected: readonly string[]
  onChange: (metricIds: string[]) => void
}

function ChoiceBox({ choice, checked, onToggle, inputId }: {
  choice: Choice
  checked: boolean
  onToggle: (checked: boolean) => void
  inputId: string
}) {
  return (
    <label htmlFor={inputId} className="flex items-start gap-2 text-xs">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">{choice.name}</span>
        <span className="block text-slate-500">{choice.description}</span>
      </span>
    </label>
  )
}

/**
 * Lets the user choose what a section shows: standard statistics,
 * section-specific values and registry metrics (§9.2). The number of
 * nights/days with data is always shown and is not listed.
 */
export function MetricChooser({ subject, builtIns, selected, onChange }: MetricChooserProps) {
  const id = useId()
  const available: Choice[] = metricsFor(subject).filter((metric) => !(metric.id in REGISTRY_DUPLICATES))
  const all = [...builtIns, ...available]
  const shown = all.filter((choice) => selected.includes(choice.id)).length

  function toggle(choiceId: string, checked: boolean) {
    const next = checked
      ? [...selected.filter((item) => item !== choiceId), choiceId]
      : selected.filter((item) => item !== choiceId)

    // Stable order (statistics, section values, then the registry's order);
    // choices that do not apply to this section are dropped.
    onChange(all.map((choice) => choice.id).filter((item) => next.includes(item)))
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs font-medium text-blue-700 hover:underline">
        {messages().dashboard.chooseWhatToShow(shown)}
      </summary>
      <fieldset className="mt-2 grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-xs font-semibold">{messages().dashboard.statistics}</legend>
        {builtIns.map((choice) => (
          <ChoiceBox
            key={choice.id}
            choice={choice}
            inputId={`${id}-${choice.id}`}
            checked={selected.includes(choice.id)}
            onToggle={(checked) => toggle(choice.id, checked)}
          />
        ))}
      </fieldset>
      {available.length > 0 && (
        <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold">{messages().dashboard.extraMetrics}</legend>
          {available.map((metric) => (
            <ChoiceBox
              key={metric.id}
              choice={metric}
              inputId={`${id}-${metric.id}`}
              checked={selected.includes(metric.id)}
              onToggle={(checked) => toggle(metric.id, checked)}
            />
          ))}
        </fieldset>
      )}
    </details>
  )
}
