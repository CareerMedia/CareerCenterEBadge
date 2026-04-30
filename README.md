# CSUN Career Center E-Badges

This repo turns the original certificate generator into a fuller badge platform while keeping the same coordinate-based certificate workflow.

It now includes:
- a standalone generator page at `/generator/`
- formal public badge verification pages
- a password-protected home page and badge registry
- a password-protected admin dashboard
- CSV and JSON records so every generated badge link can always be found later

## What is already configured

Default branding and content now match your latest request:
- System name: `CSUN Career Center E-Badges`
- Badge title: `Career Champion`
- Issuer: `CSUN Career Center`
- Career Center website: `https://csun.edu/career`
- Issuer website: `https://csun.edu`
- Support email: `career.center@csun.edu`
- Accent color: `#d22030`
- Admin password: `spider#5`
- Public directory password: `spider#5`

## What the app does

### 1. Standalone generator page
Path:

```text
/generator/
```

This is the page you can link to directly or embed elsewhere.

It:
- asks for the recipient name
- auto-fills today’s date in long format like `April 7, 2026`
- still lets the date be edited
- uses the saved X/Y certificate coordinates
- previews the certificate
- creates the badge record in the backend
- returns the final public badge URL
- lets the user download the certificate PDF named like `Name_Certificate.pdf`

The generator page was updated to:
- remove the back-to-home button
- remove the open-registry button
- remove the footer

### 2. Public badge verification pages
Each issued badge gets its own public page in:

```text
docs/badges/<badge-slug>/index.html
```

Each badge page shows:
- badge image
- recipient name
- badge title
- meaning behind the badge
- eligibility / criteria
- issuer
- issue date
- credential ID
- career center link
- certificate download
- valid / never expires status

The badge page was updated to:
- remove the generate-another-credential link
- remove the search-all-public-badges link
- remove the return-home link
- remove the footer menus

### 3. Protected home page and protected registry
Paths:

```text
/
/registry/
```

These are protected with the password:

```text
spider#5
```

The same password also protects the searchable registry data feed routes used by the home page and registry.

### 4. Admin dashboard
Path:

```text
/admin/login
```

The admin dashboard is password-only and uses:

```text
spider#5
```

From admin you can:
- issue badges manually
- search awardees
- copy badge links
- export the master CSV
- manage badge templates
- update certificate coordinates and text styling
- update site settings
- configure **Email (Brevo)** so awardees receive an automatic message when a badge is issued (including bulk issue)

### Automatic award emails (Brevo)

Path: `/admin/email`

Uses Brevo’s transactional API: `POST https://api.brevo.com/v3/smtp/email` with the `api-key` header and JSON body (`sender`, `to`, `subject`, `htmlContent`, `textContent`). See [Brevo: Send a transactional email](https://developers.brevo.com/reference/send-transac-email).

1. In Brevo, verify a **sender** address under **Senders**, then enter that address as **Sender email** on the Email tab.
2. Under **SMTP & API** → **API keys**, create a key allowed to send transactional mail. Paste it into **Brevo API key**, or set the host variable **`BREVO_API_KEY`** (it overrides a saved key when present).
3. Turn on **Send award email automatically**, save, and set **Public site URL** on Settings so badge links in emails are full `https://` URLs.

**Security:** API keys saved in `data/email-config.json` sync to GitHub when persistence is enabled. Prefer `BREVO_API_KEY` on Render (or another host) if you do not want the key in the data branch.

## Where your generated links and records live

Backend source files:
- `data/badges.json` — master record of all issued badges
- `data/badge-links.csv` — exportable list of all badge links and file paths
- `data/badge-catalog.json` — badge template definitions
- `data/certificate-template.json` — X/Y coordinates and certificate text settings
- `data/site-config.json` — global site branding and URLs
- `data/email-config.json` — Brevo / automatic award email settings (persisted separately so they survive deploys and stay synced on the GitHub data branch)

Generated public files:
- `docs/index.html`
- `docs/registry/index.html`
- `docs/generator/index.html`
- `docs/badges/<badge-slug>/index.html`
- `docs/badges/<badge-slug>/details.json`
- `docs/data/badges.json`
- `docs/data/badge-links.csv`

## Render deployment

This project is meant to run as a Node app on Render so the generator and admin can write badge records.

Use:

```text
Build Command: npm install
Start Command: node server.js
```

## Local run

```bash
node server.js
```

Then open:

```text
http://localhost:8787/generator/
http://localhost:8787/admin/login
http://localhost:8787/
```

## Environment file

`.env.example` already matches the current password setup:

```text
ADMIN_PASSWORD=spider#5
PUBLIC_PASSWORD=spider#5
PORT=8787
```

## Important after Render gives you a live URL

Update this field in:

```text
data/site-config.json
```

Set:

```text
publicSiteUrl
```

to your real Render URL, for example:

```text
https://your-app.onrender.com
```

That makes newly generated badge pages use the correct full public link.

## Delivered state

This package is clean and ready to upload:
- one default badge template: `Career Champion`
- no issued badge records yet
- admin password set
- public directory password set
- updated CSUN branding and styling included


## Preventing badge loss on Render redeploys

Render deploys start from your GitHub repo, so issued badges will disappear unless the app syncs its badge data back to GitHub. This build now supports a dedicated persistence branch for that.

Set these environment variables in Render:

- `GITHUB_TOKEN` — a GitHub personal access token with repository contents write access
- `GITHUB_REPO` — your repo in `owner/name` format
- `GITHUB_DATA_BRANCH` — optional, defaults to `badge-data`
- `GITHUB_COMMIT_NAME` — optional commit author name
- `GITHUB_COMMIT_EMAIL` — optional commit author email

Recommended setup:

- Keep your app code on `main`
- Let the app store badges, settings, and templates on `badge-data`
- Do **not** connect Render auto-deploys to `badge-data`

With that setup, generated badges persist across redeploys and only disappear if an admin deletes them.
