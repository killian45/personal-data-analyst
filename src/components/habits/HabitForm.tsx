import type { FormEvent } from 'react'

import type { Habit, HabitType } from '../../database/types'

import { HABIT_TYPES, habitTypeLabel } from './habitTypes'
import { messages } from '../../i18n'
import type { HabitFormValues } from './habitTypes'

/** The create/edit habit form on the Data Logging page. The page keeps the values and saves them. */

export interface HabitFormProps {
  form: HabitFormValues
  setForm: (form: HabitFormValues) => void
  /** The habit being edited, or null when creating a new one. */
  editingHabit: Habit | null
  saving: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}

export function HabitForm({ form, setForm, editingHabit, saving, onSubmit, onCancel }: HabitFormProps) {
  const t = messages()
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">
        {editingHabit ? t.habitForm.editTitle : t.habitForm.createTitle}
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        {t.habitForm.intro}
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-5"
      >
        <div>
          <label
            htmlFor="habit-name"
            className="mb-1 block text-sm font-medium"
          >
            {t.habitForm.name}
          </label>

          <input
            id="habit-name"
            type="text"
            maxLength={80}
            required
            value={form.name}
            onChange={(event) =>
              setForm({
                ...form,
                name: event.target.value,
              })
            }
            placeholder={t.habitForm.namePlaceholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label
            htmlFor="habit-type"
            className="mb-1 block text-sm font-medium"
          >
            {t.habitForm.type}
          </label>

          <select
            id="habit-type"
            value={form.type}
            onChange={(event) =>
              setForm({
                ...form,
                type: event.target.value as HabitType,
              })
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            {HABIT_TYPES.map((type) => (
              <option
                key={type}
                value={type}
              >
                {habitTypeLabel(type)}
              </option>
            ))}
          </select>
        </div>

        {form.type === 'number' && (
          <div>
            <label
              htmlFor="habit-unit"
              className="mb-1 block text-sm font-medium"
            >
              {t.habitForm.unit}
            </label>

            <input
              id="habit-unit"
              type="text"
              maxLength={20}
              value={form.unit}
              onChange={(event) =>
                setForm({
                  ...form,
                  unit: event.target.value,
                })
              }
              placeholder={t.habitForm.unitPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        )}

        {form.type === 'number' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="habit-daily"
                className="mb-1 block text-sm font-medium"
              >
                {t.habitForm.dailyValue}
              </label>

              <select
                id="habit-daily"
                value={form.dailyAggregation}
                onChange={(event) =>
                  setForm({
                    ...form,
                    dailyAggregation: event.target.value as 'sum' | 'mean',
                  })
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="sum">{t.habitForm.dailySum}</option>
                <option value="mean">{t.habitForm.dailyMean}</option>
              </select>

              <p className="mt-1 text-xs text-slate-500">
                {t.habitForm.dailyHelp}
              </p>
            </div>

            <div>
              <label
                htmlFor="habit-target"
                className="mb-1 block text-sm font-medium"
              >
                {t.habitForm.target}
              </label>

              <input
                id="habit-target"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.target}
                onChange={(event) =>
                  setForm({ ...form, target: event.target.value })
                }
                placeholder={t.habitForm.targetPlaceholder(form.unit)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        )}

        {form.type === 'label' && (
          <div>
            <label
              htmlFor="habit-labels"
              className="mb-1 block text-sm font-medium"
            >
              {t.habitForm.labelOptions}
            </label>

            <input
              id="habit-labels"
              type="text"
              required
              value={form.labelOptions}
              onChange={(event) =>
                setForm({
                  ...form,
                  labelOptions: event.target.value,
                })
              }
              placeholder={t.habitForm.labelOptionsPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />

            <p className="mt-1 text-xs text-slate-500">
              {t.habitForm.labelOptionsHelp}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="habit-color"
            className="mb-1 block text-sm font-medium"
          >
            {t.habitForm.color}
          </label>

          <div className="flex items-center gap-3">
            <input
              id="habit-color"
              type="color"
              value={form.color}
              onChange={(event) =>
                setForm({
                  ...form,
                  color: event.target.value,
                })
              }
              className="h-10 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1"
            />

            <span className="text-sm text-slate-500">
              {form.color}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? t.common.saving
              : editingHabit
                ? t.habitForm.saveChanges
                : t.habitForm.create}
          </button>

          {editingHabit && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              {t.common.cancel}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
