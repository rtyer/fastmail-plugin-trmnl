# Security Policy

## Sensitive Calendar URLs

Published ICS URLs commonly act like bearer tokens. Anyone with the URL may be able to read calendar metadata and event details until the URL is rotated or unpublished.

- Do not commit real ICS URLs.
- Prefer configuring `ICS_URLS` as a server-side environment variable.
- Avoid putting real ICS URLs in polling URL query strings for production deployments.
- Use `FREE_BUSY_ONLY=true` if the TRMNL screen should hide event titles.
- Rotate or unpublish a calendar URL if it is accidentally shared.

## Reporting Vulnerabilities

Please open a private security advisory on GitHub if available, or contact the repository maintainer directly. Avoid posting real calendar URLs, event contents, or deployment secrets in public issues.
