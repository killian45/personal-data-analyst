# Privacy — what happens to your data

Last updated: 22 November 2026. This page makes no claim of GDPR
compliance.

## In short

- Your data is stored **on your device** (in the browser or in the
  Android app). The app works without an internet connection and
  without an account.
- Nothing is sent anywhere unless **you** switch on a feature that
  needs it (sync, YNAB) or click a map link.
- There is no advertising, no tracking and no analytics. The app's
  author does not receive your data and runs no server for you.

## What stays on your device

Habits and entries, sleep, screen time, location history, Health
Connect data, contacts and notes about them (Personal CRM), goals,
formulas and settings. They are stored in the device's local database.

Risks to know:
- Clearing the browser's data for this site, or uninstalling the
  Android app, **deletes** your data on that device. Keep backups.
- On iPhone, Safari may delete the data of a web page that has not been
  added to the Home Screen and has not been opened for a while.
- Anyone who can use your unlocked device can open the app.

## Backups and exports

Backups (JSON) and exports (CSV, Excel, Markdown) are **not
encrypted**. They contain all the data you chose to include. Keep them
somewhere safe and do not send them to people you do not trust.

## Sync (optional, off by default)

If you connect a server, it is **your own** Supabase project, in a
region you choose (an EU region is recommended).

- Every record is **encrypted on your device** with a key protected by
  your passphrase before it is sent. The server, and Supabase, cannot
  read your habits, health data, contacts or notes.
- What the server can still see: your email address (used to sign in
  with emailed codes), how many records of each kind you have, their
  encrypted size, when they were changed, revision numbers and random
  record identifiers.
- If you lose both your passphrase and your recovery key, the synced
  copy cannot be decrypted by anyone, including you.
- Supabase's own terms and privacy policy apply to your Supabase
  account.

## Outside services (only when you use them)

| Feature | What is sent, to whom |
|---|---|
| YNAB (optional) | Your YNAB access token, sent only to YNAB (api.ynab.com) to download your transactions. The token is kept on that one device only and is not synced or included in backups. |
| Map link in the Location section | When you click it, the place's coordinates are sent to OpenStreetMap (openstreetmap.org) in the address of the page that opens. |
| Goals AI chat (optional, computer only) | Summaries (never raw records) are sent to Ollama, a program running **on your own computer** (127.0.0.1). Nothing goes to an online AI service. |
| Android permissions | Health Connect, Usage access (screen time), location history files and contacts are **read** on the phone only when you allow it; the app never writes to them. |

## Your control

- Export or back up everything at any time (Settings & Data).
- Delete single records (restorable from "Deleted data") or "Delete all
  data on this device".
- Each device chooses which of its own data it imports ("What this
  device imports", Android).

## People in your Personal CRM

Notes about other people are personal data about them. Keep only what
you need, for your own personal use.
