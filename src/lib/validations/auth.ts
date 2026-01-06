import { z } from "zod";
import { EMAIL_REGEX, PASSWORD_REGEX } from "@/constants/regex";

export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .regex(EMAIL_REGEX, "Invalid email format");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(
    PASSWORD_REGEX,
    "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
  );

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"), // Don't enforce regex on login, just presence
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
// .refine((data) => data.password === data.confirmPassword, {
//   message: "Passwords do not match",
//   path: ["confirmPassword"],
// }); 
// Keeping it simple for now to match service, but can extend for UI forms.

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
