-- Drop the @unique constraints on company_profiles.nip and .regon.
-- One NIP/REGON maps to multiple KRS rows when the same business
-- restructured over time (S.A. → sp. z o.o. sp.k. → sp. z o.o.).
-- The original schema's @unique on nip/regon blew up with P2002 the
-- moment we tried to cache the 2nd historical form.
-- Keep the plain index on nip so lookups stay fast.

DROP INDEX IF EXISTS "company_profiles_nip_key";
DROP INDEX IF EXISTS "company_profiles_regon_key";
