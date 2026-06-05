# Security Policy

## Sensitive Calendar URLs

Published ICS URLs commonly act like bearer tokens. Anyone with the URL may be able to read calendar metadata and event details until the URL is rotated or unpublished.

- Do not commit real ICS URLs.
- Prefer configuring `ICS_URLS` as a server-side environment variable.
- Avoid putting real ICS URLs in polling URL query strings for production deployments.
- Use `FREE_BUSY_ONLY=true` if the TRMNL screen should hide event titles.
- Rotate or unpublish a calendar URL if it is accidentally shared.

## Fastmail CalDAV Credentials

The preferred Fastmail mode uses CalDAV with an app-specific password. Store `FASTMAIL_USERNAME` and `FASTMAIL_APP_PASSWORD` only in your deployment secret manager or local `.env` file.

- Do not commit real app passwords.
- Create an app password scoped to calendar access when possible.
- Rotate the app password if it is exposed.

## TRMNL Polling And Refresh Tokens

Cloudflare Worker deployments require bearer tokens for both TRMNL polling and manual refresh.

- Put `TRMNL_POLLING_TOKEN` in the TRMNL Polling Headers field, never in the URL.
- Use a different `REFRESH_TOKEN` for `POST /refresh`.
- Use only HTTPS for `TRMNL_WEBHOOK_URL`.
- Rotate both tokens if a screenshot, log, or browser history entry exposes them.
- Keep `FREE_BUSY_ONLY=true` for privacy-sensitive displays.

## Reporting Vulnerabilities

Please open a private security advisory on GitHub if available, or contact the repository maintainer directly. Avoid posting real calendar URLs, event contents, or deployment secrets in public issues.
