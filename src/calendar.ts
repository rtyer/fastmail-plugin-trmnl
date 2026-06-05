import * as ical from "node-ical";
import { DateTime } from "luxon";
import type { DateWithTimeZone, EventInstance, ParameterValue, VEvent } from "node-ical";
import type {
  AllDayEvent,
  CalendarConfig,
  CalendarDay,
  CalendarPayload,
  HourMarker,
  TimedEvent,
} from "./types.js";

type IcsFeed = {
  name: string;
  ics: string;
};

type RawEvent = {
  uid: string;
  title: string;
  calendar: string;
  allDay: boolean;
  start: DateTime;
  end: DateTime;
};

type FetchText = (url: string, timeoutMs: number) => Promise<string>;

export async function fetchIcsText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/calendar, text/plain;q=0.9, */*;q=0.8",
        "user-agent": "fastmail-plugin-trmnl/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildCalendarPayload(
  config: CalendarConfig,
  now: DateTime = DateTime.now().setZone(config.timezone),
  fetchText: FetchText = fetchIcsText,
): Promise<CalendarPayload> {
  const feeds = await Promise.all(
    config.sources.map(async (source) => ({
      name: source.name,
      ics: await fetchText(source.url, config.fetchTimeoutMs),
    })),
  );
  return buildCalendarPayloadFromIcs(feeds, config, now);
}

export function buildCalendarPayloadFromIcs(
  feeds: IcsFeed[],
  config: CalendarConfig,
  now: DateTime = DateTime.now().setZone(config.timezone),
): CalendarPayload {
  const zonedNow = now.setZone(config.timezone);
  const range = getRange(config.viewMode, zonedNow);
  const days = makeDays(range.start, range.dayCount, zonedNow, config);
  const rangeEndExclusive = range.start.plus({ days: range.dayCount });
  const rawEvents = feeds.flatMap((feed) =>
    parseFeed(feed, config, range.start.minus({ days: 1 }), rangeEndExclusive.plus({ days: 1 })),
  );

  const dedupedEvents = dedupeEvents(rawEvents);
  for (const event of dedupedEvents) {
    placeEvent(event, days, config);
  }
  for (const day of days) {
    day.all_day_events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
    day.timed_events = layoutTimedEvents(day.timed_events);
  }

  return {
    synced_at: zonedNow.toUTC().toISO({ suppressMilliseconds: true }) ?? zonedNow.toUTC().toISO() ?? "",
    synced_label: "just now",
    synced_ago_minutes: 0,
    timezone: config.timezone,
    view_mode: config.viewMode,
    start_hour: config.startHour,
    end_hour: config.endHour,
    show_calendar_names: config.showCalendarNames,
    free_busy_only: config.freeBusyOnly,
    day_count: days.length,
    range: {
      start: range.start.toISODate() ?? "",
      end: rangeEndExclusive.minus({ days: 1 }).toISODate() ?? "",
    },
    hours: makeHours(config),
    days,
  };
}

function getRange(viewMode: CalendarConfig["viewMode"], now: DateTime): { start: DateTime; dayCount: number } {
  if (viewMode === "work_week") {
    return { start: now.startOf("week").startOf("day"), dayCount: 5 };
  }
  if (viewMode === "three_day") {
    return { start: now.startOf("day"), dayCount: 3 };
  }
  if (viewMode === "agenda") {
    return { start: now.startOf("day"), dayCount: 7 };
  }
  return { start: now.startOf("day"), dayCount: 7 };
}

function makeDays(start: DateTime, dayCount: number, now: DateTime, config: CalendarConfig): CalendarDay[] {
  return Array.from({ length: dayCount }, (_, index) => {
    const day = start.plus({ days: index });
    return {
      date: day.toISODate() ?? "",
      label: day.setLocale("en-US").toFormat("ccc M/d"),
      is_today: day.hasSame(now, "day"),
      all_day_events: [],
      timed_events: [],
    };
  });
}

function makeHours(config: CalendarConfig): HourMarker[] {
  const totalMinutes = (config.endHour - config.startHour) * 60;
  return Array.from({ length: config.endHour - config.startHour + 1 }, (_, index) => {
    const hour = config.startHour + index;
    const label = DateTime.fromObject({ hour }).toFormat(hour === 12 ? "ha" : "h");
    return {
      hour,
      label: label.toLowerCase(),
      top_pct: Math.round(((index * 60) / totalMinutes) * 1000) / 10,
    };
  });
}

function parseFeed(feed: IcsFeed, config: CalendarConfig, from: DateTime, to: DateTime): RawEvent[] {
  const parsed = ical.sync.parseICS(feed.ics);
  const events = Object.values(parsed).filter(isVEvent);
  const rawEvents: RawEvent[] = [];

  for (const event of events) {
    if (event.recurrenceid || event.status === "CANCELLED") {
      continue;
    }

    const instances = event.rrule
      ? ical.expandRecurringEvent(event, {
          from: from.toJSDate(),
          to: to.toJSDate(),
          includeOverrides: true,
          excludeExdates: true,
          expandOngoing: true,
        })
      : [instanceFromEvent(event)];

    for (const instance of instances) {
      if (instance.event.status === "CANCELLED") {
        continue;
      }
      rawEvents.push(normalizeInstance(instance, feed.name, config));
    }
  }

  return rawEvents.filter((event) => event.end > from && event.start < to);
}

function isVEvent(value: unknown): value is VEvent {
  return typeof value === "object" && value !== null && "type" in value && value.type === "VEVENT";
}

function instanceFromEvent(event: VEvent): EventInstance {
  return {
    start: event.start,
    end: event.end ?? inferEnd(event.start, event.start.dateOnly === true || event.datetype === "date"),
    summary: event.summary,
    isFullDay: event.start.dateOnly === true || event.datetype === "date",
    isRecurring: false,
    isOverride: false,
    event,
  };
}

function inferEnd(start: DateWithTimeZone, allDay: boolean): DateWithTimeZone {
  const end = new Date(start.valueOf() + (allDay ? 24 * 60 : 30) * 60 * 1000) as DateWithTimeZone;
  if (start.tz) {
    end.tz = start.tz;
  }
  if (allDay) {
    end.dateOnly = true;
  }
  return end;
}

function normalizeInstance(instance: EventInstance, calendar: string, config: CalendarConfig): RawEvent {
  const allDay = instance.isFullDay || instance.start.dateOnly === true || instance.event.datetype === "date";
  const start = toDateTime(instance.start, config.timezone, allDay);
  const end = toDateTime(instance.end ?? inferEnd(instance.start, allDay), config.timezone, allDay);
  const safeEnd = end > start ? end : start.plus(allDay ? { days: 1 } : { minutes: 30 });
  const uid = instance.event.uid || `${calendar}-${start.toISO()}-${stringValue(instance.summary)}`;

  return {
    uid,
    title: config.freeBusyOnly ? "Busy" : stringValue(instance.summary) || "Untitled",
    calendar,
    allDay,
    start,
    end: safeEnd,
  };
}

function toDateTime(date: DateWithTimeZone, timezone: string, allDay: boolean): DateTime {
  if (allDay) {
    return DateTime.fromJSDate(date, { zone: date.tz ?? "UTC" }).startOf("day");
  }
  return DateTime.fromJSDate(date, { zone: timezone });
}

function stringValue(value: ParameterValue | undefined): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return value.val ?? "";
}

function dedupeEvents(events: RawEvent[]): RawEvent[] {
  const seen = new Set<string>();
  const deduped: RawEvent[] = [];
  for (const event of events) {
    const key = [
      event.uid,
      event.allDay ? event.start.toISODate() : event.start.toUTC().toISO(),
      event.allDay ? event.end.toISODate() : event.end.toUTC().toISO(),
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function placeEvent(event: RawEvent, days: CalendarDay[], config: CalendarConfig): void {
  const byDate = new Map(days.map((day) => [day.date, day]));
  if (event.allDay) {
    for (let cursor = event.start.startOf("day"); cursor < event.end.startOf("day"); cursor = cursor.plus({ days: 1 })) {
      const day = byDate.get(cursor.toISODate() ?? "");
      if (day) {
        day.all_day_events.push({
          id: `${event.uid}-${cursor.toISODate()}`,
          title: event.title,
          calendar: event.calendar,
          start: event.start.toISODate() ?? "",
          end: event.end.toISODate() ?? "",
        });
      }
    }
    return;
  }

  for (const day of days) {
    const dayStart = DateTime.fromISO(day.date, { zone: config.timezone }).startOf("day");
    const dayEnd = dayStart.plus({ days: 1 });
    if (event.end <= dayStart || event.start >= dayEnd) {
      continue;
    }
    const segmentStart = DateTime.max(event.start, dayStart);
    const segmentEnd = DateTime.min(event.end, dayEnd);
    day.timed_events.push(makeTimedEvent(event, segmentStart, segmentEnd, config));
  }
}

function makeTimedEvent(event: RawEvent, segmentStart: DateTime, segmentEnd: DateTime, config: CalendarConfig): TimedEvent {
  const dayStart = segmentStart.startOf("day");
  const visibleStart = config.startHour * 60;
  const visibleEnd = config.endHour * 60;
  const visibleTotal = visibleEnd - visibleStart;
  const startMinutes = Math.floor(segmentStart.diff(dayStart, "minutes").minutes);
  const endMinutes = Math.ceil(segmentEnd.diff(dayStart, "minutes").minutes);
  const clippedStart = Math.max(visibleStart, Math.min(visibleEnd, startMinutes));
  const clippedEnd = Math.max(visibleStart, Math.min(visibleEnd, endMinutes));
  const heightMinutes = Math.max(12, clippedEnd - clippedStart);

  return {
    id: `${event.uid}-${segmentStart.toISODate()}-${startMinutes}`,
    title: event.title,
    calendar: event.calendar,
    start: segmentStart.toISO({ suppressMilliseconds: true }) ?? "",
    end: segmentEnd.toISO({ suppressMilliseconds: true }) ?? "",
    start_minutes: startMinutes,
    end_minutes: endMinutes,
    top_pct: roundPct(((clippedStart - visibleStart) / visibleTotal) * 100),
    height_pct: roundPct((heightMinutes / visibleTotal) * 100),
    column: 0,
    columns: 1,
    left_pct: 0,
    width_pct: 100,
  };
}

function layoutTimedEvents(events: TimedEvent[]): TimedEvent[] {
  const sorted = [...events].sort((a, b) => a.start_minutes - b.start_minutes || a.end_minutes - b.end_minutes);
  const laidOut: TimedEvent[] = [];
  let cluster: TimedEvent[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) {
      return;
    }
    laidOut.push(...layoutCluster(cluster));
    cluster = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.start_minutes >= clusterEnd) {
      flush();
    }
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.end_minutes);
  }
  flush();

  return laidOut.sort((a, b) => a.start_minutes - b.start_minutes || a.column - b.column);
}

function layoutCluster(events: TimedEvent[]): TimedEvent[] {
  const columnEnds: number[] = [];
  const assigned = events.map((event) => {
    let column = columnEnds.findIndex((end) => event.start_minutes >= end);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(event.end_minutes);
    } else {
      columnEnds[column] = event.end_minutes;
    }
    return { ...event, column };
  });

  const columns = Math.max(1, columnEnds.length);
  const gutter = columns > 1 ? 2 : 0;
  const width = 100 / columns;
  return assigned.map((event) => ({
    ...event,
    columns,
    left_pct: roundPct(event.column * width + gutter / 2),
    width_pct: roundPct(width - gutter),
  }));
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}
