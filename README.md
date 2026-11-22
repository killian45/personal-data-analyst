# Personal Data Analyst

A private, offline-first app to track your habits, sleep and other personal
data, and to see what changes together. Available in English and French
(the French translation is a machine translation, to be checked by a
native speaker).

- **Private:** your data stays on your device. No account, no ads, no
  tracking, no third-party scripts.
- **Works offline,** in any modern browser, on a computer or a phone.
- **Optional sync between your devices** with your own free Supabase
  project; everything is encrypted on your devices before it is sent.
- Privacy details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Features

- Habits of five kinds (number, checkbox, stopwatch, category, text),
  logged in one tap, with comments; sleep logged by hand or imported.
- Personal Data Log: every entry in one searchable table, editable, with
  undo and restore of deleted items.
- Dashboard: charts and statistics over 7, 30 or 90 days or any range.
- Analysis: do two of your measures move together (with a delay)?
  Explained in words, with the limits of such statistics. Your own
  formulas.
- Optional features, off at first: Goals with a private AI running on
  your own computer (Ollama), location history (Google Timeline), screen
  time (Android), spending (YNAB). The Personal CRM is on by default.
- Imports: spreadsheet (copy and paste), Health Connect, Google Timeline,
  App Usage files. Exports: Excel, CSV, JSON, Markdown (always in
  English). Full backups (JSON) and restore.

## Use it

- **Web version:** https://personal-data-analyst.pages.dev — install it
  from your browser (Settings & Data → Install the app, in the app,
  explains how). On iPhone and iPad, add it to the Home Screen.
- **Android app** (with Health Connect and screen time): a download will
  be given here.
- **Sync:** Settings & Data → Sync → "How to set up your own server"
  (step by step, about 15 minutes). Your server, your data.

Your data lives in your browser or on your phone. Use sync or download
backups regularly (Settings & Data → Export & backups).

## Development

Requirements: Node.js 22 and npm 10.

```bash
npm install            # install dependencies
npm run dev            # development server: http://localhost:5174
npm test               # all automated tests (Vitest)
npm run typecheck      # TypeScript
npm run lint           # Oxlint
npm run build:public   # the public web build (dist-public/, no built-in server)
npm run preview:public # serve it with the website's security headers: http://localhost:4173
npm run setup-sql      # rebuild supabase/setup.sql after adding a migration
```

The server side is in `supabase/` (migrations, the combined `setup.sql`,
the sign-in email template). Database tests need a local Supabase stack
(`npm run db:start`, then `npm run test:db`). The specification is in
[PROJECT_SPEC.md](PROJECT_SPEC.md).

Optional, Linux: `npm run app:install` runs the app as a background
service at http://localhost:5173 with an icon in the app grid
(`npm run app:update` after a change, `npm run app:uninstall` to remove).

Technology: React, TypeScript, Vite, Tailwind CSS, Dexie (browser
database), vite-plugin-pwa, date-fns, Recharts, SheetJS, Supabase,
Capacitor (Android), Vitest.

## Licence and notices

MIT licence (see [LICENSE](LICENSE)). Personal Data Analyst is not
affiliated with YNAB, Google, Supabase or Samsung. It is not a medical
device and gives no medical advice.
