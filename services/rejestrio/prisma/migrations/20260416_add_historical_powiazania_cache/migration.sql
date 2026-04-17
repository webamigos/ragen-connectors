-- Cache columns for historical powiązania — endpoint 06 with
-- aktualnosc=historyczne. Requires Premium+ plan. Separate from the
-- aktualne cache because the two queries return different sets and
-- need independent TTLs (historical data is more stable).

ALTER TABLE "company_profiles"
  ADD COLUMN "powiazania_historyczne_raw" JSONB,
  ADD COLUMN "powiazania_historyczne_fetched_at" TIMESTAMPTZ;
