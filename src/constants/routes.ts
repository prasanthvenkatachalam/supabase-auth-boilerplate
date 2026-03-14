export const ROUTES = {
  HOME: "/",
  AUTH: {
    LOGIN: "/auth/login",
    SIGN_UP: "/auth/sign-up",
    FORGOT_PASSWORD: "/auth/forgot-password",
    ERROR: "/auth/error",
    VERIFY_EMAIL: "/auth/verify-email",
    RESET_PASSWORD: "/auth/reset-password",
    CONFIRM: "/auth/confirm",
  },
  PROTECTED: "/protected",
} as const;

export type AppRoutes = typeof ROUTES;
