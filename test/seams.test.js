const test = require("node:test");
const assert = require("node:assert/strict");
const { constants } = require("node:fs");
const {
  collectDigest,
  openDigest,
  openDiscoverTab,
  cdpPort,
  headlessWarning,
  chromeCommand,
  prepareChromeLaunch,
} = require("../scripts/daily-news.js");

test("collectDigest serves the API Top cards and scrapes other categories", () => {
  const calls = [];
  const logFn = () => {};
  const { allData, blocked } = collectDigest({
    openTab: () => calls.push("open"),
    fetchFeed: ({ logFn: logger }) => {
      assert.equal(logger, logFn);
      calls.push("feed");
      return [{ title: "API headline" }];
    },
    scrape: ({ id }, { logFn: logger }) => {
      assert.equal(logger, logFn);
      calls.push(id);
      return { result: { count: 1, cards: [{ headline: id }] }, blocked: false };
    },
    logFn,
  });

  assert.deepEqual(calls, ["open", "feed", "tech", "finance", "arts", "sports", "entertainment"]);
  assert.equal(allData.top.cards[0].headline, "API headline");
  assert.equal(allData.tech.cards[0].headline, "tech");
  assert.equal(blocked, false);
});

test("openDigest invokes xdg-open with the output path as one argument", () => {
  const calls = [];
  const logs = [];
  const outPath = "/scratch/news digest.html";
  openDigest(outPath, {
    exec: (...args) => calls.push(args),
    logFn: (message) => logs.push(message),
  });

  assert.deepEqual(calls, [["xdg-open", [outPath], { stdio: "ignore" }]]);
  assert.deepEqual(logs, ["Opened in browser"]);
});

test("openDiscoverTab navigates to Top and returns when the title is ready", () => {
  const calls = [];
  openDiscoverTab({
    nav: (url) => calls.push(url),
    title: () => {
      calls.push("title");
      return "Discover";
    },
    sleep: () => assert.fail("paused after the title was ready"),
  });

  assert.deepEqual(calls, ["https://www.perplexity.ai/discover/top", "title"]);
});

test("cdpPort returns the explicit port", () => {
  assert.equal(cdpPort("http://example.invalid:9333"), "9333");
});

test("headlessWarning reports an existing headless Chrome", () => {
  assert.match(headlessWarning('{"Browser":"HeadlessChrome/123"}'), /CDP port is headless/);
});

test("chromeCommand wraps headed Chrome in xvfb-run", () => {
  const chromeBin = "/scratch/chrome";
  const { cmd, args } = chromeCommand({
    chromeBin,
    port: "9333",
    userDataDir: "/scratch/profile",
    hasXvfb: true,
  });

  assert.equal(cmd, "/usr/bin/xvfb-run");
  assert.deepEqual(args.slice(0, 7), [
    "-a", "-s", "-screen 0 1280x900x24", chromeBin, "--ozone-platform=x11",
    "--remote-debugging-port=9333", "--user-data-dir=/scratch/profile",
  ]);
});

test("prepareChromeLaunch creates the profile and calls lock cleanup before preparing the command", () => {
  const calls = [];
  const userDataDir = "/scratch/profile";
  const logFn = () => {};
  const launch = prepareChromeLaunch({
    cdpUrl: "http://example.invalid:9333",
    userDataDir,
    access: (...args) => calls.push(["access", ...args]),
    mkdir: (...args) => calls.push(["mkdir", ...args]),
    clearLocks: (dir, options) => calls.push(["clearLocks", dir, options]),
    logFn,
  });

  assert.deepEqual(calls, [
    ["access", "/usr/bin/google-chrome-stable", constants.X_OK],
    ["mkdir", userDataDir, { recursive: true }],
    ["clearLocks", userDataDir, { logFn }],
    ["access", "/usr/bin/xvfb-run", constants.X_OK],
  ]);
  assert.equal(launch.cmd, "/usr/bin/xvfb-run");
  assert.equal(launch.port, "9333");
});

