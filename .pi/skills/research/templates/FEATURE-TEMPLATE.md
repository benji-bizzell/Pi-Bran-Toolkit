# Feature: {Feature Name}

## Feature ID

`{feature-id}`

## Metadata

| Field | Value |
|-------|-------|
| **Domain** | {domain} |
| **Feature Name** | {Feature Name} |
| **Contributors** | @{github-id} |

## Files Touched

### {Category}
- `{path/to/file}` ({action: new/modify})

## Table of Contents

- [Feature Overview](#feature-overview)
- [Intended State](#intended-state)
- [System Architecture](#system-architecture)
- [Changelog of Feature Specs](#changelog-of-feature-specs)

## Feature Overview

### Summary

{1-2 sentences describing what this feature does.}

### Problem Statement

{What problem does this feature solve? Why is it needed?}

### Goals

- {Goal 1}
- {Goal 2}

### Non-Goals

- {What is explicitly NOT included} - {why}

## Intended State

{Description of the feature when complete. Write as if describing the finished product, not the changes needed.}

### Key Behaviors

1. **{Behavior}**: {Description}
2. **{Behavior}**: {Description}

## System Architecture

### Component Structure

```
{Diagram or structure showing how components relate}
```

### Data Flow

```
{How data moves through the system}
```

## Module Boundaries

### Public API

{What this feature exports for other modules to consume. Keep this surface small.}

| Export | Type | Consumers |
|--------|------|-----------|
| `{name}` | {type/function/component} | {who uses it} |

### Dependencies

| Module | Category | Direction |
|--------|----------|-----------|
| `{module}` | {in-process / local-substitutable / ports & adapters / mock} | {imports from / exports to} |

### Boundary Rules

{Feature-specific rules beyond the project-wide rules in module-map.md.}

- {Rule 1}

## Changelog of Feature Specs

| Date | Spec | Description |
|------|------|-------------|
| {YYYY-MM-DD} | [{NN}-{spec-name}](specs/{NN}-{spec-name}/spec.md) | {Brief description} |
