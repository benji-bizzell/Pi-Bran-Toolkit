# Module Map

> Living architecture document. Declares public exports, allowed dependencies, and forbidden imports per module. Updated by the research skill when creating new domains/features.

---

## Boundary Rules

<!-- Project-wide architectural rules. Add rules as the codebase grows. -->

1. **Domain isolation** — Domains never import from other domains' internal modules. Cross-domain communication goes through public exports only.
2. **Barrel exports** — Each module exposes a public API via its barrel file (index.ts or similar). Consumers import from the barrel, never from internal paths.
3. **Dependency direction** — Higher-level modules (UI, adapters) depend on lower-level modules (domain, contracts), never the reverse.

---

## Modules

<!-- Add entries as features are researched. Format:

### {domain}/{feature}

**Public Exports:**
- `{type/function}` — {purpose}

**Allowed Dependencies:**
- `{module}` ({category}) — {why}

**Forbidden Dependencies:**
- `{module}` — {why forbidden}

**Dependency Categories:**
- `in-process` — Direct import, same runtime
- `local-substitutable` — Can swap implementation (e.g., test double vs real)
- `ports & adapters` — Behind an interface/port, implementation injected
- `mock` — Only used in tests, never in production code

-->

_No modules registered yet. Run `/skill:research` to populate._
