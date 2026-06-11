# Follow-ups — PR #1 (poll for card hydration)

GitNexus review of `fix/hydration-poll`. Severe/High/Medium issues were fixed
in the PR itself. The items below are deferred LOW-severity improvements.

## Blast radius (GitNexus)

- Changed symbol: `scrapeCategory` (`scripts/daily-news.js`)
- Upstream callers: `main` only (d=1)
- Affected processes: 1 (`Main → Log`)
- Risk: **LOW** — change is fully isolated to one function.

## Deferred items

### LOW-1: Selector string is duplicated (#2)
The card selector `a[href*="${catPath}"]` is built independently in both
`countJS` (hydration poll) and `extractJS` (extraction). If the selector ever
changes, both must be updated in lockstep or the poll will wait on a different
element than the one extracted.

**Suggestion:** derive both from a single `cardSelector` constant computed once
per call from `catPath`.

### LOW-2: Repeated shell-escape boilerplate (#3)
`.replace(/'/g, "'\\''")` is applied separately to `countJS` and `extractJS`.

**Suggestion:** extract a small `shEscape(js)` helper and reuse it for every
`browser-eval` invocation.

### LOW-3: No upper bound on total run time (#4)
Each category can now wait up to `HYDRATION_MAX_WAIT_MS` (20s) plus extraction.
Across 6 categories a fully-degraded run could take ~2 min. Acceptable for a
cron job, but consider an overall wall-clock budget / early-abort if Chrome is
clearly unresponsive (e.g. repeated poll-eval failures across categories).

### LOW-4: No tests (#5)
The repo has no automated tests. `scrapeCategory` relies on a live browser, so
a unit test would need the hydration poll loop factored out into a pure,
injectable function (clock + eval as dependencies). Worth doing if this script
keeps growing.
