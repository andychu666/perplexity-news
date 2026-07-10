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
- **Chrome/Chromium** installed — auto-detected from common paths and auto-started headless on port `9222` if not already running
- **pi browser-tools** at `~/.pi/agent/skills/pi-skills/browser-tools/` — the script uses `browser-nav.js` and `browser-eval.js` from this skill. This is the only setup dependency; no separate `puppeteer-core` install needed.

To start the browser (optional — the script auto-starts headless if port 9222 is free):

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
│   ├── hydration-poll.test.js     # Unit tests for hydration polling
│   └── card-parse.test.js         # Unit tests for card metadata extraction
├── follow-ups/                    # Code review follow-up notes
├── package.json                   # npm test entrypoint
├── README.md                      # This file
└── LICENSE                        # MIT
```

## 🛠️ How It Works

1. Ensures Chrome is running on `localhost:9222` (auto-starts headless if not)
2. Navigates to each Perplexity Discover category page in sequence
3. Waits for story cards to hydrate via poll loop with configurable timeout (#8)
4. Extracts card data from DOM leaf elements to prevent digit concatenation (#9, #10)
5. Parses both relative times ("3 hours ago") and absolute dates ("Jul 7, 2026") (#9, #10)
6. Generates a self-contained dark-themed HTML file with all data
7. Saves to `~/Downloads/perplexity-news-YYYY-MM-DD.html`

## 📋 Options

| Flag | Default | Description |
|------|---------|-------------|
| `--out <dir>` | `~/Downloads` | Output directory |
| `--limit <N>` | `10` | Cards per category |
| `--open` | — | Open HTML after generation |
| `--suffix <str>` | `""` | Append label to filename, e.g. `--suffix morning` |

## ✅ Tests

```bash
npm test
```

## 📄 License

MIT