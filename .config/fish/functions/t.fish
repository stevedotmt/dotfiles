# Save as ~/.config/fish/functions/t.fish
# Usage: t myapp    (resolved via zoxide)
#        t .        (current directory)
#        t          (zoxide fuzzy search, replaces current session)
#        t -n       (zoxide fuzzy search, new session)
#        t -n myapp (new session, resolved via zoxide)
#        t -l       (list active project sessions)
#        t -k       (kill current session)

function t
    set -l kill_previous yes

    # Handle flags
    switch "$argv[1]"
        case -l --list
            tmux list-sessions 2>/dev/null || echo "no active sessions"
            return 0
        case -k --kill
            if set -q TMUX
                set -l s (tmux display-message -p '#S')
                tmux kill-session -t "=$s"
            else
                echo "not in a tmux session"
                return 1
            end
            return 0
        case -n --new
            set kill_previous no
    end

    set -l query
    if test "$kill_previous" = no
        set query $argv[2]
    else
        set query $argv[1]
    end

    # Resolve directory
    set -l dir
    if command -q zoxide
        if test -z "$query"
            # No argument — launch interactive picker
            set dir (zoxide query -i 2>/dev/null)
            or return 1
        else if test "$query" = "."
            set dir (realpath "." 2>/dev/null)
        else
            set dir (zoxide query -- "$query" 2>/dev/null)
            or begin
                echo "zoxide: no match for '$query'"
                return 1
            end
        end
    else
        test -z "$query"; and set query "."
        set dir (realpath "$query" 2>/dev/null)
    end

    if not test -d "$dir"
        echo "not a valid directory: $dir"
        return 1
    end

    set -l name (basename "$dir")

    # Sanitize name — tmux doesn't allow dots or colons in session names
    set name (string replace -a '.' '_' -- "$name")
    set name (string replace -a ':' '_' -- "$name")

    # Track current session if inside tmux
    set -l current_session
    if set -q TMUX
        set current_session (tmux display-message -p '#S')
    end

    # If session already exists, attach to it
    if tmux has-session -t "=$name" 2>/dev/null
        if set -q TMUX
            tmux switch-client -t "=$name"
        else
            tmux attach-session -t "=$name"
        end
        if test "$kill_previous" = yes; and test -n "$current_session"; and test "$current_session" != "$name"
            tmux kill-session -t "=$current_session"
        end
        return 0
    end

    # Create new session with 3 windows
    tmux new-session -d -s "$name" -c "$dir" -n ''
    tmux set-option -t "$name" automatic-rename off
    tmux send-keys -t "$name" "vim" Enter

    tmux new-window -t "$name" -c "$dir" -n ''
    if command -q claude
        tmux send-keys -t "$name" "claude" Enter
    else if command -q pi
        tmux send-keys -t "$name" "pi" Enter
    else
        tmux send-keys -t "$name" "opencode" Enter
    end

    tmux new-window -t "$name" -c "$dir" -n ''

    tmux select-window -t "$name:1"

    # Attach / switch
    if set -q TMUX
        tmux switch-client -t "=$name"
        if test "$kill_previous" = yes; and test -n "$current_session"; and test "$current_session" != "$name"
            tmux kill-session -t "=$current_session"
        end
    else
        tmux attach-session -t "=$name"
    end
end
