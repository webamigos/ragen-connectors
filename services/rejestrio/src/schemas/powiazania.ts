/**
 * Endpoint 06: `GET /org/{id}/krs-powiazania` — KRS connections
 * (board members, shareholders, related organisations, etc.).
 *
 * Top-level is an array of related entities. Each entity has an `id`,
 * a `typ` (e.g. `osoba-bez-pesel`, `organizacja`), a `tozsamosc` block
 * with identity fields, and `krs_powiazania_kwerendowane` describing
 * each link.
 *
 * Historical connections require Premium plan; current connections
 * work on base. The schema doesn't try to distinguish — the API just
 * returns whatever the plan allows.
 */
import { z } from "zod";

const zIntishId = z.union([z.number().int(), z.string()]);

const zPowiazanieLink = z
  .object({
    data_start: z.string().optional(),
    data_koniec: z.string().nullable().optional(),
    kierunek: z.string().optional(), // AKTYWNY | PRZESZLY
    typ: z.string().optional(),
  })
  .passthrough();

export const powiazanieItemSchema = z
  .object({
    id: zIntishId,
    typ: z.string(),
    krs_powiazania_kwerendowane: z.array(zPowiazanieLink).optional(),
    tozsamosc: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const powiazaniaResponseSchema = z.array(powiazanieItemSchema);

export type PowiazanieItem = z.infer<typeof powiazanieItemSchema>;
export type PowiazaniaResponse = z.infer<typeof powiazaniaResponseSchema>;
