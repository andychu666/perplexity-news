#!/usr/bin/env node
/**
 * daily-news.js — Perplexity Pro News Digest
 *
 * Scrapes all 6 Perplexity Discover category feeds and generates a single
 * dark-themed HTML file with cards (headline, image, source count, publish time).
 *
 * Usage: node daily-news.js [--out ~/Downloads] [--limit 10] [--open]
 */

const { execSync } = require("child_process");
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
  { id: "technology", name: "Tech & Science", emoji: "🔬" },
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

// ── Scrape one category ─────────────────────────────────────────────
function scrapeCategory(cat) {
  const url = `https://www.perplexity.ai/discover/${cat.id}`;
  log(`Scraping ${cat.name} (${url})`);

  // Extraction JS — must use the category's own URL path to select cards.
  // Technology (tech) and default (/discover) use /discover/you/ for story links.
  const catPath = (cat.id === "technology") ? "/discover/you/" : `/discover/${cat.id}/`;

  // Navigate
  execSync(`"${NAV}" "${url}" 2>&1`, { timeout: EVAL_TIMEOUT_MS, stdio: "pipe" });

  // Poll for card hydration instead of a fixed sleep — Perplexity is a React
  // SPA and hydration time varies (slow network / busy Chrome). Without this,
  // categories can intermittently return 0 cards (as happened in the night run).
  const countJS = `document.querySelectorAll('a[href*="${catPath}"]').length`;
  const safeCountJS = countJS.replace(/'/g, "'\\''");
  // Wall-clock-bounded poll: track real elapsed time (Date.now), not just the
  // sum of sleep intervals. EVAL calls can themselves take up to their timeout,
  // so accumulating POLL_MS alone would let total wait far exceed MAX_WAIT_MS.
  const deadline = Date.now() + HYDRATION_MAX_WAIT_MS;
  execSync(`sleep ${HYDRATION_INITIAL_WAIT_MS / 1000}`);
  let cardCount = 0;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    try {
      cardCount = parseInt(
        execSync(`"${EVAL}" '${safeCountJS}' 2>&1`, { timeout: EVAL_TIMEOUT_MS, encoding: "utf8" }).trim(),
        10
      ) || 0;
    } catch (e) {
      pollErrors++;
      cardCount = 0;
      if (pollErrors === 1) log(`  ${cat.name}: hydration poll eval failed — ${e.message}`);
    }
    if (cardCount > 0) break;
    if (Date.now() + HYDRATION_POLL_MS >= deadline) break;
    execSync(`sleep ${HYDRATION_POLL_MS / 1000}`);
  }
  if (cardCount === 0) {
    log(`  ${cat.name}: no cards after ${HYDRATION_MAX_WAIT_MS / 1000}s hydration wait (${pollErrors} poll error(s)) — extracting anyway`);
  }
  const extractJS = `
(function() {
  var catPath = "${catPath}";
  var cards = Array.from(document.querySelectorAll('a[href*="' + catPath + '"]')).map(function(a) {
    var fullText = a.textContent.trim();
    if (fullText.length < 20) return null;
    var href = a.getAttribute("href");
    if (href.startsWith("/")) href = "https://www.perplexity.ai" + href;
    var img = a.querySelector("img");
    var imgSrc = img ? img.src : null;

    var sourcesMatch = fullText.match(/(\\d+)\\s*sources?/i);
    var sources = sourcesMatch ? sourcesMatch[1] : null;

    var publishedMatch = fullText.match(/Published\\s*\\n*\\s*([\\d]+\\s*(?:hours?|minutes?|days?)\\s*ago)/i);
    var published = publishedMatch ? publishedMatch[1] : null;

    var headline = fullText;
    var pubIdx = headline.indexOf("Published");
    if (pubIdx > 0) headline = headline.substring(0, pubIdx).trim();
    if (sources) headline = headline.replace(new RegExp("\\\\d+\\\\s*sources?$", "i"), "").trim();

    return { headline: headline, href: href, imgSrc: imgSrc, published: published, sources: sources };
  }).filter(function(c) { return c !== null; });
  return JSON.stringify({ count: cards.length, cards: cards });
})()`;

  const safeJS = extractJS.replace(/'/g, "'\\''");
  const raw = execSync(`"${EVAL}" '${safeJS}' 2>&1`, { timeout: EVAL_TIMEOUT_MS, encoding: "utf8" });

  try {
    return JSON.parse(raw);
  } catch (e) {
    log(`  Parse error for ${cat.name}: ${e.message}`);
    // Try extracting JSON from stderr-free output
    const match = raw.match(/(\{[\s\S]*\})/);
    if (match) return JSON.parse(match[1]);
    return { count: 0, cards: [] };
  }
}

// ── HTML generators ─────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cardHtml(card) {
  const headline = escapeHtml(card.headline || "");
  const url = escapeHtml(card.href || "#");
  const imgSrc = card.imgSrc ? escapeHtml(card.imgSrc) : "";
  const published = card.published ? `🕐 ${escapeHtml(card.published)}` : "";
  const sources = card.sources ? `📊 ${card.sources} sources` : "";
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

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().split("T")[0];

  log(`Perplexity News Digest — ${today}`);
  log(`Output dir: ${opts.out}`);
  log(`Cards per category: ${opts.limit}`);

  // Check Chrome
  try {
    execSync("curl -s http://127.0.0.1:9222/json/version >/dev/null 2>&1");
  } catch {
    log("ERROR: Chrome not reachable on :9222. Start with browser-start.js");
    process.exit(1);
  }

  const allData = {};
  for (const cat of CATEGORIES) {
    try {
      allData[cat.id] = scrapeCategory(cat);
      log(`  ${cat.name}: ${allData[cat.id].count} cards`);
    } catch (e) {
      log(`  ${cat.name}: ERROR — ${e.message}`);
      allData[cat.id] = { count: 0, cards: [] };
    }
  }

  const totalCards = CATEGORIES.reduce((sum, c) => sum + (allData[c.id]?.count || 0), 0);
  log(`Total: ${totalCards} cards across ${CATEGORIES.length} categories`);

  if (totalCards === 0) {
    log("ERROR: No cards scraped. Check Chrome and Perplexity availability.");
    process.exit(1);
  }

  const html = buildHtml(allData, opts.limit);
  const suffixPart = opts.suffix ? `-${opts.suffix}` : "";
  const outPath = path.join(opts.out, `perplexity-news-${today}${suffixPart}.html`);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(outPath, html);

  const kb = (html.length / 1024).toFixed(1);
  log(`✅ Saved: ${outPath} (${kb} KB)`);

  if (opts.open) {
    try { execSync(`xdg-open "${outPath}" >/dev/null 2>&1`); } catch {}
    log("Opened in browser");
  }
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
