/**
 * Endpoint 05: GET /org/{id}/crbr — ultimate beneficial owners
 * from Centralny Rejestr Beneficjentów Rzeczywistych (CRBR). Not
 * KRS data — sourced from the Ministry of Finance's CRBR register.
 * Requires Premium plan.
 */
import { z } from "zod";

const zIntishId = z.union([z.number().int(), z.string()]);

export const beneficialOwnerSchema = z
  .object({
    id: zIntishId.optional(), // optional because persons without PESEL have no Rejestr.io id
    kod_kraju_rezydencji: z.string().optional(),
    kody_krajow_obywatelstwa: z.array(z.string()).optional(),
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
    /**
     * CRBR's description of what kind of control / ownership this
     * person exercises over the organisation. Shape varies — keep
     * as loose record until fixture-backed.
     */
    charakterystyka: z.unknown().optional(),
    /** Uprawnienia — list of specific controls (ownership, voting, etc.). */
    uprawnienia: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const crbrResponseSchema = z.array(beneficialOwnerSchema);

export type CrbrResponse = z.infer<typeof crbrResponseSchema>;
export type BeneficialOwner = z.infer<typeof beneficialOwnerSchema>;
