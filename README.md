# 🪑 Rental Manager

A simple web app to manage rental bookings (chairs, tables, coolers — or anything you configure) across a configurable date range. Tracks inventory, calculates costs, and supports pickup or delivery.

## Project structure

```
chair-booking/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    └── App.jsx
```

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Deploy options

### Option A — Vercel (easiest for static apps)
1. Push the project to GitHub.
2. Go to [vercel.com](https://vercel.com), click **New Project**, import the repo.
3. Vercel auto-detects Vite. Click **Deploy**.
4. You'll get a public `*.vercel.app` URL.

### Option B — Netlify
1. Push to GitHub.
2. On [netlify.com](https://netlify.com): **Add new site** → **Import from Git** → pick the repo.
3. Build command: `npm run build`. Publish directory: `dist`.
4. Click **Deploy**.

### Option C — Replit
1. Create a new Repl using the **React (Vite)** template.
2. Replace the default files with the ones from this folder (keep the structure above).
3. In the Shell: `npm install` then `npm run dev`.
4. Click **Deploy** in the top bar to get a public URL.

> **Note:** Vercel and Netlify are usually faster and more reliable than Replit for static Vite apps. Pick Replit if you also want an in-browser editor for collaborators.

## Data storage

Bookings and settings are saved in the browser's `localStorage`:
- `rentalpro_bookings_v1` — all bookings
- `rentalpro_settings_v1` — date range and inventory items

Data persists per-device, per-browser. **Clearing browser data will erase bookings.** For multi-device sync, you'd plug in a backend (e.g. [Supabase](https://supabase.com), Firebase, or a small Node API).

The CSV export (Bookings tab → **Export CSV**) is a good way to keep an off-device backup.

## Features

- ✅ Configurable date range (default: today + ~4 months)
- ✅ Configurable inventory items with name, price, and quantity
- ✅ Pickup or delivery with address + delivery fee
- ✅ Manual % discount with live cost preview
- ✅ Inventory guard — prevents overbooking on any date
- ✅ Calendar view with capacity color coding (per-day utilization)
- ✅ Bookings list with **search**, **service-type filter**, **date-range filter**
- ✅ **Edit** existing bookings (not just remove)
- ✅ **Confirm dialog** before deletion
- ✅ **CSV export** of the (filtered) bookings list
- ✅ Mobile and desktop layouts
