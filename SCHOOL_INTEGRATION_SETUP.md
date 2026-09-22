# School integration setup

The application code is ready for Google Workspace sign-in, protected Google Drive evidence storage and direct iSAMS pupil synchronisation. A school administrator must supply and approve the real service credentials before real pupil data can be used.

Never paste service-role keys, Google client secrets, refresh tokens or iSAMS API keys into `index.html`, `config.js`, GitHub files or support messages.

## 1. Create the Supabase backend

1. Create a school-owned Supabase project in the school's approved region.
2. Copy the project reference from the dashboard URL: `https://supabase.com/dashboard/project/<project-reference>`.
3. Add these GitHub repository settings for the manual backend deployment:
   - Variable `SUPABASE_PROJECT_ID` — the project reference.
   - Secret `SUPABASE_ACCESS_TOKEN` — created in the school administrator's Supabase account settings.
   - Secret `SUPABASE_DB_PASSWORD` — the project database password.
4. Open **Actions > Deploy Supabase backend > Run workflow**. Keep both deployment choices selected. This applies the timestamped files in `supabase/migrations` and deploys every Edge Function.
5. Alternatively, use the Supabase CLI locally: copy `.env.example` to `.env`, copy `supabase/functions/.env.example` to `supabase/functions/.env`, then use the `supabase:*` commands in `package.json`.
6. In **Authentication > URL Configuration**, add:
   - `https://markstevengray95-star.github.io/EAL/`
   - `http://localhost:3000` and `http://127.0.0.1:3000` when testing locally
7. In **Authentication > Providers > Google**, enable Google and enter the school-owned OAuth client details.
8. In Google Cloud, add the Supabase callback shown by the provider screen as an authorised redirect URI.

`supabase/config.toml` contains the safe local ports, Google provider placeholders, exact redirect URLs and per-function authentication settings. It contains no private credentials.

## 2. Configure first login

Set these Supabase Edge Function secrets:

```text
AUTH_ALLOWED_EMAIL_DOMAIN=adcoteschool.co.uk
APP_ALLOWED_ORIGINS=https://markstevengray95-star.github.io,http://localhost:3000
BOOTSTRAP_ADMIN_EMAIL=mgray@adcoteschool.co.uk
BOOTSTRAP_SCHOOL_NAME=Adcote School for Girls
```

The first successful sign-in by `BOOTSTRAP_ADMIN_EMAIL` creates the school record and the first administrator membership. Other staff sign in once, then the administrator grants their role from **Integration Centre > Manage staff roles**.

## 3. Deploy the server functions

The manual GitHub workflow deploys all five functions together. For a local CLI deployment, use:

```bash
npm run supabase:deploy:functions -- --project-ref YOUR_PROJECT_REFERENCE
```

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. The real service-role key must remain server-side.

## 4. Google Drive evidence storage

Create a school-owned Google OAuth application with Drive access and an approved refresh token. Create a dedicated Drive or Shared Drive folder for EAL evidence, then set:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_FOLDER_ID=...
```

The configured Google account must be able to create files and folders in that destination. The app verifies the folder before reporting **Connected**. Uploads are organised into school and pupil-ID subfolders. It does not make files public.

## 5. Direct iSAMS sync

Ask the school's iSAMS administrator or iSAMS support to enable the approved pupil-data API/report and provide its exact endpoint and authentication method. The enabled response must include a stable pupil ID and pupil name. DOB, year, form, admission date, first language and attendance should be enabled where the school approves them.

Set:

```text
ISAMS_STUDENTS_URL=https://YOUR-ISAMS-ENDPOINT
ISAMS_API_KEY=...
ISAMS_AUTH_MODE=query
ISAMS_API_KEY_PARAM=apiKey
ISAMS_HTTP_METHOD=GET
```

Alternative authentication values:

- `ISAMS_AUTH_MODE=bearer` sends `Authorization: Bearer ...`.
- `ISAMS_AUTH_MODE=header` uses `ISAMS_API_KEY_HEADER` (default `X-API-Key`).
- `ISAMS_RECORD_PATH` can identify a nested pupil array, for example `iSAMS.Pupils.Pupil`, when automatic detection is not sufficient.

The parser accepts JSON or XML and maps common iSAMS pupil field names. Use **Test safely** first: it returns counts and field coverage without returning pupil names to the screen. **Sync pupils now** then updates the protected core register and merges only MIS-owned fields into the EAL app. Professional EAL records are preserved.

For other MIS providers, keep using the provider-neutral adapter secrets `MIS_SYNC_URL` and `MIS_API_TOKEN` described in `MIS_ADAPTER_CONTRACT.md`.

## 6. Optional scheduled iSAMS refresh

Set `MIS_SCHEDULE_SECRET` and `ISAMS_SCHOOL_ID`, then create a daily Supabase scheduled Edge Function call to `mis-sync` with:

- method: `POST`
- header: `x-eal-sync-secret: <MIS_SCHEDULE_SECRET>`
- body: `{"provider":"iSAMS","action":"sync","schoolId":"<school UUID>"}`

Keep that secret only in the scheduler/Supabase secret store. Scheduled runs refresh `students_core`; staff receive the latest MIS-owned fields when they load central data.

## 7. Configure the GitHub Pages app

Add these repository settings:

Repository variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SCHOOL_EMAIL_DOMAIN=adcoteschool.co.uk
SCHOOL_NAME=Adcote School for Girls
REQUIRE_SIGN_IN=true
```

Repository Actions secret:

```text
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

The deployment workflow generates `config.js` during deployment. The file contains only public browser configuration. If the variables are absent, the site remains in fictional demo mode rather than locking users out.

After adding these settings, rerun **Deploy EAL Progress Hub** so the live website receives the public project URL and browser key.

## 8. Final checks before real data

- Complete the school's DPIA/data-protection review.
- Confirm the school domain restriction and role permissions.
- Test sign-in with an authorised and an unauthorised account.
- Run the iSAMS safe test with fictional/test records first.
- Verify Drive uploads remain private and open only for authorised school staff.
- Confirm retention, deletion, backup and incident procedures.
- Only then move from fictional data to real pupil records.
