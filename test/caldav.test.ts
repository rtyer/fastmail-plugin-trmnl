import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { DAVCalendar } from "tsdav";
import { fetchCalDavIcsFeedsWithClient } from "../src/caldav.js";
import type { CalendarConfig } from "../src/types.js";

const baseConfig: CalendarConfig = {
  sourceMode: "caldav",
  sources: [],
  caldavServer: "https://caldav.fastmail.com/",
  caldavUsername: "person@example.com",
  caldavPassword: "app-password",
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

const rangeStart = DateTime.fromISO("2026-06-05T00:00:00", { zone: "America/Denver" });
const rangeEnd = DateTime.fromISO("2026-06-12T00:00:00", { zone: "America/Denver" });

describe("CalDAV adapter", () => {
  it("fetches event objects from discovered calendars", async () => {
    const requestedCalendars: string[] = [];
    const client = {
      fetchCalendars: async () => [
        { url: "https://caldav.fastmail.com/family/", displayName: "Family", components: ["VEVENT"] },
        { url: "https://caldav.fastmail.com/tasks/", displayName: "Tasks", components: ["VTODO"] },
      ],
      fetchCalendarObjects: async ({ calendar }: { calendar: DAVCalendar }) => {
        requestedCalendars.push(typeof calendar.displayName === "string" ? calendar.displayName : "");
        return [
          {
            url: "https://caldav.fastmail.com/family/event.ics",
            data: [
              "BEGIN:VCALENDAR",
              "BEGIN:VEVENT",
              "UID:family-1",
              "SUMMARY:Dinner",
              "DTSTART;TZID=America/Denver:20260605T180000",
              "DTEND;TZID=America/Denver:20260605T190000",
              "END:VEVENT",
              "END:VCALENDAR",
            ].join("\r\n"),
          },
        ];
      },
    };

    const feeds = await fetchCalDavIcsFeedsWithClient(client, baseConfig, rangeStart, rangeEnd);

    expect(requestedCalendars).toEqual(["Family"]);
    expect(feeds).toMatchObject([{ name: "Family" }]);
    expect(feeds[0].ics).toContain("BEGIN:VEVENT");
  });

  it("honors calendar include and exclude filters", async () => {
    const requestedCalendars: string[] = [];
    const client = {
      fetchCalendars: async () => [
        { url: "https://caldav.fastmail.com/family/", displayName: "Family", components: ["VEVENT"] },
        { url: "https://caldav.fastmail.com/sports/", displayName: "Sports", components: ["VEVENT"] },
        { url: "https://caldav.fastmail.com/holidays/", displayName: "Holidays", components: ["VEVENT"] },
      ],
      fetchCalendarObjects: async ({ calendar }: { calendar: DAVCalendar }) => {
        requestedCalendars.push(typeof calendar.displayName === "string" ? calendar.displayName : "");
        return [];
      },
    };

    await fetchCalDavIcsFeedsWithClient(
      client,
      { ...baseConfig, calendarInclude: ["s"], calendarExclude: ["holiday"] },
      rangeStart,
      rangeEnd,
    );

    expect(requestedCalendars).toEqual(["Sports"]);
  });
});
