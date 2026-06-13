# PR #6 Follow-ups — Code Review Issues

2026-06-13 | Review of `fix/cron-chrome-auto-start` (ensureChrome auto-start Chrome on Linux)

## Fixed (3 issues)

### 1. Curl execSync hang risk
**Severity: High** — `execSync("curl ...")` had no timeouts. If port 9222 was open but the listener hung, Node would block indefinitely.
**Fix:** Added `--max-time 5 --connect-timeout 3` to curl and `{ timeout: 8000 }` to execSync. Now worst case is 8s hang per attempt, then clean exit.

### 2. Polling loop silent error swallowing
**Severity: Medium** — Empty `catch {}` in the 60× polling loop swallowed real Chrome startup errors for 30s. User saw only "failed to start" with no clue why.
**Fix:** Capture `firstError` and log it at i===12 (after 6s of failed polling). This gives diagnostic info without spamming during normal Chrome startup.

### 3. Lock file permission errors hidden
**Severity: Medium** — Empty `catch {}` on `fs.unlinkSync` hid EACCES/EPERM when stale lock files were owned by another user.
**Fix:** Check `e.code !== "ENOENT"` and log a warning with the error message.

## Not Fixed (with rationale)

### 4. `--no-sandbox` security concern
**Severity: High (flagged)** — Chrome sandbox disabled unconditionally.
**Decision: Won't fix.** This is a personal cron script scraping only perplexity.ai. Exploiting this requires compromising Perplexity AND a Chrome renderer zero-day. `--no-sandbox` is needed for headless Chrome on systems without unprivileged user namespaces (Docker, WSL, some Ubuntu configs). Practical risk near zero.

### 5. TOCTOU race + spawn failure silent
**Severity: Medium (flagged)** — Another process could bind :9222 between check and spawn; spawn errors invisible.
**Decision: Won't fix.** TOCTOU window is <200ms on a single-user dev machine — practically impossible. Spawn crash-on-startup with standard flags is extremely rare on Linux. The lock file cleanup mitigates the most common cause.

### 6. Orphan Chrome process accumulation
**Severity: Medium (flagged)** — `detached:true + child.unref()` leaves Chrome alive after script exits.
**Decision: Won't fix — by design.** The port check at line 333 (`Already running?`) prevents duplicate instances. Chrome is intentionally long-lived so subsequent cron invocations reuse it instead of paying startup cost each time. Only one Chrome process exists per machine, not per invocation.

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | Curl no timeout → indefinite hang | High | Fixed |
| 2 | Polling catch swallows errors | Medium | Fixed |
| 3 | Lock file permission errors hidden | Medium | Fixed |
| 4 | --no-sandbox security | High | Won't fix (needed for headless, trusted site) |
| 5 | TOCTOU/spawn race | Medium | Won't fix (impractical) |
| 6 | Orphan Chrome processes | Medium | Won't fix (by design, port check prevents duplicates) |