// ── collectDigest ───────────────────────────────────────────────────

const quiet = () => {};
const categoryIds = ["top", "tech", "finance", "arts", "sports", "entertainment"];
const noCards = () => ({ result: { count: 0, cards: [] }, blocked: false });
const now = Date.parse("2025-01-02T12:00:00.000Z");
const hoursAgo = (hours) => new Date(now - hours * 3600000).toISOString();

function challengeError(message) {
  const err = new Error(`bot challenge: ${message}`);
  err.botChallenge = true;
  return err;
}

test("collectDigest scrapes Top when the API is challenged and marks the run blocked", () => {
  const scraped = [];
  const logs = [];
  const { allData, blocked } = collectDigest({
    openTab: () => {
      throw challengeError("page is a Cloudflare interstitial");
    },
    fetchFeed: () => assert.fail("read the feed after the tab failed"),
    scrape: (cat) => {
      scraped.push(cat.id);
      return noCards();
    },
    logFn: (message) => logs.push(message),
  });

  assert.equal(blocked, true);
  assert.deepEqual(scraped, categoryIds);
  assert.deepEqual(Object.keys(allData), categoryIds);
  assert.deepEqual(logs, ["API unavailable (bot challenge: page is a Cloudflare interstitial); relying on UI scraping"]);
});

test("collectDigest does not mark the run blocked for a plain API failure", () => {
  const { blocked } = collectDigest({
    openTab: quiet,
    fetchFeed: () => {
      throw new Error("HTTP 500");
    },
    scrape: noCards,
    logFn: quiet,
  });

  assert.equal(blocked, false);
});

test("collectDigest scrapes Top when no feed item has a usable headline", () => {
  const scraped = [];
  collectDigest({
    openTab: quiet,
    fetchFeed: () => [{ title: " \t" }, { slug: "no-title" }],
    scrape: (cat) => {
      scraped.push(cat.id);
      return noCards();
    },
    logFn: quiet,
  });

  assert.deepEqual(scraped, categoryIds);
});

test("collectDigest ignores feed entries that are not objects", () => {
  const { allData } = collectDigest({
    openTab: quiet,
    fetchFeed: () => [null, 7, { title: "Real story" }],
    scrape: noCards,
    logFn: quiet,
  });

  assert.deepEqual(allData.top.cards.map((card) => card.headline), ["Real story"]);
});

test("collectDigest marks the run blocked when one scraped category was challenged", () => {
  const { blocked } = collectDigest({
    openTab: quiet,
    fetchFeed: () => [],
    scrape: (cat) => ({ result: { count: 0, cards: [] }, blocked: cat.id === "sports" }),
    logFn: quiet,
  });

  assert.equal(blocked, true);
});

test("collectDigest skips the publish-time backfill when the feed is empty", () => {
  const results = new Map();
  const { allData } = collectDigest({
    openTab: quiet,
    fetchFeed: () => [],
    scrape: (cat) => {
      // Only the backfill reads the cards, and an empty feed can fill nothing.
      const result = {
        count: 0,
        get cards() {
          return assert.fail(`read the ${cat.id} cards without a feed`);
        },
      };
      results.set(cat.id, result);
      return { result, blocked: false };
    },
    logFn: quiet,
  });

  assert.deepEqual([...results.keys()], categoryIds);
  for (const [id, result] of results) assert.equal(allData[id], result);
});

