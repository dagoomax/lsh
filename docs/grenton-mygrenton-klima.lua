-- ─────────────────────────────────────────────────────────────────────────────
-- LSH → myGrenton bridge for the three Tuya air-conditioners.
-- Mirrors each LSH object grenton/AC_<id>_{PWR,SET,MODE,TMP} into Grenton virtual
-- objects so the klimas appear in the myGrenton app, two-way.
--
-- This is the REVERSE of grenton-gate-lsh.lua: here the GATE calls OUT to LSH.
--
-- Covered klimas (LSH device keys — verified live on :3001):
--   bf0sim0klima   "Klima salon"
--   bf0sim0klima2  "Klima sypialnia"
--   bf0sim0klima3  "Klima biuro"
--
-- The logic below is complete. The only parts to adapt to YOUR GATE firmware are
-- the two HTTP helper bodies and the event wiring (see "WIRING" at the bottom) —
-- Grenton's HttpRequest object method/event names vary by version. Not tested on
-- a physical GATE.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) From the LSH endpoint QR (Settings → Grenton → Generate QR & token):
local LSH_URL = "http://192.168.1.50:3001"   -- the "url:" line
local TOKEN   = "PASTE_API_TOKEN_HERE"       -- the "token:" line

-- 2) Create in Object Manager, per klima, 4 virtual objects + 2 HttpRequest
--    objects (LSH_HTTP for reads, LSH_HTTP_CMD for commands). Replace each
--    *_VO below with the object you created:
--      _PWR  → a switch   (0/1)      read + write
--      _SET  → a slider   (°C)       read + write   (range ~16–31)
--      _MODE → a slider   (0–4)      read + write   (0 cold,1 hot,2 wet,3 wind,4 auto)
--      _TMP  → a value     (°C)       read only
local KLIMA = {
  { id = "bf0sim0klima",  pwr = KLIMA_SALON_PWR_VO,     set = KLIMA_SALON_SET_VO,     mode = KLIMA_SALON_MODE_VO,     tmp = KLIMA_SALON_TMP_VO },
  { id = "bf0sim0klima2", pwr = KLIMA_SYPIALNIA_PWR_VO, set = KLIMA_SYPIALNIA_SET_VO, mode = KLIMA_SYPIALNIA_MODE_VO, tmp = KLIMA_SYPIALNIA_TMP_VO },
  { id = "bf0sim0klima3", pwr = KLIMA_BIURO_PWR_VO,     set = KLIMA_BIURO_SET_VO,     mode = KLIMA_BIURO_MODE_VO,     tmp = KLIMA_BIURO_TMP_VO },
}

-- ── HTTP helpers — ADAPT to your firmware's HttpRequest API ──────────────────
-- SEND a request on LSH_HTTP for one read. The response arrives asynchronously
-- in LSH_HTTP's OnResponse event (handled by onLshResponse below).
local function sendRead(key, sensor)
  LSH_HTTP->SetUrl(LSH_URL .. "/api/devices/" .. key .. "?sensor=" .. sensor)
  LSH_HTTP->SetMethod("GET")
  LSH_HTTP->SetRequestHeader("Authorization", "Bearer " .. TOKEN)
  LSH_HTTP->SendRequest()
end

-- FIRE a command (fire-and-forget) on the separate LSH_HTTP_CMD object.
-- value is numeric: switch uses 1/0, setpoint uses °C, mode uses the 0–4 index.
local function sendCommand(key, sensor, value)
  LSH_HTTP_CMD->SetUrl(LSH_URL .. "/api/device/" .. key .. "/command")
  LSH_HTTP_CMD->SetMethod("POST")
  LSH_HTTP_CMD->SetRequestHeader("Authorization", "Bearer " .. TOKEN)
  LSH_HTTP_CMD->SetRequestHeader("Content-Type", "application/json")
  LSH_HTTP_CMD->SetRequestBody('{"sensor":"' .. sensor .. '","value":' .. tostring(value) .. '}')
  LSH_HTTP_CMD->SendRequest()
end

