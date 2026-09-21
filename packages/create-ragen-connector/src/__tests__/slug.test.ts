import { describe, expect, it } from "vitest";
import {
  CATALOG_SLUG_PATTERN,
  LEGACY_CATALOG_SLUGS,
  catalogSlugError,
  slugify,
} from "../slug.js";

describe("catalogSlugError", () => {
  it("accepts what the catalogue form accepts", () => {
    for (const slug of ["notion", "open-meteo", "a", "x1", "a-b-c"]) {
      expect(catalogSlugError(slug)).toBeNull();
    }
  });

  it("refuses what the catalogue form refuses", () => {
    expect(catalogSlugError("")).toMatch(/required/);
    expect(catalogSlugError("Notion")).toMatch(/lowercase/);
    expect(catalogSlugError("1notion")).toMatch(/starting with a letter/);
    expect(catalogSlugError("no_tion")).toMatch(/lowercase/);
    expect(catalogSlugError("-notion")).toMatch(/lowercase/);
    expect(catalogSlugError("a".repeat(65))).toMatch(/at most 64/);
  });

  it("refuses the lowercase form of every built-in slug that is typeable", () => {
    // `slack` beside the built-in `SLACK` would send both connectors the same
    // x-customer-id, which is what the catalogue's unique index on lower(slug)
    // exists to stop. Better here than as a constraint violation at save time.
    //
    // The built-ins with an underscore — GOOGLE_CALENDAR and friends — cannot
    // collide at all: `google_calendar` fails the pattern before it reaches
    // the collision check, and `google-calendar` is a different string under
    // lower(). So they are excluded here rather than asserted loosely.
    const typeable = LEGACY_CATALOG_SLUGS.map((slug) => slug.toLowerCase()).filter(
      (slug) => !slug.includes("_"),
    );
    expect(typeable.length).toBeGreaterThan(0);
    for (const legacy of typeable) {
      expect(catalogSlugError(legacy)).toMatch(/collides/);
    }
  });

  it("accepts the hyphenated form of an underscored built-in", () => {
    // lower('GOOGLE_CALENDAR') is `google_calendar`, not `google-calendar`,
    // so there is no collision and refusing one would be superstition.
    expect(catalogSlugError("google-calendar")).toBeNull();
  });

  it("does not refuse a slug that merely contains a built-in's name", () => {
    expect(catalogSlugError("slack-internal")).toBeNull();
  });
});

describe("slugify", () => {
  it("suggests a usable slug for an ordinary name", () => {
    expect(slugify("Weather")).toBe("weather");
    expect(slugify("Open Meteo")).toBe("open-meteo");
    expect(slugify("Rejestr.io (KRS)")).toBe("rejestr-io-krs");
  });

  it("strips diacritics rather than dropping the letters", () => {
    // `Księgowość` must not become `ksi-gowo`, which is unreadable and would
    // be a worse default than asking again.
    expect(slugify("Księgowość")).toBe("ksiegowosc");
  });

  it("always suggests something the rule accepts, or nothing", () => {
    for (const name of ["Weather", "  ", "123", "--", "Éa"]) {
      const suggestion = slugify(name);
      if (suggestion.length > 0) {
        expect(CATALOG_SLUG_PATTERN.test(suggestion)).toBe(true);
      }
    }
  });
});
