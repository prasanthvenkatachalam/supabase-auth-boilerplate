# Database Reference

This document covers the database schema, security policies, triggers, and TypeScript types used by the auth boilerplate.

---

## Table: `profiles`

The boilerplate uses a single public table, `profiles`, which mirrors each `auth.users` row and extends it with app-level fields.

### Schema

```sql
CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT UNIQUE NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Key Design Decisions

| Field | Why |
|---|---|
| `id` references `auth.users(id)` | One-to-one link; profile is deleted when the auth user is deleted (`ON DELETE CASCADE`) |
| `email_verified` | The app sets this to `true` after the user completes email verification via `/api/auth/verify-otp` or `/api/auth/verify-email` (type `signup` or `email`). Supabase's own `email_confirmed_at` is not always queryable from client-side code, so we mirror the state here. |
| `updated_at` | Auto-updated by a trigger on every row modification |

---

## Row Level Security (RLS)

RLS is **enabled** on `profiles`. Users can only read and update their own row.

```sql
-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
```

> **Server-side admin access**: The `supabaseAdmin` client (using `SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS. This is used in API routes that need to update profiles on behalf of a user (e.g. setting `email_verified`).

---

## Triggers

### 1. Auto-create profile on signup

Fires immediately after a new row is inserted into `auth.users`. Creates the corresponding `profiles` row.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

### 2. Auto-update `updated_at`

Fires before any update to a `profiles` row to keep `updated_at` current.

```sql
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
```

---

## Migrations

| Migration | Description |
|---|---|
| `create_profiles_table` | Creates `profiles`, RLS policies, and both triggers |
| `20250314120000_drop_unused_tables_and_functions.sql` | Drops legacy tables (`audit_logs`, `email_verifications`, `user_sessions`) and their related functions — apply if you had created them in an earlier version of this boilerplate |

To apply a migration manually, paste it into the **Supabase Dashboard → SQL Editor** or use the Supabase CLI:

```bash
supabase db push
```

---

## TypeScript Types

Types for the `profiles` table are maintained in `src/types/database.ts`. After any schema change, regenerate them:

```bash
supabase gen types typescript --project-id your-project-ref > src/types/database.ts
```

Or use the Supabase MCP tool if configured in your editor.

---

## Environment Variables

The following Supabase-related env vars are required:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_publishable_key

# Server-side only — never expose in client code or version control
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## Verifying Setup

```sql
-- Confirm profiles table exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles';

-- Confirm triggers exist
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public';

-- Confirm RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'profiles';
```
