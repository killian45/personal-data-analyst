import { useSyncExternalStore } from 'react'

import { messages } from '../i18n'
import { FEATURES, getFeatures, setFeatures, subscribeFeatures, type Feature, type FeatureSwitches } from '../settings/features'

/** One checkbox per optional feature (shared by Settings and the welcome screen). */
export function FeatureChoices({
  value,
  onChange,
}: {
  value: FeatureSwitches
  onChange: (feature: Feature, on: boolean) => void
}) {
  const t = messages().features
  return (
    <ul className="space-y-3">
      {FEATURES.map((feature) => (
        <li key={feature}>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={value[feature]}
              onChange={(event) => onChange(feature, event.target.checked)}
              aria-label={t.toggle(t.list[feature].name)}
            />
            <span>
              <span className="font-medium">{t.list[feature].name}</span>
              <span className="block text-xs text-slate-500">{t.list[feature].description}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/** Settings & Data → Features: changes apply at once on this device. */
export function FeaturesPanel() {
  const t = messages().features
  const features = useSyncExternalStore(subscribeFeatures, getFeatures)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      <div className="mt-4">
        <FeatureChoices value={features} onChange={(feature, on) => setFeatures({ [feature]: on })} />
      </div>
    </section>
  )
}
