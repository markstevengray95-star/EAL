# EAL Progress Hub - Production backend setup

The live GitHub Pages site can operate in local demo mode or connect to a Supabase project for shared school data.

## 1. Create the central database
1. Create a school-owned Supabase project in the appropriate approved region.
2. Run `supabase/schema.sql` in the SQL editor.
3. Sign in once through the EAL app, then add the first administrator to `school_memberships`.
4. Add other authorised staff with the minimum role they need.

The browser only stores the **project URL and public anon key**. Never put the Supabase service-role key, OAuth client secrets, Drive/OneDrive secrets or MIS API secrets in the web page.

## 2. Google / Microsoft school login
Configure providers in **Supabase Auth > Providers**:
- Google: configure the school Google OAuth app in Supabase.
- Microsoft: configure Azure/Microsoft Entra in Supabase using the Azure provider and restrict the tenant to the school where appropriate.
- Add the GitHub Pages URL as an allowed redirect URL.

The EAL app's Integration Centre then uses the configured provider for staff sign-in. Row-level security checks the signed-in user's school membership.

## 3. Shared central data
The current application uses a central JSONB school snapshot so the existing app can move away from browser-only storage without losing its feature set. Local storage remains a resilience/offline cache.

The repository also includes evidence metadata and integration logs as separate database tables. These can be normalised further later if required.

## 4. Drive / OneDrive evidence files
Deploy `supabase/functions/evidence-storage` as a Supabase Edge Function.

Provider secrets belong in Edge Function secrets/environment variables. The function can be extended or configured for your school's approved Google Drive or Microsoft Graph application. Do not place provider secrets in `index.html`.

## 5. MIS sync
Deploy `supabase/functions/mis-sync`.

Because SIMS, Arbor, Bromcom and iSAMS have different licensing, endpoints and authentication models, the function uses a secure server-side adapter URL. Configure the approved school/provider middleware endpoint and API token as Edge Function secrets.

Expected pupil fields returned to the web app:
`external_id, name, preferred_name, dob, year, form, admission_date, first_language, attendance_percent`.

## 6. Production checklist
- School-owned Supabase project
- Data-processing / DPIA approval as required by the school
- Google/Microsoft OAuth restricted to school staff
- RLS enabled and tested
- Minimum necessary staff permissions
- Provider secrets only on server-side functions
- Backups and retention policy agreed
- Test with fictional records before any real pupil data


## 7. Conflict-safe central sync
The repository now includes `supabase/functions/app-sync` plus `supabase/migrations/003_central_sync.sql`.

Apply the migration after `supabase/schema.sql`, then deploy the Edge Function:

```bash
supabase functions deploy app-sync
```

The web app saves through this function using a revision number. If another staff member saves a newer revision first, the app stops autosaving and shows a sync-conflict warning. Staff can download a local backup and load the latest central revision rather than silently overwriting another user's work.

The same save also mirrors essential pupil identity fields into `students_core` so the central database has queryable student records as well as the full application snapshot.

## 8. Core central tables
The backend contains:

- `schools` — school tenant record.
- `school_memberships` — signed-in staff and roles.
- `app_snapshots` — full school application state with revision control.
- `students_core` — normalised core pupil identity/MIS fields.
- `evidence_files` — Drive/OneDrive evidence metadata.
- `integration_connections` — non-secret connection metadata.
- `integration_sync_log` — MIS/storage sync history.
- `central_audit_log` — central data-save audit history.

Row-level security restricts reads to users who belong to the same school. Editing is further restricted by role.

## 9. Deploy the server functions
Deploy these Supabase Edge Functions after the database schema/migrations are applied:

```bash
supabase functions deploy app-sync
supabase functions deploy staff-admin
supabase functions deploy evidence-storage
supabase functions deploy mis-sync
```

Set provider credentials with Supabase secrets rather than putting them in the website.

For Drive:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- optional `GOOGLE_DRIVE_FOLDER_ID`

For OneDrive:
- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `ONEDRIVE_DRIVE_ID`
- optional `ONEDRIVE_BASE_PATH`

For MIS:
- `MIS_SYNC_URL`
- `MIS_API_TOKEN`

See `MIS_ADAPTER_CONTRACT.md` for the provider-neutral MIS payload.

## 10. What is live now vs what still needs school credentials
Already implemented in the repository:
- Central database schema and row-level security.
- Google/Microsoft sign-in flow through Supabase Auth.
- Conflict-safe shared central sync.
- Google Drive and OneDrive upload function.
- MIS sync function and provider-neutral contract.
- Integration Centre in the web app.
- Local/offline cache as a resilience layer.

Still requires school-owned configuration:
- Supabase project URL and public anon key.
- Google and/or Microsoft OAuth app configuration.
- Drive/OneDrive server-side credentials.
- An approved SIMS/Arbor/Bromcom/iSAMS API or middleware connection.
- Initial school and administrator membership setup.


## 11. Staff access administration
Deploy `supabase/functions/staff-admin`.

After the first school administrator has been bootstrapped in `school_memberships`, that administrator can manage central access from the EAL app's Integration Centre.

Supported roles:
- Administrator
- EAL Coordinator
- Teacher
- Senior Leadership
- Read only

For security, a staff member must sign in once with the configured school Google or Microsoft provider before an administrator can add their account by email. The browser never receives the service-role key.
