import { createClient } from "@/utils/supabase/client";
import { 
  loginSchema, 
  signUpSchema,
  forgotPasswordSchema, 
  type LoginInput, 
  type SignUpInput, 
  type ForgotPasswordInput,
  type UpdatePasswordInput
} from "@/lib/validations/auth";

export const signInWithEmail = async (credentials: LoginInput) => {
  const supabase = createClient();
  const { email, password } = loginSchema.parse(credentials);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: {
      captchaToken: credentials.captchaToken,
    },
  });

  if (error) throw error;
  return data;
};

/**
 * Sign up with email using rate-limited API endpoint
 * 
 * This now calls our custom API route instead of directly calling Supabase.
 * Benefits:
 * 1. Rate limiting is enforced server-side
 * 2. IP tracking for abuse prevention
 * 3. Better error handling
 * 4. Automatic profile creation via database trigger
 * 
 * The API route (/api/auth/signup) handles:
 * - Multi-layer rate limiting (IP, email, global)
 * - Input validation
 * - Supabase authentication
 * - Profile creation (automatic via trigger)
 */
export const signUpWithEmail = async (credentials: SignUpInput) => {
  // Validate input before sending to API
  const { email, password } = signUpSchema.parse(credentials);

  // Call our API route instead of Supabase directly
  const response = await fetch("/api/auth/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();

  // Handle different error scenarios
  if (!response.ok) {
    // Rate limit error (429)
    if (response.status === 429) {
      const retryAfter = data.retryAfter || 900;
      const minutes = Math.ceil(retryAfter / 60);
      throw new Error(
        data.message || `Too many attempts. Please try again in ${minutes} minutes.`
      );
    }

    // Email already exists (409)
    if (response.status === 409) {
      throw new Error("An account with this email already exists. Please log in instead.");
    }

    // Validation error (400)
    if (response.status === 400) {
      throw new Error(data.message || "Invalid email or password format.");
    }

    // Generic error
    throw new Error(data.message || "Failed to create account. Please try again.");
  }

  return data;
};

export const resetPasswordForEmail = async (input: ForgotPasswordInput, redirectTo?: string) => {
  const supabase = createClient();
  const { email } = forgotPasswordSchema.parse(input);

  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) throw error;
  return data;
};

export const updatePassword = async (input: UpdatePasswordInput) => {
  const supabase = createClient();
  // We only send the password to supabase, confirmPassword was for UI validation
  const { password } = input; 

  const { data, error } = await supabase.auth.updateUser({
    password,
  });

  if (error) throw error;
  return data;
};

export const signOut = async () => {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

/**
 * Resend verification email
 * 
 * Calls the API route to resend verification email with rate limiting.
 */
export const resendVerificationEmail = async (email: string) => {
  const response = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  // Handle different error scenarios
  if (!response.ok) {
    // Rate limit error (429)
    if (response.status === 429) {
      const retryAfter = data.retryAfter || 3600;
      const minutes = Math.ceil(retryAfter / 60);
      throw new Error(
        data.message || `Too many resend requests. Please try again in ${minutes} minutes.`
      );
    }

    // Email already verified (409)
    if (response.status === 409) {
      throw new Error(data.message || "This email is already verified.");
    }

    // Validation error (400)
    if (response.status === 400) {
      throw new Error(data.message || "Invalid email address.");
    }

    // Generic error
    throw new Error(data.message || "Failed to resend verification email. Please try again.");
  }

  return data;
};
