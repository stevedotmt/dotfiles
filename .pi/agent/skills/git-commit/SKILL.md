---
name: git-commit
description: Use when creating a git commit message for staged changes, preparing to commit, or asked to commit local work.
---

# Git Commit

## Overview

Create clear, consistent commit messages for staged changes. Inspect what is staged, avoid including unrelated work, and ask before committing or adding testing claims that were not verified.

## When to Use

Use this when:

- Asked to create a commit message for staged changes
- Asked to commit local work
- Preparing a conventional commit message
- Summarizing staged changes into a durable commit explanation

Do not use this for general git history exploration unless a commit or commit message is being prepared.

## Workflow

1. Check repository state:

   ```bash
   git status --short
   git diff --cached --stat
   git diff --cached
   ```

2. If nothing is staged, ask whether to stage changes. Do not stage unrelated changes without explicit permission.
3. Summarize only the staged changes.
4. Include testing only when verified or explicitly provided by the user. If code changes are present and testing is unknown, ask before claiming tests passed.
5. Ask before running `git commit` unless the user explicitly asked you to commit.
6. Use the commit message template below.

## Commit Message Template

```text
<conventional-commit-title>

What
---
<overview of what the commit does>

Why
---
<context for why the change is needed; include links or issue references when useful>

Testing
---
<commands run and results, or "Not run (reason)">

Assisted-by: <AGENT_NAME>:<MODEL_VERSION>
```

## Message Rules

- Title should follow Conventional Commits, e.g. `feat: add git commit skill` or `fix: handle empty staged diff`.
- Use present tense: "Foo does not work", not "Foo did not work".
- `What`: explain the change at a high level.
- `Why`: explain context for future readers who may not know the conversation.
- `Testing`: include only verified commands/results or an explicit "Not run" reason.
- Use `Assisted-by: AGENT_NAME:MODEL_VERSION`, not `Co-authored-by`.
- Keep the title concise; put details in the body.

## Common Mistakes

- Claiming tests passed without running them.
- Summarizing unstaged changes as if they are in the commit.
- Staging or committing unrelated user changes without permission.
- Omitting the reason/context behind the change.
- Using past tense or vague titles like `update files`.
