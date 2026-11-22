PROJECT_SPEC.md

PERSONAL DATA ANALYST (PDA)

Document type: Product and Technical Master Specification
Project: Personal Data Analyst
Primary user: Single individual, personal use initially
Default timezone: Europe/Paris
Development approach: Incremental, local-first, test-driven

---

1. PROJECT VISION

1.1 Objective

Build a personal application called Personal Data Analyst (PDA).

The application centralises personal habit, sleep and health data, provides longitudinal visualisation and eventually enables within-person statistical analysis.

The objective is to create a reliable personal data infrastructure rather than a conventional habit-tracking application.

The application must support:

- Manual data logging.
- Automatic data imports.
- Historical data editing.
- Longitudinal visualisation.
- Descriptive statistical analysis.
- Future correlation and lag analysis.
- Data export and backup.
- Offline operation.
- Cross-device synchronisation.
- Future Android integration.

1.2 Core principles

The application must be:

1. Local-first: Local storage is the primary source of truth.
2. Offline-first: Core functionality must work without an internet connection.
3. Private by default: Personal data must not be transmitted unnecessarily.
4. Data-safe: Existing data must survive updates, migrations and synchronisation.
5. Statistically correct: All calculations must follow documented mathematical conventions.
6. Extensible: New metrics and data sources should not require extensive architectural changes.
7. Modular: Business logic must be separated from presentation.
8. Transparent: Imported, calculated and manually entered data must remain distinguishable.
9. Maintainable: Prefer understandable, tested code over unnecessary complexity.

---

2. FIXED TECHNOLOGY STACK

Do not change these technologies without explicit user approval.

Layer| Technology
Frontend| React
Language| TypeScript
Build system| Vite
PWA| vite-plugin-pwa
Styling| Tailwind CSS
Local database| Dexie / IndexedDB
Cloud database| Supabase / PostgreSQL
Authentication| Supabase email authentication
Cloud region| EU
Charts| Recharts
Excel export| SheetJS
Testing| Vitest
Android| Capacitor
Version control| Git

Use compatible and stable package versions.

Avoid unnecessary dependencies.

Explain important dependency choices and potential maintenance risks.

---

3. CORE ARCHITECTURE

3.1 Local-first architecture

Dexie / IndexedDB is the primary application database.

The application must operate without Supabase being available.

Cloud synchronisation is introduced in Phase 3.

Do not make core logging or dashboard functionality dependent on an internet connection.

3.2 Synchronisation preparation

Prepare the data model for future synchronisation from Phase 0.

Relevant records must support:

- Stable UUID identifiers.
- created_at timestamps.
- updated_at timestamps.
- deleted_at timestamps where soft deletion is required.
- Synchronisation status.
- External source identifiers.
- Conflict detection.
- Schema versioning.
- Database migration support.

Never assume a successful local database write means cloud synchronisation succeeded.

Never silently overwrite newer data with older data.

Document conflict-resolution rules before implementing synchronisation.

3.3 Data preservation

Implement a reliable JSON backup and restoration mechanism before the application becomes dependent on long-term IndexedDB storage.

The backup system must:

- Include all relevant local records.
- Preserve identifiers and timestamps.
- Include schema/version information.
- Validate data before restoration.
- Detect malformed backups.
- Prevent accidental duplicate restoration.
- Report partial failures.
- Never silently discard invalid records.

---

4. DATA MODEL

4.1 Habits

Each habit must contain:

- id
- name
- type
- unit
- label_options
- color
- archived
- created_at
- updated_at
- deleted_at

Supported types:

- stopwatch
- number
- checkbox
- label
- text

Habit types must use TypeScript discriminated unions.

Each type must have appropriate validation and input components.

4.2 Entries

Each entry must contain:

- id
- habit_id
- occurred_start
- occurred_end (nullable when not applicable)
- value
- comment
- created_at
- updated_at
- source
- event_timezone
- external_id (nullable)
- sync_status
- deleted_at

Supported sources:

- manual
- health_connect
- import

Every entry must support an optional comment.

Every entry must have editable date and time information.

4.3 Validation

Number

- Must be a finite numeric value.

Checkbox

- Must be boolean.

Label

