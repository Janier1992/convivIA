import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";

const getTelegramPollerHealthMock = vi.fn();

vi.mock("../src/services/telegram/telegramPollingManager.js", () => ({
  getTelegramPollerHealth: () => getTelegramPollerHealthMock()
}));

const { createApp } = await import("../src/app.js");

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports ok when there are no Telegram bots connected yet", async () => {
    getTelegramPollerHealthMock.mockReturnValue({ activeOrgCount: 0, lastPollSuccessAt: null });

    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("reports ok when a connected bot polled recently", async () => {
    getTelegramPollerHealthMock.mockReturnValue({ activeOrgCount: 1, lastPollSuccessAt: new Date().toISOString() });

    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("reports degraded (503) when a connected bot hasn't polled successfully in over 2 minutes", async () => {
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    getTelegramPollerHealthMock.mockReturnValue({ activeOrgCount: 1, lastPollSuccessAt: staleTimestamp });

    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("reports degraded (503) when a bot is connected but never successfully polled", async () => {
    getTelegramPollerHealthMock.mockReturnValue({ activeOrgCount: 1, lastPollSuccessAt: null });

    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });
});
