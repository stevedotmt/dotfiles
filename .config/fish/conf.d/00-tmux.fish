if status is-interactive
and not set -q TMUX
and not set -q VSCODE_RESOLVING_ENVIRONMENT # Cursor/VS Code spawn interactive login fish (no TTY) to capture env.
and isatty stdin
    exec $HOME/.flox/run/aarch64-darwin.default-run/bin/tmux new-session
end
