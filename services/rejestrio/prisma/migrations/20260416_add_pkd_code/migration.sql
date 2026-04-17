-- Numeric PKD 2007 code extracted from endpoint 03's ogolny chapter.
-- Needed by `search_enriched_leads` to filter by sector prefix (e.g.
-- "62" = software / IT services). Plain pkd_glowny only carries the
-- human-readable description.

ALTER TABLE "company_profiles"
  ADD COLUMN "pkd_code" TEXT;

CREATE INDEX "company_profiles_pkd_code_idx" ON "company_profiles"("pkd_code");
