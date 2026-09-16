const test = require("node:test");
const assert = require("node:assert");
const { relativeTime, normalizeTitle, apiCard } = require("../scripts/daily-news.js");

test("relativeTime: singular units match the UI wording", () => {
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  assert.strictEqual(relativeTime(at(1)), "1 minute ago");
  assert.strictEqual(relativeTime(at(59)), "59 minutes ago");
  assert.strictEqual(relativeTime(at(60)), "1 hour ago");
  assert.strictEqual(relativeTime(at(60 * 24)), "1 day ago");
  assert.strictEqual(relativeTime(at(60 * 24 * 3)), "3 days ago");
});

test("relativeTime: future/skewed and invalid timestamps", () => {
  assert.strictEqual(relativeTime(new Date(Date.now() + 120000).toISOString()), "just now");
  assert.strictEqual(relativeTime("not-a-date"), null);
  assert.strictEqual(relativeTime(null), null);
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
    published_timestamp: new Date(Date.now() - 3600000).toISOString(),
    web_results_preview: { total_count: 7 },
    featured_images: [{ image: "https://img/1.jpg" }],
  });
  assert.strictEqual(card.headline, "Headline");
  assert.strictEqual(card.sources, "7");
  assert.strictEqual(card.href, "https://www.perplexity.ai/discover/abc");
  assert.strictEqual(card.imgSrc, "https://img/1.jpg");
  assert.strictEqual(card.published, "1 hour ago");
  // short_title is used when title is missing
  assert.strictEqual(apiCard({ short_title: "Short" }).headline, "Short");
});