- Must match one of the configured options.

Text

- Must be a string.
- Must have a documented maximum length.

Stopwatch

- Must contain valid session information.
- Duration must be non-negative.
- A session is a single start and stop; pause and resume are not
  required (user decision, 2026-11-09).

Validate at data boundaries and before persistence.

4.4 Stopwatch

Support:

- Start.
- Stop.
- Manual start/end entry.
- Editing historical sessions.
- Optional comments.

No pause or resume: the activity duration is the actual elapsed time
between start and stop.

Persist enough information to reconstruct the actual active duration.

Prevent accidental duplicate sessions.

A page refresh or application restart must not silently create a duplicate session.

4.5 Sleep sessions

Use a dedicated table.

Preserve original imported sleep sessions separately from calculated merged sessions.

Do not destroy original imported records during sleep processing.

4.6 External samples

Use a separate table for imported health measurements.

Fields:

- id
- source
- external_id
- measurement_type
- value
- unit
- occurred_start
- occurred_end
- event_timezone
- imported_at
- metadata

Implement deterministic deduplication using appropriate source identifiers and fallback rules.

Preserve original imported values and metadata.

---

5. DATE AND TIME MANAGEMENT

Date and time handling is a critical architectural requirement.

5.1 Storage conventions

- Store event timestamps in UTC.
- Store the IANA timezone associated with the event.
- Store record creation timestamps independently.
- Default timezone: Europe/Paris.
- Allow the user to select a display timezone.

Do not confuse:

- Event time.
- Record creation time.
- Import time.
- Display time.

5.2 Required functionality

Support:

- Past entries.
- Future entries.
- Editing date and time.
- Daylight-saving transitions.
- Travel across timezones.
- Different event and display timezones.
- Optional comments.

5.3 Duration calculations

Never calculate elapsed duration through local clock subtraction.

Use actual elapsed time between UTC instants.

A displayed clock-time difference must not be mistaken for elapsed duration.

For example, a sleep session spanning a daylight-saving transition must have its actual elapsed duration calculated correctly.

Use explicit timezone-aware date utilities where appropriate.

Avoid relying on implicit browser timezone behaviour.

---

6. APPLICATION PAGES

6.1 Page 1 — Personal Data Log

Create a spreadsheet-style table containing all entries.

Columns:

- Date
- Time
- Habit
- Type
- Value
- Unit
- Source
- Comment

Features:

- Virtualised rendering.
- Sorting.
- Search.
- Filtering.
- Inline editing.
- Deletion.
- Undo after deletion.
- Efficient pagination or virtualisation.
- Responsive layout.
- Empty states.
- Validation feedback.

Never load the entire database into the DOM.

The table must remain usable as the database grows.

6.2 Page 2 — Dashboard

Display sections in this order:

1. Sleep duration.
2. Bedtime.
3. Wake time.
4. Habits.

Features:

- 7-day range.
- 30-day range.
- 90-day range.
- Custom date range.
- Day aggregation.
- Week aggregation.
- Month aggregation.
- Empty states.
- Configurable visible metrics.
- Responsive charts.

All displayed values must be traceable to the underlying records and calculation rules.

6.3 Page 3 — Data Logging

Support creation, editing and archiving of all five habit types.

Prioritise rapid logging.

Common entries should ideally require only 2–3 interactions.

Features:

- Date and time editing.
- Optional comments.
- Appropriate input for each habit type.
- Validation feedback.
- Stopwatch controls.
- Historical editing.

---

7. SLEEP PROCESSING ENGINE

Implement sleep processing as an independent module of pure functions.

It must not depend on React components or UI state.

7.1 Session merging

1. Merge overlapping sessions.
2. Merge sessions separated by a gap below a configurable threshold.
3. Default threshold: 60 minutes.
4. Preserve all original sessions.
5. Make the merging algorithm deterministic.

Define and test the exact behaviour at the merging threshold.

7.2 Night date calculation

Calculate night date using the merged session's local start time.

- Start at or after 12:00: use that local calendar date.
- Start before 12:00: use the preceding local calendar date.

Use the session's event timezone.

7.3 Nap classification

A nap must satisfy both conditions:

