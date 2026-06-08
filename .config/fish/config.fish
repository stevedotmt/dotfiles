# Flox default environment
if type -q flox
  flox activate -d $HOME -m run | source
end

# mise installation
if type -q mise
    mise activate fish | source
end

# Needs to be after mise to not mess up paths.
set -gx PATH /opt/homebrew/bin $PATH

# direnv shell update
if type -q direnv
    direnv hook fish | source
end

# Disable greeting message
set fish_greeting

# fzf bindings
# Run `fzf_configure_bindings --help` for more information
fzf_configure_bindings --directory=\ct

########################################
# General env
#######################################
set -gx GPG_TTY (tty)

set -gx PATH $HOME/.local/bin $PATH

# GO installation
set -gx GOPATH $HOME/go
set -gx PATH $PATH $GOPATH/bin

# Rust installation
set -gx PATH $PATH $HOME/.cargo/bin

# Vim all the things
alias vim nvim
set -gx VISUAL "nvim"
set -gx EDITOR $VISUAL

# Start tmux when not set
if status is-interactive
and not set -q TMUX
    exec tmux new-session -n ""
end

# Make ssh use yubikey-agent
set -gx SSH_AUTH_SOCK "/opt/homebrew/var/run/yubikey-agent.sock"

# Set locale
set -gx LC_ALL en_US.UTF-8

# Configure FZF to use fd
set -gx FZF_DEFAULT_COMMAND 'fd --hidden --type f'

# gcloud installation
set -gx PATH $PATH /opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin
# https://cloud.google.com/blog/products/containers-kubernetes/kubectl-auth-changes-in-gke
set -gx USE_GKE_GCLOUD_AUTH_PLUGIN true

# zoxide installation
zoxide init fish | source

# Override `z` with no args to open the fzf picker instead of jumping home
function z
    if test (count $argv) -eq 0
        __zoxide_zi
    else
        __zoxide_z $argv
    end
end

# Set configuration to be all in 1 place
set -gx XDG_CONFIG_HOME $HOME/.config

# Disable pre-commit color
set -gx PRE_COMMIT_COLOR never

# 1password plugins
source $HOME/.config/op/plugins.sh

########################################
# GitLab
#######################################
set -gx VAULT_ADDR https://vault.ops.gke.gitlab.net
set -gx VAULT_PROXY_ADDR socks5://localhost:18200

########################################
# General abbreviations
#######################################
abbr -a ll ls -la
abbr -a k kubectl
abbr -a kc kubectx
abbr -a cl clear
abbr -a gcl gcloud
abbr -a tf terraform
abbr -a to tofu
abbr -a n lima nerdctl
abbr -a l limactl
abbr -a d docker
abbr -a co container
abbr -a v vim
abbr -a lg lazygit
abbr -a oc opencode
abbr -a c claude
########################################
# Git abbreviations
########################################
abbr -a g git
abbr -a ga git add -p
abbr -a gaa git add --all
abbr -a gl 'git log --pretty=format:"%C(yellow)%H | %ad%Cred%d | %Creset%s%Cblue | [%cn] [%ae]" --decorate --date=short'
abbr -a gc git commit
abbr -a gch git checkout
abbr -a gcf git commit --fixup
abbr -a gd git diff
abbr -a gds git diff --staged
abbr -a gs git status -s
abbr -a gss git status
abbr -a gp git push
abbr -a gpf git push --force-with-lease
abbr -a gsw git switch
abbr -a gr git restore
abbr -a gcp git cherry-pick
abbr -a gb git branch

########################################
# Colorscheme: Mono Lace
########################################
set -U fish_color_normal normal
set -U fish_color_command 000000
set -U fish_color_quote 626262
set -U fish_color_redirection 8a8a8a
set -U fish_color_end 767676
set -U fish_color_error d73a49
set -U fish_color_param 303030
set -U fish_color_comment 4e4e4e
set -U fish_color_match --background=brblue
set -U fish_color_selection white --bold --background=brblack
set -U fish_color_search_match bryellow --background=brblack
set -U fish_color_history_current --bold
set -U fish_color_operator 00a6b2
set -U fish_color_escape 00a6b2
set -U fish_color_cwd green
set -U fish_color_cwd_root red
set -U fish_color_valid_path --underline
set -U fish_color_autosuggestion 777777
set -U fish_color_user brgreen
set -U fish_color_host normal
set -U fish_color_cancel --reverse
set -U fish_pager_color_prefix normal --bold --underline
set -U fish_pager_color_progress brwhite --background=cyan
set -U fish_pager_color_completion normal
set -U fish_pager_color_description B3A06D
set -U fish_pager_color_selected_background --background=brblack
set -U fish_color_host_remote
set -U fish_color_keyword
set -U fish_pager_color_secondary_prefix
set -U fish_pager_color_selected_prefix
set -U fish_pager_color_background
set -U fish_pager_color_secondary_background
set -U fish_pager_color_secondary_completion
set -U fish_pager_color_selected_description
set -U fish_pager_color_selected_completion
set -U fish_color_option
set -U fish_pager_color_secondary_description
