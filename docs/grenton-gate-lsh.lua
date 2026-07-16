-- LSH ↔ Grenton bridge — Lua script for the GATE HTTP module.
--
-- Setup in Object Manager:
--   1. Add a virtual object to your GATE HTTP: HttpListener, name it e.g.
--      LSH_Listener, set Path to /lsh (must match config.grenton.path in LSH).
--   2. Create a new script (e.g. lsh_handler) with this file's contents and
--      attach it to the listener's OnRequest event.
--   3. If you set a token in LSH (config.grenton.token), put the same value
--      in TOKEN below; leave empty to disable the check.
--   4. Send the configuration to the GATE.
--
-- Protocol (JSON over POST):
--   {"cmd":"status","objects":["DOU8272:0","DIM1234:0"]}
--       → {"DOU8272:0":1,"DIM1234:0":0.35}
--   {"cmd":"set","object":"DOU8272","index":0,"value":1}
--       → {"ok":true}
--   {"cmd":"exec","code":"ROL4321:execute(0,0)"}
--       → {"ok":true}
--
-- NOTE: adjust the listener variable name (LSH_Listener) to the name you gave
-- the HttpListener object in Object Manager.

local TOKEN = ""  -- optional shared secret; must equal config.grenton.token

local req = LSH_Listener->ReqestBody          -- (sic — Grenton spells it this way)
if req == nil then req = LSH_Listener->RequestBody end

local resp = {}

if TOKEN ~= "" and (req == nil or req.token ~= TOKEN) then
  resp = { error = "unauthorized" }
elseif req.cmd == "status" then
  -- objects: array of "NAME:index" strings; answer with NAME:index → value
  for _, entry in ipairs(req.objects or {}) do
    local name, idx = string.match(entry, "([^:]+):?(%d*)")
    idx = tonumber(idx) or 0
    local ok, value = pcall(function()
      return load("return " .. name .. ":get(" .. idx .. ")")()
    end)
    if ok then resp[entry] = value end
  end
elseif req.cmd == "set" then
  local idx = tonumber(req.index) or 0
  local ok = pcall(function()
    load(req.object .. ":set(" .. idx .. "," .. tostring(req.value) .. ")")()
  end)
  resp = { ok = ok }
elseif req.cmd == "exec" then
  local ok = pcall(function() load(req.code)() end)
  resp = { ok = ok }
else
  resp = { error = "unknown cmd" }
end

LSH_Listener->SetStatusCode(200)
LSH_Listener->SetResponseBody(resp)
LSH_Listener->SendResponse()
