const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const port = process.env.PORT || 4000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
});

app.use(publicLimiter);

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const sites = new Map();
const submissions = [];
const challengeTokens = new Map();
const accessTokens = new Map();

const tokenTtlMs = Number(process.env.TOKEN_TTL_MS || 5 * 60 * 1000);
const minSubmitDelayMs = Number(process.env.MIN_SUBMIT_DELAY_MS || 0);

const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined;
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbSsl = String(process.env.DB_SSL || "").toLowerCase() === "true";
const disableDb = String(process.env.DISABLE_DB || "").toLowerCase() === "true";

const pool = !disableDb && dbHost && dbName && dbUser && dbPassword
  ? new Pool({
      host: dbHost,
      port: dbPort || 5432,
      database: dbName,
      user: dbUser,
      password: dbPassword,
      ssl: dbSsl ? { rejectUnauthorized: false } : false,
    })
  : null;

async function initDatabase() {
  if (!pool) return;
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domains TEXT[] NOT NULL DEFAULT '{}',
      site_key TEXT NOT NULL UNIQUE,
      secret_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS submissions (
      event_id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL,
      payload JSONB NOT NULL,
      fingerprint TEXT,
      ip TEXT,
      ua TEXT,
      origin TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `
  );
}

async function storeSite(record) {
  if (!pool) {
    sites.set(record.id, record);
    return;
  }
  await pool.query(
    `INSERT INTO sites (id, name, domains, site_key, secret_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [record.id, record.name, record.domains, record.siteKey, record.secretKey]
  );
}

async function findSiteBySiteKey(siteKey) {
  if (!siteKey) return null;
  if (!pool) {
    for (const site of sites.values()) {
      if (site.siteKey === siteKey) return site;
    }
    return null;
  }
  const result = await pool.query(
    "SELECT id, name, domains, site_key AS \"siteKey\", secret_key AS \"secretKey\" FROM sites WHERE site_key = $1 LIMIT 1",
    [siteKey]
  );
  return result.rows[0] || null;
}

async function storeSubmission(entry) {
  if (!pool) {
    submissions.push(entry);
    return;
  }
  await pool.query(
    `INSERT INTO submissions (event_id, site_key, payload, fingerprint, ip, ua, origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.eventId,
      entry.siteKey,
      entry.payload,
      entry.fingerprint || null,
      entry.ip || null,
      entry.ua || null,
      entry.origin || null,
    ]
  );
}

function getOriginHost(origin) {
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch (err) {
    return null;
  }
}

function isOriginAllowed(site, origin) {
  if (!site || !site.domains || site.domains.length === 0) return true;
  const host = getOriginHost(origin);
  if (!host) return true;
  return site.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function generateToken(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function isTokenExpired(issuedAt) {
  return Date.now() - issuedAt > tokenTtlMs;
}

function requireAdminKey(req, res, next) {
  const headerKey = req.header("x-admin-api-key");
  if (!process.env.ADMIN_API_KEY || headerKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/v1/embed", (req, res) => {
  const siteKey = req.query.siteKey;
  if (!siteKey) {
    return res.status(400).send("Missing siteKey");
  }

  const target = req.query.target || "#capture-slot";
  
  // Detect if being accessed through a proxy by checking the path prefix
  // If the request comes from /api/catalyst/v1/embed, use relative URLs
  const originalUrl = req.originalUrl || req.url;
  const isProxied = originalUrl.includes('/api/catalyst');
  
  // Use relative URL if proxied, otherwise use full URL
  const apiBase = isProxied ? '/api/catalyst' : `${req.protocol}://${req.get('host')}`;
  
  const html = `
  <div class="catalyst-capture-container" data-site-key="${siteKey}"></div>
  <script>
    (function(){
      var siteKey = "${siteKey}";
      var apiBase = "${apiBase}";
      var container = document.currentScript.previousElementSibling;
      var root = document.querySelector("${target}");
      if (!root) root = container.parentElement;
      if (!root) return;
      
      // Clear and create the widget
      if (container) container.remove();
      
      var widget = document.createElement('div');
      widget.className = 'cc-micro-ui';
      widget.style.cssText = 'margin: 10px 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; display: inline-flex; align-items: center; gap: 10px;';
      
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'cc-button';
      button.textContent = 'Verify';
      button.style.cssText = 'padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s;';
      
      var status = document.createElement('span');
      status.className = 'cc-status';
      status.style.cssText = 'font-size: 14px; color: #6b7280;';
      
      var tokenInput = document.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.className = 'cc-token';
      
      widget.appendChild(button);
      widget.appendChild(status);
      widget.appendChild(tokenInput);
      root.appendChild(widget);
      
      // Handle verification
      button.onclick = function() {
        button.disabled = true;
        button.textContent = 'Verifying...';
        button.style.cursor = 'wait';
        status.textContent = '';
        
        fetch(apiBase + '/v1/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteKey: siteKey })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok && data.token) {
            button.textContent = '✓ Verified';
            button.style.background = '#10b981';
            button.style.cursor = 'default';
            status.textContent = '✓ Success';
            status.style.color = '#10b981';
            
            // Store token
            tokenInput.value = data.token;
            
            // Emit event
            if (window.postMessage) {
              window.postMessage({
                type: 'catalyst-verified',
                token: data.token,
                siteKey: siteKey
              }, '*');
            }
          } else {
            throw new Error('Verification failed');
          }
        })
        .catch(function(err) {
          console.error('Verification error:', err);
          button.disabled = false;
          button.textContent = 'Verify (retry)';
          button.style.background = '#ef4444';
          button.style.cursor = 'pointer';
          status.textContent = '✗ Failed';
          status.style.color = '#ef4444';
        });
      };
    })();
  </script>
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});

app.post("/v1/challenge", (req, res) => {
  const { siteKey } = req.body || {};
  if (!siteKey) {
    return res.status(400).json({ ok: false, error: "missing_site_key" });
  }
  const challengeId = `chl_${Date.now()}`;
  const token = generateToken("tok");
  challengeTokens.set(token, {
    siteKey,
    issuedAt: Date.now(),
    verified: false,
  });
  res.json({ ok: true, challengeId, token, challenge: { type: "micro-ui" } });
});

app.post("/v1/verify", verifyLimiter, async (req, res) => {
  const { siteKey, token } = req.body || {};
  if (!siteKey || !token) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }
  const origin = req.header("origin");

  try {
    const site = await findSiteBySiteKey(siteKey);
    if (site && !isOriginAllowed(site, origin)) {
      return res.status(403).json({ ok: false, error: "origin_not_allowed" });
    }

    const record = challengeTokens.get(token);
    if (!record || record.siteKey !== siteKey) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }
    if (isTokenExpired(record.issuedAt)) {
      return res.status(401).json({ ok: false, error: "token_expired" });
    }

    record.verified = true;
    const accessToken = generateToken("acc");
    accessTokens.set(accessToken, {
      siteKey,
      issuedAt: Date.now(),
    });

    res.json({ ok: true, score: 0.99, reason: "verified", accessToken });
  } catch (err) {
    console.error("verify_error", err);
    res.status(500).json({ ok: false, error: "verification_failed" });
  }
});

app.post("/v1/verify-server", verifyLimiter, async (req, res) => {
  const { siteKey, token, secretKey } = req.body || {};
  const headerSecret = req.header("x-site-secret");
  const providedSecret = secretKey || headerSecret;

  if (!siteKey || !token || !providedSecret) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }

  try {
    const site = await findSiteBySiteKey(siteKey);
    if (!site || site.secretKey !== providedSecret) {
      return res.status(401).json({ ok: false, error: "invalid_secret" });
    }

    return res.json({ ok: true, score: 1.0, reason: "server_secret" });
  } catch (err) {
    console.error("verify_server_error", err);
    return res.status(500).json({ ok: false, error: "verification_failed" });
  }
});

app.post("/v1/submit", submitLimiter, async (req, res) => {
  const { siteKey, token, accessToken, payload, honeypot, fingerprint } = req.body || {};
  if (!siteKey || (!token && !accessToken) || typeof payload === "undefined") {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }

  if (honeypot) {
    return res.status(400).json({ ok: false, error: "honeypot_triggered" });
  }

  const origin = req.header("origin");

  try {
    const site = await findSiteBySiteKey(siteKey);
    if (site && !isOriginAllowed(site, origin)) {
      return res.status(403).json({ ok: false, error: "origin_not_allowed" });
    }

    if (accessToken) {
      const accessRecord = accessTokens.get(accessToken);
      if (!accessRecord || accessRecord.siteKey !== siteKey) {
        return res.status(401).json({ ok: false, error: "invalid_access_token" });
      }
      if (isTokenExpired(accessRecord.issuedAt)) {
        return res.status(401).json({ ok: false, error: "access_token_expired" });
      }
    } else {
      const record = challengeTokens.get(token);
      if (!record || record.siteKey !== siteKey) {
        return res.status(401).json({ ok: false, error: "invalid_token" });
      }
      if (isTokenExpired(record.issuedAt)) {
        return res.status(401).json({ ok: false, error: "token_expired" });
      }
      if (Date.now() - record.issuedAt < minSubmitDelayMs) {
        return res.status(429).json({ ok: false, error: "submit_too_fast" });
      }
      record.verified = true;
    }

  const eventId = `evt_${Date.now()}`;
  const entry = {
    eventId,
    siteKey,
    payload,
    fingerprint,
    ip: req.ip,
    ua: req.header("user-agent"),
    origin,
  };

    await storeSubmission(entry);
    res.json({ ok: true, eventId });
  } catch (err) {
    console.error("submit_store_error", err);
    res.status(500).json({ ok: false, error: "storage_failed" });
  }
});

app.post("/v1/admin/sites", requireAdminKey, (req, res) => {
  const { name, domains = [] } = req.body || {};
  if (!name) {
    return res.status(400).json({ ok: false, error: "missing_name" });
  }

  const id = `site_${Date.now()}`;
  const siteKey = `pk_${Math.random().toString(36).slice(2)}`;
  const secretKey = `sk_${Math.random().toString(36).slice(2)}`;

  const record = { id, name, domains, siteKey, secretKey };
  storeSite(record)
    .then(() => res.json({ ok: true, site: record }))
    .catch((err) => {
      console.error("site_store_error", err);
      res.status(500).json({ ok: false, error: "storage_failed" });
    });
});
initDatabase()
  .then(() => {
    if (!pool) {
      console.warn("DB_* env vars not set. Using in-memory storage.");
    }
    app.listen(port, () => {
      console.log(`Catalyst Capture API running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed", err);
    process.exit(1);
  });
