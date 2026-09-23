# Volt

A multi-tenant school ERP and student portal for A Level and O Level campuses in Pakistan.

This repository implements the Volt Product & Engineering Spec. It is built milestone by
milestone; **M0 (Foundation), M1 (Attendance core) and M2 (Academics) are complete**. See
[Milestone status](#milestone-status).

Three rules from the spec govern everything here:

1. **Nothing ships fake.** Every feature listed as in-scope is wired end to end — real
   database writes, real auth, real files. There is no placeholder UI in this repo.
2. **Volt is a web app, not an app-store app.** A responsive web application that installs
   as a PWA. No native build, no store submission.
3. **Multi-tenant from line one.** Every tenant table carries `school_id`. Branding,
   grading scales and fee structures are per-tenant configuration, never hardcoded.

---

## Quick start

```bash
cp .env.example .env         # then set DATABASE_URL, REDIS_URL and NEXTAUTH_SECRET
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Or bring the whole stack up with Docker:

```bash
NEXTAUTH_SECRET=$(openssl rand -base64 32) docker compose up --build
```

The app runs with only `DATABASE_URL` and `REDIS_URL` set. Every external integration
(WhatsApp, SMS, email, payments, object storage) sits behind an interface whose mock
implementation is selected when its key is absent, so the product is fully demoable before
any gateway contract exists.

### Demo logins

After `npm run db:seed`, password `Volt2026!` for every account:

| Role | Sign in with |
| --- | --- |
| Coordinator / Admin | `admin@volt-demo.test` or `0300 111 0001` |
| Accounts / Bursar | `bursar@volt-demo.test` or `0300 111 0002` |
| Volt staff (Super Admin) | `support@volt.test` or `0300 111 0003` |
| Teacher (also an HOD) | `emp-0001@volt-demo.test` |
| Student | `as1-0001@volt-demo.test` |
| Parent | phone `+923001500000` |

Sign in with a phone number or an email. Phone is the primary identifier — `03001234567`,
`+92 300 1234567` and `0300-123-4567` all resolve to the same account.

---

## Architecture

### Multi-tenancy is enforced, not remembered

`lib/db/tenancy.ts` is a Prisma client extension that injects `school_id` from the request
context into the `where` of every read and the `data` of every write on every tenant-scoped
model. A query issued with no tenant context **throws** rather than returning every school's
rows, and a query that names a different school throws `CrossTenantAccessError`.

```ts
// A service never mentions schoolId. This returns only the current tenant's students.
await withTenant({ schoolId }, () => prisma.student.findMany());
```

Two tests keep this honest:

- `tests/unit/tenancy.test.ts` fails if any model is added without `school_id` and without
  a recorded decision about why it is safe (`lib/db/tenant-models.ts`).
- `tests/integration/tenancy-runtime.test.ts` runs against a real Postgres with two tenants
  and asserts that a lookup by another school's primary key returns `null`.

Crossing the boundary deliberately requires `withoutTenantScope()` — awkward to type and
easy to grep for, because every use is a place a reviewer should look.

One asymmetry worth knowing: Prisma's generated types still require `schoolId` on a
`create`, so the compiler asks for it on writes even though the extension supplies it.
Reads — the actual data-leak vector — are scoped with no help from the caller.

### Academic-year scoping

Attendance, marks, enrolments, fees and timetables all carry `academic_year_id`. Rolling
over to a new year never touches last year's rows, and a result card from three years ago
still prints. `tests/unit/tenancy.test.ts` asserts this for every academic model.

### Permissions

`lib/permissions/` holds a capability matrix (`resource.action`) and the row-level scope
rules. Route handlers check capabilities, never role names.

- Seven roles, held many-to-many: one account can be teacher, HOD and parent at once.
- Row-level scoping: a teacher sees only sections they teach, a parent only their linked
  children, an HOD only their own department.
- A bursar holds no `marks.*` or `remark.*` capability at all — asserted in tests.
- A student's own record is enforced as a **query predicate**, so the rule holds on list and
  search endpoints too, not just on detail pages.

### Layering

Route handlers stay thin: validate with Zod, check permission, call a service in
`lib/services/`, return. There are no Prisma calls in React components, and an ESLint rule
blocks importing `PrismaClient` anywhere but the three sanctioned files.

### Money

Every amount is an integer in **paisa**. A test asserts there is no `Float` or `Decimal`
anywhere in the schema. Conversion to rupees happens once, at the display edge, in
`lib/i18n/format.ts`.

---

## Design system

Apple-like restraint, not an Apple copy. Inter (open licence) rather than SF Pro, whose
licence covers Apple platforms only.

All colour is CSS custom properties. **There are no hex codes in component code.** A tenant
theme is a JSON file in `themes/`, so a second school is a new file and a row — nothing
else. `tests/unit/theme.test.ts` asserts, for every theme in both light and dark:

- `--brand-on-primary` passes 4.5:1 against `--brand-primary`
- every text token, tertiary included, passes 4.5:1 against both background depths
- every status colour passes 4.5:1 as text
- dark mode is authored rather than a mechanical inversion of light

Other rules in the build: tabular numerals on every mark, fee and percentage; 8px spacing
scale; 44×44px minimum tap targets; bottom tab bar on mobile (five items max) and a sidebar
at ≥1024px; `prefers-reduced-motion` respected; loading, empty and error states as
components rather than as a convention people remember.

`themes/lgs.json` is marked `publicUseApproved: false`. Per the branding section of the
spec, develop against the neutral Volt theme and switch the LGS theme on only for the pitch
— and not at all in anything public until there is written permission.

---

## The seed is a deliverable

`npm run db:seed` builds the demo tenant in **under 60 seconds**, idempotently (it
rebuilds rather than duplicating, and the PRNG is seeded so two runs are identical):

| | |
| --- | --- |
| Students | 2,000 across AS1 and A2, realistic Pakistani names, real A Level combinations |
| Guardians | 1,857 accounts, some linked to two children so the child switcher has a subject |
| Staff | 150 across 6 departments, 111 teaching, an HOD for each department |
| Sections | 218, every one with a teacher and a room |
| Enrolments | 6,235 — students take 3–4 subjects, not all twelve |
| Timetable | 872 slots over a 6-day, 8-period week, **provably clash-free** |
| Academic years | 2025–26 and 2026–27, exactly one current |
| Attendance | 583,166 records over 147 school days, 91.7% average, with chronic absentees to find |
| Exams | 3 series, 2,493 papers, 71,469 marks on a realistic curve; two published, the latest left in draft for the demo to publish live |
| Past papers | 400 across 8 years, 3 sessions and 3 variants, with mark schemes |
| Practice | 326 timed attempts by 60 students, so the grade trend has a trend in it |
| Quizzes | 40 — one already sat per section, one that has just opened, so there is something to actually do |
| Question bank | 336 topic-tagged questions, and 2,096 topic mastery rows behind the weakness map |
| Assignments | 436 with 5,500 submissions, some late, some ungraded, some missing |
| Fees | 12,000 invoices over 6 months, 9,500 payments, 95.6% of what is due collected, ~460 families behind across every aging bucket |
| Concessions | 167 sibling, scholarship and staff-child discounts, each with an approver |
| Meetings | 72 parents' evening slots across six teachers |

### How the timetable is clash-free

Clash detection runs on three axes: teacher double-booked, room double-booked, and
**student-cohort clash** — two subjects one student takes, scheduled in the same period.
The third is the hard one and the real differentiator.

The seed makes it structural rather than searched-for, the way real A Level colleges do it:
every subject sits in exactly one **option block**, a student takes at most one subject per
block, and all sections of a block run at the same time. Each (year group, block) pair gets
four of the week's 48 slots and no two pairs share one, so distinct teachers and rooms
within a pair are all that is needed.

`tests/integration/seed.test.ts` runs the real three-axis detector over all 872 slots and
6,235 enrolments and asserts zero clashes. `tests/unit/curriculum.test.ts` asserts the
invariant the scheme rests on — no subject combination takes two subjects from one block.
That test caught a genuine bug during M0: Biology and Mathematics had been placed in the
same block while "Pre-medical with Maths" takes both.

**M1 added the attendance history**: every school day of the current academic year to date
— 147 days, 20,387 registers and 583,166 records — averaging 91.7% with believable
patterns. Mondays run 89.4% against 92.7% on other days, the day before a holiday drops to
86.1%, and about fifty students are chronic absentees who keep reappearing on the
defaulters list. No sessions exist on Sundays or holidays.

**M2 added three exam series** — 2,493 papers and 71,469 marks, distributed to a real bell
curve rather than a uniform spread, drifting upward across the year so the grade-trend chart
has a trend in it. The two older series are published through the real publication service
(4,000 result cards), so every analytics screen has data the moment the app opens; the most
recent mocks are left with marks entered but unpublished, which is what the demo publishes
live in front of the principal.

Seed data keeps growing with each milestone: M3 adds past papers and quiz attempts, M4 a
full fee cycle.

---

## Milestone status

| Milestone | Ships | Status |
| --- | --- | --- |
| **M0 Foundation** | Repo, CI, Docker, Prisma schema, auth, roles and permissions, theming and design system, app shell, seed with 2,000 students | **Complete** |
| **M1 Attendance core** | Bulk import with column mapping, three-axis timetable clash detection, offline attendance marking, attendance dashboards | **Complete** |
| **M2 Academics** | Exam series, component weighting, marks entry grid, moderation, publication, result card PDFs, student and teacher analytics | **Complete** |
| **M3 Learning** | Past paper vault, practice engine, quiz engine with auto-marking and topic mastery, assignments, resources, doubt threads | **Complete** |
| **M4 Fees and parents** | Fee structures, bulk invoicing, bank-format vouchers, payments, discounts, defaulter aging, statement reconciliation, parent portal in Urdu, channel-agnostic notifications | **Complete** |
| M5 Student life | Societies, events, effort leaderboards, careers, digital ID | Next |
| M6 Harden and pilot | Performance pass, security review, backup drill, audit log UI, year-end rollover | |

### What M0 delivers

- **Schema** — 60 models covering every entity in the spec's data model, with the indexes
  that matter at 2,000 students and the constraints Prisma cannot express (one current
  academic year per school, non-negative money) as a hand-written migration.
- **Auth** — phone-or-email + password, argon2id, account lockout after 5 failed attempts
  for 15 minutes, and **per-role session lengths**: 12 hours for admin and bursar, 30 days
  for everyone else. NextAuth's `maxAge` is global and cannot express that, so the token
  carries its own deadline, checked on every request.
- **Permissions** — the capability matrix, row-level scope helpers, and 14 tests over the
  role boundaries.
- **Theming** — token system, two themes, contrast enforced by test.
- **i18n** — English and Urdu, RTL, PKR and `DD MMM YYYY` formatting, with a test that fails
  if the two locale files drift apart or if Urdu is left as copied English.
- **Shell** — installable PWA with an offline app-shell cache, sidebar/tab-bar navigation
  per role, and the three designed list states.
- **CI** — lint, typecheck, migrate, seed, unit + integration tests, build, then E2E on a
  mobile viewport.

### What M1 delivers

**Attendance** — the feature that sells the product.

- The register opens with every student pre-marked present and their photo alongside their
  name, so the teacher taps only the absentees. One tap toggles absent; press and hold
  cycles late and excused. Bulk "all present" / "all absent". The submit button is
  bottom-anchored, above the tab bar rather than behind it.
- **Offline-capable.** The register loads from an IndexedDB cache with no connectivity,
  accepts marks, and queues them. On reconnect the queue drains automatically and the
  original period timestamp is preserved — not the sync time. The sync endpoint is
  idempotent on a device-generated batch id and returns per-register results, so a phone
  that loses signal mid-sync can retry the whole batch safely.
- **Conflict resolution favours the earliest timestamp** when two devices queued the same
  period. A teacher's deliberate online correction is not a conflict and always applies.
- **Registers lock 24 hours after the period ends**, measured from the period in the
  school's own timezone rather than from submission. After that only a coordinator can
  amend, the reason is mandatory, and the audit row records before, after, actor and reason.
- **Period-wise, not daily** — selective absence is the problem schools want solved.
- Views per audience: a student's calendar heatmap and per-subject percentages, a teacher's
  section percentages sorted worst-first, a coordinator's campus figure, year-group
  comparison, absentee list and the register-not-marked list, plus a teacher marking
  compliance table.

**Bulk import** — the reason schools stall on switching.

Upload a CSV, confirm the guessed column mapping, see the first twenty rows with every
error flagged inline, then commit and download a CSV report explaining every rejected row.
Dedupes on admission number, links siblings to the guardian account that already exists,
and forces a password change at first login. 500 students with guardians and subject
enrolments import in about 13 seconds.

**Timetable** — three-axis clash detection (teacher, room, student cohort) enforced on
write, not just previewed: placing a section in a clashing slot is refused with a message
naming the specific conflict. Plus substitutions, and the read views with the current
period highlighted.

### Performance, measured

Against the seeded 2,000 students and 583,166 attendance records:

| Endpoint | Budget | Measured (p95) |
| --- | --- | --- |
| Attendance register load | < 1s | 21ms |
| Student list | < 300ms | 18ms |
| Student attendance (180 days) | < 300ms | 159ms |
| Daily attendance report | < 300ms | 62ms |
| Teacher compliance | < 300ms | 56ms |
| 200 concurrent register reads | the 08:00 peak | all 200 OK, 1.6s wall |

The daily report started at 389ms — over budget — because it counted four thousand records
in JavaScript. It now aggregates in Postgres and runs in 62ms. That query is raw SQL, which
bypasses the tenancy extension, so it binds `school_id` explicitly; that is why there are
so few raw queries in this codebase.

### What M2 delivers

The module the spec says differentiates Volt in a demo, because every competitor treats
A Level like a percentage-and-position system.

**Component weighting done properly.** A subject grade is computed from weighted component
scores, never from an average of raw marks. Chemistry 9701's published weights are
15/23/38/23 — which total 99, not 100 — so the aggregate normalises by the weight that
actually contributed rather than assuming a hundred. An absent paper is excluded from both
sides rather than scored zero, and the card names what was missed.

**Marks entry** is a spreadsheet grid: students down, one paper across, driven entirely
from the keyboard. Enter and the arrows move between students, `A` marks a student absent,
and a column pasted from Excel fills downward in roll-number order. Marks above the paper
total are refused, outliers more than three standard deviations from the class mean are
flagged as a warning rather than a block, and every entry autosaves.

**Moderation** keeps the teacher's original mark on the row as well as in the audit log, so
a result card can show that a mark was moderated without a query across the audit table. A
second moderation pass never overwrites the original.

**Publication** happens for the whole series at once — staggered visibility causes
complaints — and freezes an immutable snapshot per student. Everything afterwards reads
that snapshot, so a card reprinted in three years is the one the family received even if a
grading scale has been edited since. Unpublishing exists for the broken-paper case and is
recorded loudly.

**Result cards** render server-side with no browser: one A4 page per student carrying the
component breakdown, subject grade, class average, attendance for the term, remarks the
school marked visible to parents, and signature blocks.

**Analytics**: the grade trend per subject (small multiples, one series each, with the
boundary bands drawn behind), the paper costing the most in weighted grade points, a
teacher-set and a system-suggested predicted grade side by side and clearly labelled, a
section's distribution against its year group, and the students who dropped two grade bands
or more since the last series.

Class position is a percentile **band** shown only to the student — never a ranked list.

### Performance, measured

Against the seeded 2,000 students, 583,166 attendance records and 71,469 marks:

| Endpoint | Budget | Measured (p95) |
| --- | --- | --- |
| Attendance register load | < 1s | 21ms |
| Student list | < 300ms | 18ms |
| Student attendance (180 days) | < 300ms | 159ms |
| Daily attendance report | < 300ms | 62ms |
| Teacher compliance | < 300ms | 56ms |
| Marks grid | < 300ms | 31ms |
| Student results (3 series) | < 300ms | 23ms |
| Single result card PDF | < 3s | 66ms |
| 200 result cards, merged | < 60s | 8s |
| Publishing a series for 2,000 students | — | 2.5s |
| 200 concurrent register reads | the 08:00 peak | all 200 OK, 1.6s wall |

Two budgets were missed and fixed rather than renegotiated. The daily report started at
389ms because it counted four thousand records in JavaScript; it now aggregates in Postgres
at 62ms. The seed twice crossed its 60-second limit as attendance and exam data landed;
both writes moved from `createMany` to set-based `unnest` inserts, which is roughly an
order of magnitude faster.

### What M3 delivers

The milestone the spec calls the one that wins students, because it is the only part of an
ERP a student opens voluntarily.

**The past paper vault** organises by subject → component → year → session → variant, with
the mark scheme and, where the school has it, the examiner report. Filters live in the URL,
so "9701 P4, never attempted" is a link a student can send a friend. Volt ships the
organising structure and the metadata — never the papers themselves; see the licensing note
below.

**The practice engine** is built around one rule: **the mark scheme stays locked while an
attempt is open**. It is not hidden in the payload and revealed by the client — it is not
in the payload at all, and the server returns it only in the response to the submit call.
Without that the timer is theatre. An attempt is re-entrant, so a student whose phone dies
at question 12 reopens the same attempt with the clock where they left it rather than
getting a fresh hour. Running out of time does not seize the paper: the deadline is
recorded, the submission is not refused.

Afterwards the student marks their own script against the scheme and enters a total, and
the **grade trend** plots it — grouped by subject *and component*, because "I have gone
from a C to a B on P2" is a sentence about a component, and averaging P2 with P4 hides both
stories. Goals and streaks count **papers sat, never grades**: effort is the thing a
student controls.

**The quiz engine** auto-marks MCQ, multiple-response, numeric with a tolerance band, and
short text. Two decisions shape it:

- Anything the machine cannot mark with certainty goes to the teacher's queue rather than
  being guessed. A short answer that does not exactly match an accepted response is
  *unmarked*, not *wrong* — a quiz result a student disputes and wins destroys the feature.
- A blank answer is never penalised. Negative marking exists to punish a guess, and not
  answering is not a guess. A total can never go below zero.

Numeric tolerance is relative to the expected magnitude, which is what "±2%" means on a
mark scheme; around an expected value of zero it falls back to an absolute band rather than
silently demanding exactness. Question and option order are shuffled from a seed derived
from the attempt id, so a reload shows the same paper in the same order — otherwise a
student reloads until the question they know comes first.

**The answer key never crosses the wire early.** The page a student opens carries no
questions at all; those arrive from the start call, and `correct` and `explanation` only
appear after submission, and only if the quiz allows it. An end-to-end test asserts the
served HTML contains neither.

**Anti-cheating is proportionate**: tab switches are counted so a teacher has a reason to
ask a question. No webcam, no lockdown, no auto-submit.

**Per-question analysis** is what makes a quiz worth setting. Facility per question, a
distractor breakdown showing how the class actually answered — a wrong option pulling 40%
is a misconception with a name — and a reteach list ordered weakest first. The marking
queue is grouped by question rather than by student, because marking thirty answers to the
same question in a row is how marking stays consistent.

**Topic mastery** feeds the weakness map. It is a rolling average, not a lifetime one: a
student who bombed electrolysis in September and has since fixed it should not still be
told electrolysis is their weakness in March. Only auto-marked questions count — treating
"not yet marked" as "wrong" would tell a student they are weak at a topic nobody has looked
at — and a thin sample is shown as provisional rather than as a verdict.

**Assignments** flag late work rather than refusing it, unless the teacher has explicitly
turned late submission off. A student who submits at 12:04 has done the work; whether that
is acceptable is the school's judgement, not the software's. The grading list shows every
enrolled student including those who handed in nothing, because "who is missing" is the
list a teacher actually needs.

**Resources** carry version history, so a corrected handout does not orphan the old link
and the library shows one entry rather than two. Download counts tell a teacher whether
anyone opened the revision pack. Whole-school visibility is a broadcast and needs
`resource.moderate`.

**Doubt threads** are visible to the whole subject cohort rather than being private
messages, because a question only one student can see has to be answered thirty times. A
staff reply stamps the thread answered, which is what the teacher's "unanswered" queue runs
on.

Throughout, each record is authorised **against itself** rather than by asking whether it
appears in a page of a list. A thread from last term, an assignment from last month and a
handout from a full library all still open for someone entitled to read them.

### Performance, measured

Against the seeded volume — 400 papers, 326 practice attempts, 40 quizzes, 434 quiz
attempts, 2,096 topic mastery rows — every learning read is an order of magnitude inside
its budget:

| Endpoint | Budget | Measured (p95) |
| --- | --- | --- |
| Past paper vault list | < 300ms | 8ms |
| Vault, "never attempted" filter | < 300ms | 6ms |
| Vault facets | < 300ms | 6ms |
| Practice grade trend | < 300ms | 7ms |
| Quiz list (student) | < 300ms | 5ms |
| Quiz analysis with distractors | < 300ms | 16ms |
| Weakness map | < 300ms | 2ms |
| Assignment list | < 300ms | 4ms |
| Resource library | < 300ms | 8ms |
| 30 concurrent vault reads | a class told to revise | 76ms wall |

These are assertions in `tests/integration/learning-performance.test.ts`, not a one-off
measurement — a regression fails the suite.

### What M4 delivers

The milestone aimed at the budget holder. "The bursar is your internal champion. Win the
accounts office and the contract renews itself."

**Financial integrity is the design, not a feature.** Every amount is an integer number of
paisa — there is no float anywhere in the finance path. An invoice is **never edited once a
payment is recorded against it**: a correction is a credit note, with an amount, a reason
and an approver, on the record for good. Every finance mutation is audit-logged with the
actor, and a reversal keeps what the payment was as well as who undid it.

**Bulk invoicing** raises a numbered voucher for a whole year group in one action, and is
idempotent on (student, period): pressing the button twice because the first run seemed
slow must not bill a family twice. Voucher numbers are allocated inside the transaction,
because two people in an accounts office do press the button at the same moment.

**The voucher is a bank challan**, not a styled invoice — three copies across one A4
landscape sheet, each complete, each with the bank block, the amount in figures and in the
lakh/crore wording a Pakistani counter expects, and a stamp box. "Schools will not switch
to a voucher their bank rejects."

**Reconciliation** is the module's hardest problem and the accounts office's biggest daily
pain. A statement CSV is parsed (the column names four different banks use, thousands
separators, currency prefixes, parenthesised negatives, day-first dates), then each credit
line is scored against every open voucher. The design rule is to be *right about what it is
sure of and honest about the rest*: a confident match is pre-ticked, an ambiguous one shows
its candidates and its reasons, an unmatched one says so. **Nothing posts until a person
presses the button.** A tool that silently mis-posts one payment in a hundred is worse than
the spreadsheet, because nobody checks it.

**Defaulters** roll up per family, not per invoice — a student with four unpaid months is
one conversation — with aging buckets, the guardian's phone number on every row, a CSV
export and a one-click reminder that aggregates to one message per family before sending
anything.

**The optional fee gate** is off unless a school turns it on, and when it blocks a result
card it says why and what would clear it. A child told only "unavailable" learns that the
school is arbitrary.

**`notify(userId, type, payload)`** is the only way anything in Volt reaches a person.
Nothing else talks to WhatsApp, SMS or email. A type declares its channels, its urgency and
its batching; the recipient's preference overrides the default; quiet hours hold anything
non-urgent between 21:00 and 07:00; and **every attempt is written down, including the ones
that were suppressed and why**. That log is searchable by phone number, because the
question always arrives as "what did we send to this parent" while the parent is on the
line.

Batching is real rather than nominal: a batched message is **not delivered when it is
raised**. It waits in the queue, its count rises as more events land, and one message goes
out when the window closes — so a parent whose child missed four periods gets one message
saying four, not four messages.

**The parent portal** is four facts and three actions. Today's attendance, the fee
position, the latest result, unread announcements — and leave, meeting booking, and
announcement replies. A parent has no write access to anything academic and cannot message
teachers freely, because "that becomes a support nightmare for the school."

**Urdu is not a toggle in a settings menu.** The language control is on every screen, each
option written in its own script, so somebody who cannot read the current interface can
still find the other one. The choice is saved to the account rather than the browser,
because it also decides which language the school's WhatsApp messages arrive in — and a
parent who switches the portal to Urdu and keeps getting English alerts has not really been
given the choice.

### Performance, measured

Against the seeded ledger — 12,000 invoices, 9,500 payments, six months of billing:

| Endpoint | Budget | Measured (p95) |
| --- | --- | --- |
| Invoice list | < 300ms | 24ms |
| Defaulter list | < 300ms | 89ms |
| Collection report | < 300ms | 114ms |
| Parent home screen | < 300ms | 27ms |
| Notification inbox | < 300ms | 4ms |
| Delivery log search | < 300ms | 34ms |
| Announcement list | < 300ms | 2ms |
| Reconcile a 100-line statement | a coffee break | 472ms |
| 250 vouchers as one PDF | < 60s | 8s |

Two things were fixed rather than accepted. The collection report started at **1,417ms**
because it pulled every invoice for the year into JavaScript and summed there; aggregating
in Postgres took it to 114ms — the same mistake, and the same fix, as the M1 daily
attendance report. And publishing a series for 2,000 students had become a **50-second**
request once it started notifying guardians, because it called `notify()` once per family;
a bulk path that reads preferences once and writes every row in one insert took the whole
seed back inside its 60-second budget.

### Deliberately not built

Library, transport, hostel, payroll and biometric hardware modules. Every competitor in
this market bloats into those and ships a mediocre everything.

---

## Commands

| Command | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm test` | Unit and integration tests (needs Postgres) |
| `npm run test:e2e` | Playwright, mobile and desktop viewports |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Rebuild the demo tenant |
| `npm run db:studio` | Prisma Studio |

Where Chromium is provisioned outside Playwright (locked-down CI images), point
`PLAYWRIGHT_CHROMIUM_PATH` at the binary.

---

## Testing

| Layer | Tool | What it covers |
| --- | --- | --- |
| Unit | Vitest | **Grading** (component weighting, boundary arithmetic, class statistics, outliers, percentile), **attendance percentages**, the lock window, offline conflict resolution and **timetable clash logic** — the four the spec requires to be near 100%, because wrong answers there are invisible and expensive. Plus CSV parsing, column mapping and import date handling |
| Integration | Vitest + real Postgres | Tenancy enforcement, permission boundaries, the register and offline sync, the import acceptance criterion, the full exam cycle from setup to PDF, the whole learning module end to end, the finance integrity rules, notification batching and quiet hours against a recording provider, the parent portal's scope, the seed's own invariants, and the read budgets as assertions rather than as a one-off measurement |
| E2E | Playwright | The demo-script flows on a mobile viewport, including marking a register in airplane mode and watching it sync, sitting a quiz, a timed practice attempt proving the mark scheme stays locked, the bursar's day from ledger to reconciliation, the parent portal switching to Urdu and laying out right to left, and a per-role 403 matrix over the real HTTP stack |

Both suites run against a single shared database, so both are configured to run
sequentially. Parallel files racing over the same tenant is a flake factory.

Tests run against a real database, never a mock. A tenancy guard tested against a fake
client would prove nothing.

No test is allowed to skip itself into a pass. A quiz allows a fixed number of attempts, so
the end-to-end test that sits one creates its own through the API rather than consuming a
seeded quiz — otherwise it would pass on the first run and silently skip on every run
after, which reads exactly like a pass. For the same reason the seed's documented parent
login is a guardian with **two** children: the child-switcher test used to skip on a
one-child account, and a switcher demoed with nothing to switch between is not a demo.

**547 unit and integration tests, 134 end-to-end across mobile and desktop, zero skips.**

---

## Security and data protection

This system holds minors' names, photographs, home addresses, guardian CNICs, academic
records and family financial information.

Implemented in M0: argon2id hashing, Zod validation on every server input, rate limiting and
account lockout on auth, security headers including HSTS, no student PII in URLs, an audit
log model on every sensitive mutation, and an impersonation model that records actor, target
and reason and drives a persistent UI banner.

M2 closed a real hole found by its own tests: the helper that answered "may this actor read
marks?" counted `marks.read.own`, which a student holds — so a student enrolled in a section
could open that section's marks grid and read every classmate's marks. The same shape of
mistake existed on the attendance register page. Reading a whole section is now a distinct
capability check (`canReadSectionMarks` / `canReadSectionAttendance`) that deliberately
excludes "own" and "children", pinned by unit tests and asserted end to end.

M1 added the **per-role 403 matrix** (`tests/e2e/permissions.spec.ts`), which drives the
real HTTP stack: an unauthenticated caller gets 401 everywhere, a student is refused every
staff endpoint and cannot read another student's attendance by id, a teacher cannot reach
the campus reports or run an import, and a bursar is refused every academic endpoint.

M3 added file handling and three more ways to leak something. Uploads are typed by
**sniffing the magic number**, never by trusting the extension or the client's
`Content-Type`, and nothing is ever served with an executable content type; stored files
are reached only through short-lived HMAC-signed URLs scoped to the school's own key
prefix. The quiz answer key is withheld by **not being in the payload**, which is the only
version of that guarantee a client cannot undo. And M3 fixed a bug of its own making:
`openResource`, `getAssignment` and `getDoubt` all authorised by asking whether the record
appeared in a page of a list, which would have started refusing perfectly legitimate reads
the moment a school's library, section or subject outgrew that page. Each now authorises
against the record itself, with tests that backdate a thread off the recent list and open
it anyway.

M4 holds money, so the rules are structural rather than procedural. Invoices are immutable
once a payment lands; corrections are credit notes with an approver. Fee mutations are the
bursar's alone — the coordinator can read the collection position, because the spec gives
them "all reports", and cannot record a payment, grant a concession or reconcile a
statement. A parent sees exactly their own children, enforced as a query predicate rather
than a filter over results, and sees that another family's meeting slot is taken without
ever learning whose it is. The raw SQL behind the collection report carries `school_id`
explicitly, because a raw statement is outside the tenancy extension's reach.

One M4 bug is worth naming because a test found it and nothing else would have: the
statement matcher flattened a narration to digits, so `FEE TST-2026-000003` plus a
reference of `TRXREC1` produced `20260000031` — which contains the sequence of a completely
different voucher. It compares contiguous digit runs now, with a unit test pinning it. The
ambiguity margin meant it was proposed rather than auto-posted, which is the whole reason
that margin exists.

Scheduled for M6: the full security review, encryption at rest, and the backup and restore
drill. Do not go live at a school before those pass.

## Licensing note on past papers

CAIE and Pearson own their papers. Volt ships the uploader, the taxonomy and the metadata —
each school uploads its own copies into its own tenant storage. Take legal advice before
marketing a preloaded paper library as a Volt feature.
