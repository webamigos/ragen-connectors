/**
 * Cache TTLs per data class. Informed by how often each upstream
 * data class changes in practice (see docs/pl-registry-mcp.md in
 * ragen-app for the rationale).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const CACHE_TTL_MS = {
  /** Search results — user-specific, low reuse; short TTL. */
  search: 7 * DAY_MS,
  /** Basic / advanced / powiązania — KRS changes rarely. */
  krsInfo: 30 * DAY_MS,
  /** List of financial documents — cheap to re-fetch, this is how
   * we detect a new filing year. */
  finDocList: 7 * DAY_MS,
  /** Specific financial document JSON — a filed statement never
   * changes. One year's worth. */
  finDoc: 365 * DAY_MS,
} as const;

/**
 * Returns true if `fetchedAt` is within `ttlMs` of now. Null
 * `fetchedAt` counts as stale (never fetched).
 */
export function isFresh(
  fetchedAt: Date | null | undefined,
  ttlMs: number,
  now: Date = new Date(),
): boolean {
  if (!fetchedAt) {
    return false;
  }
  return now.getTime() - fetchedAt.getTime() < ttlMs;
}
