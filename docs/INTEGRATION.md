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

## Step 1: Add the Widget to Your HTML

Add this to your HTML where you want the verification widget (replace `YOUR_SITE_KEY`):

```html
<div id="capture-slot"></div>
```

Then fetch and inject the widget HTML:

```html
<script>
(async function() {
  try {
    const response = await fetch('https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
    const html = await response.text();
    document.getElementById('capture-slot').innerHTML = html;
  } catch (error) {
    console.error('Error loading Catalyst widget:', error);
  }
})();
</script>
```

**Alternative**: Load directly in the div (the embed endpoint returns self-executing HTML):

```html
<div id="capture-slot">
  <!-- Widget will be injected here -->
</div>
<script>
fetch('https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot')
  .then(r => r.text())
  .then(html => document.getElementById('capture-slot').innerHTML = html);
</script>
```

## Step 2: Listen for Verification Events

The widget emits events via `postMessage` when the user completes verification:

```js
let captureToken = null;

window.addEventListener('message', (event) => {
  // Verify event is from your widget
  if (event.data?.type === 'catalyst-verified') {
    captureToken = event.data.token;
    console.log('Verification complete:', captureToken);
    
    // Enable your form submit button
    document.getElementById('submit-button').disabled = false;
  }
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

## Complete Working Example (Client-Side Only)

```html
<form id="waitlist-form">
  <input type="email" id="email" placeholder="Your email" required />
  <input type="text" name="honeypot" autocomplete="off" tabindex="-1" class="hidden" />
  
  <div id="capture-slot"></div>
  
  <button type="submit" id="submit-btn" disabled>
    Join Waitlist
  </button>
  
  <p id="status"></p>
</form>

<script>
  // Load the widget
  (async function() {
    try {
      const response = await fetch('https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
      const html = await response.text();
      document.getElementById('capture-slot').innerHTML = html;
    } catch (error) {
      console.error('Error loading widget:', error);
    }
  })();
  
  // Listen for verification
  let captureToken = null;
  
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'catalyst-verified') {
      captureToken = event.data.token;
      document.getElementById('submit-btn').disabled = false;
      document.getElementById('status').textContent = '✓ Verified!';
    }
  });
  
  // Handle form submission
  document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!captureToken) {
      alert('Please verify first');
      return;
    }
    
    const email = document.getElementById('email').value;
    const honeypot = document.querySelector('[name="honeypot"]').value;
    
    try {
      // Verify the token
      const verifyResponse = await fetch('https://captured.thecatalyst.dev/v1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteKey: 'YOUR_SITE_KEY',
          token: captureToken,
          origin: window.location.origin
        })
      });
      
      const verifyResult = await verifyResponse.json();
      
      if (!verifyResult.ok) {
        alert('Verification failed');
        return;
      }
      
      // Submit the payload
      const submitResponse = await fetch('https://captured.thecatalyst.dev/v1/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteKey: 'YOUR_SITE_KEY',
          accessToken: verifyResult.accessToken,
          honeypot: honeypot,
          payload: {
            email: email,
            timestamp: new Date().toISOString()
          }
        })
      });
      
      const submitResult = await submitResponse.json();
      
      if (submitResult.ok) {
        document.getElementById('status').textContent = '✓ Success!';
        e.target.reset();
        document.getElementById('submit-btn').disabled = true;
        captureToken = null;
      } else {
        alert('Submission failed');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred');
    }
  });
</script>
```

## Support

If you need keys or policy updates, contact the Catalyst Capture admin.
