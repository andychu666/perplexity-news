#!/usr/bin/env node
/**
 * daily-news.js — Perplexity Pro News Digest
 *
 * Scrapes all 6 Perplexity Discover category feeds and generates a single
 * dark-themed HTML file with cards (headline, image, source count, publish time).
 *
 * Usage: node daily-news.js [--out ~/Downloads] [--limit 10] [--open]
 */

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Config ──────────────────────────────────────────────────────────
const BROWSER_TOOLS = path.join(
  os.homedir(),
  ".pi/agent/skills/pi-skills/browser-tools"
);
const NAV = path.join(BROWSER_TOOLS, "browser-nav.js");
const EVAL = path.join(BROWSER_TOOLS, "browser-eval.js");

// ── Timing knobs ────────────────────────────────────────────────────
const EVAL_TIMEOUT_MS = 15000;          // per browser-eval/nav subprocess
const HYDRATION_INITIAL_WAIT_MS = 2000; // grace period before first poll
const HYDRATION_POLL_MS = 1500;         // gap between hydration polls
const HYDRATION_MAX_WAIT_MS = 20000;    // wall-clock ceiling for hydration

const CATEGORIES = [
  { id: "top", name: "Top", emoji: "🌍" },
  { id: "tech", name: "Tech & Science", emoji: "🔬" },
  { id: "finance", name: "Business", emoji: "💼" },
  { id: "arts", name: "Arts & Culture", emoji: "🎨" },
  { id: "sports", name: "Sports", emoji: "⚽" },
  { id: "entertainment", name: "Entertainment", emoji: "🎬" },
];

// ── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { out: path.join(os.homedir(), "Downloads"), limit: 10, open: false, suffix: "" };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--out":
        if (i + 1 >= argv.length) { console.error("ERROR: --out requires a path"); process.exit(1); }
        opts.out = argv[++i];
        break;
      case "--limit":
        if (i + 1 >= argv.length) { console.error("ERROR: --limit requires a number"); process.exit(1); }
        opts.limit = Math.max(1, parseInt(argv[++i], 10) || 10);
        break;
      case "--open":
        opts.open = true;
        break;
      case "--suffix":
        if (i + 1 >= argv.length) { console.error("ERROR: --suffix requires a string"); process.exit(1); }
        opts.suffix = argv[++i];
        break;
      default:
        console.error("Unknown flag:", argv[i]);
        process.exit(1);
    }
  }
  return opts;
}

// ── Logging ─────────────────────────────────────────────────────────
function log(msg) {
  process.stderr.write("[news] " + msg + "\n");
}

// Native sleep: no shell, no subprocess spawned per poll.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

function waitForHydratedCards({
  categoryName,
  evaluateCount,
  sleep = sleepSync,
  now = Date.now,
  logFn = log,
  initialWaitMs = HYDRATION_INITIAL_WAIT_MS,
  pollMs = HYDRATION_POLL_MS,
  maxWaitMs = HYDRATION_MAX_WAIT_MS,
}) {
  const deadline = now() + maxWaitMs;

  sleep(initialWaitMs);

  let cardCount = 0;
  let pollErrors = 0;

  while (now() < deadline) {
    try {
      cardCount = parseInt(String(evaluateCount()).trim(), 10) || 0;
    } catch (e) {
      pollErrors++;
      cardCount = 0;
      if (pollErrors === 1) {
        logFn(`  ${categoryName}: hydration poll eval failed — ${e.message}`);
      }
    }

    if (cardCount > 0) break;
    if (now() + pollMs >= deadline) break;
    sleep(pollMs);
  }

  if (cardCount === 0) {
    logFn(`  ${categoryName}: no cards after ${maxWaitMs / 1000}s hydration wait (${pollErrors} poll error(s)) — extracting anyway`);
  }

  return { cardCount, pollErrors };
}

