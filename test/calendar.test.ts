import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { buildCalendarPayloadFromIcs } from "../src/calendar.js";
import type { CalendarConfig } from "../src/types.js";

const baseConfig: CalendarConfig = {
  sourceMode: "ics",
  sources: [],
  caldavServer: "https://caldav.fastmail.com/",
  calendarInclude: [],
  calendarExclude: [],
  timezone: "America/Denver",
  viewMode: "rolling_week",
  startHour: 8,
  endHour: 21,
  showCalendarNames: true,
  freeBusyOnly: false,
  fetchTimeoutMs: 10000,
};

const now = DateTime.fromISO("2026-06-05T12:00:00", { zone: "America/Denver" });

function makeIcs(events: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//fastmail-plugin-trmnl//tests//EN",
    "CALSCALE:GREGORIAN",
    events.trim(),
    "END:VCALENDAR",
  ].join("\r\n");
}

function payload(events: string, config: Partial<CalendarConfig> = {}) {
  return buildCalendarPayloadFromIcs(
    [{ name: "Family", ics: makeIcs(events) }],
    { ...baseConfig, ...config },
    now,
  );
}

describe("calendar normalization", () => {
  it("builds a rolling five-day range for the five_day view", () => {
    const result = payload("", { viewMode: "five_day" });

    expect(result.day_count).toBe(5);
    expect(result.range).toEqual({
      start: "2026-06-05",
      end: "2026-06-09",
    });
    expect(result.days.map((day) => day.label)).toEqual([
      "Fri 6/5",
      "Sat 6/6",
      "Sun 6/7",
      "Mon 6/8",
      "Tue 6/9",
    ]);
  });

  it("places all-day events in the all-day row", () => {
    const result = payload(`
BEGIN:VEVENT
UID:all-day-1
DTSTAMP:20260601T120000Z
SUMMARY:Louisville Dolphins
DTSTART;VALUE=DATE:20260605
DTEND;VALUE=DATE:20260606
END:VEVENT
`);

    expect(result.days[0].all_day_events).toMatchObject([
      {
        title: "Louisville Dolphins",
        calendar: "Family",
        start: "2026-06-05",
        end: "2026-06-06",
      },
    ]);
    expect(result.days[0].timed_events).toHaveLength(0);
  });

  it("places timed events in the correct day and hour slot", () => {
    const result = payload(`
BEGIN:VEVENT
UID:timed-1
DTSTAMP:20260601T120000Z
SUMMARY:Practice (10U Bolinger)
DTSTART;TZID=America/Denver:20260605T173000
DTEND;TZID=America/Denver:20260605T190000
END:VEVENT
`);

    expect(result.days[0].timed_events).toMatchObject([
      {
        title: "Practice (10U Bolinger)",
        start_minutes: 1050,
        end_minutes: 1140,
        time_label: "5:30 PM - 7 PM",
        top_pct: 73.1,
        height_pct: 11.5,
      },
    ]);
    expect(result.days[0].timed_events[0].start).toBe("2026-06-05T17:30:00-06:00");
  });

  it("splits timed multi-day events across days", () => {
    const result = payload(`
BEGIN:VEVENT
UID:multi-day-1
DTSTAMP:20260601T120000Z
SUMMARY:Overnight maintenance
DTSTART;TZID=America/Denver:20260605T200000
DTEND;TZID=America/Denver:20260606T100000
END:VEVENT
`);

    expect(result.days[0].timed_events).toMatchObject([
      { title: "Overnight maintenance", start_minutes: 1200, end_minutes: 1440 },
    ]);
    expect(result.days[1].timed_events).toMatchObject([
      { title: "Overnight maintenance", start_minutes: 0, end_minutes: 600 },
    ]);
  });

  it("expands recurring events inside the visible range", () => {
    const result = payload(`
BEGIN:VEVENT
UID:rrule-1
DTSTAMP:20260601T120000Z
SUMMARY:Daily standup
DTSTART;TZID=America/Denver:20260605T090000
DTEND;TZID=America/Denver:20260605T093000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
`);

    expect(result.days.slice(0, 3).map((day) => day.timed_events[0]?.title)).toEqual([
      "Daily standup",
      "Daily standup",
      "Daily standup",
    ]);
  });

  it("converts timed events from their source timezone to the display timezone", () => {
    const result = payload(`
BEGIN:VEVENT
UID:tz-1
DTSTAMP:20260601T120000Z
SUMMARY:East coast call
DTSTART;TZID=America/New_York:20260605T100000
DTEND;TZID=America/New_York:20260605T110000
END:VEVENT
`);

    expect(result.days[0].timed_events).toMatchObject([
      {
        start: "2026-06-05T08:00:00-06:00",
        end: "2026-06-05T09:00:00-06:00",
        start_minutes: 480,
        end_minutes: 540,
      },
    ]);
  });

  it("dedupes duplicate UIDs across feeds", () => {
    const ics = makeIcs(`
BEGIN:VEVENT
UID:duplicate-1
DTSTAMP:20260601T120000Z
SUMMARY:Shared appointment
DTSTART;TZID=America/Denver:20260605T110000
DTEND;TZID=America/Denver:20260605T120000
END:VEVENT
`);
    const result = buildCalendarPayloadFromIcs(
      [
        { name: "Family", ics },
        { name: "Sports", ics },
      ],
      baseConfig,
      now,
    );

    expect(result.days[0].timed_events).toHaveLength(1);
    expect(result.days[0].timed_events[0].calendar).toBe("Family");
  });

  it("ignores cancelled events", () => {
    const result = payload(`
BEGIN:VEVENT
UID:cancelled-1
DTSTAMP:20260601T120000Z
SUMMARY:Do not show
STATUS:CANCELLED
DTSTART;TZID=America/Denver:20260605T110000
DTEND;TZID=America/Denver:20260605T120000
END:VEVENT
`);

    expect(result.days[0].timed_events).toHaveLength(0);
    expect(result.days[0].all_day_events).toHaveLength(0);
  });

  it("assigns overlapping events to side-by-side columns", () => {
    const result = payload(`
BEGIN:VEVENT
UID:overlap-a
DTSTAMP:20260601T120000Z
SUMMARY:One
DTSTART;TZID=America/Denver:20260605T100000
DTEND;TZID=America/Denver:20260605T110000
END:VEVENT
BEGIN:VEVENT
UID:overlap-b
DTSTAMP:20260601T120000Z
SUMMARY:Two
DTSTART;TZID=America/Denver:20260605T103000
DTEND;TZID=America/Denver:20260605T113000
END:VEVENT
`);

    expect(result.days[0].timed_events).toMatchObject([
      { title: "One", columns: 2, column: 0 },
      { title: "Two", columns: 2, column: 1 },
    ]);
  });
});
