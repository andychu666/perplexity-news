const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isChallengeTitle,
  apiGet,
  scrapeWithRetries,
  noCardsMessage,
} = require("../scripts/daily-news");

function fakeFetch(status, headers = {}, body = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  });
}

function challengeError(message) {
  const err = new Error(message);
  err.botChallenge = true;
  return err;
}

// ── API 403 path ────────────────────────────────────────────────────

test("apiGet reports a challenged 403 with its status and cf-mitigated header", async () => {
  await assert.rejects(
    apiGet("/rest/discover/feed", [], fakeFetch(403, { "cf-mitigated": "challenge" })),
    (err) => {
      assert.equal(err.message, "bot challenge: HTTP 403 (cf-mitigated: challenge)");
      assert.equal(err.botChallenge, true);
      return true;
    }
  );
});

test("apiGet reports a plain 403 without marking it as a bot challenge", async () => {
  await assert.rejects(apiGet("/x", [], fakeFetch(403)), (err) => {
    assert.equal(err.message, "HTTP 403");
    assert.equal(err.botChallenge, undefined);
    return true;
  });
});

test("apiGet keeps a non-challenge cf-mitigated value in the message only", async () => {
  await assert.rejects(apiGet("/x", [], fakeFetch(403, { "cf-mitigated": "block" })), (err) => {
    assert.equal(err.message, "HTTP 403 (cf-mitigated: block)");
    assert.equal(err.botChallenge, undefined);
    return true;
  });
});

test("apiGet returns the JSON body on 200", async () => {
  const body = await apiGet("/x", [], fakeFetch(200, {}, { items: [1] }));
  assert.deepEqual(body, { items: [1] });
});

// ── Interstitial detection ──────────────────────────────────────────

test("isChallengeTitle matches Cloudflare's interstitial title", () => {
  assert.equal(isChallengeTitle("Just a moment..."), true);
  assert.equal(isChallengeTitle("  just a moment…\n"), true);
});

test("isChallengeTitle ignores normal page titles", () => {
  assert.equal(isChallengeTitle("Discover - Perplexity"), false);
  assert.equal(isChallengeTitle("Wait — Just a moment in history"), false);
  assert.equal(isChallengeTitle(""), false);
});

// ── Retry loop ──────────────────────────────────────────────────────

function harness(outcomes) {
  const logs = [];
  const sleeps = [];
  let calls = 0;
  return {
    logs,
    sleeps,
    get calls() {
      return calls;
    },
    opts: {
      logFn: (m) => logs.push(m),
      sleep: (ms) => sleeps.push(ms),
      scrape: () => {
        const outcome = outcomes[calls++];
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
  };
}

const cat = { id: "tech", name: "Tech" };
const empty = { count: 0, cards: [] };

test("an interstitial stops the retries after the first attempt", () => {
  const h = harness([challengeError("bot challenge: page is a Cloudflare interstitial")]);
  const out = scrapeWithRetries(cat, h.opts);
  assert.equal(h.calls, 1);
  assert.equal(out.attempts, 1);
  assert.equal(out.blocked, true);
  assert.deepEqual(out.result, empty);
  assert.deepEqual(h.sleeps, []);
  assert.ok(h.logs.some((m) => m.includes("blocked by bot challenge — not retrying")));
});

test("an interstitial on a retry stops the remaining retries", () => {
  const h = harness([empty, challengeError("bot challenge: x")]);
  const out = scrapeWithRetries(cat, h.opts);
  assert.equal(h.calls, 2);
  assert.equal(out.blocked, true);
  assert.deepEqual(h.sleeps, [5000]);
});

test("ordinary errors and empty pages still retry the full count", () => {
  const h = harness([new Error("timeout"), empty, empty]);
  const out = scrapeWithRetries(cat, h.opts);
  assert.equal(h.calls, 3);
  assert.equal(out.attempts, 3);
  assert.equal(out.blocked, false);
  assert.deepEqual(h.sleeps, [5000, 5000]);
});

test("cards on the first attempt return without retrying", () => {
  const cards = { count: 1, cards: [{ headline: "h" }] };
  const h = harness([cards]);
  const out = scrapeWithRetries(cat, h.opts);
  assert.equal(h.calls, 1);
  assert.equal(out.blocked, false);
  assert.deepEqual(out.result, cards);
});

// ── Final error ─────────────────────────────────────────────────────

test("the final error names the bot challenge when one was seen", () => {
  assert.match(noCardsMessage(true), /Cloudflare bot challenge/);
  assert.doesNotMatch(noCardsMessage(true), /Check Chrome/);
});

test("the final error keeps the original wording otherwise", () => {
  assert.equal(noCardsMessage(false), "ERROR: No cards scraped. Check Chrome and Perplexity availability.");
});
