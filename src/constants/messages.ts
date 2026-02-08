export const ERROR_MESSAGES = {
  RATE_LIMIT: {
    GLOBAL: "System is experiencing high load. Please try again in a few minutes.",
    IP: "Too many attempts from your network. Please try again later.",
    EMAIL: "Too many attempts with this email. Please try again later.",
    GENERIC: "Rate limit exceeded. Please try again later.",
  },
  VALIDATION: {
    INVALID_INPUT: "Invalid input",
  },
  AUTH: {
    EMAIL_EXISTS: "An account with this email already exists. Please log in or use a different email.",
    WEAK_PASSWORD: "Password is too weak.",
    SIGNUP_FAILED: "Signup failed",
    INTERNAL_ERROR: "An unexpected error occurred. Please try again later.",
  },
} as const;

export const SUCCESS_MESSAGES = {
  SIGNUP: {
    CREATED: "Account created successfully. Please check your email to verify your account.",
  },
  FORGOT_PASSWORD: {
    EMAIL_SENT: "If an account exists with this email, you will receive a password reset link.",
  },
} as const;