test("collectDigest backfills missing publish times of scraped cards from the API", (t) => {
  t.mock.method(Date, "now", () => now);
  const feed = [
    { title: "Shared story", published_timestamp: hoursAgo(2) },
    { title: "Dated elsewhere", published_timestamp: hoursAgo(3) },
    { title: "No time in feed" },
    { title: "Repeated story", published_timestamp: hoursAgo(4) },
    { title: "repeated STORY", published_timestamp: hoursAgo(5) },
    { title: "Echo story" },
    { title: "Echo story", published_timestamp: hoursAgo(6) },
    { title: "Echo story" },
    { title: "Business story", published_timestamp: hoursAgo(7) },
  ];
  const scrapedCards = {
    tech: [
      { headline: "Shared Story!", published: null },
      { headline: "Dated elsewhere", published: "1 hour ago" },
      { headline: "No time in feed", published: null },
      { headline: "Not in the feed", published: null },
      { headline: "", published: null },
      { headline: "Repeated story", published: null },
      { headline: "Echo story", published: null },
    ],
    finance: [{ headline: "Business story", published: null }],
  };
  const logs = [];
  const { allData } = collectDigest({
    openTab: quiet,
    fetchFeed: () => feed,
    scrape: (cat) => {
      const cards = scrapedCards[cat.id] ?? [];
      return { result: { count: cards.length, cards }, blocked: false };
    },
    logFn: (message) => logs.push(message),
  });

  const published = (id) => allData[id].cards.map((card) => card.published);
  // Backfill takes the first dated duplicate, even when a later item is undated.
  assert.deepEqual(published("tech"), ["2 hours ago", "1 hour ago", null, null, null, "4 hours ago", "6 hours ago"]);
  assert.deepEqual(published("finance"), ["7 hours ago"]);
  // Top shows the API cards as they are: one without a time stays without.
  assert.deepEqual(published("top"), ["2 hours ago", "3 hours ago", null, "4 hours ago", "5 hours ago", null, "6 hours ago", null, "7 hours ago"]);
  assert.deepEqual(logs.filter((message) => message.includes("from API")), [
    "  Tech & Science: +3 publish time(s) from API",
    "  Business: +1 publish time(s) from API",
  ]);
});

test("collectDigest backfills from a feed of one item", (t) => {
  t.mock.method(Date, "now", () => now);
  const { allData } = collectDigest({
    openTab: quiet,
    fetchFeed: () => [{ title: "Lone story", published_timestamp: hoursAgo(1) }],
    scrape: () => ({ result: { count: 1, cards: [{ headline: "Lone story", published: null }] }, blocked: false }),
    logFn: quiet,
  });

  assert.equal(allData.tech.cards[0].published, "1 hour ago");
});

// ── openDigest ──────────────────────────────────────────────────────

test("openDigest logs a warning instead of throwing when xdg-open fails", () => {
  const logs = [];
  openDigest("/scratch/news.html", {
    exec: () => {
      throw new Error("spawnSync xdg-open ENOENT");
    },
    logFn: (message) => logs.push(message),
  });

  assert.deepEqual(logs, ["Warning: could not open the digest (spawnSync xdg-open ENOENT)"]);
});

// ── openDiscoverTab ─────────────────────────────────────────────────

