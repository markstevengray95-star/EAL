# EAL Progress Hub

Whole-school EAL student progress and reading-age tracker for UK schools.

## What is included
- EAL coordinator dashboard and priority alerts
- Student profiles and searchable EAL register
- EAL proficiency tracking across eight language domains
- Reading-age history, chronological-age comparison and progress-rate calculations
- Targets, interventions, teacher observations and reviews
- Student progress timelines and printable student passports
- Cohort, language and data-quality analysis
- Parent-friendly reports and student voice
- Role selector, privacy mode, audit log and archive
- JSON backup/restore plus CSV export/import
- Fictional demo data and one-click demo reset

## Running the app
Open `index.html` in a browser or deploy this repository as a static site. No build step is required.

## Data and school integrations
The app starts in fictional demo mode when no school backend is configured. The repository now includes a production Supabase architecture with Google Workspace staff login, server-enforced roles, shared central data, direct configurable iSAMS sync, and protected Google Drive evidence storage/linking.

Real pupil data must only be used after the school-owned services and data-protection controls are configured. Follow `SCHOOL_INTEGRATION_SETUP.md`.

All demo pupils are fictional.

Deployment refresh: GitHub Pages enabled.

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/project?template=https://github.com/markstevengray95-star/EAL)

Use the button above to import this repository into Vercel and create a live deployment.
