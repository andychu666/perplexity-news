const test = require("node:test");
const assert = require("node:assert");
const { relativeTime, normalizeTitle, apiCard, selectTopApiCards } = require("../scripts/daily-news.js");

const now = Date.parse("2025-01-02T12:00:00.000Z");
const minutesAgo = (minutes) => new Date(now - minutes * 60000).toISOString();
const futureTimestamp = "9999-01-01T00:00:00.000Z";

test("relativeTime: boundaries and unit wording match the UI", () => {
  const cases = [
    [0, "just now"],
    [1, "1 minute ago"],
    [59, "59 minutes ago"],
    [60, "1 hour ago"],
    [60 * 5, "5 hours ago"],
    [60 * 23, "23 hours ago"],
    [60 * 24, "1 day ago"],
    [60 * 24 * 3, "3 days ago"],
  ];
  for (const [minutes, expected] of cases) {
    assert.strictEqual(relativeTime(minutesAgo(minutes), now), expected);
  }
});

test("relativeTime: future/skewed and invalid timestamps", () => {
  assert.strictEqual(relativeTime(minutesAgo(-2), now), "just now");
  assert.strictEqual(relativeTime("not-a-date", now), null);
  assert.strictEqual(relativeTime(null, now), null);
});

test("normalizeTitle: keeps non-Latin headlines distinct", () => {
  assert.strictEqual(normalizeTitle("Hello, World!"), "helloworld");
  assert.notStrictEqual(normalizeTitle("香蕉漲價"), "");
  assert.notStrictEqual(normalizeTitle("香蕉漲價"), normalizeTitle("蘋果降價"));
  assert.strictEqual(normalizeTitle(null), "");
});

test("apiCard: shape guards and field mapping", () => {
  assert.strictEqual(apiCard(null), null);
  assert.strictEqual(apiCard("nope"), null);
  const card = apiCard({
    title: "Headline",
    slug: "abc",
    published_timestamp: futureTimestamp,
    web_results_preview: { total_count: 7 },
    featured_images: [{ image: "https://img/1.jpg" }],
  });
  assert.strictEqual(card.headline, "Headline");
  assert.strictEqual(card.sources, "7");
  assert.strictEqual(card.href, "https://www.perplexity.ai/discover/abc");
  assert.strictEqual(card.imgSrc, "https://img/1.jpg");
  assert.strictEqual(card.published, "just now");
  // short_title is used when title is missing
  assert.strictEqual(apiCard({ short_title: "Short" }).headline, "Short");
});

test("apiCard: zero, missing and null source counts stay distinct", () => {
  assert.strictEqual(apiCard({ web_results_preview: { total_count: 0 } }).sources, "0");
  assert.strictEqual(apiCard({ web_results_preview: {} }).sources, null);
  assert.strictEqual(apiCard({ web_results_preview: { total_count: null } }).sources, null);
  assert.strictEqual(apiCard({}).sources, null);
});

test("apiCard: explicit URLs and fallback fields map to cards", () => {
  const card = apiCard({
    slug: "abc",
    url: "https://www.perplexity.ai/discover/top/custom",
    updated_datetime: futureTimestamp,
    featured_images: [{ thumbnail: "https://img/thumb.jpg" }],
  });
  assert.strictEqual(card.href, "https://www.perplexity.ai/discover/top/custom");
  assert.strictEqual(apiCard({}).href, "#");
  assert.strictEqual(card.published, "just now");
  assert.strictEqual(card.imgSrc, "https://img/thumb.jpg");
});

test("Top falls back when feed items have no headline", () => {
  const items = [{ slug: "missing-title" }, { title: "" }];
  assert.deepStrictEqual(selectTopApiCards(items.map(apiCard)), []);
});

test("Top API cards filter whitespace headlines and keep usable cards", () => {
  const items = [{ title: " \t\n" }, { short_title: " " }, { title: "Headline", slug: "abc" }];
  const cards = items.map(apiCard);
  assert.deepStrictEqual(selectTopApiCards(cards), [cards[2]]);
});
