# PR #7 Follow-ups — Code Review Issues

2026-06-13 | Review of `fix/tech-scraper-retry`

## Fixed (1 issue)

### 1. Stale comment referencing removed `/discover/you/` selector
**Severity: Medium** — Line 78 comment "Technology (tech) and default (/discover) use /discover/you/ for story links" was left behind when the special-case ternary was removed in eb0c522.
**Fix:** Replaced with accurate comment describing the current `/discover/{id}/` pattern.

## Not Fixed (with rationale)

### 2. Redundant `attempts` variable in retry loop
**Severity: Low** — Reviewers noted `attempts` tracks the same count as `attempt + 1` inside the loop body.
**Decision: Won't fix.** `attempt` is block-scoped (`let` in `for` header) and not accessible after the loop. The outer `log()` call on line 432 needs `attempts` for the post-loop summary. Not actually redundant.

### 3. Retry loop doesn't re-navigate between attempts
**Severity: Info** — The retry calls `scrapeCategory()` which does its own navigation, but doesn't explicitly re-navigate between retries.
**Decision: Won't fix — not needed.** `scrapeCategory()` already calls `browser-nav.js` as its first operation, so each retry includes a fresh navigation. No additional navigation needed.

### 4. EnsureChrome is custom vs using chrome-launcher/puppeteer
**Severity: Info** — History3 noted that the custom Chrome lifecycle management duplicates what libraries provide.
**Decision: Won't fix — intentional.** Adding a puppeteer dependency for a single use case (open Chrome on :9222) would be heavier than the 64-line function. The current approach has been tested and works reliably.

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | Stale comment | Medium | Fixed |
| 2 | Redundant variable | Low | Won't fix (needed for outer scope) |
| 3 | Retry re-navigation | Info | Won't fix (scrapeCategory does it) |
| 4 | Custom Chrome lifecycle | Info | Won't fix (lighter than deps) |
