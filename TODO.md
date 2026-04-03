# TODO
---

## Exploring / Marinating 🧠

### Deep Module Architecture
The core hypothesis: orient the workflow around producing deep modules (small interface, substantial hidden implementation) so that confidence comes from testing at boundaries, not reviewing every line.


- [ ] **Boundary checker script** — Static import analysis (like Aerie's `check-architecture-boundaries-lib.mjs`) that reads module-map.md and validates import paths. Runs as a gate task in review phase.
- [ ] **Boundary fix agent** — When checker finds violations, an agent fixes the imports and updates module-map.md if needed. Runs after boundary checker, before test-optimiser.
- [ ] **Boundary tests as a concept** — Distinguish from FR unit tests: boundary tests go through the public interface only, use real/substituted dependencies (not mocks), survive internal refactoring. Possibly a separate sub-phase (X.1.5) or integrated with red-phase-test-validator awareness.
- [ ] **`deep-module-validator` agent** — Checks implementation against FEATURE.md's intended state: are the right things exported, are internals hidden, is the module boundary clean, is the file structure reasonable (not monolithic)?

### UI/Visual Confidence
- [ ] **Polish skill port** — Chrome DevTools MCP for visual verification of UI changes. Needs work beyond the original CC version.

### Developer Experience
- [ ] **Input history (up/down arrow)** — Cycle through recent prompts. CC stores in `~/.claude/history.jsonl`, project-scoped, session-prioritized. Buildable as a CustomEditor extension.
- [ ] **Memory extraction** — Auto-capture key decisions/findings at session end. `session_shutdown` hook → summarize → write to `.pi/memory/`. Need to solve context bloat concern.
- [ ] **Skillify** — Skill that analyzes session history and generates a reusable SKILL.md. "Turn what we just did into a repeatable workflow."
- [ ] **Context visualization** — `/context` command showing token usage breakdown by tool, agent, category. Helps understand context budget.
- [ ] **Session "away summary"** — On session resume, summarize what happened since last session using fast model.
- [ ] **Doctor skill** — Check feature pipeline health: missing specs, incomplete checklists, stale in-progress tasks, orphaned branches.

### Task System Enhancements
- [ ] **Cron/scheduled tasks** — Persistent scheduled orchestration re-runs, periodic QC checks.
- [ ] **Inter-agent messaging** — SendMessage-style tool alongside Task system for real-time agent communication mid-task.
- [ ] **Task persistence options** — Configurable task lifetime (session-only vs persistent). Currently tasks are ephemeral + gitignored with cleanup prompt on session start.

---

## Reference Repos

| Repo | What we learned |
|------|----------------|
| [benji-bizzell/Workflow](https://github.com/benji-bizzell/Workflow) | Original CC workflow: skills, agents, task orchestration, QC gates |
| [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) | Sub-agent extension for pi — vendored locally in `.pi/packages/subagents/` |
| [disler/pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code) | 16 pi extensions: subagent-widget, agent-chain, damage-control, purpose-gate, etc. |
| [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/improve-codebase-architecture) | Deep module architecture skill: dependency categories, boundary testing, interface design |
| Claude Code source (extracted) | Task system, coordinator mode, memory extraction, permissions, history |
| Aerie `arch/proposal-spike` branch | Real-world deep module implementation: boundary checker script, shared contracts, CI enforcement |
