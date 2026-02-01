# Catalyst Capture – Integration Guide

This document explains how to embed and verify Catalyst Capture on your site to protect forms from bots.

## Quick Start

**User flow:** User clicks "Verify" → Button turns green → User clicks "Submit" → Form submitted

**Implementation steps:**
1. Get a site key (contact admin)
2. Add widget div to your HTML
3. Load widget via fetch
4. Disable your submit button until verified
5. Listen for `catalyst-verified` event to enable submit
6. Submit form with token

## What You'll Get

- **Site Key** (public) - Use in browser
- **Secret Key** (server-only) - Never expose in browser
- **API Access** - https://captured.thecatalyst.dev

---

## Step 1: Add Widget Container

Add an empty div where you want the verification widget:

```html
<form id="my-form">
  <input type="email" id="email" required />
  
  <!-- Widget loads here -->
  <div id="capture-slot"></div>
  
  <!-- Disabled until verification -->
  <button type="submit" id="submit-btn" disabled>Submit</button>
</form>
```

## Step 2: Load the Widget

Fetch and inject the widget HTML into your page:

```html
<script>
(async function() {
  try {
    const response = await fetch('https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
    const html = await response.text();
    document.getElementById('capture-slot').innerHTML = html;
  } catch (error) {
    console.error('Error loading widget:', error);
  }
})();
</script>
```

**What happens:** The API returns self-executing HTML that creates a "Verify" button. When clicked, it calls `/v1/challenge` to get a token.

## Step 3: Listen for Verification

The widget emits a `postMessage` event when verification succeeds:

```js
let captureToken = null;

window.addEventListener('message', (event) => {
  if (event.data?.type === 'catalyst-verified') {
    captureToken = event.data.token;
    
    // Enable your submit button
    document.getElementById('submit-btn').disabled = false;
    
    console.log('Verified! Token:', captureToken);
  }
});
```

**Important:** Store the token - you'll need it for submission.

## Step 4: Submit with Token

### Client-Side Only (No Backend)

If you don't have a backend, verify and submit directly from the browser:

```js
document.getElementById('my-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!captureToken) {
    alert('Please verify first');
    return;
  }
  
  try {
    // 1. Verify the token
    const verifyRes = await fetch('https://captured.thecatalyst.dev/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteKey: 'YOUR_SITE_KEY',
        token: captureToken,
        origin: window.location.origin
      })
    });
    
    const verifyResult = await verifyRes.json();
    if (!verifyResult.ok) throw new Error('Verification failed');
    
    // 2. Submit your data
    const submitRes = await fetch('https://captured.thecatalyst.dev/v1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteKey: 'YOUR_SITE_KEY',
        accessToken: verifyResult.accessToken,
        honeypot: '', // Keep empty
        payload: {
          email: document.getElementById('email').value,
          // ... any other data
        }
      })
    });
    
    const result = await submitRes.json();
    if (result.ok) {
      alert('Success!');
    }
  } catch (error) {
    console.error(error);
    alert('Submission failed');
  }
});
```

### Server-Side (Recommended)

Send the token to your backend and verify there:

**Frontend:**
```js
document.getElementById('my-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: document.getElementById('email').value,
      captureToken: captureToken
    })
  });
});
```

**Backend:**
```http
POST https://captured.thecatalyst.dev/v1/verify
Content-Type: application/json

{
  "siteKey": "YOUR_SITE_KEY",
  "secretKey": "YOUR_SECRET_KEY",
  "token": "TOKEN_FROM_CLIENT",
  "ip": "USER_IP",
  "ua": "USER_AGENT",
  "origin": "https://your-site.com"
}
```

Response:
```json
{
  "ok": true,
  "score": 0.93,
  "reason": "human",
  "accessToken": "acc_..."
}
```

Only proceed if `ok` is `true`.

---

## Complete Working Example

