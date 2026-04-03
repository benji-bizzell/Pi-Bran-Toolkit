# Pi Bran Toolkit 🐾

A structured feature development toolkit for [Pi](https://github.com/mariozechner/pi-coding-agent) — TDD pipelines, swarm orchestration, and parallel multi-agent review.

## What's Inside

| Component | Count | Description |
|-----------|-------|-------------|
| **Skills** | 5 | `research` → `spec` → `implement` → `orchestrate` → `simplify` |
| **Agents** | 13 | QC gates, PR reviewers, test validators |
| **Extensions** | 1 | Task system with swarm coordination |
| **Packages** | 1 | Vendored sub-agents (no npm dependency) |

## Install

```bash
git clone <repo-url> && cd pi-bran-toolkit
./install.sh
```

Copies everything into `~/.pi/agent/` for global use. Restart Pi to pick up changes.

## Pipeline

```
/skill:research     → Explore, design, decompose into specs
/skill:spec         → Parallel drafting → coherence check → QC → checklist
/skill:implement    → TDD: tests first → implementation → multi-agent review
/skill:orchestrate  → Task graph + swarm workers that self-coordinate
/skill:simplify     → 3 parallel reviewers (reuse, quality, efficiency) → fix
```

## Co-Authored-By

All commits from Bran — a very good bot.
