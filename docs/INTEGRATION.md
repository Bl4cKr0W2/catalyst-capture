# Catalyst Capture – Integration Guide

This document is intended to be shared with other projects that need to embed and verify Catalyst Capture on their sites.

## Overview

Catalyst Capture provides a turnstile-like widget and token verification flow to protect form submissions from bots. It replaces third-party form gateways (like Formspark) by storing JSON payloads directly in Catalyst Capture. You will:

1. Obtain a **site key** (public) and **secret key** (server-only).
2. Embed the **client snippet** on your page.
3. Use the widget to generate a **token**.
4. Verify that token on your server.
5. Submit the JSON payload to Catalyst Capture.

## Requirements

- A site key (public)
- A secret key (server-only)
- HTTPS access to the API: https://captured.thecatalyst.dev

## Step 1: Add the Client Snippet

Add this to your HTML (replace `YOUR_SITE_KEY`):

```html
<div id="capture-slot"></div>
<script
  src="https://captured.thecatalyst.dev/v1/widget.js"
  data-site-key="YOUR_SITE_KEY"
  data-target="#capture-slot"
  async
></script>
```

When the user completes the challenge, the widget will emit a token. The script requests compiled widget HTML from the API and injects it into `data-target`.

### Embed HTML (Behind the Scenes)

The snippet calls:

```http
GET https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot
```

The response is HTML for the micro-ui widget. You generally do not need to call this directly.

## Step 2: Collect the Token

Example (pseudo):

```js
window.CatalystCapture.on("verified", (token) => {
  document.querySelector("#captureToken").value = token;
});
```

Include the token in your form submission.

## Step 3: Verify Token (Server-Side)

Use your secret key on your server to verify the token.

```http
POST https://captured.thecatalyst.dev/v1/verify
Content-Type: application/json

{
  "siteKey": "YOUR_SITE_KEY",
  "secretKey": "YOUR_SECRET_KEY",
  "token": "TOKEN_FROM_WIDGET",
  "ip": "USER_IP",
  "ua": "USER_AGENT",
  "origin": "https://your-site.com"
}
```

Response example:

```json
{
  "ok": true,
  "score": 0.93,
  "reason": "human",
  "accessToken": "ACCESS_TOKEN_IF_ENABLED"
}
```

Only proceed if `ok` is true.

### Server-Side (Symmetric Key) Verification

If you want a non-asymmetric, server-only verification, use the site **secret key**:

```http
POST https://captured.thecatalyst.dev/v1/verify-server
Content-Type: application/json
x-site-secret: YOUR_SECRET_KEY

{
  "siteKey": "YOUR_SITE_KEY",
  "token": "TOKEN_FROM_WIDGET"
}
```

## Step 4: Submit Payload

Submit your JSON payload (any shape is allowed):

```http
POST https://captured.thecatalyst.dev/v1/submit
Content-Type: application/json

{
  "siteKey": "YOUR_SITE_KEY",
  "accessToken": "ACCESS_TOKEN_FROM_VERIFY",
  "honeypot": "",
  "fingerprint": "optional-client-hash",
  "payload": {
    "name": "Ada",
    "email": "ada@example.com",
    "message": "Hello"
  }
}
```

Response:

```json
{
  "ok": true,
  "eventId": "evt_123456"
}
```

## Security Notes

- **Never expose your secret key in the browser.**
- Always verify tokens on your server.
- Keep your server clock accurate for token expiration.
- Use IP gating and rate limits on your site as a second layer.
- Add a hidden **honeypot** field and leave it empty. If filled, the API rejects the submission.
- Tokens are short-lived. Submitting too quickly after challenge can be rejected.
- Prefer `accessToken` for submit calls.

## UI-Only Best Practices

If you must integrate from a UI-only app (no server), use these safeguards:

- **Do not** call `/v1/verify-server` (it requires a secret key).
- Use `/v1/verify` and treat it as **low-trust** validation.
- Submit with `accessToken` from `/v1/verify` instead of raw token.
- Keep rate limits conservative and use IP gating on the API.
- Require JS and keep tokens short-lived.
- Add honeypot fields and client-side timing checks.
- Log suspicious submissions for manual review.

## Support

If you need keys or policy updates, contact the Catalyst Capture admin.
