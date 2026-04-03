---
name: implement
description: TDD implementation skill. Executes spec via test-first development with parallel FR execution and multi-agent review. Use after spec skill has created spec.md and checklist.md.
---

# Implement

Executes a spec through strict TDD: tests first, then implementation, then multi-agent review.

## When to Use This Skill

- After `spec` skill has created spec.md and checklist.md
- When implementing any decomposed spec unit
- Called by spec-executor agent during orchestrated execution

## Prerequisites

- **spec.md exists** with functional requirements and success criteria
- **checklist.md exists** with Phase 1.0, 1.1, and 1.2 tasks
- **spec-research.md exists** with interface contracts and test plan

---

## Workflow Overview

```
Read spec artifacts
       │
       ▼
Build FR Dependency Graph
       │
       ▼
Phase X.0: Tests First
       │
       ├─ Wave-based parallel test dispatch
       ├─ Run red-phase-test-validator
       │
       ▼
Phase X.1: Implementation
       │
       ├─ Wave-based parallel impl dispatch
       ├─ Integration verification (full test suite)
       │
       ▼
Phase X.2: Review
       │
       ├─ Step 0: spec-implementation-alignment
       ├─ Step 1: Address feedback
       ├─ Step 2: test-optimiser
       │
       ▼
Completion
       │
       ├─ Update checklist + FEATURE.md
       ├─ Commit documentation
       │
       ▼
Done
```

---

## Stage 1: Test Foundation (Phase X.0)

### 1.1: Read Spec Artifacts

Read the following files:
- `{spec-path}/spec.md` - Functional requirements
- `{spec-path}/spec-research.md` - Interface contracts, test plan
- `{spec-path}/checklist.md` - Task tracking

### 1.2: Build FR Dependency Graph

Identify FR dependencies from the spec:

| FR | Description | Depends On | Wave |
|----|-------------|------------|------|
| FR1 | ... | - | 1 |
| FR2 | ... | FR1 | 2 |
| FR3 | ... | - | 1 |

**If no dependencies:** All FRs are Wave 1 (maximum parallelism).

### 1.3: Dispatch Test Sub-Agents (Wave-Based)

For each wave, dispatch parallel sub-agents:

```
Agent({
  subagent_type: "general-purpose",
  description: "FR1 tests for {spec-name}",
  run_in_background: true,
  prompt: "Write tests for FR1 of {spec-name}.

Read: {spec-path}/spec.md, spec-research.md, checklist.md
Write tests to: {test-file-path}
Cover all FR1 success criteria and edge cases from spec-research.md.

MODULE BOUNDARIES:
- Check spec-research.md 'Module Boundaries' section for public/internal classification
- Test through public interfaces only — do not test internal implementation details
- Mock cross-module dependencies at the boundary, not deep internals

COMMIT DISCIPLINE:
1. Stage specific files: git add {test-file}
2. Commit with HEREDOC format:
   git commit -m \"$(cat <<'EOF'
   test(FR1): {description}

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )\"
3. Run git status to verify
4. Update checklist.md: mark your tasks [x]
5. Return: 'DONE - FR1 tests committed: {hash}' or 'BLOCKED - {reason}'"
})
```

Wait for wave completion, then dispatch next wave.

### 1.4: Run Test Validator

After all tests written:

```
Agent({
  subagent_type: "red-phase-test-validator",
  description: "Validate test design for {spec-name}",
  prompt: "Validate tests for {spec-path}.

Read:
- Test files (recently created)
- {spec-path}/spec.md
- {spec-path}/spec-research.md

Verify:
- All FR success criteria have test coverage
- Assertions are specific (not just 'exists' or 'doesn't throw')
- Mocks return realistic data matching contracts
- Tests would fail with incorrect implementation

Report PASS or FAIL."
})
```

**If FAIL:** Fix issues, re-run (max 2 iterations).

---

## Stage 2: Implementation (Phase X.1)

### 2.1: Dispatch Implementation Sub-Agents (Wave-Based)

Same wave pattern as tests:

```
Agent({
  subagent_type: "general-purpose",
  description: "FR1 implementation for {spec-name}",
  run_in_background: true,
  prompt: "Implement FR1 to make tests pass.

Read: {spec-path}/spec.md, spec-research.md, {test-file-path}, checklist.md
Implement minimum code to pass FR1 tests (target 50-150 lines).
Run tests to verify passing BEFORE committing.

MODULE BOUNDARIES:
- Check spec-research.md 'Module Boundaries' section and features/module-map.md
- Import from public interfaces only — never reach behind another module's barrel
- Only expose what spec-research.md marks as public exports
- Keep internal implementation hidden — do not export helpers/utils meant for internal use

COMMIT DISCIPLINE:
1. Stage only implementation files (NOT test files)
2. Commit with HEREDOC format:
   git commit -m \"$(cat <<'EOF'
   feat(FR1): {description}

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )\"
3. Run git status to verify
4. Update checklist.md: mark your tasks [x]
5. Return: 'DONE - FR1 implemented: {hash}' or 'BLOCKED - {reason}'"
})
```

### 2.2: Integration Verification

After all FRs implemented, run full test suite:

```bash
{test-command}
```

**If failures:** Identify which FR broke, dispatch targeted fix sub-agent.

---

## Stage 3: Review (Phase X.2)

### Step 0: Spec-Implementation Alignment