- Duration below 3 hours.
- Local start time between 09:00 and 19:00.

Exclude classified naps from the main night calculation.

Display naps separately.

7.4 Sleep duration

Use this priority order:

1. Validated sleep-stage intervals, when available.
2. Valid reported total sleep duration, when available.
3. Elapsed session duration as fallback.

Document and test the source-priority rule.

Do not double-count overlapping sleep stages.

7.5 Time in bed

Calculate time in bed separately from sleep duration.

7.6 Bedtime and wake time

- Bedtime = start of the first night session.
- Wake time = end of the last night session.
- Exclude naps from both calculations.

7.7 Continuous time axis

Represent times after midnight on a continuous axis.

Examples:

- 23:30 = 23.5 hours.
- 00:30 = 24.5 hours.

Calculate averages on this continuous axis.

Display final values in hh:mm format.

7.8 Required test cases

- 23:30–07:00.
- 01:00–09:00.
- 13:00 nap.
- Split night.
- Overlapping sessions.
- Sessions exactly at the merging threshold.
- Sessions immediately below and above the threshold.
- Daylight-saving transitions.
- Travel across timezones.
- Missing sleep stages.
- Invalid sleep-stage intervals.
- Overlapping sleep-stage intervals.
- Invalid reported sleep duration.

All edge cases must have automated tests.

---

8. STATISTICS ENGINE

Create a reusable statistics engine independent of React components.

All calculations must have clearly documented inputs, outputs, units and missing-data conventions.

8.1 General descriptive statistics

For each applicable metric and selected date range, calculate:

- n.
- Mean.
- Median.
- Sample standard deviation (n−1).
- Minimum.
- Maximum.
- IQR.
- RMSD.
- Delta versus the previous equal-length period.

Always display n.

If n < 5, display "Insufficient data" instead of presenting descriptive statistics in a way that could suggest meaningful inferential conclusions.

Never treat missing observations as zero.

Do not interpolate missing observations.

8.2 RMSD

For a user-defined target:

RMSD = sqrt(mean((x − target)²))

When a target exists, also display:

- Bias = mean − target.
- Spread = population standard deviation.
- RMSD² = Bias² + Spread².

Without a target:

- Use the mean as the reference.
- Label the result "RMSD around mean (= population SD)".

8.3 Habit-specific statistics

Bedtime and wake time

- Calculate using the continuous after-midnight axis.
- Display as hh:mm.
- Display deviations in minutes.
- Exclude naps.

Checkbox

- Completion rate.
- Streaks.

Define the observation denominator and streak behaviour explicitly.

Missing days must not automatically count as failures or successes.

Stopwatch

- Total duration.
- Mean duration per valid day.

Label and text

- Counts only.
- No numerical descriptive statistics.

Number

- All applicable descriptive statistics.

8.4 Mathematical conventions

- Sample SD for displayed standard deviation.
- Population SD for RMSD decomposition.
- Hyndman–Fan Type 7 percentile interpolation.
- Exclude missing observations.
- Never interpolate missing observations in trend calculations.
- Use actual calendar-time spacing for regression.
- Express linear trend in units per week.
- Do not calculate coefficient of variation when the mean is zero or the measurement scale makes it meaningless.
- Use absolute changes for metrics such as bedtime rather than misleading percentage changes.

Document all conventions in code and tests.

---

9. EXTENSIBLE METRIC REGISTRY

Each metric must be defined in its own file.

Each metric must implement a standardised pure-function interface:

- id
- name
- applicableTypes
- compute(values, options)

Use Vite's import.meta.glob for automatic discovery of metric files.

Adding a new metric should require adding one appropriately structured file without modifying a central registry or unrelated UI files.

Separate:

- Descriptive statistics.
- Time-series transformations.
- Habit-specific summaries.
- Trend calculations.

9.1 Initial metrics

Implement:

- Median.
- IQR.
- Coefficient of variation.
- 7-day moving average.
- Linear trend (slope per week).
- Percentiles.

9.2 Metric selection

The dashboard must allow the user to choose which metrics appear in each section.

9.3 Testing

Every metric must have unit tests.

Include:

- Hand-calculated expected results.
- Empty inputs.
- Single observations.
- Missing values.
- Edge cases.
- Invalid values where relevant.

