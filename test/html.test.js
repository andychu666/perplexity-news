const test = require("node:test");
const assert = require("node:assert/strict");
const { safeUrl, cardHtml } = require("../scripts/daily-news.js");

test("safeUrl accepts absolute HTTP and HTTPS URLs only", () => {
  assert.equal(safeUrl(" http://example.com/story "), "http://example.com/story");
  assert.equal(safeUrl("https://example.com/story"), "https://example.com/story");
  assert.equal(safeUrl("/story"), "");
  assert.equal(safeUrl("javascript:"), "");
});

for (const href of ["javascript:", " JaVaScRiPt:", "java\tscript:"]) {
  test(`cardHtml replaces unsafe href ${JSON.stringify(href)} with #`, () => {
    assert.match(cardHtml({ href }), /<a href="#"/);
  });
}

for (const imgSrc of ["data:,", "javascript:"]) {
  test(`cardHtml omits unsafe image URL ${JSON.stringify(imgSrc)}`, () => {
    assert.doesNotMatch(cardHtml({ imgSrc }), /<img\b/i);
  });
}

test("cardHtml escapes headline markup", () => {
  const html = cardHtml({ headline: '\"><script>' });
  assert.match(html, /<h3>&quot;&gt;&lt;script&gt;<\/h3>/);
  assert.doesNotMatch(html, /<script>/i);
});

test("cardHtml escapes source count markup", () => {
  const html = cardHtml({ sources: "<img onerror>" });
  assert.match(html, /&lt;img onerror&gt; sources/);
  assert.doesNotMatch(html, /<img\b/i);
});

test("cardHtml uses singular and plural source labels", () => {
  assert.match(cardHtml({ sources: "1" }), /1 source<\/span>/);
  assert.match(cardHtml({ sources: "3" }), /3 sources<\/span>/);
});
