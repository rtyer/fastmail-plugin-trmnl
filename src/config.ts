import { z } from "zod";
import type { CalendarConfig, CalendarSource, SourceMode, ViewMode } from "./types.js";

const viewModeSchema = z.enum(["rolling_week", "five_day", "work_week", "three_day", "agenda"]);
const sourceModeSchema = z.enum(["caldav", "ics"]);

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

export type ConfigEnv = Record<string, unknown>;

export function buildConfig(query: Record<string, unknown> = {}, env: ConfigEnv = process.env): CalendarConfig {
  const sources = buildSources(
    query.ics_urls ?? query.ics_url ?? env.ICS_URLS,
    query.calendar_names ?? env.CALENDAR_NAMES,
  );
  const caldavUsername = readString(query.fastmail_username ?? query.caldav_username ?? env.FASTMAIL_USERNAME ?? env.CALDAV_USERNAME);
  const caldavPassword = readString(
    query.fastmail_app_password ??
      query.caldav_password ??
      env.FASTMAIL_APP_PASSWORD ??
      env.CALDAV_PASSWORD,
  );
  const sourceModeDefault: SourceMode = caldavUsername && caldavPassword ? "caldav" : "ics";
  const sourceMode = sourceModeSchema.catch(sourceModeDefault).parse(query.source_mode ?? env.SOURCE_MODE) as SourceMode;

  const startHour = Math.max(0, Math.min(23, readNumber(query.start_hour ?? env.START_HOUR, 8)));
  const endHour = Math.max(startHour + 1, Math.min(24, readNumber(query.end_hour ?? env.END_HOUR, 21)));
  const viewMode = viewModeSchema.catch("five_day").parse(query.view_mode ?? env.VIEW_MODE) as ViewMode;

  return {
    sourceMode,
    sources,
    caldavServer:
      readString(query.caldav_server ?? env.CALDAV_SERVER ?? query.fastmail_caldav_server) ??
      "https://caldav.fastmail.com/",
    caldavUsername,
    caldavPassword,
    calendarInclude: splitCsv(query.calendar_include ?? env.CALENDAR_INCLUDE),
    calendarExclude: splitCsv(query.calendar_exclude ?? env.CALENDAR_EXCLUDE),
    timezone: readString(query.timezone ?? env.TIMEZONE) ?? "America/Denver",
    viewMode,
    startHour,
    endHour,
    showCalendarNames: readBool(query.show_calendar_names ?? env.SHOW_CALENDAR_NAMES, true),
    freeBusyOnly: readBool(query.free_busy_only ?? env.FREE_BUSY_ONLY, false),
    fetchTimeoutMs: readNumber(query.fetch_timeout_ms ?? env.FETCH_TIMEOUT_MS, 10000),
  };
}
