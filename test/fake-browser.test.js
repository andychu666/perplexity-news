const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const script = path.join(__dirname, "../scripts/daily-news.js");
const tools = ".pi/agent/skills/pi-skills/browser-tools";

// Runs `driver` in a child Node with HOME in a temp dir and a dead CDP URL.
// The preload replaces child_process before the script loads, because the
// script binds execFileSync at require time. No test here calls main(), so
// ensureChrome() never runs.
function runChild(t, { preload, driver, setup = () => ({}) }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "news-fake-browser-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const preloadPath = path.join(home, "preload.cjs");
  fs.writeFileSync(preloadPath, preload);
  const result = spawnSync(process.execPath, ["--require", preloadPath, "-e", driver], {
    env: { ...process.env, HOME: home, PERPLEXITY_CDP: "http://127.0.0.1:1", ...setup(home) }, // gitleaks:allow (IPv4 loopback)
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  return { ...result, home };
}

// ── scrapeCategory, through scrapeWithRetries' defaults ─────────────

// Fake browser tools: canned answers, each call recorded in order. A fake
// clock behind Date.now and Atomics.wait (sleepSync) makes the 20 s
// hydration wait and the 5 s retry delays instant.
const SCRAPE_PRELOAD = `
const childProcess = require("node:child_process");
const path = require("node:path");
const page = JSON.parse(process.env.FAKE_PAGE);
const calls = [];
const waits = [];
let clock = 0;
Date.now = () => clock;
Atomics.wait = (array, index, value, ms) => {
  waits.push(ms);
  clock += ms;
  return "timed-out";
};
childProcess.spawn = () => {
  throw new Error("unexpected spawn");
};
childProcess.execFileSync = (file, args) => {
  const tool = path.relative(process.env.HOME, file);
  if (tool === "${tools}/browser-nav.js") {
    calls.push("nav " + args[0]);
    return "";
  }
  if (tool !== "${tools}/browser-eval.js") throw new Error("unexpected subprocess " + file);
  const code = args[0];
  if (code === "document.title") {
    calls.push("title");
    return page.title + "\\n";
  }
  if (code.startsWith("document.querySelectorAll")) {
    calls.push("count");
    return page.count + "\\n";
  }
  if (code.includes("parseCardFromLeaves")) {
    calls.push("extract");
    return page.extract;
  }
  throw new Error("unexpected eval " + code.slice(0, 40));
};
globalThis.fakeBrowser = { calls, waits };
`;

const SCRAPE_DRIVER = `
const { scrapeWithRetries } = require(${JSON.stringify(script)});
const out = scrapeWithRetries({ id: "tech", name: "Tech" });
process.stdout.write(JSON.stringify({ out, ...globalThis.fakeBrowser }));
`;

function scrapeTech(t, page) {
  const run = runChild(t, {
    preload: SCRAPE_PRELOAD,
    driver: SCRAPE_DRIVER,
    setup: () => ({ FAKE_PAGE: JSON.stringify(page) }),
  });
  assert.equal(run.status, 0, run.stderr);
  return { ...JSON.parse(run.stdout), log: run.stderr.split("\n").filter(Boolean) };
}

const normalTitle = "Discover - Perplexity";
const emptyPage = JSON.stringify({ count: 0, cards: [] });
const cards = [
  { headline: "First headline on the page", published: null, sources: "4", href: "https://www.perplexity.ai/discover/tech/first", imgSrc: null },
  { headline: "Second headline on the page", published: "1 hour ago", sources: "2", href: "https://www.perplexity.ai/discover/tech/second", imgSrc: null },
];

test("a category still on the interstitial after hydration is blocked without retries", (t) => {
  const run = scrapeTech(t, { count: 0, title: "Just a moment...", extract: emptyPage });
  assert.deepEqual(run.out, { result: { count: 0, cards: [] }, attempts: 1, blocked: true });
  assert.equal(run.calls.at(-1), "title");
  assert.equal(run.calls.includes("extract"), false);
  assert.ok(run.log.includes("[news]   Tech: blocked by bot challenge — not retrying"), run.log.join("\n"));
});

test("an empty category on a normal page is extracted and retried", (t) => {
  const run = scrapeTech(t, { count: 0, title: normalTitle, extract: emptyPage });
  assert.deepEqual(run.out, { result: { count: 0, cards: [] }, attempts: 3, blocked: false });
  assert.equal(run.calls.filter((call) => call === "title").length, 3);
  assert.equal(run.calls.filter((call) => call === "extract").length, 3);
  assert.deepEqual(run.waits.filter((ms) => ms === 5000), [5000, 5000]);
});

test("hydrated cards are extracted without a title check", (t) => {
  const run = scrapeTech(t, { count: 2, title: normalTitle, extract: JSON.stringify({ count: 2, cards }) });
  assert.deepEqual(run.out, { result: { count: 2, cards }, attempts: 1, blocked: false });
  assert.deepEqual(run.calls, ["nav https://www.perplexity.ai/discover/tech", "count", "extract"]);
});

test("extract output with noise around the JSON still yields the cards", (t) => {
  const run = scrapeTech(t, { count: 2, title: normalTitle, extract: `warning: slow page\n${JSON.stringify({ count: 2, cards })}\n` });
  assert.deepEqual(run.out.result, { count: 2, cards });
});

test("extract output with unparseable JSON is an empty page, not a scrape error", (t) => {
  const run = scrapeTech(t, { count: 2, title: normalTitle, extract: "warning: {not json}" });
  assert.deepEqual(run.out, { result: { count: 0, cards: [] }, attempts: 3, blocked: false });
  assert.ok(run.log.some((line) => line.startsWith("[news]   Parse error for Tech:")), run.log.join("\n"));
  assert.equal(run.log.some((line) => line.includes("ERROR —")), false);
});

// ── fetchFeedItems → apiGet → browserEval defaults ──────────────────

// Only subprocesses under the temp HOME may run, and they run for real.
const HOME_ONLY_PRELOAD = `
const childProcess = require("node:child_process");
const path = require("node:path");
const realExecFileSync = childProcess.execFileSync;
childProcess.spawn = () => {
  throw new Error("unexpected spawn");
};
childProcess.execFileSync = (file, ...rest) => {
  if (path.relative(process.env.HOME, file).startsWith("..")) throw new Error("unexpected subprocess " + file);
  return realExecFileSync(file, ...rest);
};
`;

// Stands in for browser-eval.js: answers the in-page feed fetch with a full
// first page over 1 MiB and a short second page, and logs each path.
const FAKE_EVAL = `#!${process.execPath}
const fs = require("node:fs");
const pathname = /fetch\\("([^"]+)"/.exec(process.argv[2])[1];
fs.appendFileSync(process.env.FAKE_LOG, pathname + "\\n");
const offset = Number(new URL(pathname, "https://www.perplexity.ai").searchParams.get("offset"));
const items = offset === 0
  ? Array.from({ length: 100 }, (_, i) => ({ title: "story " + i, padding: "x".repeat(16 * 1024) }))
  : [{ title: "last story" }];
process.stdout.write(JSON.stringify({ status: 200, mitigated: null, body: { items } }));
`;

const FEED_DRIVER = `
const items = require(${JSON.stringify(script)}).fetchFeedItems();
process.stdout.write(JSON.stringify(items.map((item) => item.title)));
`;

test("the default feed read goes through browser-eval and takes a page over 1 MiB", (t) => {
  const run = runChild(t, {
    preload: HOME_ONLY_PRELOAD,
    driver: FEED_DRIVER,
    setup(home) {
      fs.mkdirSync(path.join(home, tools), { recursive: true });
      fs.writeFileSync(path.join(home, tools, "browser-eval.js"), FAKE_EVAL, { mode: 0o755 });
      return { FAKE_LOG: path.join(home, "requests.log") };
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const titles = JSON.parse(run.stdout);
  assert.equal(titles.length, 101);
  assert.equal(titles[0], "story 0");
  assert.equal(titles[100], "last story");
  assert.deepEqual(fs.readFileSync(path.join(run.home, "requests.log"), "utf8").trim().split("\n"), [
    "/rest/discover/feed?limit=100&offset=0&version=2.18&source=default",
    "/rest/discover/feed?limit=100&offset=100&version=2.18&source=default",
  ]);
});
