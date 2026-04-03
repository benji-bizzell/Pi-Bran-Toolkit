---
name: orchestrate
description: Execution orchestrator for feature work. Reads committed research artifacts, creates tasks with dependencies, and spawns worker agents that self-coordinate via the shared task system. Re-run to continue from wherever things stand.
---

# Orchestrate

You are the execution orchestrator. After research has committed FEATURE.md and spec-research.md files, you create a full task graph with dependencies and spawn worker agents that self-coordinate by claiming unblocked tasks.

**Key principles:**
- **Tasks are the coordination layer** — create all tasks upfront with proper `blockedBy` dependencies
- **Workers self-coordinate** — each worker: `TaskList` → find unblocked work → `TaskClaim` → do work → `TaskUpdate(completed)` → repeat
- **You spawn, they decide** — you create the task graph and launch workers, they pick up work as dependencies resolve
- **Re-runnable** — call `/skill:orchestrate` again to check progress, spawn more workers, or create tasks for newly discovered work

**CRITICAL — Parallel Dispatch Rule:**
When spawning multiple worker agents, emit ALL Agent tool calls in a SINGLE response. Always use `run_in_background: true`. Do NOT call Agent one at a time.

## When to Use

- After `/skill:research` completes and commits
- When resuming work on an existing feature
- To check progress and spawn more workers
- When starting a new session to continue feature work

---

## The Swarm Pattern

```
orchestrate
    │
    ├── 1. Read research artifacts
    ├── 2. Create task graph (TaskCreate with blockedBy)
    │       ├── Worker tasks: agentType omitted → generic workers claim these
    │       └── Gate tasks: agentType set → orchestrator dispatches specific agents
    ├── 3. Spawn N generic worker agents (parallel, background)
    ├── 4. Monitor: re-run to dispatch gate tasks when they unblock
    │
    ├── Workers self-coordinate (worker tasks only):
    │       ├── TaskList → find pending + unblocked tasks WITHOUT agentType
    │       ├── TaskClaim → atomically claim a task
    │       ├── TaskGet → read full requirements
    │       ├── Do the work (read/write/edit/bash)
    │       ├── TaskUpdate(completed) → unblocks dependents
    │       └── Loop: TaskList → next unblocked task → ...
    │
    └── Orchestrator dispatches gate tasks:
            ├── On re-run, check for unblocked gate tasks (have agentType)
            ├── Spawn specific agent: Agent({ subagent_type: task.agentType, ... })
            └── Agent completes → TaskUpdate(completed) → unblocks next phase
```

### Two Types of Tasks

| Type | `agentType` field | Who executes | Example |
|------|------------------|--------------|----------|
| **Worker task** | omitted | Generic workers via TaskClaim | "Write tests for FR1", "Implement FR2" |
| **Gate task** | set to agent name | Orchestrator spawns specific agent | "QC: spec-coherence-checker", "Validate: red-phase-test-validator" |

Generic workers MUST skip tasks that have `agentType` set. The orchestrator dispatches gate tasks by spawning the named agent type directly.

---

## Instructions

### Step 1: Locate Feature & Load Artifacts

Parse feature path from argument:
```
/skill:orchestrate features/notifications/user-alerts
```

Read FEATURE.md for:
- Spec decomposition table (with Blocks/Blocked By)
- List of specs and their dependencies

Find all spec-research.md, spec.md, and checklist.md files.

### Step 2: Check Existing Tasks

```
TaskList
```

**If tasks exist:** Skip to Step 4 (assess status and spawn workers).

**If no tasks:** Create the task graph (Step 3).

### Step 3: Create Task Graph

For each spec, create tasks for each phase. The key is getting the `blockedBy` chains right.

#### Task Structure Per Spec

Each spec generates a mix of **worker tasks** and **gate tasks**.
Gate tasks use `agentType` to ensure QC is done by specialized agents, not generic workers.

For a spec like `01-foundation` with FR1, FR2 (depends on FR1), FR3:

