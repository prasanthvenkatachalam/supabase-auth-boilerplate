export const ROUTES = {
  HOME: "/",
  AUTH: {
    LOGIN: "/auth/login",
    SIGN_UP: "/auth/sign-up",
    FORGOT_PASSWORD: "/auth/forgot-password",
    ERROR: "/auth/error",
  },
  PROTECTED: "/protected",
} as const;

export type AppRoutes = typeof ROUTES;
