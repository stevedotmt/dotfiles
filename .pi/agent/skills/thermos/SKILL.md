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

   Build it with shell redirection rather than reading the files into your own context. Never inline the diff in the workflow script: backticks and `${` in the diff break the template literal, and `args` is capped at 16 KiB.
5. Launch both subagents in parallel with a single `subagent` tool call (background is the default). Both reviewers get the same short task naming the context file:

   ```js
   subagent({ workflowScript: `
     const task = [
       "Review branch <branch> in <repo path>: HEAD <HEAD sha> against merge-base <BASE sha> (<base ref>).",
       "Intent: <one or two sentences on what the branch is meant to do>.",
       "Read the complete context file <context path> (### Git / diff output and ### Changed file contents), in chunks as needed.",
       "Return prioritized findings with exact file:line references and evidence."
     ].join(" ");
     const results = await runs.all([
       { key: "audit", agent: "thermo-nuclear-review-subagent", task },
       { key: "quality", agent: "thermo-nuclear-code-quality-review-subagent", task }
     ]);
     return results.map(r => ({ agent: r.agent, ok: r.ok, error: r.error, output: r.output }));
   ` })
   ```

   - `thermo-nuclear-review-subagent`: bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
   - `thermo-nuclear-code-quality-review-subagent`: maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
6. After both finish, check each result's `ok`. If a reviewer failed or returned empty output, say which one and why before synthesizing; do not present a one-sided review as a full thermos pass.
7. Synthesize the results with findings first, deduplicated across reviewers. Weight overlapping findings more heavily, resolve disagreements with your own judgment, and keep summaries brief.

If individual subagent summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
