import { messages } from '../i18n'
import { isAppleMobile } from '../platform/appleMobile'

/**
 * How to install the web version (sharing plan S6): computer, Android,
 * iPhone with its limits. Shown in the web version only.
 */
export function InstallPanel() {
  const t = messages().install
  const apple = isAppleMobile()
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      {apple && <p role="note" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t.iphoneLimits}</p>}
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium">{t.iphone}</dt>
          <dd className="text-slate-600">{t.iphoneText}</dd>
          {!apple && <dd className="mt-1 text-xs text-slate-500">{t.iphoneLimits}</dd>}
        </div>
        <div>
          <dt className="font-medium">{t.android}</dt>
          <dd className="text-slate-600">{t.androidText}</dd>
        </div>
        <div>
          <dt className="font-medium">{t.computer}</dt>
          <dd className="text-slate-600">{t.computerText}</dd>
        </div>
      </dl>
    </section>
  )
}
