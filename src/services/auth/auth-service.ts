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
  });

  if (error) throw error;
  return data;
};

export const signUpWithEmail = async (credentials: SignUpInput) => {
  const supabase = createClient();
  const { email, password } = signUpSchema.parse(credentials);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;
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