function titleReader(answers) {
  const reader = () => {
    const answer = answers[Math.min(reader.reads++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  reader.reads = 0;
  return reader;
}

test("openDiscoverTab waits after an empty, failed or challenged title read", () => {
  const title = titleReader(["", new Error("Execution context was destroyed"), "Just a moment...", "Discover - Perplexity"]);
  const sleeps = [];
  openDiscoverTab({ nav: quiet, title, sleep: (ms) => sleeps.push(ms) });

  assert.equal(title.reads, 4);
  assert.deepEqual(sleeps, [1000, 1000, 1000]);
});

test("openDiscoverTab reports the interstitial after 31 title reads a second apart", () => {
  const navs = [];
  const title = titleReader(["Just a moment..."]);
  const sleeps = [];
  assert.throws(
    () => openDiscoverTab({ nav: (url) => navs.push(url), title, sleep: (ms) => sleeps.push(ms) }),
    { message: 'bot challenge: page is a Cloudflare interstitial (title "Just a moment...")', botChallenge: true },
  );

  assert.deepEqual(navs, ["https://www.perplexity.ai/discover/top"]);
  assert.equal(title.reads, 31);
  assert.deepEqual(sleeps, Array(31).fill(1000));
});

test("openDiscoverTab reports the last eval error when every title read fails", () => {
  const title = titleReader([new Error("first eval failure"), new Error("last eval failure")]);
  assert.throws(
    () => openDiscoverTab({ nav: quiet, title, sleep: quiet }),
    (error) => error.message === "Could not read Discover page title: last eval failure" && !error.botChallenge,
  );

  assert.equal(title.reads, 31);
});

test("openDiscoverTab reports a timeout for titles that stay empty", () => {
  const title = titleReader([""]);
  assert.throws(
    () => openDiscoverTab({ nav: quiet, title, sleep: quiet }),
    (error) => error.message === "Discover page title stayed empty" && !error.botChallenge,
  );
  assert.equal(title.reads, 31);
});

// ── Chrome launch helpers ───────────────────────────────────────────

test("cdpPort uses the HTTP and HTTPS defaults for implicit or canonicalized ports", () => {
  assert.equal(cdpPort("http://example.invalid"), "80");
  assert.equal(cdpPort("http://example.invalid:80"), "80");
  assert.equal(cdpPort("https://example.invalid"), "443");
  assert.equal(cdpPort("https://example.invalid:443"), "443");
});

test("headlessWarning stays quiet for a headed Chrome", () => {
  assert.equal(headlessWarning('{"Browser":"Chrome/140.0.7339.80"}'), null);
});

test("chromeCommand starts Chrome itself, headless, without xvfb-run", () => {
  const command = chromeCommand({ chromeBin: "/scratch/chrome", port: "9333", userDataDir: "/scratch/profile", hasXvfb: false });

  assert.deepEqual(command, {
    cmd: "/scratch/chrome",
    args: [
      "--remote-debugging-port=9333", "--user-data-dir=/scratch/profile", "--no-first-run",
      "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
      "--headless=new",
    ],
  });
});

const candidates = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];

// prepareChromeLaunch with an access() that accepts only `executables`.
function launchWith(executables) {
  const checked = [];
  const steps = [];
  const logs = [];
  const launch = prepareChromeLaunch({
    cdpUrl: "http://example.invalid:9333",
    userDataDir: "/scratch/profile",
    access: (file, mode) => {
      checked.push(file);
      assert.equal(mode, constants.X_OK);
      if (!executables.includes(file)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
    },
    mkdir: (dir) => steps.push(["mkdir", dir]),
    clearLocks: (dir) => steps.push(["clearLocks", dir]),
    logFn: (message) => logs.push(message),
  });
  return { launch, checked, steps, logs };
}

test("prepareChromeLaunch takes the first executable Chrome candidate", () => {
  const run = launchWith([candidates[2], candidates[3], "/usr/bin/xvfb-run"]);

  assert.deepEqual(run.checked, [...candidates.slice(0, 3), "/usr/bin/xvfb-run"]);
  assert.equal(run.launch.args[3], candidates[2]);
});

test("prepareChromeLaunch falls back to headless Chrome without xvfb-run and says why", () => {
  const run = launchWith([candidates[0]]);

  assert.equal(run.launch.cmd, candidates[0]);
  assert.equal(run.launch.args.at(-1), "--headless=new");
  assert.deepEqual(run.logs, [
    "Warning: /usr/bin/xvfb-run not found; starting headless Chrome, which Cloudflare may challenge (install xvfb)",
    "Starting Chrome (/usr/bin/google-chrome-stable, headless)...",
  ]);
});

test("prepareChromeLaunch logs that Chrome starts under xvfb-run", () => {
  const run = launchWith([candidates[0], "/usr/bin/xvfb-run"]);

  assert.deepEqual(run.logs, ["Starting Chrome (/usr/bin/google-chrome-stable under xvfb-run)..."]);
});

test("prepareChromeLaunch reports a missing Chrome and stops before the profile", () => {
  const run = launchWith([]);

  assert.equal(run.launch, null);
  assert.deepEqual(run.checked, candidates);
  assert.deepEqual(run.steps, []);
  assert.deepEqual(run.logs, [`ERROR: No Chrome/Chromium binary found. Tried: ${candidates.join(", ")}`]);
});
