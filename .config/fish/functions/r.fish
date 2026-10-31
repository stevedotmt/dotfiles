# Usage: r myapp    (resolved via zoxide)
#        r .        (current directory)
#        r          (zoxide fuzzy search, replaces current session)
#        r -n       (zoxide fuzzy search, new session)
#        r -n myapp (new session, resolved via zoxide)
#        r -l       (list sessions)
#        r -k       (kill current session)

function r
    set -l kill_previous yes

    switch "$argv[1]"
        case -l --list
            rex ls
            return $status
        case -k --kill
            if set -q REX_SESSION
                rex kill "$REX_SESSION"
            else
                echo "not in a rex session"
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

    set -l dir
    if command -q zoxide
        if test -z "$query"
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

    set -l target (rex ls --json | jq -r --arg n "$name" '.sessions[] | select(.label == $n) | .session_id' | head -n 1)

    if test -z "$target"
        set -l created (rex new "$name" -c "$dir" --window vim --json)
        or return 1
        set target (printf '%s' "$created" | jq -er '.session_id')
        or return 1
        set -l vim_block (printf '%s' "$created" | jq -er '.initial_windows[0].block_ids[0]')

        rex send -s "$target" -b "$vim_block" vim
        rex send-key -s "$target" -b "$vim_block" enter

        rex window new -s "$target" shell -c "$dir" --focus=false >/dev/null

        set -l agent (rex window new -s "$target" agent -c "$dir" --json)
        set -l agent_block (printf '%s' "$agent" | jq -er '.block_ids[0]')
        rex send -s "$target" -b "$agent_block" pi
        rex send-key -s "$target" -b "$agent_block" enter
    end

    set -l previous $REX_SESSION
    rex do session.select session_id="$target"
    or return 1

    if test "$kill_previous" = yes; and test -n "$previous"; and test "$previous" != "$target"
        rex kill "$previous"
    end
end