-- ── Reads: a round-robin so one HttpRequest object serves all 12 values ──────
-- Each OnTimer tick issues the next read; onLshResponse writes it and advances.
-- A full refresh takes (#READS × timer period); a 1 s timer → every ~12 s.
local READS = {}
for _, k in ipairs(KLIMA) do
  READS[#READS + 1] = { key = "grenton/AC_" .. k.id .. "_PWR",  sensor = "switch", obj = k.pwr,  bool = true }
  READS[#READS + 1] = { key = "grenton/AC_" .. k.id .. "_SET",  sensor = "level",  obj = k.set }
  READS[#READS + 1] = { key = "grenton/AC_" .. k.id .. "_MODE", sensor = "level",  obj = k.mode }
  READS[#READS + 1] = { key = "grenton/AC_" .. k.id .. "_TMP",  sensor = "value",  obj = k.tmp }
end
local idx = 1

-- OnTimer handler.
function pollTick()
  local r = READS[idx]
  sendRead(r.key, r.sensor)
end

-- LSH_HTTP OnResponse handler: write the body to the current target, advance.
function onLshResponse()
  local r = READS[idx]
  local body = LSH_HTTP->GetResponseBody()
  if r.bool then
    r.obj->SetValue((body == "true" or body == "1") and 1 or 0)
  else
    r.obj->SetValue(tonumber(body) or 0)
  end
  idx = idx + 1
  if idx > #READS then idx = 1 end
end

-- ── Writes: call these from each writable object's OnChange ───────────────────
-- (defined per klima so you can paste one line into each OnChange event)
function cmdSalonPwr()      sendCommand("grenton/AC_bf0sim0klima_PWR",  "switch", KLIMA_SALON_PWR_VO->GetValue()) end
function cmdSalonSet()      sendCommand("grenton/AC_bf0sim0klima_SET",  "level",  KLIMA_SALON_SET_VO->GetValue()) end
function cmdSalonMode()     sendCommand("grenton/AC_bf0sim0klima_MODE", "level",  KLIMA_SALON_MODE_VO->GetValue()) end

function cmdSypialniaPwr()  sendCommand("grenton/AC_bf0sim0klima2_PWR",  "switch", KLIMA_SYPIALNIA_PWR_VO->GetValue()) end
function cmdSypialniaSet()  sendCommand("grenton/AC_bf0sim0klima2_SET",  "level",  KLIMA_SYPIALNIA_SET_VO->GetValue()) end
function cmdSypialniaMode() sendCommand("grenton/AC_bf0sim0klima2_MODE", "level",  KLIMA_SYPIALNIA_MODE_VO->GetValue()) end

function cmdBiuroPwr()      sendCommand("grenton/AC_bf0sim0klima3_PWR",  "switch", KLIMA_BIURO_PWR_VO->GetValue()) end
function cmdBiuroSet()      sendCommand("grenton/AC_bf0sim0klima3_SET",  "level",  KLIMA_BIURO_SET_VO->GetValue()) end
function cmdBiuroMode()     sendCommand("grenton/AC_bf0sim0klima3_MODE", "level",  KLIMA_BIURO_MODE_VO->GetValue()) end

-- ─────────────────────────────────────────────────────────────────────────────
-- WIRING (in Object Manager):
--   • A Timer object, period 1 s, OnTimer → pollTick
--   • LSH_HTTP       (HttpRequest)  OnResponse → onLshResponse
--   • LSH_HTTP_CMD   (HttpRequest)  no event needed (fire-and-forget)
--   • Each writable VO's OnChange → the matching cmd* function:
--       KLIMA_SALON_PWR_VO      → cmdSalonPwr        KLIMA_SALON_SET_VO  → cmdSalonSet
--       KLIMA_SALON_MODE_VO     → cmdSalonMode
--       KLIMA_SYPIALNIA_PWR_VO  → cmdSypialniaPwr    …_SET_VO → cmdSypialniaSet   …_MODE_VO → cmdSypialniaMode
--       KLIMA_BIURO_PWR_VO      → cmdBiuroPwr        …_SET_VO → cmdBiuroSet       …_MODE_VO → cmdBiuroMode
--   • TMP objects are read-only (no OnChange).
-- Then bind these VO objects to widgets in myGrenton Builder and send the
-- interface to the phone with Grenton's own QR.
-- ─────────────────────────────────────────────────────────────────────────────
