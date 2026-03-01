/** Redis pub/sub channels to subscribe to (must match exit-manager + token-launcher) */
export const REDIS_CHANNELS = {
  TOKEN_LAUNCHED: "token:launched",
  TOKEN_EXIT: "token:exit",
  TOKEN_COMPLETED: "token:completed",
  TOKEN_EMERGENCY: "token:emergency",
} as const;

/** pump.fun token page base URL */
export const PUMP_FUN_URL = "https://pump.fun";

/** Daily report schedule: midnight KST (15:00 UTC previous day) */
export const DAILY_REPORT_HOUR_UTC = 15;

/** Daily report interval check (every 60 seconds) */
export const DAILY_REPORT_CHECK_MS = 60_000;
