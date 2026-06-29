# ChlorTainer Inventory System

Real-time inventory tracking with barcode scanning for ChlorTainer components.

**Stack:** React + Vite · Supabase (PostgreSQL + Realtime) · Netlify

---

## Setup Order

### 1 — GitHub

1. Create a new repository at github.com (e.g. `chlortainer-inventory`)
2. Clone it locally:
   ```bash
   git clone https://github.com/YOUR_ORG/chlortainer-inventory.git
   cd chlortainer-inventory
   ```
3. Copy all project files into this folder
4. Push to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

---

### 2 — Supabase

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `chlortainer-inventory`, pick a region, set a password
3. Wait ~2 minutes for provisioning
4. Go to **Database → SQL Editor → New Query**
5. Paste and run the contents of `supabase-setup.sql` (in this repo)
6. Go to **Project Settings → API** and copy:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon public key** → `eyJ...`

---

### 3 — Netlify

1. Go to [netlify.com](https://netlify.com) → Add new site → Import from Git
2. Connect your GitHub account and select the `chlortainer-inventory` repo
3. Build settings (auto-detected from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Before deploying, go to **Site Settings → Environment Variables** and add:
   ```
   VITE_SUPABASE_URL        = https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY   = eyJ...
   ```
5. Click **Deploy site**

Netlify will build and deploy automatically. Every `git push` to `main` triggers a redeploy.

---

## Local Development

```bash
# Install dependencies
npm install

# Create local env file
cp .env.example .env
# Edit .env and paste your Supabase URL and anon key

# Start dev server
npm run dev
# Open http://localhost:5173
```

---

## Project Structure

```
chlortainer-inventory/
├── src/
│   ├── main.jsx          # React entry point
│   ├── App.jsx           # Full application
│   └── supabase.js       # Supabase client (reads env vars)
├── index.html
├── vite.config.js
├── netlify.toml          # Netlify build + redirect config
├── package.json
├── .env.example          # Template — copy to .env locally
├── .gitignore            # Keeps .env and node_modules out of git
└── supabase-setup.sql    # Run once in Supabase SQL Editor
```

---

## Features

- **Barcode Scanner** — iPhone camera scanning via ZXing-js (no app install needed)
- **Parts Catalog** — Internal SKUs linked to multiple manufacturer suppliers
- **Inventory Tracking** — Stock levels, minimums, replenishment recommendations
- **License Plates** — Shipment labels linking multiple SKUs
- **Real-time Sync** — All users see live updates via Supabase Realtime
