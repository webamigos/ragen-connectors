/**
 * Permissive Zod schemas for Rejestr.io responses. "Permissive" means:
 *   - unknown fields are allowed (we care about drift, not purity)
 *   - optional fields are marked .optional() liberally
 *
 * These schemas ratchet toward strict. On each probe run, violations
 * surface as warnings rather than hard failures — you look at the
 * captured fixture, confirm the doc is right (or wrong), and tighten
 * the schema accordingly.
 *
 * Sources: docs/rejestrio/*.md in the ragen-app repo, confirmed
 * against real responses captured in ./fixtures/.
 */
import { z } from 'zod';

// Rejestr.io's docs say "integer" for duns/krs/nip/regon, but the real
// responses consistently return them as strings (probe run confirmed).
// Accept both — keep downstream code coerce-to-string for safety.
const zIntishId = z.union([z.number().int(), z.string()]);

const zOrgNumbers = z
  .object({
    duns: zIntishId.optional(),
    krs: zIntishId,
    nip: zIntishId.optional(),
    regon: zIntishId.optional(),
  })
  .passthrough();

const zOrgNames = z
  .object({
    pelna: z.string(),
    skrocona: z.string().optional(),
  })
  .passthrough();

const zOrgStan = z
  .object({
    czy_dofinansowana_przez_ue: z.boolean().optional(),
    czy_jest_na_gwp: z.boolean().optional(),
    czy_otrzymala_pomoc_publiczna: z.boolean().optional(),
    czy_pozytku_publicznego: z.boolean().optional(),
    czy_spolka_skarbu_panstwa: z.boolean().optional(),
    czy_wykreslona: z.boolean().optional(),
    forma_prawna: z.string().optional(),
    pkd_przewazajace_dzial: z.string().optional(),
    w_likwidacji: z.boolean().optional(),
    w_upadlosci: z.boolean().optional(),
    w_zawieszeniu: z.boolean().optional(),
    wielkosc: z.string().optional(), // "duza_srednia" | "mala" | "mikro" | "ngo"
  })
  .passthrough();

const zOrgSummary = z
  .object({
    id: zIntishId,
    nazwy: zOrgNames,
    numery: zOrgNumbers,
    stan: zOrgStan.optional(),
    typ: z.string().optional(), // always "organizacja"
  })
  .passthrough();

/** Endpoint 01: GET /org — search. */
export const searchResponseSchema = z
  .object({
    liczba_wszystkich_wynikow: z.number().int(),
    wyniki: z.array(zOrgSummary),
  })
  .passthrough();

/** Endpoint 02: GET /org/{id} — basic details for a single org. */
export const basicResponseSchema = zOrgSummary;

/**
 * Endpoint 03: GET /org/{id}/krs-rozdzialy/{rozdzial} — advanced
 * chapter data. Real API returns an object when populated, an empty
 * array `[]` when there's no data (confirmed for wykreślone/upadłe
 * entities). Accept both.
 */
export const advancedResponseSchema = z.union([
  z.record(z.unknown()),
  z.array(z.unknown()),
]);

/**
 * Endpoint 06: GET /org/{id}/krs-powiazania — related orgs/persons.
 * Top level is an array of related entities. Each item has `id`,
 * `typ` (e.g. `osoba-bez-pesel`), a `tozsamosc` block, and a
 * `krs_powiazania_kwerendowane` array describing each link.
 */
export const powiazaniaResponseSchema = z.array(
  z
    .object({
      id: zIntishId,
      typ: z.string(),
      krs_powiazania_kwerendowane: z
        .array(
          z
            .object({
              data_koniec: z.string().nullable().optional(),
              data_start: z.string().optional(),
              kierunek: z.string().optional(), // AKTYWNY | PRZESZLY
              typ: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
      tozsamosc: z.record(z.unknown()).optional(),
    })
    .passthrough(),
);

/**
 * Endpoint 10: GET /org/{id}/krs-dokumenty — list of financial docs.
 * Top level is an array of filing PERIODS. Each period groups the
 * documents filed for a given accounting year (data_start/data_koniec
 * bound the period, `dokumenty` lists the individual filings).
 */
export const finDocListResponseSchema = z.array(
  z
    .object({
      data_start: z.string().optional(),
      data_koniec: z.string().optional(),
      dokumenty: z
        .array(
          z
            .object({
              id: zIntishId,
              nazwa: z.string(),
              czy_ma_json: z.boolean().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
);

/**
 * Endpoint 11: GET /org/{id}/krs-dokumenty/{docId} — single financial
 * document.
 *
 * Returns `null` when the underlying document has no structured JSON
 * (i.e. the `czy_ma_json: false` case on endpoint 10 — typically
 * GPW/consolidated filings stored as XHTML/PDF). Callers MUST handle
 * null and fall back to document metadata only. The probe selects
 * `czy_ma_json: true` docs where available to avoid paying for nulls.
 */
export const finDocResponseSchema = z.union([
  z.record(z.unknown()),
  z.null(),
]);

export type EndpointId = '01' | '02' | '03' | '06' | '10' | '11';

export const ENDPOINT_SCHEMAS: Record<EndpointId, z.ZodTypeAny> = {
  '01': searchResponseSchema,
  '02': basicResponseSchema,
  '03': advancedResponseSchema,
  '06': powiazaniaResponseSchema,
  '10': finDocListResponseSchema,
  '11': finDocResponseSchema,
};

export const ENDPOINT_COST_PLN: Record<EndpointId, number> = {
  '01': 0.05,
  '02': 0.05,
  '03': 0.05,
  '06': 0.05,
  '10': 0.05,
  '11': 0.5,
};