// ── Card parsing ────────────────────────────────────────────────────
// Parse card metadata from leaf element texts. Exported for unit testing.
// Perplexity card leaves: headline, "Published" (optional), date/time (optional),
// description (optional), "N sources".
function parseCardFromLeaves(leafTexts) {
  let sources = null;
  let sourcesIdx = -1;
  for (let i = 0; i < leafTexts.length; i++) {
    const m = leafTexts[i].match(/^(\d+)\s*sources?$/i);
    if (m) { sources = m[1]; sourcesIdx = i; break; }
  }

  let published = null;
  for (let i = 0; i < leafTexts.length - 1; i++) {
    if (/^Published$/i.test(leafTexts[i])) {
      const candidate = leafTexts[i + 1];
      if (/^\d+\s*(?:hours?|minutes?|days?)\s*ago$/i.test(candidate) ||
          /^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$/.test(candidate)) {
        published = candidate;
      }
      break;
    }
  }

  let headline = null;
  for (let i = 0; i < leafTexts.length; i++) {
    if (i === sourcesIdx) continue;
    if (/^Published$/i.test(leafTexts[i])) continue;
    if (published && leafTexts[i] === published) continue;
    headline = leafTexts[i];
    break;
  }
  if (!headline) headline = "";

  if (headline.length < 10 && !sources) return null;
  return { headline: headline, published: published, sources: sources };
}

// ── Scrape one category ─────────────────────────────────────────────
function scrapeCategory(cat) {
  const url = `https://www.perplexity.ai/discover/${cat.id}`;
  log(`Scraping ${cat.name} (${url})`);

  // Extraction JS — must use the category's own URL path to select cards.
  // Story links follow /discover/{category-id}/slug pattern for all categories
  // Navigate
  const catPath = `/discover/${cat.id}/`;

  execFileSync(NAV, [url], { timeout: EVAL_TIMEOUT_MS, stdio: "pipe" });

  // Poll for card hydration instead of a fixed sleep — Perplexity is a React
  // SPA and hydration time varies (slow network / busy Chrome). Without this,
  // categories can intermittently return 0 cards (as happened in the night run).
  const countJS = `document.querySelectorAll('a[href*="${catPath}"]').length`;
  const safeCountJS = countJS.replace(/'/g, "'\\''");
  waitForHydratedCards({
    categoryName: cat.name,
    evaluateCount: () => execFileSync(EVAL, [countJS], { timeout: EVAL_TIMEOUT_MS, encoding: "utf8" }),
  });
  // Inject parseCardFromLeaves so the browser runs the exact same logic
  // that unit tests exercise — no duplicated regexes.
  const extractJS = `
(function() {
  var catPath = "${catPath}";
  var parseCardFromLeaves = ${parseCardFromLeaves.toString()};
  var cards = Array.from(document.querySelectorAll('a[href*="' + catPath + '"]')).map(function(a) {
    var href = a.getAttribute("href");
    if (href.startsWith("/")) href = "https://www.perplexity.ai" + href;
    var img = a.querySelector("img");
    var imgSrc = img ? img.src : null;

    // Collect leaf elements (no child elements) with visible text.
    var leaves = Array.from(a.querySelectorAll("*")).filter(function(el) {
      return el.children.length === 0 && el.textContent.trim().length > 0;
    });
    var leafTexts = leaves.map(function(el) { return el.textContent.trim(); });

    var card = parseCardFromLeaves(leafTexts);
    if (!card) return null;
    card.href = href;
    card.imgSrc = imgSrc;
    return card;
  }).filter(function(c) { return c !== null; });
  return JSON.stringify({ count: cards.length, cards: cards });
})()`;

  // execFileSync passes argv straight through: no shell, so nothing in the JS
  // (or a future backslash/quote) can break out of the command.
  const raw = execFileSync(EVAL, [extractJS], { timeout: EVAL_TIMEOUT_MS, encoding: "utf8" });

  try {
    return JSON.parse(raw);
  } catch (e) {
    log(`  Parse error for ${cat.name}: ${e.message}`);
    const match = raw.match(/(\{[\s\S]*\})/);
    if (match) {
      try { return JSON.parse(match[1]); } catch { /* truncated output */ }
    }
    return { count: 0, cards: [] };
  }
}

// ── API path (primary) ──────────────────────────────────────────────
// The Discover feed endpoint carries every card's exact publish time and needs
// no page rendering, so it is tried first; UI scraping stays as the fallback
// (and remains the only source for the per-category feeds, which the API does
// not expose — `category`/`topic` params are ignored, verified 2026-09-16).

const CDP_URL = process.env.PERPLEXITY_CDP || "http://127.0.0.1:9222";
const ORIGIN = "https://www.perplexity.ai";
// Kept together so a server-side version bump is a one-line change.
const FEED_VERSION = "2.18";
const FEED_SOURCE = "default";
const WS_TIMEOUT_MS = 15000;
const HTTP_TIMEOUT_MS = 20000;

// Node <21 has no global WebSocket. Fail loudly rather than letting a
// ReferenceError silently disable the whole API-first path.
function webSocketCtor() {
  if (typeof WebSocket === "undefined") {
    throw new Error("no global WebSocket (needs Node 21+) - API path unavailable");
  }
  return WebSocket;
}

// Every network call is bounded, so a hung Chrome/CDP or a stalled API response
// cannot block the run (and the UI fallback still gets its turn).
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function cdpSessionCookies() {
  const WebSocketImpl = webSocketCtor();
  const targets = await fetchJson(`${CDP_URL}/json/list`);
  if (!Array.isArray(targets)) throw new Error("CDP /json/list did not return an array");
  const page = targets.find((t) => t.type === "page" && /perplexity\.ai/.test(t.url || ""))
    || targets.find((t) => t.type === "page");
  if (!page || !page.webSocketDebuggerUrl) throw new Error("no CDP page target");

  const ws = new WebSocketImpl(page.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket handshake timed out")), WS_TIMEOUT_MS);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP websocket failed")); };
    });
    // Network.getCookies is only exposed on a page target.
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP getCookies timed out")), WS_TIMEOUT_MS);
      const settle = (fn, value) => { clearTimeout(timer); ws.onmessage = null; fn(value); };
      ws.onmessage = (ev) => {
        let msg;
        // Keepalive/partial frames are not guaranteed to be JSON.
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg || msg.id !== 1) return;
        if (msg.error) settle(reject, new Error(JSON.stringify(msg.error)));
        else settle(resolve, (msg.result && msg.result.cookies) || []);
      };
      ws.send(JSON.stringify({ id: 1, method: "Network.getCookies", params: { urls: [ORIGIN] } }));
    });
  } finally {
    ws.close();
  }
}