```
TaskCreate({ subject: "Draft spec sections (01-foundation)", description: "Create spec.md for 01-foundation by drafting 4 sections (Overview, Out of Scope, Requirements, Technical Design) and assembling them. Read {spec-path}/spec-research.md for context. Write final spec.md to {spec-path}/spec.md. Use templates from .pi/skills/spec/templates/.", blockedBy: [] })
→ Task #1  ← WORKER TASK

TaskCreate({ subject: "QC: Spec coherence (01-foundation)", agentType: "spec-coherence-checker", description: "Validate internal consistency of {spec-path}/spec.md. Check FR references, type names, scope alignment. Report PASS or FAIL.", blockedBy: ["1"] })
→ Task #1b  ← GATE TASK

TaskCreate({ subject: "QC: Spec vs research (01-foundation)", agentType: "spec-qc", description: "Delta check {spec-path}/spec.md against {spec-path}/spec-research.md. No new data requirements, no new orphans, consistency. Report PASS or FAIL.", blockedBy: ["1b"] })
→ Task #1c  ← GATE TASK

TaskCreate({ subject: "Generate checklist (01-foundation)", description: "Generate checklist.md for 01-foundation from spec.md and spec-research.md test plan. Use template from .pi/skills/spec/templates/checklist-template.md. Include Phase 1.0, 1.1, 1.2.", blockedBy: ["1c"] })
→ Task #1d  ← WORKER TASK

TaskCreate({ subject: "QC: Checklist completeness (01-foundation)", agentType: "checklist-completeness-validator", description: "Validate {spec-path}/checklist.md against {spec-path}/spec.md and {spec-path}/spec-research.md. Every FR needs test and impl tasks. Phase 1.2 must exist. Report PASS or FAIL.", blockedBy: ["1d"] })
→ Task #1e  ← GATE TASK

TaskCreate({ subject: "Test FR1 (01-foundation)", description: "Write tests for FR1. Read {spec-path}/spec.md and spec-research.md for requirements and test plan. Write tests, commit as test(FR1), update checklist.", blockedBy: ["1e"] })
→ Task #2

TaskCreate({ subject: "Test FR3 (01-foundation)", description: "Write tests for FR3. [same detail]", blockedBy: ["1"] })
→ Task #3

TaskCreate({ subject: "Test FR2 (01-foundation)", description: "Write tests for FR2 (depends on FR1 types). [same detail]", blockedBy: ["1", "2"] })
→ Task #4

TaskCreate({ subject: "QC: Validate test design (01-foundation)", agentType: "red-phase-test-validator", description: "Validate test design for 01-foundation. Test files: [paths]. Spec: {spec-path}/spec.md. Research: {spec-path}/spec-research.md. Report PASS or FAIL.", blockedBy: ["2", "3", "4"] })
→ Task #5  ← GATE TASK: orchestrator dispatches red-phase-test-validator agent

TaskCreate({ subject: "Impl FR1 (01-foundation)", description: "Implement FR1 to pass tests. Read spec, run tests, commit as feat(FR1), update checklist.", blockedBy: ["5"] })
→ Task #6

TaskCreate({ subject: "Impl FR3 (01-foundation)", description: "Implement FR3 to pass tests. [same detail]", blockedBy: ["5"] })
→ Task #7

TaskCreate({ subject: "Impl FR2 (01-foundation)", description: "Implement FR2 to pass tests (depends on FR1). [same detail]", blockedBy: ["5", "6"] })
→ Task #8

TaskCreate({ subject: "QC: Spec-impl alignment (01-foundation)", agentType: "spec-implementation-alignment", description: "Validate implementation alignment for 01-foundation. Check FR success criteria, interface contracts, scope. Spec: {spec-path}/spec.md. Research: {spec-path}/spec-research.md. Report PASS or FAIL.", blockedBy: ["6", "7", "8"] })
→ Task #9  ← GATE TASK

// --- PR Review agents (ALL PARALLEL, all blocked by alignment passing) ---

TaskCreate({ subject: "Review: Code quality (01-foundation)", agentType: "code-reviewer", description: "Review implementation files for 01-foundation. Check convention compliance, code quality, bugs, API design. Report issues by severity.", blockedBy: ["9"] })
→ Task #10a  ← GATE TASK (parallel with 10b-10e)

TaskCreate({ subject: "Review: Silent failures (01-foundation)", agentType: "silent-failure-hunter", description: "Hunt for silent failures in 01-foundation. Check swallowed exceptions, missing error handling, silent state corruption, missing logging.", blockedBy: ["9"] })
→ Task #10b  ← GATE TASK (parallel)

TaskCreate({ subject: "Review: Test coverage (01-foundation)", agentType: "pr-test-analyzer", description: "Analyze test quality for 01-foundation. Check critical paths, edge cases, assertion quality, test independence. Rate coverage confidence.", blockedBy: ["9"] })
→ Task #10c  ← GATE TASK (parallel)

TaskCreate({ subject: "Review: Comments (01-foundation)", agentType: "comment-analyzer", description: "Check comment accuracy for 01-foundation. Find misleading, stale, or missing documentation.", blockedBy: ["9"] })
→ Task #10d  ← GATE TASK (parallel)

TaskCreate({ subject: "Review: Type design (01-foundation)", agentType: "type-design-analyzer", description: "Analyze type design for 01-foundation. Rate encapsulation, invariant enforcement, type safety, API surface on 1-10 scale.", blockedBy: ["9"] })
→ Task #10e  ← GATE TASK (parallel)

TaskCreate({ subject: "Review: Simplification (01-foundation)", agentType: "code-simplifier", description: "Find complexity reduction opportunities in 01-foundation. Check unnecessary abstraction, redundant code, over-engineering.", blockedBy: ["9"] })
→ Task #10f  ← GATE TASK (parallel)

// --- Fix + optimize (after ALL review agents complete) ---

TaskCreate({ subject: "Fix review issues (01-foundation)", description: "Read outputs of all review agents. Fix HIGH+ severity issues. Re-run tests. Commit as fix(01-foundation): address review feedback.", blockedBy: ["10a", "10b", "10c", "10d", "10e", "10f"] })
→ Task #11  ← WORKER TASK

TaskCreate({ subject: "QC: Test optimization (01-foundation)", agentType: "test-optimiser", description: "Optimize tests for 01-foundation. Focus on recently modified test files. Ensure genuine confidence, not coverage metrics. Fix weak tests.", blockedBy: ["11"] })
→ Task #12  ← GATE TASK

TaskCreate({ subject: "Docs 01-foundation", description: "Update checklist.md (mark all [x], add session notes) and FEATURE.md (changelog). Commit as docs(01-foundation).", blockedBy: ["12"] })
→ Task #13
```

