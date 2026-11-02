local function focused_dir(block_id)
  if block_id == nil then
    return nil
  end
  local res = rex.block.call("com.superlogical.terminal", "pwd", { block_id = block_id })
  if res == nil or res.pwd == nil then
    return nil
  end
  local path = res.pwd:gsub("^file://[^/]*", "")
  return (path:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

local function window_of(block_id)
  local view, err = rex.session.view{}
  if err ~= nil then return nil end
  for _, w in ipairs(view.windows) do
    for _, layer in ipairs(w.layers) do
      for _, b in ipairs(layer.blocks) do
        if b.block_id == block_id then return w.window_id end
      end
    end
  end
  return nil
end

rex.action{
  name = "new_pi_tab",
  title = "New pi Tab",
  keywords = "pi agent",
  run = function(ctx, args)
    local w, err = rex.session.new_window{
      focus = true,
      layout = rex.layout.block{
        flavor = "com.superlogical.terminal.shell",
        options = { command = { "pi" }, cwd = focused_dir(ctx.block_id) },
      },
    }
    if err ~= nil then error(err, 0) end
    local _, ferr = rex.session.focus_block{ block_id = w.block_ids[1] }
    if ferr ~= nil then error(ferr, 0) end
    if ctx.client_id ~= nil then
      rex.client.queue("session.select", { session_id = ctx.session_id, window_id = w.window_id })
    end
    return { window_id = w.window_id }
  end,
}

rex.action{
  name = "scrollback_to_nvim",
  title = "Open Scrollback in nvim",
  keywords = "copy yank select visual scrollback",
  run = function(ctx, args)
    if ctx.block_id == nil then error("no focused pane", 0) end
    local layer, err = rex.session.new_layer{
      window_id = window_of(ctx.block_id),
      bounds = { 0.05, 0.05, 0.9, 0.9 },
      focus = true,
      layout = rex.layout.block{
        flavor = "com.superlogical.terminal.shell",
        options = {
          command = { "sh", "-c",
            "rex capture -b '" .. ctx.block_id .. "' --trim | nvim -R -c 'normal G' -" },
          cwd = focused_dir(ctx.block_id),
        },
      },
    }
    if err ~= nil then error(err, 0) end
    return { layer_id = layer.layer_id, block_id = layer.block_ids[1] }
  end,
}

rex.bind("cmd+a", "new_pi_tab")
rex.bind("cmd+shift+y", "scrollback_to_nvim")
