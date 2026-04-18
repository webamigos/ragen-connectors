/**
 * Schemas for person-oriented endpoints (04 `dane-osoby` and 07
 * `powiazania-osoby`). No real fixtures captured yet; schemas are
 * permissive `.passthrough()` and tighten only the fields a caller
 * is likely to read directly.
 */
import { z } from "zod";

const zIntishId = z.union([z.number().int(), z.string()]);

/** Endpoint 04: GET /osoby/{id}. */
export const personResponseSchema = z
  .object({
    id: zIntishId,
    tozsamosc: z
      .object({
        imie: z.string().optional(),
        nazwisko: z.string().optional(),
        imiona_i_nazwisko: z.string().optional(),
        nazwa: z.string().optional(),
        drugie_imiona: z.string().optional(),
        data_urodzenia: z.string().optional(),
        plec: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type PersonResponse = z.infer<typeof personResponseSchema>;

/**
 * Endpoint 07: GET /osoby/{id}/krs-powiazania. Same response shape
 * as org powiązania (endpoint 06) — a flat array of related orgs
 * with KRS numbers + link metadata.
 */
export const personConnectionsResponseSchema = z.array(
  z
    .object({
      id: zIntishId,
      typ: z.string().optional(),
      // Organizations carry `nazwy.pelna` / `numery.krs`; inline-
      // typed for the fields a caller reads directly.
      nazwy: z
        .object({
          pelna: z.string().optional(),
          skrocona: z.string().optional(),
        })
        .passthrough()
        .optional(),
      numery: z
        .object({
          krs: zIntishId.optional(),
          nip: zIntishId.optional(),
          regon: zIntishId.optional(),
        })
        .passthrough()
        .optional(),
      krs_powiazania_kwerendowane: z
        .array(
          z
            .object({
              data_start: z.string().optional(),
              data_koniec: z.string().nullable().optional(),
              kierunek: z.string().optional(),
              typ: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
);

export type PersonConnectionsResponse = z.infer<
  typeof personConnectionsResponseSchema
>;