#### Cross-Spec Dependencies

For `02-data-layer` that depends on `01-foundation`:

```
TaskCreate({ subject: "Spec 02-data-layer", description: "...", blockedBy: ["13"] })
→ Task #14   (blocked until 01-foundation docs complete)
```

This creates a natural cascade: as workers complete 01's tasks, 02's tasks unblock automatically.

#### Task Description Quality

**Each task description MUST be self-contained.** Workers have no context beyond the task. Include:
- Exact file paths to read
- What to produce
- Commit format (with HEREDOC + Co-Author-By)
- What to update in checklist.md
- How to signal completion

Example:
```
Write tests for FR1 (User Input Validation) of 01-foundation.

Read these files for context:
- features/example/user-notifications/specs/01-foundation/spec.md (FR1 requirements + success criteria)
- features/example/user-notifications/specs/01-foundation/spec-research.md (test plan + interface contracts)
- features/example/user-notifications/specs/01-foundation/checklist.md (Phase 1.0 FR1 tasks)

Write tests to: src/notifications/__tests__/validation.test.ts

Cover ALL FR1 success criteria and edge cases from the test plan.

After writing tests:
1. git add src/notifications/__tests__/validation.test.ts
2. git commit -m "$(cat <<'EOF'
test(FR1): add user input validation tests

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
3. git status (verify clean)
4. Update checklist.md: mark Phase 1.0 FR1 tasks as [x]
5. TaskUpdate this task to 'completed'
```

### Step 4: Spawn Worker Agents

Spawn workers — each is a general-purpose agent that knows how to use Task tools.

**IMPORTANT: Emit ALL Agent calls in ONE response.**

