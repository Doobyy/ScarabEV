export type AppEnv = "dev" | "staging" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Env {
  APP_NAME: string;
  APP_ENV: AppEnv;
  LOG_LEVEL: LogLevel;
  OBS_SAMPLE_RATE: string;
  ERROR_SINK_DSN?: string;
  SESSION_COOKIE_NAME?: string;
  CSRF_COOKIE_NAME?: string;
  SESSION_TTL_SECONDS?: string;
  SESSION_ROTATION_SECONDS?: string;
  AUTH_RATE_LIMIT_WINDOW_SECONDS?: string;
  AUTH_RATE_LIMIT_PER_IP?: string;
  AUTH_RATE_LIMIT_PER_USER?: string;
  ADMIN_RATE_LIMIT_WINDOW_SECONDS?: string;
  ADMIN_RATE_LIMIT_PER_IP?: string;
  ADMIN_RATE_LIMIT_PER_USER?: string;
  DB?: D1Database;
}

export interface RuntimeConfig {
  appName: string;
  appEnv: AppEnv;
  logLevel: LogLevel;
  observabilitySampleRate: number;
  errorSinkDsn?: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionTtlSeconds: number;
  sessionRotationSeconds: number;
  authRateLimitWindowSeconds: number;
  authRateLimitPerIp: number;
  authRateLimitPerUser: number;
  adminRateLimitWindowSeconds: number;
  adminRateLimitPerIp: number;
  adminRateLimitPerUser: number;
}

const VALID_ENV: ReadonlySet<string> = new Set(["dev", "staging", "production"]);
const VALID_LOG_LEVEL: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

function requireValue(name: keyof Env, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseOptionalInt(name: keyof Env, value: string | undefined, fallback: number, min: number): number {
  if (!value || !value.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}. Received: ${value}`);
  }

  return parsed;
}

export function loadConfig(env: Env): RuntimeConfig {
  const appName = requireValue("APP_NAME", env.APP_NAME);
  const appEnv = requireValue("APP_ENV", env.APP_ENV);
  const logLevel = requireValue("LOG_LEVEL", env.LOG_LEVEL);
  const sampleRateRaw = requireValue("OBS_SAMPLE_RATE", env.OBS_SAMPLE_RATE);
  const sampleRate = Number(sampleRateRaw);

  if (!VALID_ENV.has(appEnv)) {
    throw new Error(`APP_ENV must be one of dev|staging|production. Received: ${appEnv}`);
  }

  if (!VALID_LOG_LEVEL.has(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of debug|info|warn|error. Received: ${logLevel}`);
  }

  if (Number.isNaN(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error(`OBS_SAMPLE_RATE must be a number between 0 and 1. Received: ${sampleRateRaw}`);
  }

  const sessionTtlSeconds = parseOptionalInt("SESSION_TTL_SECONDS", env.SESSION_TTL_SECONDS, 60 * 60 * 8, 300);
  const sessionRotationSeconds = parseOptionalInt(
    "SESSION_ROTATION_SECONDS",
    env.SESSION_ROTATION_SECONDS,
    60 * 30,
    60
  );
  const authRateLimitWindowSeconds = parseOptionalInt(
    "AUTH_RATE_LIMIT_WINDOW_SECONDS",
    env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    60 * 5,
    30
  );
  const authRateLimitPerIp = parseOptionalInt("AUTH_RATE_LIMIT_PER_IP", env.AUTH_RATE_LIMIT_PER_IP, 30, 1);
  const authRateLimitPerUser = parseOptionalInt("AUTH_RATE_LIMIT_PER_USER", env.AUTH_RATE_LIMIT_PER_USER, 15, 1);
  const adminRateLimitWindowSeconds = parseOptionalInt(
    "ADMIN_RATE_LIMIT_WINDOW_SECONDS",
    env.ADMIN_RATE_LIMIT_WINDOW_SECONDS,
    60,
    10
  );
  const adminRateLimitPerIp = parseOptionalInt("ADMIN_RATE_LIMIT_PER_IP", env.ADMIN_RATE_LIMIT_PER_IP, 240, 1);
  const adminRateLimitPerUser = parseOptionalInt("ADMIN_RATE_LIMIT_PER_USER", env.ADMIN_RATE_LIMIT_PER_USER, 120, 1);

  if (sessionRotationSeconds >= sessionTtlSeconds) {
    throw new Error("SESSION_ROTATION_SECONDS must be lower than SESSION_TTL_SECONDS");
  }

  return {
    appName,
    appEnv: appEnv as AppEnv,
    logLevel: logLevel as LogLevel,
    observabilitySampleRate: sampleRate,
    errorSinkDsn: env.ERROR_SINK_DSN?.trim() || undefined,
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || "scarabev_session",
    csrfCookieName: env.CSRF_COOKIE_NAME?.trim() || "scarabev_csrf",
    sessionTtlSeconds,
    sessionRotationSeconds,
    authRateLimitWindowSeconds,
    authRateLimitPerIp,
    authRateLimitPerUser,
    adminRateLimitWindowSeconds,
    adminRateLimitPerIp,
    adminRateLimitPerUser
  };
}
