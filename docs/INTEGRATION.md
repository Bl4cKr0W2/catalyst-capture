# Catalyst Capture – Integration Guide

This document explains how to embed and verify Catalyst Capture on your site to protect forms from bots.

## Quick Start

**User flow:** User clicks "Verify" → Button turns green → User clicks "Submit" → Form submitted

**What you need to implement:**
1. ✅ Add widget container div (`<div id="capture-slot"></div>`)
2. ✅ Fetch widget from `/v1/embed` and inject into div (widget handles verification)
3. ✅ **YOU MUST ADD:** JavaScript to listen for `catalyst-verified` event
4. ✅ **YOU MUST ADD:** JavaScript to handle form submission with token
5. ✅ Start with submit button disabled, enable only after verification

**Implementation steps:**
1. Get a site key (contact admin)
2. Add widget div to your HTML
3. Load widget via fetch (returns ready-to-use HTML)
4. Add event listener for `catalyst-verified` to enable submit button
5. Add form submit handler to verify token and submit data

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

**Important:** The `/v1/embed` endpoint returns **complete, ready-to-use HTML** with all JavaScript included. You just need to fetch it and inject it into your page.

### Vanilla JavaScript / Plain HTML

```html
<script>
(async function() {
  try {
    const response = await fetch('https://captured.thecatalyst.dev/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
    const html = await response.text();
    const container = document.getElementById('capture-slot');
    container.innerHTML = html;
    
    // Execute scripts (important for frameworks that strip scripts)
    const scripts = container.querySelectorAll('script');
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  } catch (error) {
    console.error('Error loading widget:', error);
  }
})();
</script>
```

### React / Vue / Angular

**Important:** `innerHTML` (or `dangerouslySetInnerHTML` in React) **does not execute `<script>` tags** for security reasons. You must manually execute them.

**React with useRef (recommended):**

```javascript
import { useEffect, useRef } from 'react';

function MyForm() {
  const widgetContainerRef = useRef(null);
  
  useEffect(() => {
    const loadWidget = async () => {
      try {
        const response = await fetch('/api/catalyst/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
        const html = await response.text();
        
        const container = widgetContainerRef.current;
        if (!container) return;
        
        container.innerHTML = html;
        
        // Extract and execute scripts manually
        const scripts = container.querySelectorAll('script');
        scripts.forEach((oldScript) => {
          const newScript = document.createElement('script');
          newScript.textContent = oldScript.textContent;
          oldScript.parentNode.replaceChild(newScript, oldScript);
        });
      } catch (error) {
        console.error('Error loading widget:', error);
      }
    };
    
    loadWidget();
  }, []);
  
  return <div ref={widgetContainerRef} id="capture-slot"></div>;
}
```

**Why useRef?** The widget's script removes and recreates DOM elements, which conflicts with React's virtual DOM. Using `useRef` tells React to let the widget manage that part of the DOM freely.

**Vue / Angular:**

```javascript
const loadWidget = async () => {
  try {
    const response = await fetch('/api/catalyst/v1/embed?siteKey=YOUR_SITE_KEY&target=%23capture-slot');
    const html = await response.text();
    
    const container = document.getElementById('capture-slot');
    container.innerHTML = html;
    
    // Extract and execute scripts manually
    const scripts = container.querySelectorAll('script');
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  } catch (error) {
    console.error('Error loading widget:', error);
  }
};

// Call in mounted() (Vue) or ngOnInit() (Angular)
mounted() {
  loadWidget();
}
```

**What happens:** 
1. The API returns self-executing HTML that creates a styled "Verify" button
2. When user clicks it, the widget calls `/v1/challenge` automatically
3. On success, the button turns green and emits a `catalyst-verified` event
4. **The widget is fully functional** - you just need to listen for the event (Step 3)

**If using a proxy:** Replace `https://captured.thecatalyst.dev` with your proxy path (e.g., `/api/catalyst`). The widget will automatically detect the proxy and use relative URLs for all API calls - no client-side URL rewriting needed

## Step 3: Listen for Verification

**Critical:** The widget works on its own, but YOU must add JavaScript to listen for its success event and enable your submit button.

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

**This is required!** Without this listener:
- ❌ Your submit button stays disabled
- ❌ You won't have the token for submission
- ❌ The form won't work

**Important:** Store the token - you'll need it for submission in Step 4.

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
- Verify CORS is configured for your domain (contact admin)
- Confirm site key is correct
- Check network tab - should see successful request to `/v1/embed`

**Verify button doesn't appear (React/Vue/Angular):**
- ⚠️ **Common issue:** `innerHTML` or `dangerouslySetInnerHTML` doesn't execute `<script>` tags
- ✅ **Solution:** Manually execute scripts after setting innerHTML (see Step 2 - React/Vue/Angular section)
- Check if the HTML is loading: `console.log(html)` after fetch
- Check if `#capture-slot` div exists in the DOM when you try to inject

**React error: "The node to be removed is not a child of this node":**
- ⚠️ **Common issue:** Widget script removes/recreates DOM elements, conflicting with React's virtual DOM
- ✅ **Solution:** Use `useRef` instead of regular div (see Step 2 - React section)
- This allows the widget to manipulate the DOM without React interference

**Button stays disabled after clicking Verify:**
- ✅ Did you add the `window.addEventListener('message')` code? **This is required!**
- Check if `catalyst-verified` event fires: `console.log('Event:', event.data)` in the listener
- Ensure you're listening for `postMessage` events
- Hard refresh browser (`Ctrl+Shift+R`) to clear cache
- Check console for JavaScript errors

**Widget loads but "Verify" button does nothing:**
- Check network tab when clicking - should see POST to `/v1/challenge`
- Check console for errors
- Verify your proxy (if using one) forwards requests correctly

**Submission fails:**
- Token might be expired (short-lived, ~5 minutes)
- Honeypot field might be filled (bot detected)
- Check API response in network tab for specific error
- Verify you're using `accessToken` (from verify response) not raw token

**CORS errors:**
- Contact admin to add your domain to allowed origins
- Applies to: `www.yourdomain.com`, `yourdomain.com`, `https://yourdomain.com`

**Using a proxy/reverse proxy:**
- The widget automatically detects when accessed through a proxy (by checking the `Referer` and `X-Forwarded-Host` headers)
- When detected, it uses relative URLs (e.g., `/api/catalyst/v1/challenge`) instead of absolute URLs
- This means you don't need any client-side string replacement or URL rewriting
- Just fetch the widget through your proxy path and it will work automatically
- Example: If your site proxies `/api/catalyst` to `https://captured.thecatalyst.dev`, just use `fetch('/api/catalyst/v1/embed?siteKey=...')` and the widget will handle the rest

---

---

## Support

Need help? Contact the Catalyst Capture admin for:
- Site keys and secret keys
- Adding domains to CORS allowlist
- Policy updates
- Technical support
