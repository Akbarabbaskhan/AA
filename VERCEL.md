# Deploying Volt to Vercel

A demo URL you can open on a phone and send to someone, in about forty minutes. Nothing here
needs Docker, WSL or a local Postgres.

You will set up three things — a database, a file store, and the Vercel project — and then run
one command from your own machine to load the demo data.

---

## 1. The database (Neon, free)

Vercel runs each request in its own short-lived function, and each one opens its own database
connection. A plain Postgres runs out of connections quickly under that pattern, so use a
provider with a built-in pooler. Neon's free tier is the least fuss.

1. Sign up at [neon.tech](https://neon.tech) and create a project. Pick the region nearest
   your users — `aws-ap-southeast-1` (Singapore) is the closest to Pakistan.
2. On the project dashboard, copy **two** connection strings. Neon shows both; the toggle is
   usually labelled "Pooled connection".

   | | Looks like | Used for |
   | --- | --- | --- |
   | **Pooled** | `...-pooler.region.aws.neon.tech/...` | the app, in Vercel |
   | **Direct** | `...region.aws.neon.tech/...` (no `-pooler`) | migrations and seeding, from your machine |

3. Add `&pgbouncer=true&connection_limit=1` to the end of the **pooled** string. Prisma needs
   this to stop using prepared statements, which a transaction-mode pooler cannot keep.

Keep both strings somewhere for the next steps.

---

## 2. The file store (Cloudflare R2, free)

Vercel's filesystem is ephemeral — anything written to disk is gone by the next request. The
document locker, past papers and generated report files all need real object storage. Volt
already has an S3 adapter; it is selected automatically as soon as the keys are present.

R2 is the right choice here because downloads are free: a past paper fetched by six hundred
students costs nothing in egress.

1. In the Cloudflare dashboard → **R2** → create a bucket, call it `volt-demo`.
2. **Manage R2 API Tokens** → create a token with **Object Read & Write** on that bucket.
3. Note the Access Key ID, the Secret Access Key, and your account's S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).

Skipping this step does not break the deploy — the app falls back to a local directory, and
uploads simply disappear. Fine for a ten-minute look, not for a demo where somebody uploads a
document and expects it to still be there.

---

## 3. The Vercel project

1. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import
   **Akbarabbaskhan/AA**.
2. Set the production branch to `claude/system-development-0qvgz1` (Settings → Git), unless
   this has been merged to `main` by the time you read it.
3. Framework preset is detected as Next.js. Leave the build and output settings alone.
4. Add the environment variables below, then deploy.

### Environment variables

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the **pooled** Neon string, with `&pgbouncer=true&connection_limit=1` |
| `NEXTAUTH_SECRET` | 32+ random bytes — run `openssl rand -base64 32`, or use any password generator |
| `NEXTAUTH_URL` | your deployment URL, e.g. `https://volt-demo.vercel.app` |
| `APP_URL` | the same URL |
| `DEFAULT_TENANT_SLUG` | `volt-demo` |
| `CRON_SECRET` | another random string — Vercel also injects this into its own cron calls |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `volt-demo` |
| `S3_ACCESS_KEY_ID` | from the R2 token |
| `S3_SECRET_ACCESS_KEY` | from the R2 token |

`NEXTAUTH_URL` and `APP_URL` are a chicken-and-egg problem: you do not know the URL until the
first deploy. Deploy once with your best guess, then correct them and redeploy. Sign-in will
not work until they match the real URL.

Everything else — WhatsApp, SMS, email, payment gateways — stays unset. Each one falls back to
a mock that writes to the delivery log instead of sending, which is exactly what you want in
front of an audience.

---

## 4. Load the demo data

Run this from your own machine, once, against the **direct** (non-pooled) connection string.
Migrations and bulk inserts both want a real session, not a pooled one.

```bash
git clone https://github.com/Akbarabbaskhan/AA.git
cd AA
git checkout claude/system-development-0qvgz1
npm install

export DATABASE_URL='<the DIRECT Neon string>'
export NEXTAUTH_SECRET='<the same secret you put in Vercel>'

npx prisma migrate deploy
npm run db:seed
```

On Windows PowerShell, use `$env:DATABASE_URL='...'` instead of `export`.

The seed takes about two minutes and writes 3,000 students, a term of attendance, three exam
series and a fee ledger. `NEXTAUTH_SECRET` must match the one in Vercel because the seed signs
storage URLs with it.

You can run this before or after the first deploy — the build does not need the database.

---

## 5. Sign in

Open your Vercel URL. Password is `Volt2026!` for every demo account.

| Role | Sign in with |
| --- | --- |
| Coordinator / Admin | `admin@volt-demo.test` |
| Accounts / Bursar | `bursar@volt-demo.test` |
| Volt staff (super admin) | `support@volt.test` |
| Teacher | `emp-0001@volt-demo.test` |
| Student | `as1-0001@volt-demo.test` |
| Parent | phone `+923021500002` |

---

## What to show people

A demo that opens on the dashboard and scrolls is forgettable. These four land:

1. **Mark a register on your phone, in airplane mode.** Turn the wifi off first. The marks
   save, the banner says what is waiting, and it syncs the moment signal returns. This is the
   feature every teacher asks about and no competitor here has.
2. **The at-risk list** (Reports → At-risk students). Low attendance, a grade drop, missing
   work and overdue fees in one list, ranked by how many are true at once, with the guardian's
   phone number on the row.
3. **Publish a series** as the coordinator, then switch to the student account and show the
   result card already there.
4. **The audit log.** Change a mark, then find it in Audit by the student's name and show the
   before and after. This is the answer to "what if a parent disputes a grade".

---

## Known limits of this setup

- **Vercel Hobby is non-commercial.** Fine for showing people. A real school pilot needs the
  $20/month Pro plan, which also raises the function timeout.
- **Cold starts.** The first request after a quiet spell takes a second or two. Open the app
  yourself a minute before you show anyone.
- **Neon's free tier sleeps** after five minutes idle. The first query then takes a few
  seconds. Same remedy.
- **The seed's dates are relative to when you run it.** Re-run it if the demo gets stale.
- **Dependency advisories are outstanding.** `npm audit` reports 19, including criticals in
  Next.js and next-auth, and none has a fix inside the current major versions — clearing them
  means upgrading to Next 16, which is the M6 security pass, not a deploy step. Share the URL
  with people you have chosen; do not post it publicly or put real student data in it.
- **No custom domain yet.** `*.vercel.app` is fine for a demo. A school pilot wants a real
  domain, which is a DNS record and five minutes in Vercel's dashboard.

---

## If the deploy fails

**`Module not found: argon2` or a `.node` binary error at sign-in.** argon2 is a native module
and the bundler cannot always see the binary it loads at runtime. `next.config.mjs` already
forces it into the bundle; if it still fails, swap the package for `@node-rs/argon2`, which
ships proper prebuilds and verifies the same PHC hash strings, so the seeded passwords keep
working. Only `lib/auth/password.ts` imports it.

**`Can't reach database server` during the build.** Harmless as of this version — branding
falls back to the default theme when the database is unreachable, and the build completes. If
you see it at runtime instead, the connection string is wrong or Neon is asleep.

**Sign-in redirects in a loop, or "Configuration" error.** `NEXTAUTH_URL` does not match the
URL you are actually on. Correct it and redeploy.

**`prepared statement "s0" already exists`.** The pooled connection string is missing
`?pgbouncer=true`.

**A 504 on a report.** Hobby's function timeout. Either move to Pro or show a smaller report.
