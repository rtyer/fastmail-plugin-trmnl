# Fastmail TRMNL Week Grid

A small TypeScript backend plus TRMNL Liquid template for showing Fastmail calendars in a single Google-Calendar-style week grid.

The preferred source is Fastmail CalDAV: one Fastmail username plus an app-specific password discovers all calendars automatically. Published ICS URLs are still supported as a fallback, but they often work like bearer tokens. Treat all calendar URLs and app passwords as secrets.

## Features

- Discovers and fetches Fastmail calendars via CalDAV.
- Keeps published ICS URL support as a fallback mode.
- Parses `VEVENT`, timed events, all-day events, multi-day events, recurrence rules, EXDATE/RECURRENCE-ID overrides, timezones, duplicate UIDs, and cancelled events.
- Normalizes events into TRMNL-friendly JSON.
- Supports `rolling_week`, `five_day`, `work_week`, and `three_day` layouts.
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
| `VIEW_MODE` | `five_day` | `five_day`, `rolling_week`, `work_week`, `three_day`, or `agenda`. |
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

## Cloudflare Workers

Cloudflare Workers are the preferred deployment target for a TRMNL private plugin because the Worker can cache the generated calendar JSON in KV and serve polling requests quickly.

### 1. Create KV

Install dependencies first so the project-local Wrangler CLI is available:

```sh
npm install
```

```sh
npm exec -- wrangler kv namespace create CALENDAR_CACHE
```

Copy the returned namespace id into [wrangler.toml](wrangler.toml):

```toml
[[kv_namespaces]]
binding = "CALENDAR_CACHE"
id = "your-kv-namespace-id"
```

The checked-in `wrangler.toml` intentionally contains a placeholder id; `npm run deploy:worker` will not work until that value is replaced.

For local Worker development, you can copy the example vars file:

```sh
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars`. Do not commit `.dev.vars`.

### 2. Configure Secrets

```sh
npm exec -- wrangler secret put FASTMAIL_USERNAME
npm exec -- wrangler secret put FASTMAIL_APP_PASSWORD
npm exec -- wrangler secret put TRMNL_POLLING_TOKEN
npm exec -- wrangler secret put REFRESH_TOKEN
```

Non-secret defaults live in the `[vars]` section of [wrangler.toml](wrangler.toml). You can edit those values directly:

```toml
[vars]
SOURCE_MODE = "caldav"
TIMEZONE = "America/Denver"
VIEW_MODE = "five_day"
START_HOUR = "8"
END_HOUR = "21"
```

Optional CalDAV filters can be set as dashboard variables or secrets:

```sh
npm exec -- wrangler secret put CALENDAR_INCLUDE
npm exec -- wrangler secret put CALENDAR_EXCLUDE
```

For ICS fallback mode, set `SOURCE_MODE = "ics"` and configure these as secrets because ICS URLs often act like bearer tokens:

```sh
npm exec -- wrangler secret put ICS_URLS
npm exec -- wrangler secret put CALENDAR_NAMES
```

For optional webhook push, configure an HTTPS webhook URL:

```sh
npm exec -- wrangler secret put TRMNL_WEBHOOK_URL
```

`TRMNL_WEBHOOK_URL` must use `https://`; HTTP webhook URLs are ignored and recorded as a non-fatal refresh warning.

### 3. Run Worker Locally

```sh
npm run dev:worker
```

In another terminal:

```sh
curl http://localhost:8787/health
curl -H "authorization: bearer <TRMNL_POLLING_TOKEN>" http://localhost:8787/events
curl -X POST -H "authorization: bearer <REFRESH_TOKEN>" http://localhost:8787/refresh
curl -H "authorization: bearer <REFRESH_TOKEN>" http://localhost:8787/status
```

Wrangler does not run cron triggers automatically in normal local dev. To test the scheduled handler:

```sh
npm run dev:worker -- --test-scheduled
curl http://localhost:8787/__scheduled
```

### 4. Deploy

```sh
npm run deploy:worker
```

The Worker exposes:

```text
GET  /events
GET  /calendar
POST /refresh
GET  /health
GET  /status
```

`GET /events` and `GET /calendar` return the cached TRMNL JSON. If the cache is missing, the Worker attempts one synchronous refresh. `POST /refresh` performs a manual refresh. `GET /health` returns public cache freshness metadata without error details. `GET /status` requires `REFRESH_TOKEN` and includes sanitized diagnostic details. The scheduled cron in [wrangler.toml](wrangler.toml) refreshes KV every 30 minutes.

### 5. TRMNL Setup

In your TRMNL Private Plugin:

- Strategy: `Polling`
- Polling URL:

```text
https://fastmail-plugin-trmnl.<your-subdomain>.workers.dev/events
```

- Polling Verb: `GET`
- Polling Headers:

```text
authorization=bearer <TRMNL_POLLING_TOKEN>
```

Never put `TRMNL_POLLING_TOKEN`, `REFRESH_TOKEN`, Fastmail credentials, or ICS URLs in the query string.

Paste [trmnl/week-grid.liquid](trmnl/week-grid.liquid) into the plugin markup editor and click **Force Refresh**.

### Optional TRMNL Webhook Push

Polling remains the primary integration. If `TRMNL_WEBHOOK_URL` is set, successful scheduled/manual refreshes also POST:

```json
{ "merge_variables": {} }
```

where `merge_variables` contains the same payload returned by `/events`.

## TRMNL Private Plugin

1. Publish the backend somewhere TRMNL can reach it.
2. Create a TRMNL private plugin that polls the backend JSON endpoint.
3. Paste [trmnl/week-grid.liquid](trmnl/week-grid.liquid) into the plugin markup, or use [trmnl/week-grid-x.liquid](trmnl/week-grid-x.liquid) for TRMNL X.
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
  "view_mode": "five_day",
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
