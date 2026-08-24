/**
 * Structured JSON logger with built-in redaction.
 *
 * Outputs machine-readable JSON lines with correlation context, log level,
 * timestamp, and service identifiers. All payloads pass through the redactor
 * before emission to prevent secrets and PII from leaking into log stores.
 */
import type { CorrelationId, Environment } from "@counter/domain";
import { redactObject } from "./redaction.js";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
});

export interface LogContext {
  readonly correlationId?: CorrelationId;
  readonly environment?: Environment;
  readonly service?: string;
  readonly scope?: string;
}

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly correlationId?: string;
  readonly environment?: string;
  readonly service?: string;
  readonly scope?: string;
  readonly data?: unknown;
  readonly error?: { readonly message: string; readonly stack?: string | undefined };
}

export interface LogWriter {
  write(entry: LogEntry): void;
}

/**
 * Default log writer that outputs to stdout as JSON lines.
 */
export const stdoutLogWriter: LogWriter = Object.freeze({
  write(entry: LogEntry): void {
    process.stdout.write(JSON.stringify(entry) + "\n");
  },
});

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly context: LogContext;
  readonly writer?: LogWriter;
}

export interface Logger {
  readonly trace: (message: string, data?: Record<string, unknown>) => void;
  readonly debug: (message: string, data?: Record<string, unknown>) => void;
  readonly info: (message: string, data?: Record<string, unknown>) => void;
  readonly warn: (message: string, data?: Record<string, unknown>) => void;
  readonly error: (message: string, data?: Record<string, unknown>, err?: Error) => void;
  readonly fatal: (message: string, data?: Record<string, unknown>, err?: Error) => void;
  readonly child: (childContext: Partial<LogContext>) => Logger;
}

/**
 * Creates a structured logger that redacts sensitive data from all log output.
 */
export function createLogger(options: LoggerOptions): Logger {
  const { level, context, writer = stdoutLogWriter } = options;
  const minSeverity = LOG_LEVEL_SEVERITY[level];

  function shouldLog(entryLevel: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[entryLevel] >= minSeverity;
  }

  function emit(
    entryLevel: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    err?: Error,
  ): void {
    if (!shouldLog(entryLevel)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message,
      ...(context.correlationId !== undefined && { correlationId: context.correlationId }),
      ...(context.environment !== undefined && { environment: context.environment }),
      ...(context.service !== undefined && { service: context.service }),
      ...(context.scope !== undefined && { scope: context.scope }),
      ...(data !== undefined && { data: redactObject(data) }),
      ...(err !== undefined && {
        error: { message: err.message, stack: err.stack },
      }),
    };

    writer.write(entry);
  }

  const logger: Logger = Object.freeze({
    trace: (message: string, data?: Record<string, unknown>) => {
      emit("trace", message, data);
    },
    debug: (message: string, data?: Record<string, unknown>) => {
      emit("debug", message, data);
    },
    info: (message: string, data?: Record<string, unknown>) => {
      emit("info", message, data);
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      emit("warn", message, data);
    },
    error: (message: string, data?: Record<string, unknown>, err?: Error) => {
      emit("error", message, data, err);
    },
    fatal: (message: string, data?: Record<string, unknown>, err?: Error) => {
      emit("fatal", message, data, err);
    },
    child: (childContext: Partial<LogContext>) => {
      return createLogger({
        level,
        context: { ...context, ...childContext },
        writer,
      });
    },
  });

  return logger;
}
