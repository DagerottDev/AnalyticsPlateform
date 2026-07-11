# Coding Standards

## Enforced in CI (`.github/workflows/ci.yml`)
- **Backend**: `ruff check` (E, F, I, N, W, UP, B, SIM, TCH rule sets; `B008` ignored — FastAPI's
  `Depends()`-as-default is the framework's own idiom) and `mypy app/ --ignore-missing-imports`
  with `strict = true`. No untyped function defs, no bare `Any` returns.
- **Frontend**: `next lint` (`@typescript-eslint`, `react-hooks/exhaustive-deps`) and
  `tsc --noEmit`. `@typescript-eslint/no-explicit-any` and `prefer-const` are errors, not warnings.
- Both backend (`pytest`) and frontend (`vitest`) test suites must pass.

## General principles
- No force unwraps / unchecked `any` — type narrow or cast explicitly with a comment
  explaining why (see `app/services/fyers_service.py` for the pattern with untyped
  third-party SDK responses).
- Feature-based folders on the frontend (`components/<feature>/`, `app/<feature>/page.tsx`).
- Document public APIs — endpoints get FastAPI `summary`/`description`, non-obvious logic
  gets a one-line comment explaining *why*, not *what*.
- Prefer fixing the root cause over widening a type or adding a fallback; only reach for
  `# type: ignore` / `// eslint-disable` on well-understood library-typing gaps (documented
  inline), not to silence a real bug.
