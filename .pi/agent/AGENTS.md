# Global Instructions

- Never run `git commit`, `git push`, or `gh pr create`; a `block-git-writes` extension hard-blocks them. Stop at "ready to commit" and hand off to the user.
- Create worktrees at `~/code/.worktrees/<repo-name>/<name>`; a `git-worktree-conventions` extension rewrites non-conforming `git worktree add` commands and appends the setup hook.
- When delegating write work to subagents, do not use `worktree: true` (the managed allocator names leaves `pi-worktree-<runId>-<index>`). Instead, give each worker its own worktree with a readable name and branch, e.g. instruct it to run `git -C <repo> worktree add ~/code/.worktrees/<repo-name>/<branch-slug> -b <type>/<branch-slug> origin/main` first. One writer per worktree.

# Comments

Default: no comments. If code needs explaining, rename, extract, or retype it instead.

Allowed only:

- legal/license headers
- doc comments on public API contracts, exported Go identifiers, and CRD/API type fields (they generate docs and CRD schemas)
- behavior forced by an external dependency, platform, vendor, or protocol we can't reshape
- issue/RFC links for constraints code can't express
- machine-read directives: `//go:build`, `//go:generate`, `//go:embed`, `// +kubebuilder:`, `// +k8s:`
- suppressions (`// prettier-ignore`, `// biome-ignore`, `//nolint:<linter> // <reason>`) only for faulty, pedantic, or style-only rules

Never:

- narration (`// parse the input`), section banners, commented-out code, transient states, or workaround justifications (`// IMPORTANT:`, `hack`, `for now`)
- suppressions hiding correctness or safety checks (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `//nolint`, `# type: ignore`); fix or restructure the flagged code

Existing comments: don't delete them outside the lines you change. Before removing or weakening a constraint that still holds, encode it in a type, runtime check, test, or lint.
