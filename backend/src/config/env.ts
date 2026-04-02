export type AppEnv = "dev" | "staging" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Env {
  APP_NAME: string;
  APP_ENV: AppEnv;
  LOG_LEVEL: LogLevel;
  OBS_SAMPLE_RATE: string;
  ERROR_SINK_DSN?: string;
}

export interface RuntimeConfig {
  appName: string;
  appEnv: AppEnv;
  logLevel: LogLevel;
  observabilitySampleRate: number;
  errorSinkDsn?: string;
}

const VALID_ENV: ReadonlySet<string> = new Set(["dev", "staging", "production"]);
const VALID_LOG_LEVEL: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

function requireValue(name: keyof Env, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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

  return {
    appName,
    appEnv: appEnv as AppEnv,
    logLevel: logLevel as LogLevel,
    observabilitySampleRate: sampleRate,
    errorSinkDsn: env.ERROR_SINK_DSN?.trim() || undefined
  };
}