```
Agent({
  subagent_type: "spec-implementation-alignment",
  description: "Check alignment for {spec-name}",
  prompt: "Validate implementation alignment:
- spec.md: {spec-path}/spec.md
- spec-research.md: {spec-path}/spec-research.md
- checklist.md: {spec-path}/checklist.md

Verify:
1. Each FR success criterion is satisfied by the implementation
2. Types/signatures match interface contracts
3. No scope creep (features added beyond spec)
4. No scope shortfall (requirements quietly dropped)

Report PASS or FAIL with specific gaps."
})
```

**If PASS:** Proceed to Step 1 (code quality)

**If FAIL:**
1. Review specific gaps
2. Fix alignment issues (or escalate if spec needs updating)
3. Re-run alignment check
4. Repeat until PASS (max 2 iterations)

**If stuck:** Escalate to user — may need spec revision.

### Step 1: Address Any Feedback

If alignment check or other review found issues:
1. Fix issues by priority (critical → high → medium)
2. Re-run tests to ensure fixes don't break anything
3. Commit fixes: `fix({spec}): {description}`

### Step 2: Test Quality Optimization

```
Agent({
  subagent_type: "test-optimiser",
  description: "Optimize test quality for {spec-name}",
  prompt: "Review the tests for this spec implementation.

Focus on recently modified test files. Ensure tests provide genuine confidence:
- Tests would fail if implementation were broken
- Behavior tested, not implementation details
- Edge cases and error paths covered
- No pageantry testing (tests that look good but verify nothing)

Optimize any weak tests found."
})
```

**If test-optimiser suggests changes:**
1. Review suggested improvements
2. Apply changes that strengthen test confidence
3. Re-run tests
4. Commit: `fix({spec}): strengthen test assertions`

---

## Stage 4: Completion

### 4.1: Verify Checklist Complete

Read `{spec-path}/checklist.md` and verify all tasks marked `[x]`:
- [ ] All Phase X.0 tasks complete
- [ ] All Phase X.1 tasks complete
- [ ] All Phase X.2 tasks complete

If any tasks unmarked, update them now.

### 4.2: Add Session Notes

Append to checklist.md:

```markdown
## Session Notes

**{date}**: Implementation complete.
- Phase X.0: {N} test commits
- Phase X.1: {N} implementation commits
- Phase X.2: Review passed, {N} fix commits (if any)
- All tests passing.
```

### 4.3: Update FEATURE.md

Read `features/{domain}/{feature}/FEATURE.md` and update:

1. **Changelog section** - Update spec entry:
   ```markdown
   ### {NN}-{spec-name}
   - **Status**: Complete
   - **Date**: {date}
   - **Commits**: test(FR1-N), feat(FR1-N), fix (if any)
   ```

2. **Files Touched section** - Add any new files created

### 4.4: Commit Documentation Updates

```bash
git add {spec-path}/checklist.md features/{domain}/{feature}/FEATURE.md
git commit -m "$(cat <<'EOF'
docs({NN}-{spec-name}): update checklist and FEATURE.md

- Mark all checklist tasks complete
- Add session notes
- Update FEATURE.md changelog

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git status  # Verify clean working tree
```

### 4.5: Confirm Completion

```
Implementation complete for {NN}-{spec-name}.

Commits (in TDD order):
1. test(FR1-N): tests for all FRs
2. feat(FR1-N): implementations for all FRs
3. fix({spec}): review fixes (if any)
4. docs({spec}): documentation updates

Documentation Updated:
  ✓ checklist.md - all tasks marked complete, session notes added
  ✓ FEATURE.md - changelog updated

All tests passing. Git state clean.

Next step: Proceed to next spec using spec then implement skills
```

---

## Commit Discipline

Each spec follows this commit sequence:

| Order | Prefix | Phase | Purpose |
|-------|--------|-------|---------|
| 1 | `spec` | Setup | Spec artifacts (by spec skill) |
| 2 | `test` | X.0 | Test commits (red phase) |
| 3 | `feat` | X.1 | Implementation commits (green phase) |
| 4 | `fix` | X.2 | Review fix commits (if needed) |
| 5 | `docs` | Completion | Documentation updates |

### Commit Format (REQUIRED)

Always use HEREDOC format:

```bash
git add {specific-files}  # Never use git add -A
git commit -m "$(cat <<'EOF'
{prefix}({scope}): {concise description}

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git status  # Verify commit succeeded
```

### Anti-Patterns

- **NEVER** bundle tests and implementation in one commit
- **NEVER** use `git add -A` or `git add .` - stage specific files
- **NEVER** skip `git status` verification after commit
- **NEVER** commit implementation before tests (breaks TDD visibility)

---

## Key Principles

- **Tests Before Implementation**: Always write tests before code
- **Small Commits**: One logical change per commit, reference FR number
- **Review Before Merge**: Phase X.2 catches issues early
- **Commit Discipline**: Follow the sequence strictly
- **Checklist Discipline**: Update immediately after completing each item
- **Documentation Current**: Update checklist and FEATURE.md before completion
- **Parallelize independent FRs** - Use sub-agents for FRs with no dependencies
- **Wave-based execution** - Group FRs by dependency depth, execute waves in parallel
- **Integration verification** - Always run full test suite after parallel implementation
- **Respect module boundaries** - Import from public interfaces only, expose only declared public exports
