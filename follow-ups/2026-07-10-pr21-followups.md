# PR #21 Code Review Follow-ups

Date: 2026-07-10
Review scope: `scripts/daily-news.js` — `parseCardFromLeaves()`, `scrapeCategory()` extraction JS
Method: GitNexus impact/context analysis + manual diff review

## Review result

No severe, high, or medium findings. The DOM leaf extraction approach is race-proof by construction and correctly handles all observed card layouts. GitNexus impact analysis confirms LOW risk (1 direct caller, 0 affected processes for `parseCardFromLeaves`; LOW for `scrapeCategory`).

## LOW severity — no action required now

### 1. `parseCardFromLeaves.toString()` injection fragility

**Issue:** `scrapeCategory` injects the function source into a template literal via `parseCardFromLeaves.toString()`. If the function body ever contains backticks or `${`, the template literal would break. Currently safe — the function uses only `var`, regex literals, and string concatenation.

**Risk:** Very low. The function is pure logic with no template literals. A future minifier or transpiler could change this, but the project has zero build step.

**Suggestion:** If a build step is ever added, switch to a string-based serialization or move the function to a separate `.js` file that's `fetch`-ed in the browser context.

### 2. `catPath` interpolation into browser JS is unescaped (pre-existing)

**Issue:** Line 179: `var catPath = "${catPath}";` interpolates `catPath` directly into a JS string literal. If `catPath` contained `"`, it would break the string. `catPath` is derived from `cat.id` in the hardcoded `CATEGORIES` array (line 30-37), so it's safe today.

**Risk:** None with current code. Would become a risk if `CATEGORIES` were ever populated from user input or external config.

### 3. Absolute date regex coverage

**Issue:** The regex `^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$` only matches `Month D, YYYY` format. Perplexity currently uses this format exclusively (verified via live DOM inspection: `Jul 9, 2026`, `Jun 23, 2026`). Does not match day-first formats (`10 Jul 2026`) or year-less dates (`Jul 9`).

**Risk:** None — Perplexity's date format is consistent. If they change format, the leaf simply won't match and `published` will be `null` (graceful degradation, not a crash).

### 4. Description paragraph as headline fallback

**Issue:** If a card's headline leaf is somehow missing from the DOM (e.g., not rendered yet), `parseCardFromLeaves` would pick the description paragraph as the headline (it's the first non-metadata leaf). The `headline.length < 10 && !sources` guard only filters very short text.

**Risk:** Very low. In all observed Perplexity card layouts, the headline is always the first leaf element. The hydration poll ensures cards are fully rendered before extraction. A missing headline would indicate a broken card that should be skipped — but this hasn't been observed in practice.

**Suggestion:** If this ever occurs, add a check that the headline leaf is a heading element (`h1`-`h6`) or has a specific class, rather than assuming the first leaf is the headline.
