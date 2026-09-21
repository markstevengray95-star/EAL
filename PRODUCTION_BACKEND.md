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
