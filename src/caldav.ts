import { DateTime } from "luxon";
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import type { CalendarConfig } from "./types.js";

export type IcsFeed = {
  name: string;
  ics: string;
};

type DAVClient = Awaited<ReturnType<typeof createDAVClient>>;

export async function fetchCalDavIcsFeeds(
  config: CalendarConfig,
  rangeStart: DateTime,
  rangeEndExclusive: DateTime,
): Promise<IcsFeed[]> {
  if (!config.caldavUsername || !config.caldavPassword) {
    throw new Error("CalDAV mode requires FASTMAIL_USERNAME and FASTMAIL_APP_PASSWORD.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const client = await createDAVClient({
      serverUrl: config.caldavServer,
      credentials: {
        username: config.caldavUsername,
        password: config.caldavPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetchOptions: { signal: controller.signal },
    });

    return fetchCalDavIcsFeedsWithClient(client, config, rangeStart, rangeEndExclusive);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCalDavIcsFeedsWithClient(
  client: Pick<DAVClient, "fetchCalendars" | "fetchCalendarObjects">,
  config: CalendarConfig,
  rangeStart: DateTime,
  rangeEndExclusive: DateTime,
): Promise<IcsFeed[]> {
  const calendars = filterCalendars(await client.fetchCalendars(), config);
  const calendarObjectsByCalendar = await Promise.all(
    calendars.map(async (calendar) => ({
      calendar,
      objects: await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start: rangeStart.toUTC().toISO() ?? rangeStart.toUTC().toString(),
          end: rangeEndExclusive.toUTC().toISO() ?? rangeEndExclusive.toUTC().toString(),
        },
      }),
    })),
  );

  return calendarObjectsByCalendar.flatMap(({ calendar, objects }) => {
    const name = calendarName(calendar);
    return objects
      .filter((object) => typeof object.data === "string" && object.data.includes("BEGIN:VEVENT"))
      .map((object) => ({
        name,
        ics: object.data as string,
      }));
  });
}

function filterCalendars(calendars: DAVCalendar[], config: CalendarConfig): DAVCalendar[] {
  const includes = config.calendarInclude.map((name) => name.toLowerCase());
  const excludes = config.calendarExclude.map((name) => name.toLowerCase());

  return calendars.filter((calendar) => {
    const name = calendarName(calendar).toLowerCase();
    const supportsEvents = !calendar.components || calendar.components.includes("VEVENT");
    const included = includes.length === 0 || includes.some((include) => name.includes(include));
    const excluded = excludes.some((exclude) => name.includes(exclude));
    return supportsEvents && included && !excluded;
  });
}

function calendarName(calendar: DAVCalendar): string {
  if (typeof calendar.displayName === "string" && calendar.displayName.trim() !== "") {
    return calendar.displayName.trim();
  }
  if (calendar.url) {
    const parts = calendar.url.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? "Calendar");
  }
  return "Calendar";
}