---

10. EXPORTS AND DATA MANAGEMENT

10.1 Supported formats

- CSV.
- XLSX.
- JSON.
- Markdown.

10.2 Export filters

Allow export by:

- Date range.
- Selected habits.
- Selected data categories.

10.3 Export metadata

Include:

- Proper headers.
- Units.
- Timezone information.
- Consistent date formatting.
- Source information where relevant.

10.4 Backup and restoration

Support complete JSON backup and restoration.

10.5 Import framework

Support:

- Import preview.
- Duplicate detection.
- Import validation.
- Clear error reporting.
- Safe handling of partial imports.

Never silently discard invalid records.

Clearly report:

- Imported records.
- Skipped duplicates.
- Invalid records.
- Failed records.
- Records requiring user intervention.

A partial import must not leave the database in an inconsistent state.

---

11. PRIVACY AND SECURITY

Health data is sensitive.

Privacy and security are architectural requirements, not optional later improvements.

11.1 Credentials

- No credentials or secrets in the repository.
- Use environment variables.
- Commit an .env.example without real secrets.
- Never expose Supabase service-role credentials in frontend code.

11.2 Supabase security

- Enable and test Row Level Security on every user-owned cloud table.
- Every cloud query must enforce user ownership.
- Test unauthorised access between users.
- Validate data on both client and server.
- Approved exception (2026-11-10): because synchronised data is end-to-end
  encrypted, the server cannot read record content. It validates only the
  encrypted envelope (collection, record id, revision, sizes, key version,
  ownership). All content validation happens on the client, before
  encrypting and after decrypting. See docs/SYNC_DESIGN.md §4.3.

11.3 User control

Provide:

- Data export.
- Data deletion.
- Documentation of local storage risks.
- Documentation of backup risks.

11.4 AI privacy

Never transmit raw personal health data to an LLM.

Any future AI-generated summaries must use appropriately aggregated data and explicit user consent.

11.5 GDPR

EU hosting is required.

However, EU hosting alone must never be presented as proof of GDPR compliance.

Document relevant privacy and security limitations.

---

12. ANDROID AND EXTERNAL DATA

Do not pretend that a PWA can access capabilities that require native Android permissions or APIs.

Phase 4 — Android and Health Connect

- Wrap the application with Capacitor.
- Create the Android application.
- Integrate Health Connect through a compatible native plugin or maintained bridge.
- Request appropriate permissions.
- Support historical import.
- Support incremental updates.
- Persist imported records immediately.
- Deduplicate imported data.
- Preserve source identifiers.
- Synchronise through the established Supabase architecture.

Use supported Android APIs and maintained integrations.

Clearly document platform restrictions.

Phase 5 — Screen time and location

Screen time

- Implement file imports first.
- Investigate UsageStatsManager for native Android screen-time access.
- Document its special permission requirements.
- Do not promise unrestricted access.

Location

- Support location-history imports.
- Prefer supported export formats such as Google Takeout.
- Do not promise unrestricted access to historical location data.

All imports must include validation, source tracking and duplicate detection.

---

13. FUTURE ANALYSIS — NOT FOR INITIAL IMPLEMENTATION

These capabilities are explicitly deferred.

Do not implement them during earlier phases without user approval.

Future features:

- Pearson correlation.
- Spearman correlation.
- Optional lag in days.
- Custom-formula metric builder using a safe expression parser.
- Optional LLM-generated summaries using aggregated data only.

Statistical safeguards

Future analysis must warn about:

- Small sample sizes.
- Missing data.
- Multiple comparisons.
- Correlation versus causation.
- Within-person observational limitations.

Never use eval or execute arbitrary user expressions.

Never transmit raw personal health records to an LLM.

---

14. DEVELOPMENT PHASES

Complete one phase at a time.

Stop after each phase and wait for explicit user approval.

Do not start subsequent phases automatically.

Phase 0 — Foundation

- Development environment.
- Project structure.
- React + TypeScript + Vite.
- Tailwind CSS.
- PWA configuration.
- Dexie setup.
- Database versioning.
- Migration framework.
- Test framework.
- Environment configuration.
- Git and .gitignore.
- PROJECT_NOTES.md.
- Basic application shell.
- Verify production build and tests.