async function apiGet(pathname, cookies) {
  const csrf = cookies.find((c) => /csrf/i.test(c.name));
  return fetchJson(`${ORIGIN}${pathname}`, {
    headers: {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      accept: "application/json, text/plain, */*",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      ...(csrf ? { "x-csrf-token": csrf.value.split("|")[0] } : {}),
    },
  });
}

// Mirrors the UI's wording ("13 hours ago", "1 hour ago") so the rendered HTML
// matches, including singular units and clock-skewed (future) timestamps.
function relativeTime(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes <= 0) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function apiCard(item) {
  if (!item || typeof item !== "object") return null;
  const preview = item.web_results_preview || {};
  const image = (item.featured_images && item.featured_images[0]) || null;
  return {
    headline: item.title || item.short_title || "",
    published: relativeTime(item.published_timestamp || item.updated_datetime),
    sources: preview.total_count !== null && preview.total_count !== undefined
      ? String(preview.total_count) : null,
    href: item.url || (item.slug ? `${ORIGIN}/discover/${item.slug}` : "#"),
    imgSrc: (image && (image.image || image.thumbnail)) || null,
  };
}

async function fetchFeedItems({ pages = 2, perPage = 100 } = {}) {
  const cookies = await cdpSessionCookies();
  // Offsets are independent, so fetch the pages concurrently instead of doubling
  // the latency with sequential awaits.
  const requests = [];
  for (let i = 0; i < pages; i++) {
    requests.push(apiGet(
      `/rest/discover/feed?limit=${perPage}&offset=${i * perPage}&version=${FEED_VERSION}&source=${FEED_SOURCE}`,
      cookies
    ));
  }
  const outcomes = await Promise.allSettled(requests);
  const items = [];
  for (const outcome of outcomes) {
    // A failed (or short) page must not discard the pages that did succeed: all
    // pages were requested concurrently, so stopping early would only throw away
    // data that is already in hand.
    if (outcome.status !== "fulfilled") continue;
    const body = outcome.value;
    const batch = body && Array.isArray(body.items) ? body.items : [];
    items.push(...batch.filter((entry) => entry && typeof entry === "object"));
  }
  return items;
}

