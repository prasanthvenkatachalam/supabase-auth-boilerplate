# Schema pulled from Supabase (MCP)

This folder holds SQL that was **pulled from the linked Supabase project** using the Auth BoilerPlate MCP. The project’s main migration history lives in `../migrations/`.

## Contents

- **`current_schema.sql`** – Current public schema as introspected from the remote DB: `profiles` table, RLS policies, and the functions/triggers used for email verification and `updated_at`. Safe to run against an empty DB (after `auth.users` exists) to reproduce the current state.

## Remote vs local migrations

- **Remote (Supabase):** 19 migration records are applied (names/versions only; Supabase does not store migration SQL).
- **Local:** `supabase/migrations/` has 8 migration files that implement the same logical changes (with different timestamps).

The MCP **cannot** return the original SQL of applied migrations; it only lists applied migration names/versions. So:

- Any “missing” early migrations (e.g. `create_profiles_table`, `create_user_sessions_table`, …) do not exist as downloadable SQL from Supabase.
- This folder provides the **current schema** (table, RLS, functions, triggers) as a single SQL file so the project has a copy of “what’s on Supabase” in the repo.

## When to use

- **Reference:** See the current remote schema without opening the dashboard.
- **Recovery:** Recreate the same schema elsewhere using `current_schema.sql` (e.g. new project or branch), as long as `auth.users` already exists for the `profiles` FK and the auth trigger.

Do **not** run `current_schema.sql` on a project that already has migrations applied; use the normal migration flow in `../migrations/` instead.
