# PR #8 Code Review: Hydration Polling

2026-07-08 | Exhaustive review of `test/hydration-poll-loop` → `main`

## Changes Reviewed

### 1. `waitForHydratedCards` — extracted poll loop (scripts/daily-news.js)
- **Dependency injection**: `sleep`, `now`, `logFn`, `evaluateCount` all injectable — makes the function testable without Chrome
- **Default parameters**: fall back to production `sleepSync`, `Date.now`, `log`, and timing constants
- **Control flow**: `sleep(initialWaitMs)` → poll loop → `break` on `cardCount > 0` or deadline → final "no cards" log
- **Error handling**: catches `evaluateCount` throws, logs only first failure, accumulates `pollErrors`
- **Return value**: `{ cardCount, pollErrors }` — unused by `scrapeCategory` (by design: always extracts regardless)

### 2. `require.main === module` guard (scripts/daily-news.js)
- Correctly prevents `main()` invocation on `require()`
- `module.exports = { waitForHydratedCards }` placed outside guard — available in both modes

### 3. Test suite (test/hydration-poll.test.js)
- 4 tests, all `node:test`, zero external dependencies
- Covers: immediate success, polling until cards appear, deadline stop, eval-failure recovery
- `makeHarness` provides fake clock, sleep, log, and eval — clean and composable

### 4. package.json + README.md
- `npm test` → `node --test` — correct, no extra deps needed
- README test section — minimal, accurate

## Edge Case Analysis

All edge cases traced against `parseInt(String(evaluateCount()).trim(), 10) || 0`:

| Input | parseInt | `\|\| 0` | cardCount | Behavior |
|---|---|---|---|---|
| `undefined`, `null`, `NaN` | `NaN` | `0` | 0 | keep polling |
| `""`, `"0"`, `0` | `0` | `0` | 0 | keep polling |
| `"5"`, `"5\n"`, `5` | `5` | `5` | 5 | break |
| `"  42  "` | `42` | `42` | 42 | break |
| `"abc"` (garbage) | `NaN` | `0` | 0 | keep polling |
| `-1`, `"-1"`, `-5` | `-1` / `-5` | `-1` / `-5` | **negative** | **see issue #10** |

## Issues Found

### Severity: LOW — Negative cardCount via `|| 0` (created as #10)

`parseInt("-1", 10)` → `-1`, `-1 || 0` → `-1` (truthy). `cardCount = -1`, `-1 > 0` → false → polls to deadline, then `cardCount === 0` → false → "no cards" log never fires. Returns `{ cardCount: -1, pollErrors: 0 }`.

- **No production impact**: DOM `querySelectorAll().length` is never negative; `scrapeCategory` ignores return value
- **Fix**: `Math.max(0, parseInt(String(evaluateCount()).trim(), 10) || 0)`

### No severe, high, or medium issues found.

## Observations (INFO)

- `sleepSync` calls platform `sleep` — works on Linux/macOS, not Windows (pre-existing, not PR-introduced)
- `initialWaitMs` sleep is unconditional — a defensive `Math.min(initialWaitMs, maxWaitMs)` would prevent oversleep on misconfigured params
- Test coverage could add: all-eval-throws scenario, non-numeric garbage input, `pollErrors` accumulation across multiple failures
- `parseInt` is intentionally lenient (handles `"5\n"`) — the test explicitly validates this behavior

## Verification

```
npm test              → 4/4 pass
node --check          → OK (both files)
export check          → function
git diff --check      → clean
```

## Summary

Clean extraction, solid DI pattern, good test coverage. No blocking issues. The one LOW finding (#10) is cosmetic — DOM queries never return negative lengths. Ready to merge.
