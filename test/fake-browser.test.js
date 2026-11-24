const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const script = path.join(__dirname, "../scripts/daily-news.js");
const tools = ".pi/agent/skills/pi-skills/browser-tools";
const cdpUrl = "http://127.0.0.1:1"; // gitleaks:allow (IPv4 loopback)

// Runs the script (with `argv(home)`) or a `driver` in a child Node with an
// isolated HOME and CDP URL. The preload replaces child_process before the
// script loads, because the script binds execFileSync at require time.
function runChild(t, { preload, driver, argv = () => [], setup = () => ({}) }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "news-fake-browser-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const preloadPath = path.join(home, "preload.cjs");
  fs.writeFileSync(preloadPath, preload);
  const args = driver === undefined ? [script, ...argv(home)] : ["-e", driver];
  const result = spawnSync(process.execPath, ["--require", preloadPath, ...args], {
    env: { ...process.env, HOME: home, PERPLEXITY_CDP: cdpUrl, ...setup(home) },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  return { ...result, home };
}

// ── scrapeCategory, through scrapeWithRetries' defaults ─────────────

// Fake browser tools: canned answers, each call and its options recorded in
// order, and the count and extraction scripts kept. A fake clock behind
// Date.now and Atomics.wait (sleepSync) makes the 20 s hydration wait and
// the 5 s retry delays instant. It also answers the in-page feed fetch, for
// collectDigest.
const SCRAPE_PRELOAD = `
const childProcess = require("node:child_process");
const path = require("node:path");
const page = JSON.parse(process.env.FAKE_PAGE);
const calls = [];
const options = [];
const waits = [];
const scripts = {};
let clock = 0;
Date.now = () => clock;
Atomics.wait = (array, index, value, ms) => {
  waits.push(ms);
  clock += ms;
  return "timed-out";
};
function called(call, opts) {
  calls.push(call);
  options.push(opts);
}
childProcess.spawn = () => {
  throw new Error("unexpected spawn");
};
childProcess.execFileSync = (file, args, opts) => {
  const tool = path.relative(process.env.HOME, file);
  if (tool === "${tools}/browser-nav.js") {
    called("nav " + args[0], opts);
    return "";
  }
  if (tool !== "${tools}/browser-eval.js") throw new Error("unexpected subprocess " + file);
  const code = args[0];
  if (code === "document.title") {
    called("title", opts);
    // page.titles, when set, answers the first title reads in turn.
    return (page.titles?.shift() ?? page.title) + "\\n";
  }
  if (code.startsWith("document.querySelectorAll")) {
    called("count", opts);
    scripts.count = code;
    return page.count + "\\n";
  }
  if (code.includes("parseCardFromLeaves")) {
    called("extract", opts);
    scripts.extract = code;
    return page.extract;
  }
  const feed = /fetch\\("([^"]+)"/.exec(code);
  if (feed) {
    called("feed " + feed[1], opts);
    return JSON.stringify({ status: 200, mitigated: null, body: { items: page.feed } });
  }
  throw new Error("unexpected eval " + code.slice(0, 40));
};
globalThis.fakeBrowser = { calls, options, waits, scripts };
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
const navOptions = { timeout: 15000, stdio: "pipe" };
const evalOptions = { timeout: 15000, encoding: "utf8" };

test("a category still on the interstitial after hydration is blocked without retries", (t) => {
  const run = scrapeTech(t, { count: 0, title: "Just a moment...", extract: emptyPage });
  assert.deepEqual(run.out, { result: { count: 0, cards: [] }, attempts: 1, blocked: true });
  assert.equal(run.calls.at(-1), "title");
  assert.deepEqual(run.options.at(-1), evalOptions);
  assert.equal(run.calls.includes("extract"), false);
  assert.deepEqual(run.log.slice(-3), [
    '[news]   Tech: ERROR — bot challenge: page is a Cloudflare interstitial (title "Just a moment...")',
    "[news]   Tech: blocked by bot challenge — not retrying",
    "[news]   Tech: 0 cards (1 attempt)",
  ]);
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
  assert.deepEqual(run.options, [navOptions, evalOptions, evalOptions]);
  assert.equal(run.scripts.count, `document.querySelectorAll('a[href*="/discover/tech/"]').length`);
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

test("extract output with a malformed result shape is an empty page", (t) => {
  for (const extract of ["null", "{}", 'warning: {"count":1}', '{"count":"1","cards":[]}', '{"count":-1,"cards":[]}']) {
    const run = scrapeTech(t, { count: 2, title: normalTitle, extract });
    assert.deepEqual(run.out, { result: { count: 0, cards: [] }, attempts: 3, blocked: false }, extract);
    assert.equal(run.log.some((line) => line.includes("ERROR —")), false, extract);
  }
});

test("extract output with a zero count passes the shape check as it is", (t) => {
  const extract = JSON.stringify({ count: 0, cards: [cards[0]] });
  const run = scrapeTech(t, { count: 2, title: normalTitle, extract });
  assert.deepEqual(run.out, { result: { count: 0, cards: [cards[0]] }, attempts: 3, blocked: false });
});

// ── The extraction script, in a VM against a minimal DOM ────────────

// Element children only, as in the DOM; strings are text nodes.
function element(tag, attrs, ...content) {
  const children = content.filter((item) => typeof item !== "string");
  const descendants = () => children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
  return {
    tagName: tag.toUpperCase(),
    children,
    src: attrs.src,
    getAttribute: (name) => attrs[name] ?? null,
    get textContent() {
      return content.map((item) => (typeof item === "string" ? item : item.textContent)).join("");
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return selector === "*" ? descendants() : descendants().filter((node) => node.tagName === selector.toUpperCase());
    },
  };
}

test("the extraction script reads its category's cards from the page", (t) => {
  const run = scrapeTech(t, { count: 2, title: normalTitle, extract: JSON.stringify({ count: 2, cards }) });
  const anchors = [
    element("a", { href: "/discover/tech/first" },
      element("img", { src: "https://img.example/first.jpg" }),
      element("div", {}, element("h2", {}, "First headline on the page"), element("span", {}, " "), element("span", {}, "4 sources"))),
    element("a", { href: "https://www.perplexity.ai/discover/tech/second" },
      element("div", {}, element("span", {}, "Second headline on the page"), element("span", {}, "Published"),
        element("span", {}, "1 hour ago"), element("span", {}, "2 sources"))),
    element("a", { href: "/discover/tech/short" }, element("span", {}, "short")),
    element("a", { href: "/discover/sports/other" }, element("span", {}, "A headline from another category")),
  ];
  const document = {
    querySelectorAll(selector) {
      const [, part] = /^a\[href\*="([^"]+)"\]$/.exec(selector);
      return anchors.filter((anchor) => anchor.getAttribute("href").includes(part));
    },
  };

  const out = vm.runInNewContext(run.scripts.extract, { document });
  assert.deepEqual(JSON.parse(out), {
    count: 2,
    cards: [
      { ...cards[0], imgSrc: "https://img.example/first.jpg" },
      cards[1],
    ],
  });
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
  const { out, calls, options, waits } = JSON.parse(run.stdout);
  assert.equal(out.blocked, false);
  assert.deepEqual(out.allData.top.cards.map((card) => card.headline), ["First API story", "Second API story"]);
  for (const id of ["tech", "finance", "arts", "sports", "entertainment"]) {
    assert.deepEqual(out.allData[id], { count: 2, cards }, id);
  }
  assert.deepEqual(calls.slice(0, 7), [
    "nav https://www.perplexity.ai/discover/top",
    "title",
    "title",
    "feed /rest/discover/feed?limit=100&offset=0&version=2.18&source=default",
    "nav https://www.perplexity.ai/discover/tech",
    "count",
    "extract",
  ]);
  assert.deepEqual(options.slice(0, 7), [
    navOptions, evalOptions, evalOptions, { ...evalOptions, maxBuffer: 64 * 1024 * 1024 }, navOptions, evalOptions, evalOptions,
  ]);
  assert.equal(waits[0], 1000);
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

const chromeCandidates = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];
const chromeAndXvfb = JSON.stringify(["/usr/bin/chromium", "/usr/bin/xvfb-run"]);

// fs.accessSync answers for the Chrome candidates and xvfb-run from
// FAKE_EXECUTABLES, so the result does not depend on what this machine has
// installed.
const ACCESS_FAKE = `
const fs = require("node:fs");
const realAccessSync = fs.accessSync;
const faked = ${JSON.stringify([...chromeCandidates, "/usr/bin/xvfb-run"])};
const executables = JSON.parse(process.env.FAKE_EXECUTABLES);
const checked = [];
fs.accessSync = (file, mode) => {
  if (!faked.includes(file)) return realAccessSync(file, mode);
  checked.push(file);
  if (!executables.includes(file)) throw Object.assign(new Error("ENOENT: " + file), { code: "ENOENT" });
};
`;

const ACCESS_PRELOAD = `${ACCESS_FAKE}
const childProcess = require("node:child_process");
childProcess.execFileSync = childProcess.spawn = () => {
  throw new Error("unexpected subprocess");
};
globalThis.fakeAccess = { checked };
`;

const LAUNCH_DRIVER = `
const launch = require(${JSON.stringify(script)}).prepareChromeLaunch();
process.stdout.write(JSON.stringify({ launch, ...globalThis.fakeAccess }));
`;

function headedChromeArgs(profile, port) {
  return [
    "-a", "-s", "-screen 0 1280x900x24", "/usr/bin/chromium", "--ozone-platform=x11",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox",
  ];
}

test("prepareChromeLaunch() with its defaults makes the profile under HOME and clears its stale lock", (t) => {
  const run = runChild(t, {
    preload: ACCESS_PRELOAD,
    driver: LAUNCH_DRIVER,
    setup(home) {
      const profile = path.join(home, ".cache", "browser-tools");
      fs.mkdirSync(profile, { recursive: true });
      // PID 2147483647 is above Linux's pid_max, so the lock's owner is dead.
      fs.symlinkSync(`${os.hostname()}-2147483647`, path.join(profile, "SingletonLock"));
      return { FAKE_EXECUTABLES: chromeAndXvfb };
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const profile = path.join(run.home, ".cache", "browser-tools");
  const { launch, checked } = JSON.parse(run.stdout);
  assert.deepEqual(launch, { cmd: "/usr/bin/xvfb-run", args: headedChromeArgs(profile, "1"), port: "1" });
  assert.deepEqual(checked, [...chromeCandidates.slice(0, 4), "/usr/bin/xvfb-run"]);
  assert.deepEqual(fs.readdirSync(profile), []);
  assert.deepEqual(run.stderr.split("\n").filter(Boolean), [
    "[news] Removed stale SingletonLock",
    "[news] Starting Chrome (/usr/bin/chromium under xvfb-run)...",
  ]);
});

test("prepareChromeLaunch() without PERPLEXITY_CDP takes the CDP port 9222", (t) => {
  const run = runChild(t, {
    preload: ACCESS_PRELOAD,
    driver: LAUNCH_DRIVER,
    setup: () => ({ PERPLEXITY_CDP: undefined, FAKE_EXECUTABLES: chromeAndXvfb }),
  });
  assert.equal(run.status, 0, run.stderr);
  const { launch } = JSON.parse(run.stdout);
  assert.equal(launch.port, "9222");
  assert.deepEqual(launch.args, headedChromeArgs(path.join(run.home, ".cache", "browser-tools"), "9222"));
});

// ── main(), through the CLI ─────────────────────────────────────────

// A whole CLI run on a fake machine: SCRAPE_PRELOAD's browser tools and
// clock (also behind `new Date()`), ACCESS_FAKE's executables, curl answers
// from FAKE_CLI.curl in turn (null: refused; the last one repeats), a Chrome
// spawn that emits `spawn` or FAKE_CLI.spawnError, and xdg-open. Nothing real
// runs. At exit every call goes to $HOME/record.json.
const CLI_PRELOAD = `${SCRAPE_PRELOAD}${ACCESS_FAKE}
const { EventEmitter } = require("node:events");
const cli = JSON.parse(process.env.FAKE_CLI);
const machine = { curl: [], spawn: [], unref: 0, open: [] };
clock = Date.parse("2025-01-02T12:00:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
  static now() {
    return clock;
  }
};
const browserTools = childProcess.execFileSync;
childProcess.execFileSync = (file, args, opts) => {
  if (file === "curl") {
    const answer = cli.curl[Math.min(machine.curl.length, cli.curl.length - 1)];
    machine.curl.push({ args, options: opts });
    if (answer === null) throw new Error("curl: (7) Failed to connect");
    return answer;
  }
  if (file === "xdg-open") {
    machine.open.push({ args, options: opts });
    return "";
  }
  return browserTools(file, args, opts);
};
childProcess.spawn = (cmd, args, opts) => {
  machine.spawn.push({ cmd, args, options: opts });
  const child = new EventEmitter();
  child.unref = () => machine.unref++;
  process.nextTick(() => (cli.spawnError ? child.emit("error", new Error(cli.spawnError)) : child.emit("spawn")));
  return child;
};
process.on("exit", () => {
  fs.writeFileSync(path.join(process.env.HOME, "record.json"), JSON.stringify({ ...machine, ...globalThis.fakeBrowser }));
});
`;

function runCli(t, { argv, curl, spawnError, executables = ["/usr/bin/chromium", "/usr/bin/xvfb-run"], page = {} }) {
  const run = runChild(t, {
    preload: CLI_PRELOAD,
    argv,
    setup: () => ({
      FAKE_CLI: JSON.stringify({ curl, spawnError }),
      FAKE_EXECUTABLES: JSON.stringify(executables),
      FAKE_PAGE: JSON.stringify(page),
    }),
  });
  return {
    ...run,
    lines: run.stderr.split("\n").filter(Boolean),
    record: JSON.parse(fs.readFileSync(path.join(run.home, "record.json"), "utf8")),
  };
}

const curlArgs = ["-sS", "--max-time", "5", "--connect-timeout", "3", `${cdpUrl}/json/version`];
const probeOptions = { timeout: 8000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
const readyOptions = { timeout: 8000, stdio: "ignore" };
const headedVersion = '{"Browser":"Chrome/140.0.7339.80"}';
const headlessVersion = '{"Browser":"HeadlessChrome/140.0.7339.80"}';
// Top gets the two usable API stories; every other category scrapes two cards.
const servedPage = {
  title: normalTitle,
  count: 2,
  extract: JSON.stringify({ count: 2, cards }),
  feed: [{ title: "First API story" }, { title: " " }, { title: "Second API story" }],
};
const challengedPage = { title: "Just a moment...", count: 0, extract: emptyPage, feed: [] };

test("the CLI keeps a headless Chrome on the CDP port with a warning, saves the digest and opens it", (t) => {
  const run = runCli(t, {
    argv: (home) => ["--out", path.join(home, "out"), "--suffix", "Morning", "--open"],
    curl: [headlessVersion],
    page: servedPage,
  });
  assert.equal(run.status, 0, run.stderr);
  const outPath = path.join(run.home, "out", "perplexity-news-2025-01-02-Morning.html");
  assert.match(fs.readFileSync(outPath, "utf8"), /<h3>Second API story<\/h3>/);
  assert.deepEqual(run.record.curl, [{ args: curlArgs, options: probeOptions }]);
  assert.deepEqual(run.record.spawn, []);
  assert.deepEqual(run.record.open, [{ args: [outPath], options: { stdio: "ignore" } }]);
  assert.equal(run.lines[3], "[news] Warning: the Chrome on the CDP port is headless, and Cloudflare challenges headless Chrome. Close it to let the next run start a headed one.");
  assert.equal(run.lines.at(-1), "[news] Opened in browser");
});

test("the CLI uses a headed Chrome on the CDP port as it is and opens nothing unasked", (t) => {
  const run = runCli(t, { curl: [headedVersion], page: servedPage });
  assert.equal(run.status, 0, run.stderr);
  const out = path.join(run.home, "Downloads");
  const outPath = path.join(out, "perplexity-news-2025-01-02.html");
  const kb = (fs.readFileSync(outPath, "utf8").length / 1024).toFixed(1);
  const scraped = [["tech", "Tech & Science"], ["finance", "Business"], ["arts", "Arts & Culture"], ["sports", "Sports"], ["entertainment", "Entertainment"]];
  assert.deepEqual(run.lines, [
    "[news] Perplexity News Digest — 2025-01-02",
    `[news] Output dir: ${out}`,
    "[news] Cards per category: 10",
    "[news] API: 3 feed item(s) with publish times",
    "[news]   Top: 2 cards (API)",
    ...scraped.flatMap(([id, name]) => [
      `[news] Scraping ${name} (https://www.perplexity.ai/discover/${id})`,
      `[news]   ${name}: 2 cards (1 attempt)`,
    ]),
    "[news] Total: 12 cards across 6 categories",
    `[news] ✅ Saved: ${outPath} (${kb} KB)`,
  ]);
  assert.deepEqual(run.record.spawn, []);
  assert.deepEqual(run.record.open, []);
});

