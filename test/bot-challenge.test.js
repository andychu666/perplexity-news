const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const {
  isChallengeTitle,
  apiGet,
  fetchFeedItems,
  scrapeWithRetries,
  noCardsMessage,
} = require("../scripts/daily-news");

// apiGet runs its fetch inside the browser tab; the fake stands in for
// browser-eval and returns what the in-page script would print.
function fakeFetch(status, headers = {}, body = {}) {
  const ok = status >= 200 && status < 300;
  return () => JSON.stringify({ status, mitigated: headers["cf-mitigated"] || null, body: ok ? body : null });
}

function challengeError(message) {
  const err = new Error(message);
  err.botChallenge = true;
  return err;
}

// ── API 403 path ────────────────────────────────────────────────────

test("apiGet reports a challenged 403 with its status and cf-mitigated header", () => {
  assert.throws(
    () => apiGet("/rest/discover/feed", fakeFetch(403, { "cf-mitigated": "challenge" })),
    (err) => {
      assert.equal(err.message, "bot challenge: HTTP 403 (cf-mitigated: challenge)");
      assert.equal(err.botChallenge, true);
      return true;
    }
  );
});

test("apiGet reports a plain 403 without marking it as a bot challenge", () => {
  assert.throws(() => apiGet("/x", fakeFetch(403)), (err) => {
    assert.equal(err.message, "HTTP 403");
    assert.equal(err.botChallenge, undefined);
    return true;
  });
});

test("apiGet keeps a non-challenge cf-mitigated value in the message only", () => {
  assert.throws(() => apiGet("/x", fakeFetch(403, { "cf-mitigated": "block" })), (err) => {
    assert.equal(err.message, "HTTP 403 (cf-mitigated: block)");
    assert.equal(err.botChallenge, undefined);
    return true;
  });
});

test("apiGet returns the JSON body on 200", () => {
  const body = apiGet("/x", fakeFetch(200, {}, { items: [1] }));
  assert.deepEqual(body, { items: [1] });
});

test("apiGet fetches the given path from inside the page", () => {
  let js = "";
  apiGet("/rest/discover/feed?limit=1", (code) => { js = code; return fakeFetch(200)(); });
  assert.match(js, /fetch\("\/rest\/discover\/feed\?limit=1"/);
  assert.match(js, /cf-mitigated/);
});

for (const status of [199, 300]) {
  test(`apiGet rejects HTTP ${status}, just outside 2xx`, () => {
    assert.throws(() => apiGet("/x", fakeFetch(status)), { message: `HTTP ${status}` });
  });
}

test("apiGet accepts HTTP 299 as success", () => {
  assert.deepEqual(apiGet("/x", fakeFetch(299, {}, { items: [] })), { items: [] });
});

// The in-page script itself, run against a fake fetch() in a VM context.
function inPageScript(pathname) {
  let js = "";
  apiGet(pathname, (code) => { js = code; return fakeFetch(200)(); });
  return js;
}

test("the in-page fetch leaves a challenged response's body unread", async () => {
  let bodyReads = 0;
  const response = {
    status: 403,
    ok: false,
    headers: { get: (name) => (name === "cf-mitigated" ? "challenge" : null) },
    json: async () => { bodyReads++; throw new SyntaxError("Unexpected token '<'"); },
  };
  const out = await vm.runInNewContext(inPageScript("/rest/discover/feed"), { fetch: async () => response });
  assert.deepEqual(JSON.parse(out), { status: 403, mitigated: "challenge", body: null });
  assert.equal(bodyReads, 0);
});

test("the in-page fetch returns a successful response's JSON body", async () => {
  const requests = [];
  const response = { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ items: [1] }) };
  const fetch = async (url, init) => { requests.push([url, init.headers.accept]); return response; };
  const out = await vm.runInNewContext(inPageScript("/rest/discover/feed?limit=1"), { fetch });
  assert.deepEqual(JSON.parse(out), { status: 200, mitigated: null, body: { items: [1] } });
  assert.deepEqual(requests, [["/rest/discover/feed?limit=1", "application/json"]]);
});

