import { DateTime } from "luxon";
import { buildCalendarPayload } from "./calendar.js";
import { buildConfig, type ConfigEnv } from "./config.js";
import type { CalendarPayload } from "./types.js";

const CACHE_KEY = "calendar_payload";
let refreshInFlight: Promise<RefreshResult> | undefined;

export interface WorkerEnv extends ConfigEnv {
  CALENDAR_CACHE: KVNamespace;
  FASTMAIL_USERNAME?: string;
  FASTMAIL_APP_PASSWORD?: string;
  TRMNL_POLLING_TOKEN?: string;
  REFRESH_TOKEN?: string;
  TRMNL_WEBHOOK_URL?: string;
}

type CacheError = {
  message: string;
  at: string;
};

type CachedCalendar = {
  payload?: CalendarPayload;
  refreshed_at?: string;
  error?: CacheError;
  webhook_error?: CacheError;
};

type RefreshResult =
  | { ok: true; payload: CalendarPayload; refreshed_at: string }
  | { ok: false; status: number; error: string };

type RefreshFn = (env: WorkerEnv) => Promise<RefreshResult>;
type PayloadBuilder = (env: WorkerEnv) => Promise<CalendarPayload>;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    handleScheduled(env, ctx);
  },
};

export function handleScheduled(
  env: WorkerEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  refreshFn: RefreshFn = refreshCalendarCache,
): void {
  ctx.waitUntil(
    refreshFn(env).then((result) => {
      if (!result.ok) {
        console.error(`Scheduled calendar refresh failed: ${result.error}`);
      }
    }),
  );
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  refreshFn: RefreshFn = refreshCalendarCacheOnce,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/events" || url.pathname === "/calendar")) {
    if (!hasBearerToken(request, env.TRMNL_POLLING_TOKEN)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return readCalendarPayload(env, refreshFn);
  }

  if (request.method === "POST" && url.pathname === "/refresh") {
    if (!hasBearerToken(request, env.REFRESH_TOKEN)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const result = await refreshFn(env);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status);
    }
    return jsonResponse({ ok: true, refreshed_at: result.refreshed_at, payload: addSyncedLabel(result.payload) });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return readCalendarStatus(env, false);
  }

  if (request.method === "GET" && url.pathname === "/status") {
    if (!hasBearerToken(request, env.REFRESH_TOKEN)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return readCalendarStatus(env, true);
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export async function refreshCalendarCache(
  env: WorkerEnv,
  buildPayload: PayloadBuilder = (workerEnv) => buildCalendarPayload(buildConfig({}, workerEnv)),
): Promise<RefreshResult> {
  try {
    const payload = await buildPayload(env);
    const refreshed_at = payload.synced_at;
    const webhook_error = await postTrmnlWebhook(env, payload);
    await writeCache(env, { payload, refreshed_at, webhook_error });
    return { ok: true, payload, refreshed_at };
  } catch (error) {
    const safeError = sanitizeError(error);
    console.error(`Calendar refresh failed: ${safeError}`);
    const existing = await tryReadCache(env);
    if (existing?.payload) {
      await tryWriteCache(env, {
        ...existing,
        error: { message: safeError, at: new Date().toISOString() },
      });
      return { ok: false, status: 502, error: "Refresh failed; preserved the previous cached calendar." };
    }
    await tryWriteCache(env, {
      error: { message: safeError, at: new Date().toISOString() },
    });
    return { ok: false, status: 503, error: "Calendar cache is unavailable." };
  }
}

async function readCalendarPayload(env: WorkerEnv, refreshFn: RefreshFn): Promise<Response> {
  const cached = await tryReadCache(env);
  if (cached?.payload && payloadMatchesCurrentConfig(cached.payload, env)) {
    return jsonResponse(addSyncedLabel(cached.payload));
  }

  const refresh = await refreshFn(env);
  if (!refresh.ok) {
    if (cached?.payload) {
      return jsonResponse(addSyncedLabel(cached.payload));
    }
    return jsonResponse({ error: refresh.error }, refresh.status);
  }
  return jsonResponse(addSyncedLabel(refresh.payload));
}

function payloadMatchesCurrentConfig(payload: CalendarPayload, env: WorkerEnv): boolean {
  const config = buildConfig({}, env);
  return (
    payload.payload_schema_version === 2 &&
    payload.source_mode === config.sourceMode &&
    payload.timezone === config.timezone &&
    payload.view_mode === config.viewMode &&
    payload.start_hour === config.startHour &&
    payload.end_hour === config.endHour &&
    payload.show_calendar_names === config.showCalendarNames &&
    payload.free_busy_only === config.freeBusyOnly
  );
}

async function readCalendarStatus(env: WorkerEnv, includeDetails: boolean): Promise<Response> {
  const cached = await tryReadCache(env);
  const refreshedAt = cached?.refreshed_at ?? cached?.payload?.synced_at;
  const stale = refreshedAt ? DateTime.now().diff(DateTime.fromISO(refreshedAt), "hours").hours > 2 : true;

  return jsonResponse({
    ok: Boolean(cached?.payload) && !stale,
    cache_present: Boolean(cached?.payload),
    refreshed_at: refreshedAt ?? null,
    stale,
    last_refresh_error_at: cached?.error?.at ?? null,
    webhook_error_at: cached?.webhook_error?.at ?? null,
    ...(includeDetails
      ? {
          last_refresh_error: cached?.error?.message ?? null,
          webhook_error: cached?.webhook_error?.message ?? null,
        }
      : {}),
  });
}

async function refreshCalendarCacheOnce(env: WorkerEnv): Promise<RefreshResult> {
  refreshInFlight ??= refreshCalendarCache(env).finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

async function readCache(env: WorkerEnv): Promise<CachedCalendar | undefined> {
  return (await env.CALENDAR_CACHE.get<CachedCalendar>(CACHE_KEY, "json")) ?? undefined;
}

async function tryReadCache(env: WorkerEnv): Promise<CachedCalendar | undefined> {
  try {
    return await readCache(env);
  } catch {
    return undefined;
  }
}

async function writeCache(env: WorkerEnv, cache: CachedCalendar): Promise<void> {
  await env.CALENDAR_CACHE.put(CACHE_KEY, JSON.stringify(cache));
}

async function tryWriteCache(env: WorkerEnv, cache: CachedCalendar): Promise<void> {
  try {
    await writeCache(env, cache);
  } catch {
    // There is no safer fallback if KV is unavailable.
  }
}

function addSyncedLabel(payload: CalendarPayload, now = DateTime.now().setZone(payload.timezone)): CalendarPayload {
  const syncedAt = DateTime.fromISO(payload.synced_at, { zone: "utc" });
  const minutes = Math.max(0, Math.floor(now.diff(syncedAt, "minutes").minutes));
  return {
    ...payload,
    synced_ago_minutes: minutes,
    synced_label: minutes === 0 ? "just now" : `${minutes} min ago`,
  };
}

function hasBearerToken(request: Request, expectedToken: string | undefined): boolean {
  if (!expectedToken) {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token, extra] = header.trim().split(/\s+/);
  if (extra) {
    return false;
  }
  return scheme?.toLowerCase() === "bearer" && token === expectedToken;
}

async function postTrmnlWebhook(env: WorkerEnv, payload: CalendarPayload): Promise<CacheError | undefined> {
  if (!env.TRMNL_WEBHOOK_URL) {
    return undefined;
  }

  try {
    const url = new URL(env.TRMNL_WEBHOOK_URL);
    if (url.protocol !== "https:") {
      throw new Error("TRMNL_WEBHOOK_URL must use https.");
    }
    const response = await fetch(url.href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merge_variables: payload }),
    });
    if (!response.ok) {
      throw new Error(`TRMNL webhook returned ${response.status}.`);
    }
    return undefined;
  } catch (error) {
    const message = sanitizeError(error);
    console.warn(`Optional TRMNL webhook push failed: ${message}`);
    return { message, at: new Date().toISOString() };
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown refresh error";
  return message
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .replace(/Basic\s+[A-Za-z0-9+/=._-]+/gi, "Basic [redacted]")
    .slice(0, 240);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
