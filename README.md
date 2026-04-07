# Career Center Badge and Certificate System

This repo replaces the original single-page certificate generator with a fuller credential system that keeps the original coordinate-based certificate workflow and adds public e-badge pages, a searchable registry, a standalone generator page, and a password-protected admin dashboard.

## What it now does

- Keeps the original certificate behavior: enter a name and date, render them onto the PNG certificate background, preview it, and download the PDF.
- Keeps editable X/Y placement settings for the name and date, plus font family, font size, weight, color, alignment, and max width.
- Prefills the date with today in long format such as `April 7, 2026`, but still lets you change it.
- Adds a standalone generator page at `/generator/` that you can link to directly or embed in another site with an iframe.
- Lets the generator page create a public badge record, immediately return the final badge URL, and keep that record in the backend so it shows up in admin.
- Builds a formal public badge page that shows the badge image, recipient name, badge meaning, criteria, issuer, issue date, credential ID, Career Center link, and a certificate download.
- Marks issued badges as valid and never expiring.
- Builds a searchable registry page.
- Keeps a CSV index of badge links and file locations so you can always find everything later.
- Adds a password-protected admin dashboard for search, export, and badge management.

## The important hosting truth

The public badge creation workflow needs a live Node server.

That means there are **two different uses** for this repo:

### Use 1: Public Pages only
If you publish only the `docs/` folder to GitHub Pages, you will get:

- the public home page
- the public registry
- the public badge pages
- the standalone generator page layout

But GitHub Pages is static, so it **cannot** write new badge records, rebuild files, or update the admin index by itself.

### Use 2: Full working app
If you run `server.js` on a Node-capable host or on your own machine, you get the full system:

- `/generator/` can create new badge pages
- `/admin/` can search and manage all badges
- the backend writes new records into `data/`
- the public badge pages are generated into `docs/`

So the version I updated for you **does work the way you described**, but the live create-a-badge flow depends on running the Node app, not just uploading static files to GitHub Pages.

## Default admin access

The admin is protected by password.

Default password:

```text
*******
```

By default, the login page only asks for the password.

You can still override it later with `.env` if you want.

## Quick start

### 1. Optional: create `.env`

```bash
cp .env.example .env
```

Default `.env.example` values:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=spider#5
PORT=8787
```

### 2. Start the full app

```bash
node server.js
```

Open these in your browser:

```text
http://localhost:8787/generator/
http://localhost:8787/admin/login
```

## Your two main pages

### Standalone public generator page

```text
/generator/
```

This is the page that acts like the original simple tool, but now it also creates the public badge record.

What it does:

- asks for recipient name
- prefills today’s date in long format
- lets you change the date
- lets you choose a badge template
- previews the certificate using the saved X/Y coordinates
- creates the badge record in the backend
- gives you the final public badge URL
- lets you download the certificate PDF

### Password-protected admin page

```text
/admin/login
```

What it does:

- search badges by person, date, badge title, or credential ID
- open or copy badge links
- export the master CSV link file
- issue badges manually
- manage badge templates
- update site branding and URLs
- edit certificate coordinate settings

## Daily workflow

### Option A: Use the standalone generator page

1. Open `/generator/`.
2. Enter the recipient name.
3. Keep the prefilled date or edit it.
4. Choose the badge type.
5. Preview the certificate.
6. Click **Create badge and certificate**.
7. Copy or open the final public badge URL.

This writes the badge into the backend and makes it visible in admin automatically.

### Option B: Use the admin issue form

1. Log in at `/admin/login`.
2. Open **Issue badge**.
3. Select a badge template.
4. Enter the recipient name.
5. Confirm or edit the date.
6. Submit.

That uses the same backend and updates the same registry and CSV files.

## Where the generated badge records live

### Private/backend source files

- `data/badges.json` — master list of all issued badges
- `data/badge-links.csv` — easy export of all badge URLs and file paths
- `data/badge-catalog.json` — reusable badge templates
- `data/certificate-template.json` — certificate X/Y and font settings
- `data/site-config.json` — organization and public site settings

### Generated public files

- `docs/generator/index.html` — standalone public generator page
- `docs/index.html` — public landing page
- `docs/registry/index.html` — searchable public registry
- `docs/badges/<badge-slug>/index.html` — public badge verification page
- `docs/badges/<badge-slug>/details.json` — metadata for that badge
- `docs/data/badges.json` — public registry data feed
- `docs/data/badge-links.csv` — public CSV copy

## Keeping the original certificate behavior

The certificate still uses the same concept as the original project:

- background image file
- text drawn directly onto the canvas
- PDF generated from the rendered PNG
- filename uses the entered name plus `_Certificate`

The defaults live here:

```text
data/certificate-template.json
```

## Changing X/Y coordinates and styling

Open **Admin → Settings** and update:

- Name X / Y
- Date X / Y
- name font family
- name font size
- name color
- date font family
- date font size
- date color
- alignment
- max width
- certificate background image path

Those settings drive:

- the standalone `/generator/` page
- every public badge page’s PDF download
- any certificate preview based on the shared template

## Before publishing publicly

Update your real organization values in:

```text
data/site-config.json
```

Most important field:

```text
publicSiteUrl
```

Example:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME
```

Once that is set, generated badge pages will use the full public URL.

## Rebuild manually

If you edit the JSON files directly, rebuild the public site with:

```bash
node build-site.js
```

## Embedding the generator page

Because `/generator/` is its own full page, you can embed it in another site with an iframe.

Just remember: the embedded page must still be served from the Node app if you want the **Create badge and certificate** button to write new badge files.

## Clean starting state

This package is delivered with:

- one default badge template
- no issued badge records yet
- admin password set to `spider#5`
- standalone generator page included
