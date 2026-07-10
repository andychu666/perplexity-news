const assert = require("node:assert/strict");
const test = require("node:test");

const { parseCardFromLeaves } = require("../scripts/daily-news");

// ── Bug #9 regression: headline ending in a year merges with sources ──
// When the headline ends with "2027" and the adjacent leaf is "39 sources",
// the old innerText+regex approach produced sources="202739" and truncated
// the headline to "...in". The leaf-based approach must keep them separate.

test("headline ending in year does not merge with sources count", () => {
  const leafTexts = [
    "Le Pen says she will run for France's presidency in 2027",
    "39 sources",
  ];
  const card = parseCardFromLeaves(leafTexts);
  assert.equal(card.sources, "39");
  assert.equal(
    card.headline,
    "Le Pen says she will run for France's presidency in 2027"
  );
  assert.equal(card.published, null);
});

test("headline ending in age does not merge with sources count", () => {
  // "Bonnie Tyler ... dies at 75" + "28 sources" → old bug gave "7528 sources"
  const leafTexts = [
    "Bonnie Tyler, 'Total Eclipse of the Heart' singer, dies at 75",
    "28 sources",
  ];
  const card = parseCardFromLeaves(leafTexts);
  assert.equal(card.sources, "28");
  assert.equal(
    card.headline,
    "Bonnie Tyler, 'Total Eclipse of the Heart' singer, dies at 75"
  );
});

test("headline ending in year with absolute publish date", () => {
  // "Morgan Stanley forecasts record $6.4T in global M&A for 2026" + "26 sources"
  const leafTexts = [
    "Morgan Stanley forecasts record $6.4T in global M&A for 2026",
    "Published",
    "Jul 9, 2026",
    "Morgan Stanley analysts predict the largest wave of corporate dealmaking on record this year.",
    "26 sources",
  ];
  const card = parseCardFromLeaves(leafTexts);
  assert.equal(card.sources, "26");
  assert.equal(card.published, "Jul 9, 2026");
  assert.equal(
    card.headline,
    "Morgan Stanley forecasts record $6.4T in global M&A for 2026"
  );
});

test("expanded card with relative publish time", () => {
  const leafTexts = [
    "Ukraine drones strike more Russian oil sites as fuel crisis grips 90% of regions",
    "Published",
    "1 hour ago",
    "Russia banned diesel exports until July 31 after sustained Ukrainian drone attacks.",
    "29 sources",
  ];
  const card = parseCardFromLeaves(leafTexts);
  assert.equal(card.sources, "29");
  assert.equal(card.published, "1 hour ago");
  assert.equal(
    card.headline,
    "Ukraine drones strike more Russian oil sites as fuel crisis grips 90% of regions"
  );
});

test("compact card with no publish time", () => {
  const leafTexts = [
    "Poorly worded clause in Trump's Iran deal fuels Hormuz crisis",
    "41 sources",
  ];
  const card = parseCardFromLeaves(leafTexts);
  assert.equal(card.sources, "41");
  assert.equal(card.published, null);
  assert.equal(
    card.headline,
    "Poorly worded clause in Trump's Iran deal fuels Hormuz crisis"
  );
});

test("returns null for empty/too-short leaf text with no sources", () => {
  assert.equal(parseCardFromLeaves([]), null);
  assert.equal(parseCardFromLeaves(["short"]), null);
});

test("published leaf without valid date pattern is not captured", () => {
  // If the leaf after "Published" doesn't match a known date/time pattern,
  // published should be null (don't capture garbage).
  const leafTexts = [
    "Some headline that is long enough",
    "Published",
    "Some unexpected text",
    "15 sources",
  ];
  const card = parseCardFromLeaves(leafTexts);
  assert.equal(card.published, null);
  assert.equal(card.sources, "15");
  assert.equal(card.headline, "Some headline that is long enough");
});
