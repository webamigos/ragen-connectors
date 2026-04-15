/**
 * Narrower schema for Rejestr.io endpoint 01 (search), tuned for use
 * by tool handlers (not just the probe).
 *
 * Still permissive on unknown keys (`.passthrough()`) — the upstream
 * can add fields and we'd rather tolerate than crash — but narrower
 * than the probe's schema on the fields we actually read in tools.
 *
 * If you change either this or `src/probe/schemas/index.ts`, keep the
 * two consistent. Long-term this file should become the canonical one
 * and the probe should import from here.
 */
import { z } from "zod";

const zIntishId = z.union([z.number().int(), z.string()]);

const zAdres = z
  .object({
    miejscowosc: z.string().optional(),
    kod: z.string().optional(),
    ulica: z.string().optional(),
    nr_domu: z.string().optional(),
    panstwo: z.string().optional(),
  })
  .passthrough();

const zStan = z
  .object({
    czy_wykreslona: z.boolean().optional(),
    w_likwidacji: z.boolean().optional(),
    w_upadlosci: z.boolean().optional(),
    w_zawieszeniu: z.boolean().optional(),
    forma_prawna: z.string().optional(),
    pkd_przewazajace_dzial: z.string().optional(),
    wielkosc: z.string().optional(),
  })
  .passthrough();

const zNumery = z
  .object({
    duns: zIntishId.optional(),
    krs: zIntishId,
    nip: zIntishId.optional(),
    regon: zIntishId.optional(),
  })
  .passthrough();

const zNazwy = z
  .object({
    pelna: z.string(),
    skrocona: z.string().optional(),
  })
  .passthrough();

const zOrgSummary = z
  .object({
    id: zIntishId,
    nazwy: zNazwy,
    numery: zNumery,
    stan: zStan.optional(),
    adres: zAdres.optional(),
    typ: z.string().optional(),
  })
  .passthrough();

export const searchResponseSchema = z
  .object({
    liczba_wszystkich_wynikow: z.number().int(),
    wyniki: z.array(zOrgSummary),
  })
  .passthrough();

export type SearchResponse = z.infer<typeof searchResponseSchema>;
