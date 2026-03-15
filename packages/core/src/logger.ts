/**
 * Pino logger with OTEL hook — logs to console and forwards to OTLP collector.
 */

import pino from "pino";
import type { DestinationStream } from "pino";
import { otelLogger } from "./otel-logger.js";

const isProduction = process.env.NODE_ENV === "production";

const pinoLevelToOtel: Record<number, keyof typeof otelLogger> = {
  30: "info",
  40: "warn",
  50: "error",
  60: "error",
};

const logger = pino(
  {
    level: isProduction ? "info" : "debug",
    base: {
      pid: process.pid,
      hostname: process.env.HOSTNAME,
    },
    serializers: { err: pino.stdSerializers.err },
    hooks: {
      logMethod(inputArgs, method, level) {
        const otelMethod = pinoLevelToOtel[level];
        if (otelMethod) {
          let message: string | undefined;
          let attrs: Record<string, unknown> | undefined;

          if (typeof inputArgs[0] === "string") {
            message = inputArgs[0];
          } else if (
            typeof inputArgs[0] === "object" &&
            inputArgs[0] !== null
          ) {
            attrs = inputArgs[0] as Record<string, unknown>;
            if (typeof inputArgs[1] === "string") {
              message = inputArgs[1];
            }
          }

          if (typeof inputArgs[0] === "object" && inputArgs[0] instanceof Error) {
            const err = inputArgs[0];
            attrs = {
              ...attrs,
              "err.type": err.constructor.name || "Error",
              "err.message": err.message,
              ...(err.stack ? { "err.stacktrace": err.stack } : {}),
            };
            if (!message) {
              message = err.message;
            }
          }

          if (!message && attrs) {
            message = Object.keys(attrs).join(", ");
          }

          if (message) {
            try {
              otelLogger[otelMethod](message, attrs);
            } catch {
              // Swallow OTEL errors to avoid breaking primary logging
            }
          }
        }

        return method.apply(this, inputArgs as Parameters<typeof method>);
      },
    },
  },
  isProduction
    ? undefined
    : (await import("pino-pretty").then(
        (m) => m.default({ colorize: true }) as DestinationStream,
      )),
);

export { logger };
