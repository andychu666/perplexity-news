---
name: perplexity-news
description: >
  Scrape Perplexity Discover category feeds (Top, Tech & Science, Business, Arts & Culture,
  Sports, Entertainment) and generate a daily news HTML digest with headlines, images,
  source counts, and links. Designed for cron / daily automation.
  No login required — Discover feeds are public.
---

# Perplexity News (Daily Digest)

Scrape all 6 Perplexity Discover categories and output a single HTML file.
No Perplexity Pro account needed — Discover pages are public.

## Quick Start

```bash
node ~/.pi/agent/skills/perplexity-news/scripts/daily-news.js
```

Output: `~/Downloads/perplexity-news-YYYY-MM-DD.html`

## Prerequisites

- Chrome running with remote debugging on `:9222`
- `puppeteer-core` installed (shared with browser-tools skill)

## Cron Setup

### Simple daily digest (midnight UTC)

```bash
0 0 * * * TZ=UTC node ~/.pi/agent/skills/perplexity-news/scripts/daily-news.js --out ~/Downloads/daily-news >> ~/Downloads/perplexity-news.log 2>&1
```

### Morning + Night editions (midnight & noon UTC)

```bash
# Morning edition (00:00 UTC)
0 0 * * * TZ=UTC node ~/.pi/agent/skills/perplexity-news/scripts/daily-news.js --out ~/Downloads/daily-news --suffix morning >> ~/Downloads/perplexity-news.log 2>&1

# Night edition (12:00 UTC)
0 12 * * * TZ=UTC node ~/.pi/agent/skills/perplexity-news/scripts/daily-news.js --out ~/Downloads/daily-news --suffix night >> ~/Downloads/perplexity-news.log 2>&1
```

Produces `perplexity-news-YYYY-MM-DD-morning.html` and `perplexity-news-YYYY-MM-DD-night.html`.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--out <dir>` | `~/Downloads` | Output directory |
| `--limit <N>` | `10` | Cards per category |
| `--open` | — | Open the HTML file after generation (xdg-open) |
| `--suffix <str>` | `""` | Append a label to the filename, e.g. `--suffix morning` → `perplexity-news-2026-06-11-morning.html` |

## Category URLs Scraped

| Category | URL |
|----------|-----|
| Top | `https://www.perplexity.ai/discover/top` |
| Tech & Science | `https://www.perplexity.ai/discover/technology` |
| Business | `https://www.perplexity.ai/discover/finance` |
| Arts & Culture | `https://www.perplexity.ai/discover/arts` |
| Sports | `https://www.perplexity.ai/discover/sports` |
| Entertainment | `https://www.perplexity.ai/discover/entertainment` |

## Output HTML

Dark-themed responsive layout with:
- Sticky category navigation
- Card grid with hero images, headlines, source counts, and publish times
- Each card links to its Perplexity Discover page
- Images auto-hide on load failure (onerror fallback)

## Troubleshooting

- **"Could not connect to browser"**: Start Chrome with `browser-start.js` from browser-tools skill
- **0 cards for a category**: Perplexity may have changed the URL structure; check with `curl`
- **Login**: Not required — Discover feeds are public pages, no account needed
