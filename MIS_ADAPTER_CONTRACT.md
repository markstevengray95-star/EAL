# MIS Adapter Contract

The EAL Progress Hub does **not** place SIMS, Arbor, Bromcom or iSAMS credentials in the browser. The Supabase `mis-sync` Edge Function calls a school-approved server-side adapter.

## Request

The adapter receives an authenticated server-to-server POST request:

```json
{
  "provider": "SIMS | Arbor | Bromcom | iSAMS",
  "action": "sync",
  "schoolId": "UUID",
  "requestedBy": "AUTH_USER_UUID"
}
```

The adapter URL and bearer token are stored as Supabase Edge Function secrets:

- `MIS_SYNC_URL`
- `MIS_API_TOKEN`

Provider-specific API keys, certificates, tenant IDs and secrets belong only in the adapter/server environment.

## Response

Return HTTP 200 with:

```json
{
  "students": [
    {
      "external_id": "MIS-12345",
      "name": "Example Student",
      "preferred_name": "Example",
      "dob": "2013-05-12",
      "year": "Year 8",
      "form": "8A",
      "admission_date": "2026-09-01",
      "first_language": "Arabic",
      "attendance_percent": 96.4
    }
  ]
}
```

Fields may be omitted when the source system does not provide them.

## Matching behaviour

The web app matches a pupil in this order:

1. `external_id` when present.
2. Exact `name + dob` fallback.
3. Otherwise create a new EAL profile shell for staff review.

The sync must **not** automatically change EAL proficiency, reading age, interventions, targets, student voice or teacher observations. Those remain professional EAL records.

## Recommended provider adapter responsibilities

- Authenticate to the provider using its approved server-side method.
- Request only the minimum pupil fields required.
- Normalize provider-specific field names into the response contract above.
- Handle pagination and rate limits.
- Validate date formats as `YYYY-MM-DD`.
- Never return provider access tokens to the browser.
- Log provider errors without logging unnecessary pupil data.
- Support a dry-run/test mode before production rollout.