test("the CLI exits 1 when no Chrome answers and none is installed", (t) => {
  const run = runCli(t, { curl: [null], executables: [] });
  assert.equal(run.status, 1, run.stderr);
  assert.deepEqual(run.lines.slice(3), [`[news] ERROR: No Chrome/Chromium binary found. Tried: ${chromeCandidates.join(", ")}`]);
  assert.deepEqual(run.record.curl, [{ args: curlArgs, options: probeOptions }]);
  assert.deepEqual(run.record.spawn, []);
});

test("the CLI starts Chrome, waits until it answers, and ends a challenged run with the bot-challenge error", (t) => {
  const run = runCli(t, { curl: [null, null, null, headedVersion], page: challengedPage });
  assert.equal(run.status, 1, run.stderr);
  const profile = path.join(run.home, ".cache", "browser-tools");
  assert.deepEqual(run.record.spawn, [{
    cmd: "/usr/bin/xvfb-run",
    args: headedChromeArgs(profile, "1"),
    options: { detached: true, stdio: "ignore" },
  }]);
  assert.equal(run.record.unref, 1);
  assert.deepEqual(run.record.curl, [
    { args: curlArgs, options: probeOptions },
    { args: curlArgs, options: readyOptions },
    { args: curlArgs, options: readyOptions },
    { args: curlArgs, options: readyOptions },
  ]);
  assert.deepEqual(run.record.waits.slice(0, 2), [500, 500]);
  assert.deepEqual(run.lines.slice(3, 6), [
    "[news] Starting Chrome (/usr/bin/chromium under xvfb-run)...",
    "[news] Chrome ready on :1",
    '[news] API unavailable (bot challenge: page is a Cloudflare interstitial (title "Just a moment...")); relying on UI scraping',
  ]);
  assert.deepEqual(run.lines.slice(-2), [
    "[news] Total: 0 cards across 6 categories",
    "[news] ERROR: No cards scraped. Perplexity answered with a Cloudflare bot challenge (see the log above).",
  ]);
});

test("the CLI ends an empty run without a challenge with the Chrome check error", (t) => {
  const run = runCli(t, { curl: [headedVersion], page: { title: normalTitle, count: 0, extract: emptyPage, feed: [] } });
  assert.equal(run.status, 1, run.stderr);
  assert.deepEqual(run.lines.slice(-2), [
    "[news] Total: 0 cards across 6 categories",
    "[news] ERROR: No cards scraped. Check Chrome and Perplexity availability.",
  ]);
});

test("the CLI logs an asynchronous Chrome spawn error before readiness fails", (t) => {
  const run = runCli(t, { curl: [null], spawnError: "launch denied" });
  assert.equal(run.status, 1, run.stderr);
  assert.deepEqual(run.lines.slice(-3), [
    "[news] Warning: could not start Chrome (launch denied)",
    "[news] Chrome not ready after 6s — last curl error: curl: (7) Failed to connect",
    "[news] ERROR: Chrome failed to start within 30 seconds",
  ]);
});
