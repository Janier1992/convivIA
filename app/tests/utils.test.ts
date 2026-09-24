import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { slugify } from "@/lib/slug";

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", undefined, false, "font-bold")).toBe("text-sm font-bold");
  });
});

describe("slugify", () => {
  it("lowercases, strips accents and replaces non-alphanumeric characters", () => {
    const slug = slugify("La Buena Mesa Café & Bar");
    expect(slug).toMatch(/^la-buena-mesa-cafe-bar-[a-z0-9]{4}$/);
  });

  it("never leaves leading or trailing dashes in the base", () => {
    const slug = slugify("---Barbería---");
    expect(slug.startsWith("-")).toBe(false);
  });
});
