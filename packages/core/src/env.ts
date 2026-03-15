/**
 * Zod-based environment variable validation.
 * Matches the pattern used in ragen-worker and ragen-vault.
 */

import { z } from "zod";

/**
 * Validate environment variables against a Zod schema.
 * Returns parsed & typed env or exits the process on failure.
 */
export function validateEnvVars<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error("Environment validation failed:");
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

/**
 * Simple string-list validation (for backward compat with Python pattern).
 * Exits the process if any required vars are missing.
 */
export function validateEnv(required: string[]): void {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
}
