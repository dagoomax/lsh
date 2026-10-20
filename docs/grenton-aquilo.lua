-- Aquilo tank sensors for Grenton — Lua scripts for the GATE HTTP module.
--
-- Aquilo (aquilo.pl) liquid-level sensors (septic tank, rainwater tank, well):
-- the WiFi receiver plugged in indoors answers on the LAN, without login, at
-- GET http://<receiver>/state — the same endpoint LSH's aquilo-client.js reads:
--
--   { "sensors": [ { "id": "000000", "name": "TANK", "lvl": 125.6, "pct": 34,
--                    "bat": 76, "lstRead": "2026-01-01T12:00:00+01:00",
--                    "lstEmpty": "…", "daysLeft": 48, "lvlToFull": 121 } ],
--     "from": "node-1" }
--
-- Older receiver firmware sends only id / lvl / pct / lstRead; the other
-- features are then left untouched. These scripts publish up to two tanks as
-- user features on the GATE (add t3_… and a third TANK_IDS entry for more).
--
-- Setup in Object Manager (on the GATE HTTP):
--   1. Give the Aquilo receiver a fixed DHCP lease.
--   2. Virtual object HttpRequest, name it AQUILO_Request:
--        Host         = http://192.168.1.60      (the receiver's IP)
--        Path         = /state
--        Method       = GET
--        RequestType  = Text
--        ResponseType = JSON
--   3. Virtual object Timer, name it AQUILO_Timer:
--        Time = 300000 (5 min), Mode = Interval
--      The tank transmits only a few times a day; polling faster gains nothing.
--   4. User features on the GATE (type Number unless noted), for t1 and t2:
--        t1_pct       — fill, %
--        t1_lvl       — liquid level, cm
--        t1_bat       — transmitter battery, %
--        t1_days      — days left until full (receiver's estimate)
--        t1_tofull    — cm left until full
--        t1_overflow  — 1 when t1_pct >= OVERFLOW_PCT
--        t1_stale     — 1 when lstRead hasn't moved for STALE_POLLS polls
--                       (battery or radio dead — the receiver keeps
--                       repeating the last reading)
--        t1_unchanged — internal poll counter for t1_stale
--        t1_read      — (String) time of the last transmission (lstRead)
--        t1_name      — (String) tank name from the receiver
--      and once:
--        aquilo_ok    — 1 after a successful read, 0 when the receiver is
--                       unreachable or answers with something else
--   5. Create the three scripts below (aquilo_init, aquilo_request,
--      aquilo_response) and wire the events:
--        GATE OnInit                  → aquilo_init
--        AQUILO_Timer OnTimer         → aquilo_request
--        AQUILO_Request OnRequestSent → aquilo_response
--   6. Fill in TANK_IDS in aquilo_response (or leave them empty to take the
--      tanks in the order the receiver lists them) and send the configuration.
--
-- Reading the values from a CLU script: GATE_HTTP->t1_pct, GATE_HTTP->t1_overflow …
-- (replace GATE_HTTP with your GATE's name in Object Manager).


-- ═══════════════════════════════════════════════════════════════════════════
-- Script: aquilo_init        (GATE OnInit)
-- ═══════════════════════════════════════════════════════════════════════════

AQUILO_Timer->Start()
aquilo_request()          -- first reading right after boot, don't wait 5 min


-- ═══════════════════════════════════════════════════════════════════════════
-- Script: aquilo_request     (AQUILO_Timer OnTimer)
-- ═══════════════════════════════════════════════════════════════════════════

AQUILO_Request->SetRequestHeaders("Accept: application/json")
AQUILO_Request->SendRequest()


-- ═══════════════════════════════════════════════════════════════════════════
-- Script: aquilo_response    (AQUILO_Request OnRequestSent)
-- ═══════════════════════════════════════════════════════════════════════════

-- Tank ids as printed on the transmitter / shown in the Aquilo app, t1 first.
-- "" = take the next tank in the receiver's order.
local TANK_IDS     = { "", "" }
local OVERFLOW_PCT = 90
-- 24 h at a 5-min timer. Raise it if your tank transmits less than daily.
local STALE_POLLS  = 288

local body = AQUILO_Request->ResponseBody
local code = AQUILO_Request->StatusCode

if code ~= 200 or type(body) ~= "table" or type(body.sensors) ~= "table" then
  GATE_HTTP->aquilo_ok = 0
  return
end

-- Pick the tank for each slot: by id when given, otherwise in list order.
local byId, order = {}, {}
for _, s in ipairs(body.sensors) do
  if s.id ~= nil then
    byId[tostring(s.id)] = s
    table.insert(order, s)
  end
end

local function num(v) return tonumber(v) end

-- Grenton user features can't be addressed by a computed name, so each slot
-- gets its own block; read() works out the values to assign.
local function read(tank, prevRead, prevCount)
  local r = {}
  r.pct    = num(tank.pct)
  r.lvl    = num(tank.lvl)
  r.bat    = num(tank.bat)
  r.days   = num(tank.daysLeft)
  r.tofull = num(tank.lvlToFull)
  r.read   = tank.lstRead and tostring(tank.lstRead) or ""
  r.name   = tank.name and tostring(tank.name) or tostring(tank.id)
  r.overflow = (r.pct ~= nil and r.pct >= OVERFLOW_PCT) and 1 or 0
  if r.read ~= "" and r.read == prevRead then
    r.unchanged = (prevCount or 0) + 1
  else
    r.unchanged = 0
  end
  r.stale = (r.unchanged >= STALE_POLLS) and 1 or 0
  return r
end

local nextIdx = 1
local function pick(id)
  if id ~= nil and id ~= "" then return byId[id] end
  local t = order[nextIdx]
  nextIdx = nextIdx + 1
  return t
end

-- ── Tank 1 ──
local t = pick(TANK_IDS[1])
if t ~= nil then
  local r = read(t, GATE_HTTP->t1_read, GATE_HTTP->t1_unchanged)
  if r.pct    ~= nil then GATE_HTTP->t1_pct    = r.pct    end
  if r.lvl    ~= nil then GATE_HTTP->t1_lvl    = r.lvl    end
  if r.bat    ~= nil then GATE_HTTP->t1_bat    = r.bat    end
  if r.days   ~= nil then GATE_HTTP->t1_days   = r.days   end
  if r.tofull ~= nil then GATE_HTTP->t1_tofull = r.tofull end
  GATE_HTTP->t1_overflow  = r.overflow
  GATE_HTTP->t1_unchanged = r.unchanged
  GATE_HTTP->t1_stale     = r.stale
  GATE_HTTP->t1_read      = r.read
  GATE_HTTP->t1_name      = r.name
end

-- ── Tank 2 ──
t = pick(TANK_IDS[2])
if t ~= nil then
  local r = read(t, GATE_HTTP->t2_read, GATE_HTTP->t2_unchanged)
  if r.pct    ~= nil then GATE_HTTP->t2_pct    = r.pct    end
  if r.lvl    ~= nil then GATE_HTTP->t2_lvl    = r.lvl    end
  if r.bat    ~= nil then GATE_HTTP->t2_bat    = r.bat    end
  if r.days   ~= nil then GATE_HTTP->t2_days   = r.days   end
  if r.tofull ~= nil then GATE_HTTP->t2_tofull = r.tofull end
  GATE_HTTP->t2_overflow  = r.overflow
  GATE_HTTP->t2_unchanged = r.unchanged
  GATE_HTTP->t2_stale     = r.stale
  GATE_HTTP->t2_read      = r.read
  GATE_HTTP->t2_name      = r.name
end

GATE_HTTP->aquilo_ok = 1

-- Optional: react straight away, e.g. a warning LED or a push notification.
-- if GATE_HTTP->t1_overflow == 1 then CLU_GARAZ->DOU_LED_SZAMBO->SwitchOn(0) end
