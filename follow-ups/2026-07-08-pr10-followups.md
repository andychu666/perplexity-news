# PR #10 Code Review Follow-ups

Date: 2026-07-08
Review scope: `scripts/daily-news.js` — extraction JS in `scrapeCategory()`

## LOW severity — no action required now

### 1. `search(/^Published/im)` would match "published" mid-headline text

**Issue:** If a headline genuinely contains the word "published" on its own line (e.g., "Study published on climate change"), the `pubIdx` cleanup will truncate the headline at that position rather than at the meta label.

**Mitigation:** The `search(/^Published/im)` with line anchor `^` and multiline flag makes this very unlikely — "published" would need to be at the start of an `innerText` line, and the meta "Published" label is always on its own line after the headline. This would only trigger if the headline itself wraps and starts a new line with "published".

**Risk:** Very low. Perplexity headlines rarely contain standalone "Published" words.

### 2. No automated tests

**Issue:** The repo has no tests for the extraction logic. All verification is manual against the live page.

**Suggestion:** Add a test file that exercises `scrapeCategory` extraction logic against saved HTML/JSON fixtures, covering all card types (hero with relative time, hero with absolute date, compact card without time, card where headline ends with a number). The `waitForHydratedCards` extraction into a testable function on main already enables this.

### 3. `innerText` vs `textContent` layout dependency

**Issue:** `innerText` depends on CSS layout (it respects `display: none`, `visibility: hidden`, and block-level rendering). If Perplexity changes their CSS (e.g., making card elements `display: inline`), `innerText` might not produce newlines between elements, recreating the concatenation bug.

**Mitigation:** The Perplexity card layout uses block-level `<div>` elements for headline and footer sections, making it unlikely they'd switch to inline. If the bug recurs, a more robust fix would be to directly query specific elements (e.g., `[data-testid="thread-title"]` for headline, a specific badge element for sources) instead of relying on text concatenation.

### 4. `[\d]` character class quirk (cosmetic)

**Issue:** Line 128 uses `[\d]+` instead of `\d+`. Inside a character class `[...]`, `\d` is a valid escape and equivalent to `[0-9]`. So `[\d]+` is functionally identical to `\d+` but more verbose.

**Suggestion:** Clean up to `\d+` in a future refactoring pass — no behavioral change.
