/**
 * The catalogue slug rule, carried here because the scaffolder cannot import it.
 *
 * The authority is `CATALOG_SLUG_PATTERN` / `catalogSlugError()` in
 * `@ragenai/platform-contracts` (ragen-app), which is what `/mcp-catalogue`
 * applies when a platform administrator saves the entry. That package is in a
 * different repository and this CLI has no dependency on it, so the rule is a
 * copy — and `slug-rule-matches-the-catalogue.test.ts` over there asserts the
 * two agree.
 *
 * Checking it here rather than leaving it to the form is the whole point: a
 * slug refused *after* the service is written, named, built and containerised
 * is the most annoying failure this CLI can prevent, and it costs one regex.
 */

/** Authority: `CATALOG_SLUG_PATTERN` in @ragenai/platform-contracts. */
export const CATALOG_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export const MAX_SLUG_LENGTH = 64;

/**
 * The eleven slugs that were the `McpConnectorProvider` enum's members. They
 * are admitted by ragen-app's seed and by nothing else, and a new entry that
 * collided with one case-insensitively would send both connectors the same
 * `x-customer-id` — which is the hazard the catalogue's unique index on
 * `lower(slug)` exists to stop. Refused here so the collision is named at
 * scaffold time rather than by a constraint violation at save time.
 */
export const LEGACY_CATALOG_SLUGS: readonly string[] = [
  "GOOGLE_CALENDAR",
  "GOOGLE_ANALYTICS",
  "GOOGLE_ADS",
  "GOOGLE_DRIVE",
  "GMAIL",
  "HUBSPOT",
  "CLICKUP",
  "SLACK",
  "FIREFLIES",
  "WOOCOMMERCE",
  "OPEN_MERCATO",
];

export function catalogSlugError(value: string): string | null {
  if (value.length === 0) {
    return "A slug is required.";
  }
  if (value.length > MAX_SLUG_LENGTH) {
    return `A slug is at most ${MAX_SLUG_LENGTH} characters.`;
  }
  if (!CATALOG_SLUG_PATTERN.test(value)) {
    return "A slug is lowercase letters, digits and hyphens, starting with a letter — for example `notion`.";
  }
  if (
    LEGACY_CATALOG_SLUGS.some((legacy) => legacy.toLowerCase() === value)
  ) {
    return `\`${value}\` collides with the built-in connector \`${value.toUpperCase()}\`. Slugs are unique case-insensitively, because both would be sent the same x-customer-id.`;
  }
  return null;
}

/** A name the user typed, as the slug we would suggest for it. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^[^a-z]+/, "");
}
