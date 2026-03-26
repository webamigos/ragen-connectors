import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { validateEnvVars, validateEnv } from "../env.js";

describe("validateEnvVars", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("returns parsed env vars on valid schema", () => {
    const schema = z.object({
      NODE_ENV: z.string().optional().default("test"),
      PATH: z.string(),
    });
    const result = validateEnvVars(schema);
    expect(result.PATH).toBeTruthy();
  });

  it("exits on invalid schema", () => {
    const schema = z.object({
      REQUIRED_BUT_MISSING_VAR_XYZ: z.string(),
    });
    expect(() => validateEnvVars(schema)).toThrow("process.exit called");
  });
});

describe("validateEnv", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("passes when all vars are present", () => {
    expect(() => validateEnv(["PATH"])).not.toThrow();
  });

  it("exits when vars are missing", () => {
    expect(() => validateEnv(["NONEXISTENT_VAR_ABC_123"])).toThrow(
      "process.exit called",
    );
  });
});