This is a **copy-paste ready** example that works without a backend:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Waitlist Form</title>
</head>
<body>
  <form id="waitlist-form">
    <h2>Join Waitlist</h2>
    
    <input 
      type="email" 
      id="email" 
      placeholder="Your email" 
      required 
    />
    
    <!-- Hidden honeypot field -->
    <input 
      type="text" 
      name="honeypot" 
      autocomplete="off" 
      tabindex="-1" 
      style="display:none"
    />
    
    <!-- Widget container -->
    <div id="capture-slot"></div>
    
    <!-- Submit button (disabled initially) -->
    <button 
      type="submit" 
      id="submit-btn" 
      disabled
    >
      Join Waitlist
    </button>
    
    <p id="status"></p>
  </form>

  <script>
    // 1. Load the widget
    (async function() {
      try {
        const response = await fetch('https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
        const html = await response.text();
        document.getElementById('capture-slot').innerHTML = html;
      } catch (error) {
        console.error('Error loading widget:', error);
        document.getElementById('status').textContent = 'Failed to load verification';
      }
    })();
    
    // 2. Listen for verification
    let captureToken = null;
    
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'catalyst-verified') {
        captureToken = event.data.token;
        document.getElementById('submit-btn').disabled = false;
        document.getElementById('status').textContent = '✓ Verified! Click "Join Waitlist"';
        document.getElementById('status').style.color = 'green';
      }
    });
    
    // 3. Handle form submission
    document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!captureToken) {
        alert('Please click "Verify" first');
        return;
      }
      
      const submitBtn = document.getElementById('submit-btn');
      const statusEl = document.getElementById('status');
      const email = document.getElementById('email').value;
      const honeypot = document.querySelector('[name="honeypot"]').value;
      
      // Disable button during submission
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      statusEl.textContent = 'Processing...';
      
      try {
        // Verify token
        const verifyRes = await fetch('https://captured.thecatalyst.dev/v1/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteKey: 'YOUR_SITE_KEY',
            token: captureToken,
            origin: window.location.origin
          })
        });
        
        const verifyResult = await verifyRes.json();
        
        if (!verifyResult.ok) {
          throw new Error('Verification failed');
        }
        
        // Submit data
        const submitRes = await fetch('https://captured.thecatalyst.dev/v1/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteKey: 'YOUR_SITE_KEY',
            accessToken: verifyResult.accessToken,
            honeypot: honeypot,
            payload: {
              email: email,
              source: 'waitlist',
              timestamp: new Date().toISOString()
            }
          })
        });
        
        const submitResult = await submitRes.json();
        
        if (submitResult.ok) {
          statusEl.textContent = '🎉 Success! You\'re on the waitlist.';
          statusEl.style.color = 'green';
          document.getElementById('waitlist-form').reset();
          submitBtn.textContent = 'Joined!';
          
          // Reset after 3 seconds
          setTimeout(() => {
            submitBtn.textContent = 'Join Waitlist';
            submitBtn.disabled = true;
            statusEl.textContent = '';
            captureToken = null;
          }, 3000);
        } else {
          throw new Error(submitResult.error || 'Submission failed');
        }
      } catch (error) {
        console.error('Error:', error);
        statusEl.textContent = '✗ ' + error.message;
        statusEl.style.color = 'red';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try Again';
      }
    });
  </script>
</body>
</html>
```

**Just replace `YOUR_SITE_KEY` with your actual site key and it works!**

---

## Security Best Practices

**Essential:**
- ✅ Start with submit button **disabled**
- ✅ Only enable after receiving `catalyst-verified` event
- ✅ Add hidden honeypot field (bots fill it, humans don't)
- ✅ Never expose secret key in browser
- ✅ Use HTTPS

**Client-Side Only Limitations:**
- ⚠️ Less secure than server-side verification
- ⚠️ Secret key can't be used (browser visible)
- ⚠️ Relies on API rate limits for protection

**Recommended for Production:**
- ✅ Verify tokens on your backend
- ✅ Use secret key server-side only
- ✅ Add server-side rate limiting
- ✅ Log suspicious submissions

---

## API Endpoints Reference

### `GET /v1/embed`
Returns self-executing HTML widget.

**Query params:**
- `siteKey` (required) - Your public site key
- `target` (optional) - CSS selector for container, default: `#capture-slot`

**Response:** HTML with embedded JavaScript

---

### `POST /v1/challenge`
Called automatically by the widget when user clicks "Verify".

**Request:**
```json
{
  "siteKey": "YOUR_SITE_KEY"
}
```

**Response:**
```json
{
  "ok": true,
  "token": "tok_...",
  "challengeId": "chl_..."
}
```

---

### `POST /v1/verify`
Verify a token (can be called from browser or server).

**Request:**
```json
{
  "siteKey": "YOUR_SITE_KEY",
  "token": "tok_...",
  "secretKey": "YOUR_SECRET_KEY",  // Optional, use on server only
  "origin": "https://your-site.com"
}
```

**Response:**
```json
{
  "ok": true,
  "score": 0.99,
  "reason": "verified",
  "accessToken": "acc_..."
}
```

---

### `POST /v1/submit`
Submit your form data after verification.

**Request:**
```json
{
  "siteKey": "YOUR_SITE_KEY",
  "accessToken": "acc_...",
  "honeypot": "",
  "payload": {
    // Any JSON data you want to store
  }
}
```

**Response:**
```json
{
  "ok": true,
  "eventId": "evt_123456"
}
```

---

## Troubleshooting

**Widget doesn't load:**
- Check browser console for errors
- Verify CORS is configured for your domain
- Confirm site key is correct

**Button stays disabled:**
- Check if `catalyst-verified` event fires (add `console.log`)
- Ensure you're listening for `postMessage` events
- Hard refresh browser (`Ctrl+Shift+R`)

**Submission fails:**
- Token might be expired (short-lived)
- Honeypot field might be filled (bot detected)
- Check API response for specific error

**CORS errors:**
- Contact admin to add your domain to allowed origins

---

---

## Support

Need help? Contact the Catalyst Capture admin for:
- Site keys and secret keys
- Adding domains to CORS allowlist
- Policy updates
- Technical support
