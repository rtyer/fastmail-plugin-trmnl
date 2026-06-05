# Fastmail TRMNL Week Grid

A small TypeScript backend plus TRMNL Liquid template for showing Fastmail calendars in a single Google-Calendar-style week grid.

The preferred source is Fastmail CalDAV: one Fastmail username plus an app-specific password discovers all calendars automatically. Published ICS URLs are still supported as a fallback, but they often work like bearer tokens. Treat all calendar URLs and app passwords as secrets.

## Features

- Discovers and fetches Fastmail calendars via CalDAV.
- Keeps published ICS URL support as a fallback mode.
- Parses `VEVENT`, timed events, all-day events, multi-day events, recurrence rules, EXDATE/RECURRENCE-ID overrides, timezones, duplicate UIDs, and cancelled events.
- Normalizes events into TRMNL-friendly JSON.
- Supports `rolling_week`, `work_week`, and `three_day` layouts.
- Clips timed events to configurable grid hours and lays overlapping events side-by-side.
- Includes grayscale-friendly TRMNL Liquid/HTML/CSS in [trmnl/week-grid.liquid](trmnl/week-grid.liquid).

## Configuration

Set these environment variables on the backend:

| Variable | Default | Notes |
| --- | --- | --- |
| `SOURCE_MODE` | auto | `caldav` or `ics`. Defaults to `caldav` when Fastmail credentials are present, otherwise `ics`. |
| `FASTMAIL_USERNAME` | required for CalDAV | Full Fastmail username/email address. |
| `FASTMAIL_APP_PASSWORD` | required for CalDAV | Fastmail app-specific password. |
| `CALDAV_SERVER` | `https://caldav.fastmail.com/` | CalDAV endpoint. |
| `CALENDAR_INCLUDE` | empty | Optional comma-separated case-insensitive substrings of calendar names to include. |
| `CALENDAR_EXCLUDE` | empty | Optional comma-separated case-insensitive substrings of calendar names to exclude. |
| `ICS_URLS` | required for ICS mode | Comma-separated published ICS URLs. |
| `CALENDAR_NAMES` | `Calendar 1`, etc. | Comma-separated display names matching `ICS_URLS`. |
| `TIMEZONE` | `America/Denver` | Display timezone. |
| `VIEW_MODE` | `rolling_week` | `rolling_week`, `work_week`, `three_day`, or `agenda`. |
| `START_HOUR` | `8` | First hour shown in timed grid. |
| `END_HOUR` | `21` | Last hour boundary shown in timed grid. |
| `SHOW_CALENDAR_NAMES` | `true` | Include calendar labels in event blocks. |
| `FREE_BUSY_ONLY` | `false` | Replace event titles with `Busy`. |
| `FETCH_TIMEOUT_MS` | `10000` | Per-feed fetch timeout. |
| `PORT` | `3000` | HTTP port. |

The same options can be passed as lowercase query parameters for local testing, for example `?view_mode=three_day&start_hour=7`. Avoid putting real ICS URLs or passwords in query strings for production deployments because URLs are commonly logged by proxies and hosting platforms.

## Run Locally

```sh
npm install
cp .env.example .env
# Edit .env with your Fastmail username and app-specific password.
npm run dev
```

Then poll:

```sh
curl 'http://localhost:3000/events'
```

With query-string calendar config:

```sh
curl 'http://localhost:3000/events?ics_urls=https%3A%2F%2Fexample.com%2Fcalendar.ics&calendar_names=Family'
```

## Docker

```sh
docker build -t fastmail-plugin-trmnl .
docker run --rm -p 3000:3000 \
  -e SOURCE_MODE='caldav' \
  -e FASTMAIL_USERNAME='person@example.com' \
  -e FASTMAIL_APP_PASSWORD='app-specific-password' \
  -e TIMEZONE='America/Denver' \
  fastmail-plugin-trmnl
```

Set the TRMNL private plugin polling URL to:

```text
https://your-service.example.com/events
```

## TRMNL Private Plugin

1. Publish the backend somewhere TRMNL can reach it.
2. Create a TRMNL private plugin that polls the backend JSON endpoint.
3. Paste [trmnl/week-grid.liquid](trmnl/week-grid.liquid) into the plugin markup.
4. Set the plugin refresh interval to whatever is appropriate for the calendars.

The template avoids client-side JavaScript and expects the backend JSON to provide precomputed day labels, hour markers, event positions, and overlap columns.

## JSON Shape

The `/events` and `/calendar` endpoints return:

```json
{
  "synced_at": "2026-06-05T18:00:00Z",
  "synced_label": "just now",
  "source_mode": "caldav",
  "timezone": "America/Denver",
  "view_mode": "rolling_week",
  "start_hour": 8,
  "end_hour": 21,
  "show_calendar_names": true,
  "free_busy_only": false,
  "range": {
    "start": "2026-06-05",
    "end": "2026-06-11"
  },
  "days": []
}
```

Each day includes `all_day_events` and `timed_events`. Timed events include absolute local start/end timestamps plus `start_minutes`, `end_minutes`, `top_pct`, `height_pct`, `left_pct`, and `width_pct` for Liquid rendering.

## Tests

```sh
npm test
npm run typecheck
```
