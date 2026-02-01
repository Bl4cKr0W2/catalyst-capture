import json
import os
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode


LOG_EVENTS = []


def log_event(event_type, data):
    LOG_EVENTS.append({"ts": time.time(), "type": event_type, **data})


def request_json(method, url, payload=None, headers=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    log_event(
        "request",
        {
            "method": method,
            "url": url,
            "headers": headers or {},
            "payload": payload,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = res.read().decode("utf-8")
            parsed = json.loads(body)
            log_event("response", {"status": res.status, "body": parsed})
            return res.status, parsed
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body}
        log_event("response", {"status": e.code, "body": parsed})
        return e.code, parsed
    except urllib.error.URLError as e:
        log_event("error", {"error": str(e)})
        return 0, {"error": str(e)}


def request_text(method, url, headers=None):
    req = urllib.request.Request(url, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    log_event("request", {"method": method, "url": url, "headers": headers or {}})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = res.read().decode("utf-8")
            log_event("response", {"status": res.status, "body": body})
            return res.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        log_event("response", {"status": e.code, "body": body})
        return e.code, body
    except urllib.error.URLError as e:
        log_event("error", {"error": str(e)})
        return 0, str(e)


def main():
    base_url = os.getenv("CAPTURE_BASE_URL", "http://localhost:4000").rstrip("/")
    admin_key = os.getenv("ADMIN_API_KEY", "")
    db_host = os.getenv("DB_HOST")
    db_port = os.getenv("DB_PORT")
    db_name = os.getenv("DB_NAME")
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    db_ssl = os.getenv("DB_SSL")
    disable_db = os.getenv("DISABLE_DB")

    results = []

    def record(name, ok, details=""):
        results.append((name, ok, details))

    def recommend(message):
        log_event("recommendation", {"message": message})

    # Env checks
    if not admin_key:
        recommend("Set ADMIN_API_KEY before running tests.")
    if not all([db_host, db_port, db_name, db_user, db_password]):
        recommend("Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD for Postgres.")
    if db_ssl is None:
        recommend("Set DB_SSL=true|false to control Postgres TLS.")
    if not disable_db:
        recommend("Set DISABLE_DB=true when running tests without a live database.")

    # Health
    status, body = request_json("GET", f"{base_url}/health")
    record("health", status == 200 and body.get("ok") is True, f"status={status}")

    # Negative: health with bad path
    status, body = request_json("GET", f"{base_url}/healthz")
    record("health_bad_path", status in (404, 0), f"status={status}")

    # Negative: admin without key
    status, body = request_json(
        "POST",
        f"{base_url}/v1/admin/sites",
        payload={"name": "bad-site"},
        headers={"x-admin-api-key": "wrong"},
    )
    record("admin_sites_unauthorized", status in (401, 0), f"status={status}")

    # Admin create site
    if not admin_key:
        record("admin_sites", False, "ADMIN_API_KEY not set")
        site_key = None
        site_secret = None
    else:
        status, body = request_json(
            "POST",
            f"{base_url}/v1/admin/sites",
            payload={"name": "test-site", "domains": ["example.com"]},
            headers={"x-admin-api-key": admin_key},
        )
        site_key = body.get("site", {}).get("siteKey")
        site_secret = body.get("site", {}).get("secretKey")
        record("admin_sites", status == 200 and bool(site_key), f"status={status}")

    if not site_key:
        print("Site key not available. Skipping public flow tests.")
    else:
        # Negative: embed without siteKey
        status, body = request_text("GET", f"{base_url}/v1/embed")
        record("embed_missing_site_key", status in (400, 0), f"status={status}")

        # Embed HTML
        query = urlencode({"siteKey": site_key, "target": "#capture-slot"})
        status, body = request_text("GET", f"{base_url}/v1/embed?{query}")
        record("embed", status == 200 and "cc-micro-ui" in body, f"status={status}")

        # Negative: challenge missing siteKey
        status, body = request_json("POST", f"{base_url}/v1/challenge", payload={})
        record("challenge_missing_site_key", status in (400, 0), f"status={status}")

        # Challenge
        status, body = request_json(
            "POST", f"{base_url}/v1/challenge", payload={"siteKey": site_key}
        )
        challenge_id = body.get("challengeId")
        token = body.get("token")
        record(
            "challenge",
            status == 200 and bool(challenge_id) and bool(token),
            f"status={status}",
        )

        # Negative: verify missing token
        status, body = request_json(
            "POST", f"{base_url}/v1/verify", payload={"siteKey": site_key}
        )
        record("verify_missing_token", status in (400, 0), f"status={status}")

        # Verify
        status, body = request_json(
            "POST",
            f"{base_url}/v1/verify",
            payload={"siteKey": site_key, "token": token},
        )
        access_token = body.get("accessToken")
        record(
            "verify",
            status == 200 and body.get("ok") is True and bool(access_token),
            f"status={status}",
        )

        # Verify server (negative - missing secret)
        status, body = request_json(
            "POST",
            f"{base_url}/v1/verify-server",
            payload={"siteKey": site_key, "token": token},
        )
        record("verify_server_missing_secret", status in (400, 401), f"status={status}")

        # Verify server (positive)
        status, body = request_json(
            "POST",
            f"{base_url}/v1/verify-server",
            payload={"siteKey": site_key, "token": token, "secretKey": site_secret},
        )
        record("verify_server", status == 200 and body.get("ok") is True, f"status={status}")

        # Negative: submit missing payload
        status, body = request_json(
            "POST",
            f"{base_url}/v1/submit",
            payload={"siteKey": site_key, "token": "tok_test"},
        )
        record("submit_missing_payload", status in (400, 0), f"status={status}")

        # Submit honeypot (negative)
        status, body = request_json(
            "POST",
            f"{base_url}/v1/submit",
            payload={
                "siteKey": site_key,
                "accessToken": access_token,
                "honeypot": "filled",
                "payload": {"name": "Ada", "message": "Hello"},
            },
        )
        record("submit_honeypot", status in (400, 401, 429), f"status={status}")

        # Submit
        status, body = request_json(
            "POST",
            f"{base_url}/v1/submit",
            payload={
                "siteKey": site_key,
                "accessToken": access_token,
                "honeypot": "",
                "fingerprint": "fp_test",
                "payload": {"name": "Ada", "message": "Hello"},
            },
        )
        record("submit", status == 200 and bool(body.get("eventId")), f"status={status}")

    logs_dir = os.path.join(os.path.dirname(__file__), "logs")
    os.makedirs(logs_dir, exist_ok=True)
    timestamp = int(time.time())
    log_path = os.path.join(logs_dir, f"test_run_{timestamp}.jsonl")
    with open(log_path, "w", encoding="utf-8") as handle:
        for event in LOG_EVENTS:
            handle.write(json.dumps(event) + "\n")

    print("\nTest Results")
    print("============")
    failed = 0
    for name, ok, details in results:
        status = "PASS" if ok else "FAIL"
        print(f"{status} - {name} ({details})")
        if not ok:
            failed += 1

    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(
            json.dumps(
                {
                    "ts": timestamp,
                    "type": "summary",
                    "baseUrl": base_url,
                    "results": [
                        {"name": name, "ok": ok, "details": details}
                        for name, ok, details in results
                    ],
                    "failed": failed,
                }
            )
            + "\n"
        )

    if failed:
        print(f"\n{failed} test(s) failed")
        print(f"Logs: {log_path}")
        sys.exit(1)
    print("\nAll tests passed")
    print(f"Logs: {log_path}")


if __name__ == "__main__":
    main()
