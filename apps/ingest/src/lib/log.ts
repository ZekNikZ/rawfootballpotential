import pino from "pino";

export type Logger = pino.Logger;

export function createLogger(level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({ level, base: undefined });
}

/** Shared default logger for CLIs and jobs. */
export const log: Logger = createLogger();
