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
- Zero dependencies beyond Node.js built-ins + `puppeteer-core` (shared with pi's browser-tools)
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

- Chrome/Chromium running with remote debugging on port `9222`
- `puppeteer-core` installed (auto-resolved from pi's browser-tools skill)

```bash
# Start Chrome (if using pi's browser-tools skill)
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
├── SKILL.md               # Pi skill definition & usage guide
├── scripts/
│   └── daily-news.js      # Main scraper + HTML generator
├── README.md              # This file
└── LICENSE                # MIT
```

## 🛠️ How It Works

1. Connects to Chrome CDP on `localhost:9222`
2. Navigates to each Perplexity Discover category page in sequence
3. Extracts story cards from the DOM (headline, image, URL, source count, publish time)
4. Generates a self-contained dark-themed HTML file with all data
5. Saves to `~/Downloads/perplexity-news-YYYY-MM-DD.html`

## 📋 Options

| Flag | Default | Description |
|------|---------|-------------|
| `--out <dir>` | `~/Downloads` | Output directory |
| `--limit <N>` | `10` | Cards per category |
| `--open` | — | Open HTML after generation |
| `--suffix <str>` | `""` | Append label to filename, e.g. `--suffix morning` |

## 📄 License

MIT