# 📰 Perplexity News — Daily Digest

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

Scrape all 6 Perplexity Discover category feeds and generate a beautiful dark-themed HTML
news digest — no login, no API key, no Perplexity Pro account required.

<p align="center">
  <img src="https://img.shields.io/badge/categories-6-blue" />
  <img src="https://img.shields.io/badge/cards_per_category-20-green" />
  <img src="https://img.shields.io/badge/output-HTML-orange" />
</p>

## ✨ Features

- Scrapes **6 categories** from Perplexity Discover:
  - 🌍 Top · 🔬 Tech & Science · 💼 Business · 🎨 Arts & Culture · ⚽ Sports · 🎬 Entertainment
- **20 cards per category** with headline, hero image, source count, and publish time
- Dark-themed responsive HTML output with sticky nav, card grid, and scroll-spy
- Each card links to its full Perplexity Discover page with all sources
- Reliable source counts via DOM leaf extraction — no digit concatenation bugs (#9, #10)
- Handles both relative times ("3 hours ago") and absolute dates ("Jul 7, 2026") (#9, #10)
- Hydration poll loop with dependency injection, fully testable without Chrome (#8)
- Zero runtime dependencies beyond Node.js built-ins + pi's `browser-tools`
- Built for **daily cron automation**

## 🚀 Quick Start

```bash
# 10 cards per category, saved to ~/Downloads/perplexity-news-YYYY-MM-DD.html
node scripts/daily-news.js

# Custom limit + output path
node scripts/daily-news.js --limit 15 --out ~/Desktop

# Open in browser after generation
node scripts/daily-news.js --open
```

### Prerequisites

- **Node.js** `>= 18`
- **Chrome/Chromium** installed — auto-detected from common paths and auto-started on port `9222` if not already running
- **xvfb** (`sudo apt install xvfb`) — recommended. Chrome must run **headed**: since 2026-11-21 Cloudflare challenges headless Chrome (HTTP 403, `cf-mitigated: challenge`, "Just a moment..." page), while a headed Chrome passes the check by itself in a few seconds. With `xvfb-run` the script starts Chrome in a virtual display, so no window appears. Without it, the script falls back to headless Chrome, which is likely to be blocked.

> **A visible Chrome window is OK.** A normal Chrome that you start yourself on port `9222` (with a window on your desktop) works too: the script reuses any Chrome already on that port. Only a *headless* Chrome on the port is a problem — the script logs a warning; close it so the next run starts a headed one.
>
> The script never solves or evades the challenge: no user-agent spoofing, no stealth flags. It only runs a normal browser. If Cloudflare gets stricter later, runs can be blocked again (#27).
- **pi browser-tools** at `~/.pi/agent/skills/pi-skills/browser-tools/` — the script uses `browser-nav.js` and `browser-eval.js` from this skill. This is the only setup dependency; no separate `puppeteer-core` install needed.

If no Chrome is listening on port `9222`, the script starts headed Chrome under `xvfb-run`. It falls back to headless Chrome when `xvfb-run` is unavailable. You can also start Chrome yourself.

```bash
~/.pi/agent/skills/pi-skills/browser-tools/browser-start.js --profile
```

## ⏰ Daily Cron

### Simple daily digest (midnight UTC)

```bash
0 0 * * * TZ=UTC node ~/projects/perplexity-news/scripts/daily-news.js --out ~/Downloads/daily-news >> ~/Downloads/perplexity-news.log 2>&1
```

### Morning + Night editions (midnight & noon UTC)

```bash
# Morning edition (00:00 UTC)
0 0 * * * TZ=UTC node ~/projects/perplexity-news/scripts/daily-news.js --out ~/Downloads/daily-news --suffix morning >> ~/Downloads/perplexity-news.log 2>&1

# Night edition (12:00 UTC)
0 12 * * * TZ=UTC node ~/projects/perplexity-news/scripts/daily-news.js --out ~/Downloads/daily-news --suffix night >> ~/Downloads/perplexity-news.log 2>&1
```

Produces `perplexity-news-YYYY-MM-DD-morning.html` and `perplexity-news-YYYY-MM-DD-night.html`.

## 🖼️ Sample Output

Dark-themed responsive layout with images:

```
┌─────────────────────────────────────────────────────────┐
│  🗞️ Daily News Digest                                   │
│  2026-06-09 · Scraped from Perplexity Discover          │
├─────────────────────────────────────────────────────────┤
│  [🌍 Top] [🔬 Tech] [💼 Business] [🎨 Arts] [⚽ ...]   │
├────────────────┬────────────────┬───────────────────────┤
│ ┌────────────┐ │ ┌────────────┐ │ ┌────────────┐        │
│ │  🖼️        │ │ │  🖼️        │ │ │  🖼️        │        │
│ │  Headline  │ │ │  Headline  │ │ │  Headline  │        │
│ │  🕐 3h ago │ │ │  📊 29 src │ │ │  🕐 6h ago │        │
│ └────────────┘ │ └────────────┘ │ └────────────┘        │
│ ┌────────────┐ │ ┌────────────┐ │ ┌────────────┐        │
│ │  ...        │ │ │  ...       │ │ │  ...       │        │
└────────────────┴────────────────┴───────────────────────┘
```

## 🏗️ Project Structure

```
perplexity-news/
├── SKILL.md                       # Pi skill definition & usage guide
├── scripts/
│   └── daily-news.js              # Main scraper + HTML generator
├── test/
│   ├── api-helpers.test.js         # Feed card mapping and relative timestamps
│   ├── bot-challenge.test.js       # Challenge handling, API paging, and retries
│   ├── card-parse.test.js          # Card metadata extraction
│   ├── chrome-locks.test.js        # Chrome profile lock cleanup
│   ├── cli.test.js                 # CLI validation before browser startup
│   ├── fake-browser.test.js        # Browser-facing code with fake subprocesses
│   ├── html.test.js                # Digest card rendering and escaping
│   ├── hydration-poll.test.js      # Card hydration polling
│   ├── seams.test.js               # Digest collection and launch helpers
│   └── mutants/
│       └── run-mutants             # Mutation test runner
├── follow-ups/                    # Code review follow-up notes
├── package.json                   # npm test entrypoint
├── README.md                      # This file
└── LICENSE                        # MIT
```

## 🛠️ How It Works

1. Ensures Chrome is running on `localhost:9222` (auto-starts it headed under `xvfb-run` if not)
2. Opens Discover, waits for Cloudflare's check to pass, and fetches the Top feed from the API inside that tab
3. Navigates to each other Perplexity Discover category page in sequence
4. Waits for story cards to hydrate via poll loop with configurable timeout (#8)
5. Extracts card data from DOM leaf elements to prevent digit concatenation (#9, #10)
6. Parses both relative times ("3 hours ago") and absolute dates ("Jul 7, 2026") (#9, #10)
7. Generates a self-contained dark-themed HTML file with all data
8. Saves to `~/Downloads/perplexity-news-YYYY-MM-DD.html`

If Cloudflare still answers with its challenge, the script does not retry that category, and the final error names the bot challenge.

## 📋 Options

| Flag | Default | Description |
|------|---------|-------------|
| `--out <dir>` | `~/Downloads` | Output directory |
| `--limit <N>` | `10` | Cards per category |
| `--open` | — | Open HTML after generation |
| `--suffix <str>` | `""` | Append label to filename, e.g. `--suffix morning`. Use one or more ASCII letters, digits, hyphens, or underscores. |

## ✅ Tests

```bash
npm test
```

## 📄 License

MIT