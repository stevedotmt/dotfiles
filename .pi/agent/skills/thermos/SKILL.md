---
name: thermos
description: "Launch both thermo-nuclear review subagents in parallel, then synthesize their findings. Use for thermos, double thermo review, or combined bug/security and code-quality branch audits."
disable-model-invocation: true
---

# Thermos

Run the two thermo review passes as parallel subagents via the pi-subagents extension, then synthesize their results. Invoking this skill authorizes that delegation.

## Workflow

1. If the `subagent` tool is not available yet, call `subagents_enable` first.
2. Determine the review scope from the user request, PR, current branch, or relevant changed files.
3. Resolve the base: the PR base branch if a PR exists (`gh pr view --json baseRefName`), otherwise `origin/main`. Run `git fetch origin <base>` first, then record `BASE=$(git merge-base origin/<base> HEAD)` and `HEAD=$(git rev-parse HEAD)`. Do not diff against local `main`; it may be stale.
4. Write a context file at `/tmp/<repo>-thermos-<short-head>-context.md` containing:
   - `### Git / diff output`: `git log --oneline $BASE..HEAD`, `git diff --stat $BASE..HEAD`, and `git diff $BASE..HEAD`.
   - `### Changed file contents`: full contents of each changed file (skip deleted files; generated/vendored files may be listed by path only).

   Build it with shell redirection rather than reading the files into your own context. Never pass the diff through `args`: it is capped at 16 KiB.
5. Launch both subagents in parallel with a single `subagent` tool call (background is the default) running the bundled script file `~/.pi/agent/skills/thermos/review.js`. Do not write a ```` ```js workflow ```` block or use `workflow: true`, and do not use the removed `workflowScript` parameter. Pass the absolute path (expand `~`) and fill `args`:

   ```js
   subagent({
     workflow: "/Users/steve/.pi/agent/skills/thermos/review.js",
     args: {
       repo: "<repo path>",
       branch: "<branch>",
       head: "<HEAD sha>",
       base: "<BASE sha>",
       baseRef: "<base ref>",
       intent: "<one or two sentences on what the branch is meant to do>",
       context: "<context path>"
     }
   })
   ```

   The script gives both reviewers the same short task naming the context file and returns `{ agent, ok, error, output }` per reviewer.

   - `thermo-nuclear-review-subagent`: bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
   - `thermo-nuclear-code-quality-review-subagent`: maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
6. After both finish, check each result's `ok`. If a reviewer failed or returned empty output, say which one and why before synthesizing; do not present a one-sided review as a full thermos pass.
7. Synthesize the results with findings first, deduplicated across reviewers. Weight overlapping findings more heavily, resolve disagreements with your own judgment, and keep summaries brief.

If individual subagent summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
