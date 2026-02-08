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
} as const;
