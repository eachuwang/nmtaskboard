# Coding Standards

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't improve adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match the existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it—don't delete it.

When your changes create orphans:

- Remove imports, variables, or functions that your changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after."

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

## 5. React UI: Library → Kit → Pages

**The whole client, not just the shell.** Pages never import third-party UI packages.

```text
lucide / Radix  →  client/src/components/ui/*  →  pages / shell / views
```

- `components/ui` is the only place that may import `lucide-react` or `@radix-ui/*`. It wraps them with Tailwind. Swapping a library means editing this folder only.
- Pages, shell, and feature views import from `components/ui` (or other in-repo business components). They do not import vendor widgets.
- If you still must write UI, add it as a kit or business component styled with Tailwind. Do not add new rules to `styles.css`.

# Commit Message Standards

When committing code, always use the Conventional Commits format:

```text
<type>: <description>
```

`type` must be one of the following:

- `build`: Changes that affect the build system or external dependencies, such as Gulp, Webpack, or NPM.
- `chore`: Changes unrelated to a fix or feature that do not modify source or test files, such as updating dependencies.
- `ci`: Changes to continuous integration configuration files and scripts, such as Travis or GitHub Actions.
- `docs`: Documentation updates, such as changes to the README or other Markdown files.
- `feat`: Changes that introduce a new feature.
- `fix`: Changes that fix a bug.
- `perf`: Changes that improve performance.
- `refactor`: Code refactoring that neither fixes a bug nor adds a feature.
- `revert`: Reverts a previous commit.
- `style`: Changes that do not affect the meaning of the code, such as whitespace, formatting, or missing semicolons.
- `test`: Changes related to test cases, such as adding or modifying tests.

The commit description should concisely and clearly summarize the change.

# Git Branching Standards

Use `main` as the production branch whenever possible; keep it continuously releasable. Use `develop` as the integration branch for ongoing work. Protect both branches from direct pushes and require reviewed Pull Requests for all merges.

Create short-lived branches from the branch that matches the work:

- All working branch types use the `<type>/<purpose>` form, with the type as a namespace: `feature/*`, `fix/*`, `release/*`, and `hotfix/*`. Do not use hyphenated forms such as `fix-*`.
- `feature/*` and non-urgent `fix/*` branches start from and merge back into `develop`.
- `release/*` branches prepare a specific version, then merge into both `main` and `develop` before deletion.
- `hotfix/*` branches start from `main` and, after release, merge into both `main` and `develop`; create a version tag for the production fix.

Use lowercase, hyphen-separated names with a clear purpose. Include a task ID when available, and avoid vague names. Keep working branches current with `develop`, preferably by syncing at least daily, and delete them promptly after merging.

**Before making any code change, update the local&#x20;**`develop`**&#x20;branch to the latest remote state. Create a new feature, fix, or equivalent working branch from that updated&#x20;**`develop`**, and make all changes there. Only after the user has tested, reviewed, and explicitly approved the work may you commit the changes, push the branch, and open or merge a PR into the remote&#x20;**`develop`**. Once the PR is merged, delete the corresponding local and remote working branches.**

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues (`eachuwang/nmtaskboard`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map 1:1 to the repo's existing labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root plus `docs/adr/` (already populated). See `docs/agents/domain.md`.
