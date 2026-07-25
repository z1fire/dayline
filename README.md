# Dayline

Dayline is a mobile-first daily time-block planner designed to run as an
installable Android PWA. Plans are stored privately in the browser using
IndexedDB and continue to work offline after the first visit.

## What it does

- plan activities as colored blocks on a single-day timeline
- move between dates and see planned/open time at a glance
- add, edit, complete, and delete blocks
- prevent accidental schedule overlaps
- install from Chrome on Android
- keep working without a network connection

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

## Deploy with GitHub Pages

1. Push the project to a GitHub repository whose default branch is `main`.
2. In the repository, open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` or run the “Deploy Dayline to GitHub Pages” workflow.

The included workflow calculates the repository base path, builds a static
export, and deploys it to Pages. No backend, account, or environment variables
are required.

## Useful commands

- `npm run dev` — start the live development site
- `npm run build` — verify the Sites-compatible production build
- `npm run build:pages` — create the static GitHub Pages build in `out`
- `npm test` — build and run the rendered HTML check
