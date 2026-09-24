import { describe, expect, it, vi } from "vitest";
import { createInsforgeMock } from "./helpers/insforgeMock.js";

let insforgeMockInstance = createInsforgeMock({});

vi.mock("../src/lib/insforge.js", () => ({
  get insforgeAdmin() {
    return insforgeMockInstance;
  }
}));

const { suspendExpiredSubscriptions } = await import("../src/services/subscription/subscriptionService.js");

describe("suspendExpiredSubscriptions", () => {
  it("suspends organizations whose subscription already expired", async () => {
    insforgeMockInstance = createInsforgeMock({
      organizations: { data: [{ id: "org-1" }, { id: "org-2" }], error: null }
    });

    const result = await suspendExpiredSubscriptions();
    expect(result).toEqual({ suspended: 2 });
  });

  it("reports zero when nothing is due (no rows matched the filters)", async () => {
    insforgeMockInstance = createInsforgeMock({
      organizations: { data: [], error: null }
    });

    const result = await suspendExpiredSubscriptions();
    expect(result).toEqual({ suspended: 0 });
  });

  it("never throws when the update fails, just reports zero", async () => {
    insforgeMockInstance = createInsforgeMock({
      organizations: { data: null, error: { message: "db down" } }
    });

    await expect(suspendExpiredSubscriptions()).resolves.toEqual({ suspended: 0 });
  });
});
