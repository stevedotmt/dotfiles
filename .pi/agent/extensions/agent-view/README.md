# Agent view

Run `/reload`, then press `←` on an empty prompt or run `/agents`.

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Select a session |
| `Enter` / `→` | Resume the selection, or return to the current conversation |
| `n` | Start a blank session in this directory |
| `Space` | Peek at the selected session |
| `Esc` / `←` | Close the peek, then return to your conversation |

The pinned **+ New session** row also accepts Enter. Idle shows at most five sessions, keeping the current session visible. Other saved sessions remain in `/resume`.

Titles use the full row and wrap when needed. Elapsed time occupies a fixed column at the far right and freezes when a turn finishes. Status/tool summaries appear only in the Space preview. Status groups, group counts, the current-session marker, directory, and keyboard hints remain; redundant total and row-position counters are omitted.

## Scope and safety

The list covers the exact current directory. Symlink aliases share a list; sibling directories and other worktrees do not. Reload other Pi terminals to enable their live status. Saved sessions without presence records show "live status unavailable". Needs input reflects blocking UI prompts, not guesses from assistant text.

New/resume actions use Pi's normal session APIs. They refuse to discard a draft or interrupt a response or queued messages. Known-live sessions must be closed in their other terminal before resuming here. Untracked sessions have no live-state check. Closing the view never stops work.

Subagents remain in `/subagents-fleet`. Its inline `fleetView` is disabled in `../subagent/config.json` to avoid competing for `←`. The existing editor styling is preserved; there is no chat-footer hint.

## Code

- `index.ts` connects Pi events, publishes current-session status, and handles session changes.
- `store.ts` reads saved sessions and private presence records under `~/.pi/agent/agent-view/`.
- `view.ts` owns grouping, the Idle limit, keyboard navigation, and rendering. One `choose` callback handles new, resume, and close.

Presence updates are debounced and have a five-second heartbeat. The open view refreshes every two seconds. Timers are cleaned up on close, reload, and session replacement. `--no-session` stays in memory. No model requests or extra processes are started.

## Test

```sh
node ~/.pi/agent/extensions/agent-view/test.mjs
```

Set `PI_PACKAGE_DIR` if Pi is installed somewhere other than `~/.local/lib/node_modules/@earendil-works/pi-coding-agent`.
