import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest, handleScheduled, refreshCalendarCache, type WorkerEnv } from "../src/worker.js";
import type { CalendarPayload } from "../src/types.js";

const cacheKey = "calendar_payload";

class MemoryKV {
  store = new Map<string, string>();

  async get<T>(key: string, type: "json"): Promise<T | null>;
  async get(key: string): Promise<string | null>;
  async get<T>(key: string, type?: "json"): Promise<T | string | null> {
    const value = this.store.get(key);
    if (!value) {
      return null;
    }
    return type === "json" ? (JSON.parse(value) as T) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

class ThrowingKV extends MemoryKV {
  override async get<T>(_key: string, _type?: "json"): Promise<T | string | null> {
    throw new Error("KV unavailable");
  }

  override async put(_key: string, _value: string): Promise<void> {
    throw new Error("KV unavailable");
  }
}

function makeEnv(kv = new MemoryKV()): WorkerEnv {
  return {
    CALENDAR_CACHE: kv as unknown as KVNamespace,
    TRMNL_POLLING_TOKEN: "poll-token",
    REFRESH_TOKEN: "refresh-token",
    FASTMAIL_USERNAME: "person@example.com",
    FASTMAIL_APP_PASSWORD: "app-password",
    TIMEZONE: "America/Denver",
    VIEW_MODE: "rolling_week",
  };
}

function makePayload(overrides: Partial<CalendarPayload> = {}): CalendarPayload {
  return {
    payload_schema_version: 3,
    synced_at: "2026-06-05T22:00:00Z",
    synced_label: "just now",
    synced_ago_minutes: 0,
    source_mode: "caldav",
    timezone: "America/Denver",
    view_mode: "rolling_week",
    start_hour: 8,
    end_hour: 21,
    show_calendar_names: true,
    free_busy_only: false,
    day_count: 0,
    range: { start: "2026-06-05", end: "2026-06-11" },
    hours: [],
    days: [],
    ...overrides,
  };
}

function getEventsRequest(headers: HeadersInit = {}) {
  return new Request("https://worker.example.com/events", { headers });
}

describe("worker endpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires bearer auth for polling endpoints", async () => {
    const response = await handleRequest(getEventsRequest(), makeEnv());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects malformed bearer headers", async () => {
    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token extra" }), makeEnv());

    expect(response.status).toBe(401);
  });

  it("returns a cached payload for authorized polling requests", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    await kv.put(cacheKey, JSON.stringify({ payload: makePayload(), refreshed_at: "2026-06-05T22:00:00Z" }));

    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token" }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source_mode: "caldav",
      timezone: "America/Denver",
      days: [],
    });
  });

  it("refreshes cached payloads built for a different view mode", async () => {
    const kv = new MemoryKV();
    const env = { ...makeEnv(kv), VIEW_MODE: "five_day" };
    await kv.put(cacheKey, JSON.stringify({ payload: makePayload({ view_mode: "rolling_week" }), refreshed_at: "2026-06-05T22:00:00Z" }));

    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token" }), env, async () => ({
      ok: true,
      payload: makePayload({ view_mode: "five_day", day_count: 5 }),
      refreshed_at: "2026-06-05T22:05:00Z",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ view_mode: "five_day", day_count: 5 });
  });

  it("refreshes cached payloads from an older schema version", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    const oldPayload = makePayload();
    delete (oldPayload as Partial<CalendarPayload>).payload_schema_version;
    await kv.put(cacheKey, JSON.stringify({ payload: oldPayload, refreshed_at: "2026-06-05T22:00:00Z" }));

    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token" }), env, async () => ({
      ok: true,
      payload: makePayload({ day_count: 5 }),
      refreshed_at: "2026-06-05T22:05:00Z",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ payload_schema_version: 3, day_count: 5 });
  });

  it("refreshes synchronously when cache is missing", async () => {
    const env = makeEnv();
    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token" }), env, async () => ({
      ok: true,
      payload: makePayload({ day_count: 1 }),
      refreshed_at: "2026-06-05T22:00:00Z",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ day_count: 1 });
  });

  it("returns a safe 503 when missing cache refresh fails", async () => {
    const env = makeEnv();
    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token" }), env, async () => ({
      ok: false,
      status: 503,
      error: "Calendar cache is unavailable.",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Calendar cache is unavailable." });
  });

  it("returns a safe 503 when KV is unavailable and refresh cannot produce cache", async () => {
    const env = makeEnv(new ThrowingKV());
    const response = await handleRequest(getEventsRequest({ authorization: "Bearer poll-token" }), env, async () => ({
      ok: false,
      status: 503,
      error: "Calendar cache is unavailable.",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Calendar cache is unavailable." });
  });

  it("writes KV during refresh", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);

    const result = await refreshCalendarCache(env, async () => makePayload({ day_count: 2 }));

    expect(result.ok).toBe(true);
    const cached = await kv.get<{ payload: CalendarPayload }>(cacheKey, "json");
    expect(cached?.payload.day_count).toBe(2);
  });

  it("keeps refresh successful when optional TRMNL webhook fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("webhook down"));
    const kv = new MemoryKV();
    const env = { ...makeEnv(kv), TRMNL_WEBHOOK_URL: "https://trmnl.example/webhook" };

    const result = await refreshCalendarCache(env, async () => makePayload({ day_count: 5 }));

    expect(result.ok).toBe(true);
    const cached = await kv.get<{ payload: CalendarPayload; error?: unknown }>(cacheKey, "json");
    expect(cached?.payload.day_count).toBe(5);
    expect(cached?.error).toBeUndefined();
  });

  it("records non-2xx optional TRMNL webhook responses without failing refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 401 }));
    const kv = new MemoryKV();
    const env = { ...makeEnv(kv), TRMNL_WEBHOOK_URL: "https://trmnl.example/webhook" };

    const result = await refreshCalendarCache(env, async () => makePayload({ day_count: 6 }));

    expect(result.ok).toBe(true);
    const cached = await kv.get<{ payload: CalendarPayload; webhook_error?: { message: string } }>(cacheKey, "json");
    expect(cached?.payload.day_count).toBe(6);
    expect(cached?.webhook_error?.message).toBe("TRMNL webhook returned 401.");
  });

  it("scheduled refresh writes KV", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    const pending: Promise<unknown>[] = [];

    handleScheduled(env, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }, async (workerEnv) =>
      refreshCalendarCache(workerEnv, async () => makePayload({ day_count: 4 })),
    );

    await Promise.all(pending);
    const cached = await kv.get<{ payload: CalendarPayload }>(cacheKey, "json");
    expect(cached?.payload.day_count).toBe(4);
  });

  it("preserves old cache on refresh failure", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    await kv.put(cacheKey, JSON.stringify({ payload: makePayload({ day_count: 3 }), refreshed_at: "2026-06-05T22:00:00Z" }));

    const result = await refreshCalendarCache(env, async () => {
      throw new Error("Fetch failed for https://secret.example/calendar.ics");
    });

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      error: "Refresh failed; preserved the previous cached calendar.",
    });
    const cached = await kv.get<{ payload: CalendarPayload; error?: { message: string } }>(cacheKey, "json");
    expect(cached?.payload.day_count).toBe(3);
    expect(cached?.error?.message).toContain("[redacted-url]");
  });

  it("returns a safe refresh error when KV write fails", async () => {
    const result = await refreshCalendarCache(makeEnv(new ThrowingKV()), async () => makePayload());

    expect(result).toEqual({ ok: false, status: 503, error: "Calendar cache is unavailable." });
  });

  it("returns status metadata without exposing error messages on public health", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    await kv.put(
      cacheKey,
      JSON.stringify({
        payload: makePayload({ synced_at: new Date().toISOString() }),
        refreshed_at: new Date().toISOString(),
        error: { message: "Invalid credentials", at: "2026-06-05T22:01:00Z" },
      }),
    );

    const response = await handleRequest(new Request("https://worker.example.com/health"), env);

    expect(response.status).toBe(200);
    const body = await response.clone().text();
    await expect(response.json()).resolves.toMatchObject({
      cache_present: true,
      last_refresh_error_at: "2026-06-05T22:01:00Z",
    });
    expect(body).not.toContain("Invalid credentials");
  });

  it("requires refresh auth for detailed status", async () => {
    const response = await handleRequest(new Request("https://worker.example.com/status"), makeEnv());

    expect(response.status).toBe(401);
  });

  it("returns detailed status with refresh auth", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv);
    await kv.put(
      cacheKey,
      JSON.stringify({
        payload: makePayload({ synced_at: new Date().toISOString() }),
        refreshed_at: new Date().toISOString(),
        error: { message: "Invalid credentials", at: "2026-06-05T22:01:00Z" },
      }),
    );

    const response = await handleRequest(
      new Request("https://worker.example.com/status", { headers: { authorization: "Bearer refresh-token" } }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cache_present: true,
      last_refresh_error: "Invalid credentials",
    });
  });

  it("requires refresh bearer auth for manual refresh", async () => {
    const response = await handleRequest(new Request("https://worker.example.com/refresh", { method: "POST" }), makeEnv());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
