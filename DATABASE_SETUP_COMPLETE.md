# Database Setup Complete

## Overview

The auth boilerplate uses a single **profiles** table in the public schema, linked to Supabase `auth.users`. When a user verifies their email (signup or email-change), `profiles.email_verified` is set to `true` by the app.

## Table: `profiles`

- **Purpose**: User profiles linked to Supabase `auth.users`
- **Features**: Auto-creation on signup (via database trigger), RLS, `email_verified` flag
- **Email verification**: When the user completes email verification (via `/api/auth/verify-otp` or `/api/auth/verify-email`) with type `signup` or `email`, the app updates `profiles.email_verified = true` for that user.

## Security

- **RLS**: Enabled on `profiles`; users can read/update their own row (e.g. `id = auth.uid()`).
- **Trigger**: Profile row is created automatically on signup (if your project has this trigger).

## TypeScript Types

- Types are maintained in `src/types/database.ts` (only `profiles` table).

## Migrations

- **`20250314120000_drop_unused_tables_and_functions.sql`**: Drops unused tables (`audit_logs`, `email_verifications`, `user_sessions`) and their related functions. Apply via Supabase Dashboard → SQL Editor or Supabase CLI if you had created those objects earlier.

## Environment Variables

Ensure `.env.local` has:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_supabase_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

**Security**: Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code or version control. Use only in server-side API routes.

## Testing

1. Test signup and email verification; confirm `profiles.email_verified` is set after verification.
2. Test password reset and login flows.

**Status**: Schema aligned with app (profiles only).
