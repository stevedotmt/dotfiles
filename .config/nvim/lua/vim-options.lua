-- Sync clipboard between OS and Neovim.
vim.o.clipboard = "unnamedplus"

vim.o.tabstop = 4
vim.o.softtabstop = 4
vim.o.shiftwidth = 4
vim.o.expandtab = true
vim.o.smartindent = true
vim.o.wrap = false

-- Set completeopt to have a better completion experience
vim.o.completeopt = "menuone,noselect"

-- Case-insensitive searching UNLESS \C or capital in search
vim.o.ignorecase = true
vim.o.smartcase = true

-- Keep signcolumn on by default
vim.wo.signcolumn = "yes"

-- [[ Highlight on yank ]]
-- See `:help vim.highlight.on_yank()`
local highlight_group = vim.api.nvim_create_augroup("YankHighlight", { clear = true })
vim.api.nvim_create_autocmd("TextYankPost", {
	callback = function()
		vim.highlight.on_yank()
	end,
	group = highlight_group,
	pattern = "*",
})

-- Decrease update time
vim.o.updatetime = 250
vim.o.timeoutlen = 300

-- Mappings
vim.keymap.set("n", "<leader>n", vim.cmd.Ex)

-- Set cursor to blink when in insert mode.
vim.opt.guicursor = "i-ci:ver30-iCursor-blinkwait300-blinkon200-blinkoff200"

-- Virtual Text
vim.diagnostic.config({ virtual_text = true })

-- Don't show the mode, since it's already in the status line
vim.opt.showmode = false

-- Save undo history
vim.opt.undofile = true

-- File types
vim.filetype.add({
	extension = {
		tofu = "terraform",
	},
})
