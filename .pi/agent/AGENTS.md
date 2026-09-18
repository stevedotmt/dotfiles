# Global Instructions

- Never run `git commit`, `git push`, or `gh pr create`; a `block-git-writes` extension hard-blocks them. Stop at "ready to commit" and hand off to the user.
- Create worktrees at `~/code/.worktrees/<repo-name>/<name>`; a `git-worktree-conventions` extension rewrites non-conforming `git worktree add` commands and appends the setup hook.
- When delegating write work to subagents, do not use `worktree: true` (the managed allocator names leaves `pi-worktree-<runId>-<index>`). Instead, give each worker its own worktree with a readable name and branch, e.g. instruct it to run `git -C <repo> worktree add ~/code/.worktrees/<repo-name>/<branch-slug> -b <type>/<branch-slug> origin/main` first. One writer per worktree.
- Don't document or comment transient states.
