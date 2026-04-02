import type { RuntimeConfig } from "../config/env";

type JsonRecord = Record<string, unknown>;
type LogLevel = RuntimeConfig["logLevel"];

const LOG_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function shouldLog(config: RuntimeConfig, level: LogLevel): boolean {
  return LOG_ORDER[level] >= LOG_ORDER[config.logLevel];
}

function writeLog(level: LogLevel, config: RuntimeConfig, message: string, fields: JsonRecord = {}): void {
  if (!shouldLog(config, level)) {
    return;
  }

  const record = {
    ts: new Date().toISOString(),
    level,
    app: config.appName,
    env: config.appEnv,
    msg: message,
    ...fields
  };

  console.log(JSON.stringify(record));
}

export function logDebug(config: RuntimeConfig, message: string, fields?: JsonRecord): void {
  writeLog("debug", config, message, fields);
}

export function logInfo(config: RuntimeConfig, message: string, fields?: JsonRecord): void {
  writeLog("info", config, message, fields);
}

export function logWarn(config: RuntimeConfig, message: string, fields?: JsonRecord): void {
  writeLog("warn", config, message, fields);
}

export function logError(config: RuntimeConfig, message: string, fields?: JsonRecord): void {
  writeLog("error", config, message, fields);
}

export function captureError(config: RuntimeConfig, error: unknown, fields: JsonRecord = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));

  logError(config, "Unhandled error", {
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
    ...fields
  });

  if (config.errorSinkDsn) {
    logInfo(config, "Error sink configured", { sink: "ERROR_SINK_DSN" });
  }
}
