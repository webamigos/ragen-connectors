/**
 * OpenTelemetry, from `@ragen-connectors/core`.
 *
 * Imported for its side effect at the top of `index.ts`, where the ordering
 * matters: OTEL patches modules as they are imported, so anything imported
 * above it is never instrumented. Re-exporting through this file keeps that
 * guarantee — ESM evaluates a module's dependencies before the imports that
 * follow it.
 */

export { shutdownOtel } from "@ragen-connectors/core/instrument";
