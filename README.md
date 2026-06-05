# Fastmail TRMNL Week Grid

A small TypeScript backend plus TRMNL Liquid template for showing multiple published Fastmail calendar ICS feeds in a single Google-Calendar-style week grid.

Published ICS URLs often work like bearer tokens. Treat them as secrets: do not commit real URLs, do not paste real URLs into screenshots, and prefer server-side environment variables over query strings in production.

## Features

- Fetches multiple Fastmail published ICS URLs.
- Parses `VEVENT`, timed events, all-day events, multi-day events, recurrence rules, EXDATE/RECURRENCE-ID overrides, timezones, duplicate UIDs, and cancelled events.
- Normalizes events into TRMNL-friendly JSON.
- Supports `rolling_week`, `work_week`, and `three_day` layouts.
- Clips timed events to configurable grid hours and lays overlapping events side-by-side.
- Includes grayscale-friendly TRMNL Liquid/HTML/CSS in [trmnl/week-grid.liquid](trmnl/week-grid.liquid).

## Configuration

Set these environment variables on the backend:

| Variable | Default | Notes |
| --- | --- | --- |
| `ICS_URLS` | required | Comma-separated Fastmail published ICS URLs. |
| `CALENDAR_NAMES` | `Calendar 1`, etc. | Comma-separated display names matching `ICS_URLS`. |
| `TIMEZONE` | `America/Denver` | Display timezone. |
| `VIEW_MODE` | `rolling_week` | `rolling_week`, `work_week`, `three_day`, or `agenda`. |
| `START_HOUR` | `8` | First hour shown in timed grid. |
| `END_HOUR` | `21` | Last hour boundary shown in timed grid. |
| `SHOW_CALENDAR_NAMES` | `true` | Include calendar labels in event blocks. |
| `FREE_BUSY_ONLY` | `false` | Replace event titles with `Busy`. |
| `FETCH_TIMEOUT_MS` | `10000` | Per-feed fetch timeout. |
| `PORT` | `3000` | HTTP port. |

The same options can be passed as lowercase query parameters for local testing, for example `?view_mode=three_day&start_hour=7`. Avoid putting real ICS URLs in query strings for production deployments because URLs are commonly logged by proxies and hosting platforms.

## Run Locally

```sh
npm install
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
  -e ICS_URLS='https://calendar.example.com/family.ics,https://calendar.example.com/sports.ics' \
  -e CALENDAR_NAMES='Family,Sports' \
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
