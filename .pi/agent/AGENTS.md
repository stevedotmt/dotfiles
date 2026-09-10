# Global Instructions

- Never run `git commit`, `git push`, or `gh pr create`; a `block-git-writes` extension hard-blocks them. Stop at "ready to commit" and hand off to the user.
- Create worktrees at `~/code/.worktrees/<repo-name>/<name>`; a `git-worktree-conventions` extension rewrites non-conforming `git worktree add` commands and appends the setup hook.