// Keep Unicode letters/digits: the feed carries non-English headlines, and
// stripping them would collapse distinct items onto the same key.
function normalizeTitle(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// ── HTML generators ─────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only http(s) links may end up in the digest: a scraped javascript:/data: URL
// would survive HTML escaping and become a live anchor.
function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "http:" || protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

function cardHtml(card) {
  const headline = escapeHtml(card.headline || "");
  const url = escapeHtml(safeUrl(card.href) || "#");
  const imgSrc = card.imgSrc ? escapeHtml(safeUrl(card.imgSrc)) : "";
  const published = card.published ? `🕐 ${escapeHtml(card.published)}` : "";
  const sources = card.sources
    ? `📊 ${escapeHtml(String(card.sources))} source${String(card.sources) === "1" ? "" : "s"}`
    : "";
  const meta = [published, sources].filter(Boolean).join(" · ");

  const imgHtml = imgSrc
    ? `<img src="${imgSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : "";

  return [
    '<article class="card">',
    `  <a href="${url}" target="_blank" rel="noopener">`,
    `    ${imgHtml}`,
    '    <div class="card-body">',
    `      <h3>${headline}</h3>`,
    meta ? `      <span class="meta">${meta}</span>` : "",
    "    </div>",
    "  </a>",
    "</article>",
  ].join("\n");
}

function categorySection(cat, data, limit) {
  const cards = (data.cards || []).slice(0, limit);
  if (!cards.length) return "";
  const cardsHtml = cards.map(cardHtml).join("\n");

  return [
    `  <section class="category" id="${cat.id}">`,
    `    <h2 class="cat-title">${cat.emoji} ${cat.name}</h2>`,
    '    <div class="cards">',
    `      ${cardsHtml}`,
    "    </div>",
    "  </section>",
  ].join("\n");
}

function buildHtml(allData, limit) {
  const sections = CATEGORIES
    .map((cat) => categorySection(cat, allData[cat.id] || { cards: [] }, limit))
    .filter(Boolean)
    .join("\n");

  const today = new Date().toISOString().split("T")[0];
  const navLinks = CATEGORIES
    .map((c) => `<a href="#${c.id}">${c.emoji} ${c.name.split(" & ")[0]}</a>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily News Digest — ${today} | Perplexity Discover</title>
  <style>
    :root {
      --bg: #0f1117;
      --card-bg: #1a1d27;
      --text: #e4e6ed;
      --muted: #8b8fa3;
      --accent: #6c8cff;
      --border: #2a2d3a;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
    }
    header {
      background: linear-gradient(135deg, #1a1d27 0%, #252836 100%);
      border-bottom: 1px solid var(--border);
      padding: 2rem 1.5rem;
      text-align: center;
    }
    header h1 {
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #6c8cff, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    header p { color: var(--muted); margin-top: 0.5rem; font-size: 0.95rem; }
    .nav {
      display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center;
      padding: 1rem; border-bottom: 1px solid var(--border);
      background: var(--card-bg); position: sticky; top: 0; z-index: 10;
    }
    .nav a {
      padding: 0.4rem 0.9rem; border-radius: 20px; font-size: 0.85rem;
      text-decoration: none; color: var(--muted); border: 1px solid var(--border);
      transition: all 0.2s;
    }
    .nav a:hover, .nav a.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
    .cat-title {
      font-size: 1.4rem; font-weight: 700; margin: 2rem 0 1rem;
      padding-bottom: 0.5rem; border-bottom: 2px solid var(--border);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }
    .card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 12px; overflow: hidden;
      transition: transform 0.2s, border-color 0.2s;
    }
    .card:hover { transform: translateY(-2px); border-color: var(--accent); }
    .card a { text-decoration: none; color: inherit; display: flex; flex-direction: column; height: 100%; }
    .card img { width: 100%; height: 180px; object-fit: cover; display: block; }
    .card-body { padding: 1rem; flex: 1; display: flex; flex-direction: column; gap: 0.4rem; }
    .card h3 { font-size: 0.95rem; font-weight: 600; line-height: 1.4; color: var(--text); }
    .card .meta {
      font-size: 0.75rem; color: var(--muted); margin-top: auto;
      padding-top: 0.5rem; border-top: 1px solid var(--border);
    }
    footer {
      text-align: center; color: var(--muted); font-size: 0.8rem;
      padding: 1.5rem; border-top: 1px solid var(--border);
    }
    @media (max-width: 768px) {
      .cards { grid-template-columns: 1fr; }
      header h1 { font-size: 1.4rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>🗞️ Daily News Digest</h1>
    <p>${today} · Scraped from <a href="https://www.perplexity.ai/discover" style="color:var(--accent)">Perplexity Discover</a></p>
  </header>

  <nav class="nav">
    ${navLinks}
  </nav>

  <main>
${sections}
  </main>

  <footer>
    Generated ${new Date().toUTCString()} · Powered by Perplexity Discover
  </footer>

  <script>
    const sections = document.querySelectorAll('section.category');
    const navLinks = document.querySelectorAll('.nav a');
    window.addEventListener('scroll', () => {
      let current = '';
      sections.forEach(s => { if (window.scrollY >= s.offsetTop - 100) current = s.id; });
      navLinks.forEach(a => { a.classList.toggle('active', a.getAttribute('href') === '#' + current); });
    });
  </script>
</body>
</html>`;
}

// ── Chrome lifecycle ───────────────────────────────────────────────────
function ensureChrome() {
  // Already running?
  try {
    execFileSync("curl", ["-sS", "--max-time", "5", "--connect-timeout", "3", `${CDP_URL}/json/version`], { timeout: 8000, stdio: "ignore" });
    return;
  } catch { /* not running */ }

  // Find Chrome binary
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];
  let chromeBin = null;
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      chromeBin = c;
      break;
    } catch { /* not found */ }
  }
  if (!chromeBin) {
    log("ERROR: No Chrome/Chromium binary found. Tried: " + candidates.join(", "));
    process.exit(1);
  }

  const userDataDir = path.join(os.homedir(), ".cache", "browser-tools");
  fs.mkdirSync(userDataDir, { recursive: true });

  // Only clear locks that are actually stale: deleting them while a live Chrome
  // owns the profile can corrupt it.
  for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const lockPath = path.join(userDataDir, lock);
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > 30000) {
        fs.unlinkSync(lockPath);
        log(`Removed stale ${lock} (${Math.round(age / 1000)}s old)`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") log(`Warning: cannot remove ${lock} \u2014 ${e.message}`);
    }
  }

  log(`Starting Chrome (${chromeBin})...`);
  const child = spawn(chromeBin, [
    // Follow the configured CDP endpoint instead of assuming the default port.
    `--remote-debugging-port=${new URL(CDP_URL).port || 9222}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ], { detached: true, stdio: "ignore" });
  child.unref();
  let firstError = null;
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync("curl", ["-sS", "--max-time", "5", "--connect-timeout", "3", `${CDP_URL}/json/version`], { timeout: 8000, stdio: "ignore" });
      log("Chrome ready on :9222");
      return;
    } catch (e) {
      firstError ??= e;
    }
    // Log first error after a few attempts (not immediate — Chrome may be starting)
    if (i === 12 && firstError) {
      log(`Chrome not ready after 6s — last curl error: ${firstError.message || firstError.stderr || firstError}`);
    }
    sleepSync(500);
  }

  log("ERROR: Chrome failed to start within 30 seconds");
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().split("T")[0];

  log(`Perplexity News Digest — ${today}`);
  log(`Output dir: ${opts.out}`);
  log(`Cards per category: ${opts.limit}`);

  // Ensure Chrome is running with remote debugging
  ensureChrome();

  // API first: one call carries exact publish times and needs no rendering.
  let feedItems = [];
  try {
    feedItems = await fetchFeedItems();
    log(`API: ${feedItems.length} feed item(s) with publish times`);
  } catch (e) {
    log(`API unavailable (${e.message}); relying on UI scraping`);
  }
  // Key on the same headline apiCard() uses, and skip empty ones so blank
  // headlines cannot collide on "".
  const apiByTitle = new Map();
  for (const item of feedItems) {
    const card = apiCard(item);
    const key = card ? normalizeTitle(card.headline) : "";
    if (key) apiByTitle.set(key, card);
  }

  const RETRY_DELAY_MS = 5000;
  const RETRY_MAX = 2;
  const allData = {};
  for (const cat of CATEGORIES) {
    let result = { count: 0, cards: [] };
    let attempts = 0;
    let servedByApi = false;

    // The API exposes one general feed, so it can serve the Top section outright;
    // the per-category feeds only exist in the UI.
    if (cat.id === "top" && feedItems.length > 0) {
      // Blank headlines would render as empty cards; the UI path filters them too.
      const cards = feedItems.map(apiCard).filter((card) => card && card.headline);
      result = { count: cards.length, cards };
      servedByApi = true;
      log(`  ${cat.name}: ${cards.length} cards (API)`);
    } else {
      for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
        if (attempt > 0) {
          log(`  ${cat.name}: retry ${attempt}/${RETRY_MAX} after ${RETRY_DELAY_MS / 1000}s...`);
          sleepSync(RETRY_DELAY_MS);
        }
        attempts++;
        try {
          result = scrapeCategory(cat);
        } catch (e) {
          log(`  ${cat.name}: ERROR — ${e.message}`);
        }
        if (result.count > 0) break;
        if (attempt < RETRY_MAX) log(`  ${cat.name}: 0 cards (attempt ${attempts})`);
      }
      log(`  ${cat.name}: ${result.count} cards (${attempts} attempt${attempts > 1 ? "s" : ""})`);
    }

    // Fill publish times the UI does not render, using the API's timestamps.
    // API cards already carry one, so only scraped categories need this.
    if (!servedByApi && feedItems.length > 0) {
      let filled = 0;
      for (const card of result.cards) {
        const key = normalizeTitle(card.headline);
        if (!key || card.published) continue;
        const hit = apiByTitle.get(key);
        if (hit && hit.published) {
          card.published = hit.published;
          filled++;
        }
      }
      if (filled > 0) log(`  ${cat.name}: +${filled} publish time(s) from API`);
    }

    allData[cat.id] = result;
  }

  const totalCards = CATEGORIES.reduce((sum, c) => sum + (allData[c.id]?.count || 0), 0);
  log(`Total: ${totalCards} cards across ${CATEGORIES.length} categories`);

  if (totalCards === 0) {
    log("ERROR: No cards scraped. Check Chrome and Perplexity availability.");
    process.exit(1);
  }

  const html = buildHtml(allData, opts.limit);
  // The suffix becomes part of a filename: reject anything that could traverse
  // out of --out (e.g. ../../).
  if (opts.suffix && !/^[A-Za-z0-9_-]+$/.test(opts.suffix)) {
    log(`ERROR: --suffix may only contain letters, digits, - and _ (got "${opts.suffix}")`);
    process.exit(2);
  }
  const suffixPart = opts.suffix ? `-${opts.suffix}` : "";
  const outPath = path.join(opts.out, `perplexity-news-${today}${suffixPart}.html`);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(outPath, html);

  const kb = (html.length / 1024).toFixed(1);
  log(`✅ Saved: ${outPath} (${kb} KB)`);

  if (opts.open) {
    try {
      execFileSync("xdg-open", [outPath], { stdio: "ignore" });
      log("Opened in browser");
    } catch (e) {
      log(`Warning: could not open the digest (${e.message})`);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  waitForHydratedCards,
  parseCardFromLeaves,
  // Pure helpers, exported so the node --test suite can cover their edge cases
  // (missing/invalid timestamps, clock skew, unit rounding, empty headlines).
  relativeTime,
  normalizeTitle,
  apiCard,
};
