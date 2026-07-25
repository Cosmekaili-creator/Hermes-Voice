# Feature pipeline (orchestrator)

Reusable process for non-trivial Hermes Voice work. One person (or agent) is **orchestrator and final judge**; specialists do explore / plan / QC / implement.

## When to use

Use for multi-file features, refactors with control-flow risk, or anything that needs a written plan before coding. Skip for trivial one-file fixes.

## Stages

| # | Stage | Who | Output |
|---|--------|-----|--------|
| 0 | **Scope lock** | Orchestrator | Goals, non-goals, sequencing notes (e.g. `docs/FUTURE.md` if local) |
| 1 | **Explore** | Explore subagent (read-only) | Fact report: files, string/API surface, risks, touch list |
| 2 | **Plan** | Plan crafter | Lean implementation plan (API, files, acceptance, risks) |
| 3 | **Plan QC** | QC subagent | `APPROVE` / `APPROVE_WITH_FIXES` / `REJECT` + must-fix list |
| 4 | **Amend** | Orchestrator | Fold must-fixes into the impl brief; do **not** implement yet if REJECT |
| 5 | **Implement** | Implementer | Code only; run `npm run check`; no drive-by scope; no commit unless asked |
| 6 | **Impl QC** | QC subagent | `PASS` / `PASS_WITH_FIXES` / `FAIL` + acceptance checklist with evidence |
| 7 | **Fix** | Orchestrator (or implementer) | Must-fixes only; re-check; should-fixes optional |
| 8 | **Report** | Orchestrator | Verdict, what shipped, deferred items, commit/deploy ask |

## Rules

1. **Orchestrator judges** — subagents advise; the orchestrator accepts, amends, or rejects.
2. **No coding before plan QC** — explore → plan → plan QC → then implement.
3. **Must-fix block** — empty must-fix to proceed; should-fix may ship later.
4. **Briefs carry ground truth** — pass explore facts + QC amendments into the next agent; do not assume shared chat memory.
5. **Acceptance is testable** — plans list checkboxes; impl QC marks each ✅/❌ with evidence.
6. **Scope stickiness** — implementer must not pull later phases (wizard, multi-user, second provider, etc.).
7. **Verify in repo** — QC and implementer run `npm run check` (and other project checks) themselves.
8. **Commits are opt-in** — pipeline stops at report unless the user asks to commit/deploy.

## Agent prompts (minimal)

- **Explore:** locked scope; return inventory, architecture, risks, touch list; read-only.
- **Plan:** goals/non-goals, design, file list, acceptance, risks; no edits.
- **Plan QC:** verdict + must-fix / should-fix; spot-check critical paths in code; no rewrite unless REJECT.
- **Implement:** amended plan only; check clean; summarize files + decisions.
- **Impl QC:** verify acceptance against **code**; run check; report only (no fixes).

## Svelte / this repo

- Prefer the Svelte MCP / `svelte-autofixer` when editing `.svelte` / `.svelte.ts`.
- Match existing Svelte 5 runes style; keep diffs focused.
- Avoid server-side mutation of module singletons for request-scoped state (e.g. locale): pass `data` / explicit args on SSR; sync module state in the browser only.
- `docs/FUTURE.md` is local brainstorm (gitignored). This pipeline doc is committed and reusable.
