function gw --description "cd between git worktrees (fzf): current repo's when inside one, all worktrees under ~/code/.worktrees otherwise"
    set -l tab (printf '\t')
    set -l base ~/code/.worktrees
    set -l entries

    # From a worktree, --git-common-dir still points at the main checkout's
    # .git, so its dirname is the main checkout root regardless of cwd.
    # --path-format=absolute because the main checkout itself yields ".git".
    set -l git_common (git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    set -l main_root
    if test -n "$git_common"
        set main_root (dirname $git_common)
    end

    if test -n "$main_root"
        set -l repo_name (basename $main_root)
        for wt in (git worktree list --porcelain | string match -rg '^worktree (.+)')
            if test "$wt" = "$main_root"
                set -a entries "$repo_name/(main checkout)$tab$wt"
            else if string match -q "$base/$repo_name/*" -- $wt
                set -a entries (string replace "$base/" "" -- $wt)$tab$wt
            else
                set -a entries "$wt$tab$wt"
            end
        end
    else
        for d in (find $base -mindepth 2 -maxdepth 2 -type d | sort)
            set -a entries (string replace "$base/" "" -- $d)$tab$d
        end
    end

    set -l sel (
        printf '%s\n' $entries | fzf --prompt="worktree> " \
            --delimiter="$tab" --with-nth=1 \
            --preview 'git -C {2} log --oneline -5'
    )
    set -l path (string split -m1 $tab -- $sel)[2]
    if test -n "$path"
        cd $path
    end
end