Establish the foundation without destroying existing work.

Phase 1 — Habits and logging

- Habit CRUD.
- All five habit types.
- Stopwatch.
- Local persistence.
- Data Logging page.
- Personal Data Log.
- Editing.
- Deletion with undo.
- Validation.
- Tests.

Phase 2 — Dashboard and data analysis

- Sleep processing.
- Sleep unit tests.
- Dashboard.
- Charts.
- Statistics panel.
- Metric registry.
- Date aggregation.
- Exports.
- Backup and restoration.
- Import framework.

Phase 3 — Supabase

- Email authentication.
- PostgreSQL schema.
- EU deployment.
- RLS.
- Offline synchronisation.
- Conflict resolution.
- Cross-device testing.
- Security testing.

Do not assume that synchronisation works until it has been tested.

Phase 4 — Android and Health Connect

- Capacitor.
- Android application.
- Health Connect permissions.
- Historical import.
- Incremental import.
- Deduplication.
- Synchronisation.

Phase 5 — Screen time and location

- File imports.
- Import validation.
- Native screen-time feasibility assessment.
- Location import.
- Source tracking.

Phase 6 — Advanced analysis

- Correlation.
- Lag analysis.
- Formula builder.
- Optional aggregated-data LLM summaries.

Personal CRM (added by the user's decision on 2026-11-12; built in four
steps, each approved separately)

Purpose: keep notes about the people in the user's life and a log of
interactions with them.

- A "CRM" page in the main navigation with a searchable list of contacts.
- Contact details, all editable: name (required), description,
  education, address, birthday, interests & likes, dislikes. A birthday
  may be a full date or a day and month without a year.
- Interaction log on each contact: date and time (default now, editable
  with the app's dd/mm/yyyy and 24-hour fields), stored as a UTC instant
  with its IANA timezone, shown in time order.
- Contacts and interactions follow the same data rules as other records:
  validation, stable identifiers, soft deletion with restore, included in
  backups and restore, covered by "Delete all data on this device".
- Android: optional import of the phone's contacts (names, addresses,
  birthdays) with a preview and duplicate detection by the phone
  contact's identifier; read-only access to the phone's contacts.
- Synchronisation through the existing end-to-end encrypted sync
  (new record types in the same encrypted storage, no unencrypted
  server tables) and the existing conflict rules (both versions kept for
  the user to choose; no "last write wins").
- Contacts describe other people: they are personal data of third
  parties, kept only for the user's personal use and treated with the
  same care as health data (never sent to an LLM).

Further features (user decision 2026-11-12; details and open choices in
docs/HEALTH_DATA_PLAN.md and docs/YNAB_PLAN.md)

- Dashboard: each panel can be shown or hidden (synchronised choice;
  hiding never deletes anything).
- Dashboard screen time: total, one app or several apps (each with its
  own panel and statistics).
- Health Connect activity and heart data on the phone (steps, distance,
  exercise sessions, resting heart rate, heart rate), imported
  automatically like screen time, every original value preserved,
  synchronised; one source app per kind on the Dashboard so nothing is
  counted twice.
- YNAB: transactions of one budget imported automatically with a
  personal access token kept on one device only; synchronised encrypted;
  YNAB edits and deletions followed; spending per day on the Dashboard.

- Goals (user decision 2026-11-12, docs/GOALS_PLAN.md): an optional AI
  profile, goals with a measure for progress and for success (rule +
  target), self-rated ambition and realism, start and finish; progress
  and a figure from the user's own data; a chat with the local AI on the
  computer that sees summaries only, with conversations kept on the
  computer.

Sharing the app with other people (user decision 2026-11-16, approved
to start 2026-11-21; steps and audit in docs/SHARING_PLAN.md, each step
approved separately)

Purpose: other people can install and set up the app as easily as
possible, on a laptop, Android and iPhone, in the main languages.

- No server is required: every feature except sync works on the device
  alone. Sync stays optional; each person connects their own Supabase
  project (EU region), entered in the app, with a step-by-step tutorial.
  The project owner does not host a server or data for others.
