# Pi Bran Toolkit 🐾

A structured feature development toolkit for [Pi](https://github.com/mariozechner/pi-coding-agent) — TDD pipelines, swarm orchestration, and parallel multi-agent review.

## Install

```bash
git clone <repo-url> && cd pi-bran-toolkit
./install.sh
```

Copies everything into `~/.pi/agent/` for global use. Restart Pi to pick up changes.

## Skills

Located in `.pi/skills/`. Invoked via `/skill:<name>`.

| Skill | Description |
|-------|-------------|
| `research` | Explore a problem space, design approach, decompose into implementable specs |
| `spec` | Parallel drafting (4 agents) → assemble → coherence check → QC → checklist |
| `implement` | Wave-based TDD: parallel test/impl dispatch, integration verification, multi-agent review |
| `orchestrate` | Creates task graph with dependencies, spawns swarm workers that self-coordinate |
| `simplify` | 3 parallel reviewers (reuse, quality, efficiency) against git diff → fix issues |

## Agents

Located in `.pi/agents/`. Dispatched automatically by skills and orchestrator.

**Spec QC Gates:**

| Agent | Description |
|-------|-------------|
| `spec-coherence-checker` | Validates spec internal consistency after parallel drafting |
| `checklist-completeness-validator` | Ensures checklist covers all spec FRs with tests and implementation tasks |
| `spec-qc` | Delta check — ensures spec didn't break what research QC validated |
| `research-qc` | Validates research outputs: interface tracing, decomposition coverage, API docs |

**Test & Implementation QC:**

| Agent | Description |
|-------|-------------|
| `red-phase-test-validator` | Validates test design quality before implementation begins |
| `spec-implementation-alignment` | Verifies implementation matches spec FRs, contracts, and scope |
| `test-optimiser` | Ensures tests provide genuine confidence, not just coverage metrics |

**PR Review (parallel):**

| Agent | Description |
|-------|-------------|
| `code-reviewer` | Convention compliance, style consistency, bugs, quality |
| `silent-failure-hunter` | Missing error handling, swallowed exceptions, absent logging |
| `pr-test-analyzer` | Test coverage quality, critical gaps, missing edge cases |
| `comment-analyzer` | Comment accuracy, stale docs, misleading descriptions |
| `type-design-analyzer` | Encapsulation, invariant enforcement, type safety, API surface |
| `code-simplifier` | Unnecessary complexity, redundant code, simplification opportunities |

## Extensions

Located in `.pi/extensions/`.

| Extension | Description |
|-----------|-------------|
| `task-system.ts` | TaskCreate, TaskList, TaskGet, TaskUpdate, TaskClaim, TaskReset — file-based storage with dependency resolution and atomic claiming for swarm coordination |
| `minimal-mode.ts` | Condensed tool output rendering — `ctrl+o` toggles between minimal (tool call only) and full output for bash, read, edit, write, find, grep, ls |

## Packages

Located in `.pi/packages/`. Vendored locally — no npm install required.

| Package | Description |
|---------|-------------|
| `subagents/` | Forked from [@tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) (MIT). Provides Agent, get_subagent_result, and steer_subagent tools for spawning autonomous sub-agents |

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
