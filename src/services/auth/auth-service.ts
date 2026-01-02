import { createClient } from "@/utils/supabase/client";
import { EMAIL_REGEX } from "@/constants/regex";
import { z } from "zod";

const authSchema = z.object({
  email: z.string().regex(EMAIL_REGEX, "Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type AuthCredentials = z.infer<typeof authSchema>;

export const signInWithEmail = async (credentials: AuthCredentials) => {
  const supabase = createClient();
  const { email, password } = authSchema.parse(credentials);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
};

export const signUpWithEmail = async (credentials: AuthCredentials) => {
  const supabase = createClient();
  const { email, password } = authSchema.parse(credentials);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;
  return data;
};
