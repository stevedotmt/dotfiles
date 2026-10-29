function repo_clean
    echo "📣 Reset to default branch"
    git reset --hard @
    git rev-parse --verify -q main > /dev/null 2>&1
    if test $status -eq 0
        git switch main
    end
    git rev-parse --verify -q master > /dev/null 2>&1
    if test $status -eq 0
        git switch master
    end

    echo '📣 Removing linked worktrees'
    for wt in (git worktree list --porcelain | string replace -rf '^worktree ' '' | tail -n +2)
        git worktree remove $wt; or echo "⚠️  Could not remove $wt (dirty or locked), skipping"
    end
    git worktree prune

    echo '📣 Deleting all branches apart from main'
    for branch in (git branch --format='%(refname:short)' | string match -rv '^(main|master)$')
        git branch -D $branch
    end

    echo '📣 Pruning remote'
    git pull --prune

    echo '📣 Running git gc'
    git gc
end