- Laptop and iPhone: a web version at a public address (on iPhone via
  "Add to Home Screen"). A native iPhone app is postponed.
- Android: an APK download from the project's page with an install
  guide, signed with a release key; Google Play later.
- Languages: English and French first, then Spanish, German and
  Portuguese. Translations built in, checked by TypeScript, no new
  library; dates and numbers formatted with the browser's Intl, with a
  setting to keep dd/mm/yyyy and 24-hour. Machine translations are marked
  as such until a native speaker has checked them.
- Personal features (Goals with local AI, YNAB, location, screen time)
  are available to everyone but switched off by default for new people;
  the Personal CRM is on by default (user decision 2026-11-21). The
  owner's own devices keep everything on.
- Public name "Personal Data Analyst"; MIT licence; web version on
  Cloudflare Pages; the code is published as a clean new copy without the
  owner's notes or Git history (user decisions 2026-11-21).
- A plain-language privacy page explains what stays on the device, what
  goes to the person's own server and what goes to outside services. It
  makes no GDPR compliance claim.
- The owner's own computer, phone and tablet keep working throughout
  with no data loss and no forced re-setup; local-first design, data
  format, encryption of synced data and the fixed technology stack do not
  change.

---

15. TESTING AND QUALITY CONTROL

Use Vitest from Phase 0.

Write tests alongside implementation, not at the end.

For each phase:

1. Run automated tests.
2. Run the production build.
3. Verify main user workflows.
4. Check for data loss.
5. Check responsive layouts.
6. Check offline behaviour where applicable.
7. Review regressions.
8. Document known limitations.

Never claim that a test passed unless it was actually executed.

A successful build alone does not prove that the application is functionally correct.

Test critical data-processing functions independently.

---

16. PROJECT DOCUMENTATION

Maintain PROJECT_NOTES.md throughout development.

Record:

- Architecture decisions.
- Important technical choices.
- Dependencies.
- Database schema changes.
- Migration history.
- Completed features.
- Outstanding issues.
- Known limitations.
- How to run the application.
- How to test it.
- Current development phase.
- Next approved tasks.

Update the document after meaningful implementation work.

Keep PROJECT_SPEC.md as the authoritative description of intended functionality.

Keep implementation progress in PROJECT_NOTES.md.

---

17. ACCEPTANCE CRITERIA

A feature is not complete merely because code has been written.

Each feature must have appropriate acceptance criteria.

At minimum, assess:

Functional correctness

- Does it behave as specified?
- Are edge cases handled?

Data integrity

- Is data preserved?
- Are validation and migrations safe?
- Are duplicates handled correctly?

Technical quality

- Is the implementation typed?
- Is business logic testable?
- Are dependencies justified?

Testing

- Are relevant automated tests passing?
- Has the production build succeeded?
- Have important workflows been verified?

User experience

- Is the interface responsive?
- Are errors understandable?
- Can the user recover from common mistakes?

Documentation

- Are implementation decisions recorded?
- Are limitations documented?

Report each feature's verification status accurately.

---

18. NON-NEGOTIABLE DEVELOPMENT RULES

1. Never sacrifice data integrity for development speed.
2. Never silently change the fixed technology stack.
3. Never implement future-phase functionality prematurely.
4. Never claim untested functionality works.
5. Never silently discard invalid data.
6. Never destroy original imported health records.
7. Never treat missing observations as zero.
8. Never calculate elapsed duration through local clock subtraction.
9. Never expose secrets or service-role credentials.
10. Never send raw personal health data to an LLM.
11. Never use eval for custom formulas.
12. Never proceed to the next development phase without explicit approval.
13. Prefer targeted modifications over unnecessary rewrites.
14. Document important architectural decisions.
15. Prioritise correctness, maintainability and data preservation over visual polish.

---

19. CURRENT PROJECT STATUS

This section describes the intended requirements, not the actual implementation state.

Claude must inspect the repository and maintain actual implementation progress in PROJECT_NOTES.md.

Never infer completion from this specification.

Initial status must be established through a repository audit.

Current approved development phase: To be established.

Current implementation status: To be established.

Next task: Audit the existing repository, compare it against this specification and propose a prioritised implementation roadmap before making changes.
