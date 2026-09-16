# Contributing

## Issue Standard

All issues use a bracketed prefix in the title, consistent labels, and a standard body template.

### Title Format

```
[PREFIX] Brief description — context or impact
```

- Em-dash separator (` — `) between problem and context
- Sentence case for description

| Prefix | Use for | Label |
|---|---|---|
| `[CRITICAL]` `[HIGH]` `[MEDIUM]` `[LOW]` | Bugs — observable incorrect behavior | `bug` |
| `[ENHANCEMENT]` | New features, test coverage, hardening | `enhancement` |
| `[REFACTOR]` | Cleanup, DRY, cosmetic — zero behavioral change | `enhancement` |
| `[TECH-DEBT]` | Deferred design fragility or will-bite-later | `enhancement` |

### Labels

| Label | When |
|---|---|
| `bug` | Observable incorrect behavior under some input |
| `enhancement` | Improvement that does not fix a defect |
| `good first issue` | Small, well-scoped, low-risk — stack on `bug` or `enhancement` |
| `help wanted` | Needs design discussion or external input |

### Body Template

```markdown
## Context
<which PR, review, or area this came from>

## Finding
<what is wrong, evidence, reproduction steps>

## Severity: <LEVEL>
<impact assessment, likelihood, production risk>

## Fix
<proposed change, if applicable>
```
