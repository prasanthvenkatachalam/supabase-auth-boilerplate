import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Invalid email address").trim().toLowerCase(),
  password: z.string().min(1, "Password is required"),
  captchaToken: z.string().min(1, "Please complete the captcha"),
});

export const signUpSchema = z
  .object({
    email: z.email("Invalid email address").trim().toLowerCase(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100, "Password must be less than 100 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
    captchaToken: z.string().min(1, "Please complete the captcha"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const safeRedirectTo = z
  .string()
  .optional()
  .transform((val) => (val?.trim() === "" ? undefined : val?.trim()))
  .refine(
    (val) =>
      val === undefined ||
      (val.startsWith("/") && !val.startsWith("//") && !val.includes("://")) ||
      val.startsWith("http://") ||
      val.startsWith("https://"),
    { message: "redirectTo must be a relative path or https URL" },
  );

export const forgotPasswordSchema = z.object({
  email: z.email("Invalid email address").trim().toLowerCase(),
  captchaToken: z.string().min(1, "Please complete the captcha"),
  redirectTo: safeRedirectTo,
});

export const updatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100, "Password must be less than 100 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
    captchaToken: z.string().min(1, "Please complete the captcha"),
    code: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
