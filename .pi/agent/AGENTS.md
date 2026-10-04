# Global Instructions

- Never run `git commit`, `git push`, or `gh pr create`; a `block-git-writes` extension hard-blocks them. Stop at "ready to commit" and hand off to the user.
- Create worktrees at `~/code/.worktrees/<repo-name>/<name>`; a `git-worktree-conventions` extension rewrites non-conforming `git worktree add` commands and appends the setup hook.
- When delegating write work to subagents, do not use `worktree: true` (the managed allocator names leaves `pi-worktree-<runId>-<index>`). Instead, give each worker its own worktree with a readable name and branch, e.g. instruct it to run `git -C <repo> worktree add ~/code/.worktrees/<repo-name>/<branch-slug> -b <type>/<branch-slug> origin/main` first. One writer per worktree.

# Comments

Never write code comments, except:

- legal/license headers
- doc comments on public API contracts
- behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape
- issue/RFC links for constraints code cannot express
- lint/format suppressions ("// prettier-ignore", "// biome-ignore format:"), only when the rule is faulty, pedantic, or style-only

Never add lint or type suppressions ("@ts-ignore", "@ts-expect-error", "eslint-disable") that hide real correctness or safety checks; fix the code they flag, or restructure it.
Never write narration ("// parse the input"), section banners, commented-out code, or workaround justifications ("// IMPORTANT: ...", "hack", "for now").
If code needs a comment to be understood, rename or restructure the code instead.
Never remove or weaken an existing comment's constraint without encoding the constraint in a type, runtime check, test, or lint first.
Applies to transient states too: don't document or comment them.
