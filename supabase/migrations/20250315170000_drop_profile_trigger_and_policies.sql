-- Remove trigger-based profile creation: profile is created in the signup API route.
-- Keeps email_verified flow (set_profile_email_verified RPC, verify-email/verify-otp) unchanged.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP POLICY IF EXISTS "Allow trigger to insert profile on signup" ON public.profiles;
DROP POLICY IF EXISTS "Allow auth service to insert profile on signup" ON public.profiles;
