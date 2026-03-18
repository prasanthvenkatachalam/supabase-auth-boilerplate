export const RATE_LIMIT_CONFIG = {
  SIGNUP: {
    IP: {
      LIMIT: 3,
      WINDOW: "15 m",
      PREFIX: "ratelimit:signup:ip:",
    },
    EMAIL: {
      LIMIT: 5,
      WINDOW: "1 h",
      PREFIX: "ratelimit:signup:email:",
    },
    GLOBAL: {
      LIMIT: 100,
      WINDOW: "1 m",
      PREFIX: "ratelimit:signup:global:",
    },
  },
  LOGIN: {
    IP: {
      LIMIT: 10,
      WINDOW: "1 m",
      PREFIX: "ratelimit:login:ip:",
    },
    EMAIL: {
      LIMIT: 5,
      WINDOW: "1 m",
      PREFIX: "ratelimit:login:email:",
    },
    GLOBAL: {
      LIMIT: 1000,
      WINDOW: "1 m",
      PREFIX: "ratelimit:login:global:",
    },
  },
  RESEND_VERIFICATION: {
    IP: {
      LIMIT: 10,
      WINDOW: "1 h",
      PREFIX: "ratelimit:resend-verification:ip:",
    },
    EMAIL: {
      LIMIT: 3,
      WINDOW: "1 h",
      PREFIX: "ratelimit:resend-verification:email:",
    },
    GLOBAL: {
      LIMIT: 100,
      WINDOW: "1 h",
      PREFIX: "ratelimit:resend-verification:global:",
    },
  },
  FORGOT_PASSWORD: {
    IP: {
      LIMIT: 3,
      WINDOW: "15 m",
      PREFIX: "ratelimit:forgot-password:ip:",
    },
    EMAIL: {
      LIMIT: 5,
      WINDOW: "1 h",
      PREFIX: "ratelimit:forgot-password:email:",
    },
    GLOBAL: {
      LIMIT: 100,
      WINDOW: "1 m",
      PREFIX: "ratelimit:forgot-password:global:",
    },
  },
  RESET_PASSWORD: {
    IP: {
      LIMIT: 5,
      WINDOW: "15 m",
      PREFIX: "ratelimit:reset-password:ip:",
    },
    EMAIL: {
      LIMIT: 5,
      WINDOW: "1 h",
      PREFIX: "ratelimit:reset-password:email:",
    },
    GLOBAL: {
      LIMIT: 100,
      WINDOW: "1 m",
      PREFIX: "ratelimit:reset-password:global:",
    },
  },
  VERIFY_EMAIL: {
    IP: {
      LIMIT: 30,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-email:ip:",
    },
    GLOBAL: {
      LIMIT: 2000,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-email:global:",
    },
  },
  VERIFY_OTP: {
    IP: {
      LIMIT: 30,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-otp:ip:",
    },
    GLOBAL: {
      LIMIT: 2000,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-otp:global:",
    },
  },
  SET_RECOVERY_SESSION: {
    IP: {
      LIMIT: 20,
      WINDOW: "15 m",
      PREFIX: "ratelimit:set-recovery-session:ip:",
    },
    GLOBAL: {
      LIMIT: 1000,
      WINDOW: "15 m",
      PREFIX: "ratelimit:set-recovery-session:global:",
    },
  },
} as const;
