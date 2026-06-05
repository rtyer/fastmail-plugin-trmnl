import { z } from "zod";
import type { CalendarConfig, CalendarSource, ViewMode } from "./types.js";

const viewModeSchema = z.enum(["rolling_week", "work_week", "three_day", "agenda"]);

function readString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return readString(value[0]);
  }
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readBool(value: unknown, fallback: boolean): boolean {
  const raw = readString(value);
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

function readNumber(value: unknown, fallback: number): number {
  const raw = readString(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitCsv(value: unknown): string[] {
  return (readString(value) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildSources(urlValue: unknown, namesValue: unknown): CalendarSource[] {
  const urls = splitCsv(urlValue);
  const names = splitCsv(namesValue);
  return urls.map((url, index) => ({
    url,
    name: names[index] || `Calendar ${index + 1}`,
  }));
}

export function buildConfig(query: Record<string, unknown> = {}): CalendarConfig {
  const sources = buildSources(
    query.ics_urls ?? query.ics_url ?? process.env.ICS_URLS,
    query.calendar_names ?? process.env.CALENDAR_NAMES,
  );

  const startHour = Math.max(0, Math.min(23, readNumber(query.start_hour ?? process.env.START_HOUR, 8)));
  const endHour = Math.max(startHour + 1, Math.min(24, readNumber(query.end_hour ?? process.env.END_HOUR, 21)));
  const viewMode = viewModeSchema.catch("rolling_week").parse(query.view_mode ?? process.env.VIEW_MODE) as ViewMode;

  return {
    sources,
    timezone: readString(query.timezone ?? process.env.TIMEZONE) ?? "America/Denver",
    viewMode,
    startHour,
    endHour,
    showCalendarNames: readBool(query.show_calendar_names ?? process.env.SHOW_CALENDAR_NAMES, true),
    freeBusyOnly: readBool(query.free_busy_only ?? process.env.FREE_BUSY_ONLY, false),
    fetchTimeoutMs: readNumber(query.fetch_timeout_ms ?? process.env.FETCH_TIMEOUT_MS, 10000),
  };
}
