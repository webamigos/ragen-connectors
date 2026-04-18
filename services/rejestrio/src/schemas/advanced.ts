/**
 * Endpoint 03: `GET /org/{id}/krs-rozdzialy/{rozdzial}` — advanced
 * KRS chapter data. We only request the `ogolny` chapter in phase 1.
 *
 * Real-world shape (confirmed against fixtures):
 *   - Populated: an object with chapter-specific fields.
 *   - Empty / wykreślone / no data: the literal `[]`.
 *
 * The union below accepts both; downstream code should `Array.isArray`
 * before reaching into fields.
 */
import { z } from "zod";

export const advancedResponseSchema = z.union([
  z.record(z.unknown()),
  z.array(z.unknown()),
]);

export type AdvancedResponse = z.infer<typeof advancedResponseSchema>;

/** True when the chapter has no data (API returned `[]`). */
export function isAdvancedEmpty(payload: AdvancedResponse): boolean {
  return Array.isArray(payload);
}
