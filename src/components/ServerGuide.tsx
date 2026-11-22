import { useState } from 'react'

import setupSql from '../../supabase/setup.sql?raw'
import { messages } from '../i18n'

type StepKey = keyof ReturnType<typeof messages>['serverGuide']['steps']

const STEP_ORDER: readonly StepKey[] = ['account', 'project', 'sql', 'email', 'user', 'signups', 'values', 'app', 'otherDevices']

const small = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-100'

/** A copy button with a manual fallback (the text, ready to select). */
function CopyText({ label, text, rows }: { label: string; text: string; rows: number }) {
  const t = messages().serverGuide
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        className={small}
        onClick={() => {
          const copy = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))
          copy.then(() => setStatus('copied')).catch(() => setStatus('failed'))
        }}
      >
        {label}
      </button>
      {status !== 'idle' && (
        <p role="status" className="text-xs text-slate-600">
          {status === 'copied' ? t.copied : t.copyFailed}
        </p>
      )}
      <details open={status === 'failed'} className="text-xs">
        <summary className="cursor-pointer text-slate-600">{t.showText}</summary>
        <textarea readOnly rows={rows} value={text} className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs" />
      </details>
    </div>
  )
}

/**
 * Step-by-step guide to setting up one's own sync server (sharing plan S5):
 * a free Supabase project, the setup SQL, the sign-in email, an account,
 * two values for the app. Shown inside the server form (Settings → Sync and
 * the welcome screen); works offline and in every app language.
 */
export default function ServerGuide() {
  const t = messages().serverGuide
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">{t.intro}</p>
      <ol className="list-decimal space-y-3 pl-5">
        {STEP_ORDER.map((key) => (
          <li key={key}>
            <p className="font-medium">{t.steps[key].title}</p>
            <p className="text-slate-600">{t.steps[key].text}</p>
            {key === 'sql' && <CopyText label={t.copySql} text={setupSql} rows={8} />}
            {key === 'email' && (
              <>
                <p className="mt-2 text-xs font-medium text-slate-600">{t.subjectLabel}</p>
                <CopyText label={t.copySubject} text={t.emailSubject} rows={1} />
                <p className="mt-2 text-xs font-medium text-slate-600">{t.bodyLabel}</p>
                <CopyText label={t.copyBody} text={t.emailBody} rows={5} />
              </>
            )}
          </li>
        ))}
      </ol>
      <div>
        <p className="font-medium">{t.limitsTitle}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
          {t.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
