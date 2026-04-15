-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" SERIAL NOT NULL,
    "krs" INTEGER NOT NULL,
    "krs_padded" TEXT NOT NULL,
    "nip" TEXT,
    "regon" TEXT,
    "nazwa_pelna" TEXT NOT NULL,
    "nazwa_skrocona" TEXT,
    "forma_prawna" TEXT,
    "pkd_glowny" TEXT,
    "basic_raw" JSONB,
    "advanced_raw" JSONB,
    "powiazania_raw" JSONB,
    "basic_fetched_at" TIMESTAMPTZ,
    "advanced_fetched_at" TIMESTAMPTZ,
    "powiazania_fetched_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_documents" (
    "id" SERIAL NOT NULL,
    "company_krs" INTEGER NOT NULL,
    "rocznik" INTEGER,
    "data_od" DATE,
    "data_do" DATE,
    "przychody" DOUBLE PRECISION,
    "koszty" DOUBLE PRECISION,
    "zysk" DOUBLE PRECISION,
    "aktywa" DOUBLE PRECISION,
    "pasywa" DOUBLE PRECISION,
    "podatek" DOUBLE PRECISION,
    "document_id" INTEGER,
    "czy_ma_json" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "raw_payload" JSONB,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_audits" (
    "id" SERIAL NOT NULL,
    "endpoint" TEXT NOT NULL,
    "krs" INTEGER,
    "nip" TEXT,
    "cost_pln" DOUBLE PRECISION NOT NULL,
    "http_status" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "org_id" TEXT,
    "user_id" TEXT,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_krs_key" ON "company_profiles"("krs");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_krs_padded_key" ON "company_profiles"("krs_padded");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_nip_key" ON "company_profiles"("nip");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_regon_key" ON "company_profiles"("regon");

-- CreateIndex
CREATE INDEX "company_profiles_nip_idx" ON "company_profiles"("nip");

-- CreateIndex
CREATE INDEX "company_profiles_pkd_glowny_idx" ON "company_profiles"("pkd_glowny");

-- CreateIndex
CREATE INDEX "financial_documents_company_krs_idx" ON "financial_documents"("company_krs");

-- CreateIndex
CREATE UNIQUE INDEX "financial_documents_company_krs_rocznik_key" ON "financial_documents"("company_krs", "rocznik");

-- CreateIndex
CREATE INDEX "request_audits_created_at_idx" ON "request_audits"("created_at");

-- CreateIndex
CREATE INDEX "request_audits_org_id_created_at_idx" ON "request_audits"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "request_audits_endpoint_created_at_idx" ON "request_audits"("endpoint", "created_at");

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_company_krs_fkey" FOREIGN KEY ("company_krs") REFERENCES "company_profiles"("krs") ON DELETE CASCADE ON UPDATE CASCADE;

