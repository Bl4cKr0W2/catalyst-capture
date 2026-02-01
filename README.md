# Catalyst Capture

An anti-bot capture and submission gateway similar to a turnstile. This service issues site keys, validates access tokens, gates submissions by IP/risk rules, and stores arbitrary JSON payloads for downstream processing. It provides a RESTful API for verification and a lightweight integration snippet for other sites.

## Goals

- Provide **public and secret keys** for each site (tenant).
- Generate **challenge tokens** and **access tokens** to protect forms.
- **Gate by IP** and policy (allow/deny/rate-limit/risk checks).
- Accept **any JSON payload** with minimal schema constraints.
- Store payloads and metadata for auditing and routing.
- Offer a **pasteable integration snippet** for client sites.
- Support **Docker + Nginx** for deployment at captured.thecatalyst.dev.

## High-Level Flow

1. A client site embeds the Capture snippet with its **site key**.
2. The snippet requests a **challenge** and renders a widget.
3. On successful challenge, the client receives a **token**.
4. The client submits the form payload + token to its backend (preferred) or directly to this API.
5. The API verifies the token, applies IP/policy gates, and **stores JSON** payload + metadata.
6. The API returns a **verification result** and an **event id**.

## Core Components (Planned)

- **API Service**: REST endpoints for key management, challenge, verify, submit, and embed HTML.
- **Policy Engine**: IP allow/deny lists, rate limits, geo rules, risk scoring.
- **Storage**: JSON payload store + audit metadata (IP, UA, origin, timestamps).
- **Token Service**: short-lived tokens signed by private key; public key used for validation.
- **Integration Snippet**: small JS loader + widget, embeddable in client sites.

## API Surface (Draft)

### Public

- `POST /v1/challenge`
	- Input: `siteKey`, `origin`
	- Output: `challengeId`, `challenge` (widget config)

- `GET /v1/embed`
	- Input: `siteKey`, `target` (optional), `theme` (optional)
	- Output: **HTML** that renders the micro-ui widget

- `POST /v1/verify`
	- Input: `siteKey`, `challengeId`, `token`, `ip`, `ua`, `origin`
	- Output: `ok`, `score`, `reason`, `accessToken` (optional)

- `POST /v1/verify-server`
	- Input: `siteKey`, `token`, `secretKey` (or `x-site-secret` header)
	- Output: `ok`, `score`, `reason`

- `POST /v1/submit`
	- Input: `siteKey`, `token` or `accessToken`, `payload` (any JSON)
	- Output: `ok`, `eventId`

### Admin

- `POST /v1/admin/sites`
	- Create a new site and issue `siteKey` + `secretKey`.

- `GET /v1/admin/sites/:id`
	- View site configuration and policies.

- `PATCH /v1/admin/sites/:id`
	- Update IP rules, rate limits, origins, token TTLs, and webhook routes.

## Security Model (Draft)

- **Public site key**: embedded in client sites; used to request challenges.
- **Secret key**: server-only; used for admin operations and server-side verification.
- **Challenge token**: short-lived, single-use; issued after widget completion.
- **Access token**: optional, issued after verification; used for submit calls.
- **Signed tokens**: using asymmetric keys (public/private) for validation.

## Data Stored (Draft)

- `eventId`
- `siteId`
- `payload` (arbitrary JSON)
- `createdAt`
- `ip`, `ua`, `origin`, `referrer`
- `verification` (score, reason)

## Deployment Plan

This project is designed for containerized deployment with Nginx as a reverse proxy.

- **API**: runs in a Docker container.
- **Nginx**: handles TLS termination, rate limiting, and routing.
- **Domain**: captured.thecatalyst.dev

## Environment Configuration

These values are required for the initial Turnstile integration while Catalyst Capture is being built. Formspark is being replaced by this system. Store them in an environment file (for example, `.env`).

```
VITE_TURNSTILE_SITE_KEY=0x4AAasdfMk_l8Z
TURNSTILE_SECRET_KEY=0x4AAAAAAasdfGTb6bZu4
```

## Key Management (Planned)

The service will support **project-scoped keys** bound to one or more domains.

### Data Model (Draft)

- `projects`
	- `id`, `name`, `createdAt`
- `project_domains`
	- `projectId`, `domain`
- `project_keys`
	- `projectId`
	- `siteKey` (public)
	- `secretKey` (private)
	- `createdAt`, `rotatedAt`, `revokedAt`

### Key Creation Flow (Draft)

1. Admin creates a project.
2. Admin adds one or more allowed domains.
3. Admin requests a new key pair.
4. The API stores keys and returns the **public site key** for client integration.
5. The **secret key** is stored server-side and used for verification only.

## Next Steps

1. Finalize tech stack (Node/Express, Fastify, or similar).
2. Define storage (Postgres + JSONB recommended).
3. Implement the API and snippet.
4. Add Docker + Nginx configuration.
5. Publish integration docs for client sites.

## Integration Documentation

See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the shareable guide that other projects can follow.

## Micro UI Embed (Planned)

Provide a single script tag that injects the widget into a target element. Example pattern:

```html
<div id="capture-slot"></div>
<script
	src="https://captured.thecatalyst.dev/v1/widget.js"
	data-site-key="YOUR_SITE_KEY"
	data-target="#capture-slot"
	async
></script>
```

The script will render a lightweight UI into `data-target` and emit a verified token.
Internally, the script will call `GET /v1/embed` to fetch the compiled HTML for the widget.