// ── Feed paging ─────────────────────────────────────────────────────

const page = (n) => ({ items: Array.from({ length: n }, (_, i) => ({ title: `t${i}` })) });

test("fetchFeedItems throws when the first page fails, so the cause is logged", () => {
  const get = () => { throw challengeError("bot challenge: HTTP 403 (cf-mitigated: challenge)"); };
  assert.throws(() => fetchFeedItems({ get }), (err) => err.botChallenge === true);
});

test("fetchFeedItems keeps earlier pages when a later page fails", () => {
  let calls = 0;
  const logs = [];
  const get = () => { if (calls++ === 0) return page(3); throw new Error("HTTP 500"); };
  assert.equal(fetchFeedItems({ perPage: 3, get, logFn: (message) => logs.push(message) }).length, 3);
  assert.equal(calls, 2);
  assert.deepEqual(logs, ["API page 2 failed (HTTP 500); keeping 3 item(s)"]);
});

test("fetchFeedItems stops after a short page and drops non-object entries", () => {
  let calls = 0;
  const get = () => { calls++; return { items: [{ title: "a" }, null, "x"] }; };
  assert.deepEqual(fetchFeedItems({ perPage: 4, get }), [{ title: "a" }]);
  assert.equal(calls, 1);
});

test("fetchFeedItems reads two full pages of 100 by default, in feed order", () => {
  const urls = [];
  const get = (url) => {
    urls.push(url);
    const offset = Number(new URL(url, "https://www.perplexity.ai").searchParams.get("offset"));
    return { items: Array.from({ length: 100 }, (_, i) => ({ n: offset + i })) };
  };
  const items = fetchFeedItems({ get });
  assert.deepEqual(urls, [
    "/rest/discover/feed?limit=100&offset=0&version=2.18&source=default",
    "/rest/discover/feed?limit=100&offset=100&version=2.18&source=default",
  ]);
  assert.deepEqual(items.map((item) => item.n), Array.from({ length: 200 }, (_, i) => i));
});

for (const body of [null, {}, { items: "x" }]) {
  test(`fetchFeedItems reads a ${JSON.stringify(body)} body as an empty last page`, () => {
    let calls = 0;
    assert.deepEqual(fetchFeedItems({ get: () => { calls++; return body; } }), []);
    assert.equal(calls, 1);
  });
}

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
  // Each empty attempt, each retry and the total are logged.
  assert.deepEqual(h.logs, [
    "  Tech: ERROR — timeout",
    "  Tech: 0 cards (attempt 1)",
    "  Tech: retry 1/2 after 5s...",
    "  Tech: 0 cards (attempt 2)",
    "  Tech: retry 2/2 after 5s...",
    "  Tech: 0 cards (3 attempts)",
  ]);
});

test("cards on the first attempt return without retrying", () => {
  const cards = { count: 1, cards: [{ headline: "h" }] };
  const h = harness([cards]);
  const out = scrapeWithRetries(cat, h.opts);
  assert.equal(h.calls, 1);
  assert.equal(out.blocked, false);
  assert.deepEqual(out.result, cards);
});

test("the attempt total is singular for one attempt and plural for two", () => {
  const found = { count: 2, cards: [{ headline: "a" }, { headline: "b" }] };
  const one = harness([found]);
  scrapeWithRetries(cat, one.opts);
  assert.deepEqual(one.logs, ["  Tech: 2 cards (1 attempt)"]);
  const two = harness([empty, found]);
  scrapeWithRetries(cat, two.opts);
  assert.equal(two.logs.at(-1), "  Tech: 2 cards (2 attempts)");
});

// ── Final error ─────────────────────────────────────────────────────

test("the final error names the bot challenge when one was seen", () => {
  assert.match(noCardsMessage(true), /Cloudflare bot challenge/);
  assert.doesNotMatch(noCardsMessage(true), /Check Chrome/);
});

test("the final error keeps the original wording otherwise", () => {
  assert.equal(noCardsMessage(false), "ERROR: No cards scraped. Check Chrome and Perplexity availability.");
});
