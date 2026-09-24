import { describe, expect, it } from "vitest";
import { isNonNegativeNumber, isPositiveInteger, isValidEmail } from "@/lib/validation";

describe("isValidEmail", () => {
  it("accepts well-formed emails", () => {
    expect(isValidEmail("cliente@negocio.com")).toBe(true);
    expect(isValidEmail("  cliente@negocio.com  ")).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isValidEmail("no-es-un-email")).toBe(false);
    expect(isValidEmail("falta-arroba.com")).toBe(false);
    expect(isValidEmail("sin-dominio@")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("isNonNegativeNumber", () => {
  it("accepts zero and positive finite numbers", () => {
    expect(isNonNegativeNumber(0)).toBe(true);
    expect(isNonNegativeNumber(35000)).toBe(true);
  });

  it("rejects negative numbers and NaN", () => {
    expect(isNonNegativeNumber(-1)).toBe(false);
    expect(isNonNegativeNumber(Number.NaN)).toBe(false);
    expect(isNonNegativeNumber(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isPositiveInteger", () => {
  it("accepts positive integers", () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(60)).toBe(true);
  });

  it("rejects zero, negatives, decimals and NaN", () => {
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-5)).toBe(false);
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger(Number.NaN)).toBe(false);
  });
});
