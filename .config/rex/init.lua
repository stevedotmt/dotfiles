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

rex.bind("cmd+a", "new_pi_tab")
