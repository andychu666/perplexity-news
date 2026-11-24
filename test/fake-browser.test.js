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
// hydration wait and the 5 s retry delays instant. It also answers the
// in-page feed fetch, for collectDigest.
const SCRAPE_PRELOAD = `
const childProcess = require("node:child_process");
const path = require("node:path");
const page = JSON.parse(process.env.FAKE_PAGE);
const calls = [];
const waits = [];
const navOptions = [];
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
childProcess.execFileSync = (file, args, options) => {
  const tool = path.relative(process.env.HOME, file);
  if (tool === "${tools}/browser-nav.js") {
    calls.push("nav " + args[0]);
    navOptions.push(options);
    return "";
  }
  if (tool !== "${tools}/browser-eval.js") throw new Error("unexpected subprocess " + file);
  const code = args[0];
  if (code === "document.title") {
    calls.push("title");
    // page.titles, when set, answers the first title reads in turn.
    return (page.titles?.shift() ?? page.title) + "\\n";
  }
  if (code.startsWith("document.querySelectorAll")) {
    calls.push("count");
    return page.count + "\\n";
  }
  if (code.includes("parseCardFromLeaves")) {
    calls.push("extract");
    return page.extract;
  }
  const feed = /fetch\\("([^"]+)"/.exec(code);
  if (feed) {
    calls.push("feed " + feed[1]);
    return JSON.stringify({ status: 200, mitigated: null, body: { items: page.feed } });
  }
  throw new Error("unexpected eval " + code.slice(0, 40));
};
globalThis.fakeBrowser = { calls, waits, navOptions };
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

// ── collectDigest and openDiscoverTab, through their defaults ───────

const COLLECT_DRIVER = `
const out = require(${JSON.stringify(script)}).collectDigest();
process.stdout.write(JSON.stringify({ out, ...globalThis.fakeBrowser }));
`;

test("collectDigest() with its defaults waits out the interstitial, reads the feed in the tab and scrapes the rest", (t) => {
  const feed = [{ title: "First API story" }, { title: "Second API story" }];
  const run = runChild(t, {
    preload: SCRAPE_PRELOAD,
    driver: COLLECT_DRIVER,
    setup: () => ({
      FAKE_PAGE: JSON.stringify({ titles: ["Just a moment..."], title: normalTitle, count: 2, extract: JSON.stringify({ count: 2, cards }), feed }),
    }),
  });
  assert.equal(run.status, 0, run.stderr);
  const { out, calls, waits, navOptions } = JSON.parse(run.stdout);
  assert.equal(out.blocked, false);
  assert.deepEqual(out.allData.top.cards.map((card) => card.headline), ["First API story", "Second API story"]);
  for (const id of ["tech", "finance", "arts", "sports", "entertainment"]) {
    assert.deepEqual(out.allData[id], { count: 2, cards }, id);
  }
  assert.deepEqual(calls.slice(0, 5), [
    "nav https://www.perplexity.ai/discover/top",
    "title",
    "title",
    "feed /rest/discover/feed?limit=100&offset=0&version=2.18&source=default",
    "nav https://www.perplexity.ai/discover/tech",
  ]);
  assert.equal(waits[0], 1000);
  assert.deepEqual(navOptions[0], { timeout: 15000, stdio: "pipe" });
  const log = run.stderr.split("\n");
  assert.ok(log.includes("[news] API: 2 feed item(s) with publish times"), run.stderr);
  assert.ok(log.includes("[news]   Top: 2 cards (API)"), run.stderr);
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

// ── openDigest, through its defaults ────────────────────────────────

const XDG_PRELOAD = `
const childProcess = require("node:child_process");
const calls = [];
childProcess.execFileSync = (...args) => {
  calls.push(args);
  return "";
};
childProcess.spawn = () => {
  throw new Error("unexpected spawn");
};
globalThis.fakeExec = { calls };
`;

const OPEN_DRIVER = `
require(${JSON.stringify(script)}).openDigest(process.env.DIGEST);
process.stdout.write(JSON.stringify(globalThis.fakeExec.calls));
`;

test("openDigest(outPath) with its defaults runs xdg-open and logs to stderr", (t) => {
  const run = runChild(t, {
    preload: XDG_PRELOAD,
    driver: OPEN_DRIVER,
    setup: (home) => ({ DIGEST: path.join(home, "news digest.html") }),
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [["xdg-open", [path.join(run.home, "news digest.html")], { stdio: "ignore" }]]);
  assert.equal(run.stderr, "[news] Opened in browser\n");
});

// ── prepareChromeLaunch, through its defaults ───────────────────────

// fs.accessSync answers for the Chrome candidates and xvfb-run from a list,
// so the result does not depend on what this machine has installed.
const ACCESS_PRELOAD = `
const fs = require("node:fs");
const childProcess = require("node:child_process");
const realAccessSync = fs.accessSync;
const faked = ${JSON.stringify([
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
  "/usr/bin/xvfb-run",
])};
const executables = JSON.parse(process.env.FAKE_EXECUTABLES);
const checked = [];
fs.accessSync = (file, mode) => {
  if (!faked.includes(file)) return realAccessSync(file, mode);
  checked.push(file);
  if (!executables.includes(file)) throw Object.assign(new Error("ENOENT: " + file), { code: "ENOENT" });
};
childProcess.execFileSync = childProcess.spawn = () => {
  throw new Error("unexpected subprocess");
};
globalThis.fakeAccess = { checked };
`;

const LAUNCH_DRIVER = `
const launch = require(${JSON.stringify(script)}).prepareChromeLaunch();
process.stdout.write(JSON.stringify({ launch, ...globalThis.fakeAccess }));
`;

test("prepareChromeLaunch() with its defaults makes the profile under HOME and clears its stale lock", (t) => {
  const run = runChild(t, {
    preload: ACCESS_PRELOAD,
    driver: LAUNCH_DRIVER,
    setup(home) {
      const profile = path.join(home, ".cache", "browser-tools");
      fs.mkdirSync(profile, { recursive: true });
      // PID 2147483647 is above Linux's pid_max, so the lock's owner is dead.
      fs.symlinkSync(`${os.hostname()}-2147483647`, path.join(profile, "SingletonLock"));
      return { FAKE_EXECUTABLES: JSON.stringify(["/usr/bin/chromium", "/usr/bin/xvfb-run"]) };
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const profile = path.join(run.home, ".cache", "browser-tools");
  const { launch, checked } = JSON.parse(run.stdout);
  assert.deepEqual(launch, {
    cmd: "/usr/bin/xvfb-run",
    args: [
      "-a", "-s", "-screen 0 1280x900x24", "/usr/bin/chromium", "--ozone-platform=x11",
      "--remote-debugging-port=1", `--user-data-dir=${profile}`, "--no-first-run",
      "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
    ],
    port: "1",
  });
  assert.deepEqual(checked, [
    "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/xvfb-run",
  ]);
  assert.deepEqual(fs.readdirSync(profile), []);
  assert.deepEqual(run.stderr.split("\n").filter(Boolean), [
    "[news] Removed stale SingletonLock",
    "[news] Starting Chrome (/usr/bin/chromium under xvfb-run)...",
  ]);
});