```
Agent({
  subagent_type: "general-purpose",
  description: "Worker 1 for {feature}",
  run_in_background: true,
  prompt: "You are a worker agent in a task-driven swarm. Your job is to find and complete tasks.

WORKFLOW (repeat until no work remains):
1. TaskList → find tasks with status 'pending' and no unresolved blockers
2. TaskClaim(taskId, owner='worker-1') → atomically claim a task
3. TaskGet(taskId) → read full description and requirements
4. Do the work described in the task
5. TaskUpdate(taskId, status='completed') → marks task done, unblocks dependents
6. Go to step 1

RULES:
- Only work on tasks you have claimed
- Follow commit discipline: test() before feat(), HEREDOC format, specific git add
- If blocked or stuck, update the task with a note and move to another task
- If no unblocked tasks remain, report 'All available work complete' and stop

Feature path: features/{domain}/{feature}
Spec artifacts are in features/{domain}/{feature}/specs/*/

Start by calling TaskList to see what's available."
})

Agent({
  subagent_type: "general-purpose",
  description: "Worker 2 for {feature}",
  run_in_background: true,
  prompt: "[Same prompt but owner='worker-2']"
})

Agent({
  subagent_type: "general-purpose",
  description: "Worker 3 for {feature}",
  run_in_background: true,
  prompt: "[Same prompt but owner='worker-3']"
})
```

**How many workers?** Start with 2-4. More workers = more parallelism but also more potential conflicts. The TaskClaim atomic claim prevents double-work.

**CRITICAL: Worker prompt must include the gate task rule:**

```
IMPORTANT: When calling TaskList, SKIP any task that shows {agentType} in the listing.
Those are gate tasks reserved for specific QC agents. Only claim tasks WITHOUT an agentType.
```

### Step 5: Report Status

```
ORCHESTRATION STARTED

Feature: features/{domain}/{feature}

Task Graph: {N} tasks created
  Spec tasks: {count}
  Test tasks: {count}  
  Impl tasks: {count}
  Review tasks: {count}
  Docs tasks: {count}

Workers Spawned: {N}
  worker-1, worker-2, worker-3

Currently Unblocked:
  #1 Spec 01-foundation (no blockers)
  #11 Spec 04-utils (no blockers)

Workers will self-coordinate via TaskClaim.
Re-run /skill:orchestrate to check progress.
```

---

## Resumption Flow

When `/skill:orchestrate` is called with existing tasks:

1. `TaskList` → see current status
2. Count: pending, in_progress, completed
3. **Check for unblocked gate tasks** (status=pending, agentType set, all blockers completed)
4. **Dispatch gate tasks** with specific agents:
   ```
   Agent({
     subagent_type: "{task.agentType}",
     description: "QC: {task.subject}",
     prompt: "{task.description}\n\nWhen complete, call TaskUpdate(taskId='{task.id}', status='completed') if PASS, or add notes and leave as in_progress if FAIL."
   })
   ```
5. Check for stuck tasks (in_progress for too long with no progress)
6. Spawn additional generic workers if unblocked worker tasks exist
7. Report status

```
ORCHESTRATION STATUS

Feature: features/{domain}/{feature}

Progress: 6/15 tasks completed
  ✅ #1 Spec 01-foundation (worker-1)
  ✅ #2 Test FR1 (worker-2)
  ✅ #3 Test FR3 (worker-1)
  ✅ #4 Test FR2 (worker-2)
  ✅ #5 Validate tests (worker-1)
  🔄 #6 Impl FR1 (worker-2) — in progress
  ⏳ #7 Impl FR3 — unblocked, available
  ⏳ #8 Impl FR2 — blocked by #6
  ⏳ #9 Review — blocked by #6, #7, #8
  ...

Workers Active: 2 (worker-1, worker-2)

Action: Spawning 1 more worker for unblocked task #7.
```

---

## Error Handling

### Worker Failure

If a worker agent fails:
1. Its claimed tasks remain `in_progress` with its owner
2. On re-run, detect stale in_progress tasks
3. Unclaim them: `TaskUpdate(taskId, owner='', status='pending')`
4. Spawn replacement worker

### Andon Escalation

If a task can't be completed:
```
ORCHESTRATION BLOCKED

Task #5 (Validate tests): FAILED
Worker: worker-1
Issue: Test validator found spec coverage gaps

Options:
1. Fix the issue and re-run /skill:orchestrate
2. Return to /skill:research to revise
3. Descope the problematic FR

Waiting for user decision.
```

---

## Anti-Patterns

**DO NOT:**
- Create tasks without sufficient detail (workers have no context beyond the task description)
- Spawn workers without creating tasks first
- Manually coordinate workers — let them self-coordinate via TaskClaim
- Create circular dependencies in the task graph
- Use `git add -A` — always stage specific files
- Skip the task graph and try to do work directly in orchestrate
