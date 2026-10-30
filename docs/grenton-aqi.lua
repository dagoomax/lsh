-- Air quality (AQI) sensor for Grenton — Lua scripts for the GATE HTTP module.
--
-- Grenton has no PM2.5/PM10 sensor of its own, so this pulls the current air
-- quality for your location from Airly (the same source LSH's airly-client.js
-- uses) and publishes it as user features on the GATE, where any CLU script,
-- panel or condition can read them (e.g. boost the recuperator when aqi_level
-- goes HIGH, or colour an LED).
-- Free Airly API key: https://developer.airly.org (trial keys allow ~100
-- requests/day — keep the interval at 15 min or more).
--
-- Setup in Object Manager (on the GATE HTTP):
--   1. Virtual object HttpRequest, name it AQI_Request:
--        Host         = https://airapi.airly.eu
--        Path         = /v2/measurements/point
--        Method       = GET
--        RequestType  = Text
--        ResponseType = JSON
--   2. Virtual object Timer, name it AQI_Timer:
--        Time = 900000 (15 min), Mode = Interval
--   3. User features on the GATE (type Number unless noted):
--        aqi        — Airly CAQI index (0–100+, lower is better)
--        aqi_level  — 1 very low … 7 airmageddon (0 = no data)
--        aqi_us     — US EPA AQI computed from PM2.5/PM10 (0–500)
--        pm1, pm25, pm10   — µg/m³
--        temp, hum, press  — °C, %, hPa
--        aqi_ok     — 1 after a successful read, 0 on error
--        aqi_desc   — (String) Airly's description, e.g. "Great air here today!"
--   4. Create three scripts below (aqi_init, aqi_request, aqi_response) and
--      wire the events:
--        GATE OnInit              → aqi_init
--        AQI_Timer OnTimer        → aqi_request
--        AQI_Request OnRequestSent → aqi_response
--   5. Fill in API_KEY / LAT / LON in aqi_request and send the configuration.
--
-- Reading the values from a CLU script: GATE_HTTP->pm25, GATE_HTTP->aqi_level …
-- (replace GATE_HTTP with your GATE's name in Object Manager).


-- ═══════════════════════════════════════════════════════════════════════════
-- Script: aqi_init        (GATE OnInit)
-- ═══════════════════════════════════════════════════════════════════════════

AQI_Timer->Start()
aqi_request()          -- first reading right after boot, don't wait 15 min


-- ═══════════════════════════════════════════════════════════════════════════
-- Script: aqi_request     (AQI_Timer OnTimer)
-- ═══════════════════════════════════════════════════════════════════════════

local API_KEY = "your-airly-api-key"
local LAT     = "52.2297"
local LON     = "21.0122"

AQI_Request->SetRequestHeaders("apikey: " .. API_KEY .. "\r\nAccept: application/json")
AQI_Request->SetQueryStringParams("lat=" .. LAT .. "&lng=" .. LON)
AQI_Request->SendRequest()


-- ═══════════════════════════════════════════════════════════════════════════
-- Script: aqi_response    (AQI_Request OnRequestSent)
-- ═══════════════════════════════════════════════════════════════════════════

-- Airly CAQI level names → 1..7, so CLU logic can compare numbers.
local LEVELS = {
  VERY_LOW = 1, LOW = 2, MEDIUM = 3, HIGH = 4,
  VERY_HIGH = 5, EXTREME = 6, AIRMAGEDDON = 7,
}

-- US EPA AQI for one pollutant: linear interpolation inside its breakpoint band.
-- bands = { {Clow, Chigh, Ilow, Ihigh}, … }
local function epa(c, bands)
  if c == nil then return nil end
  for _, b in ipairs(bands) do
    if c <= b[2] then
      return math.floor((b[4] - b[3]) / (b[2] - b[1]) * (c - b[1]) + b[3] + 0.5)
    end
  end
  return 500
end

-- EPA breakpoints (PM2.5 as revised in 2024)
local PM25_BANDS = {
  {0.0,    9.0,   0,  50}, {9.1,   35.4,  51, 100}, {35.5,  55.4, 101, 150},
  {55.5, 125.4, 151, 200}, {125.5, 225.4, 201, 300}, {225.5, 325.4, 301, 500},
}
local PM10_BANDS = {
  {0,   54,   0,  50}, {55,  154,  51, 100}, {155, 254, 101, 150},
  {255, 354, 151, 200}, {355, 424, 201, 300}, {425, 604, 301, 500},
}

local body = AQI_Request->ResponseBody
local code = AQI_Request->StatusCode

if code ~= 200 or type(body) ~= "table" or body.current == nil then
  GATE_HTTP->aqi_ok = 0
  return
end

-- values: [{name="PM25", value=12.3}, …] → v.PM25
local v = {}
for _, item in ipairs(body.current.values or {}) do
  v[item.name] = item.value
end

-- index: prefer AIRLY_CAQI, fall back to whatever comes first
local idx = nil
for _, i in ipairs(body.current.indexes or {}) do
  if i.name == "AIRLY_CAQI" then idx = i end
end
if idx == nil and body.current.indexes ~= nil then idx = body.current.indexes[1] end

if idx ~= nil and idx.value ~= nil then
  GATE_HTTP->aqi       = math.floor(idx.value + 0.5)
  GATE_HTTP->aqi_level = LEVELS[idx.level] or 0
  GATE_HTTP->aqi_desc  = idx.description or ""
end

if v.PM1  ~= nil then GATE_HTTP->pm1  = v.PM1  end
if v.PM25 ~= nil then GATE_HTTP->pm25 = v.PM25 end
if v.PM10 ~= nil then GATE_HTTP->pm10 = v.PM10 end
if v.TEMPERATURE ~= nil then GATE_HTTP->temp  = v.TEMPERATURE end
if v.HUMIDITY    ~= nil then GATE_HTTP->hum   = v.HUMIDITY    end
if v.PRESSURE    ~= nil then GATE_HTTP->press = v.PRESSURE    end

-- US AQI = worse of the two particulate sub-indexes
local a25 = epa(v.PM25, PM25_BANDS)
local a10 = epa(v.PM10, PM10_BANDS)
if a25 ~= nil or a10 ~= nil then
  GATE_HTTP->aqi_us = math.max(a25 or 0, a10 or 0)
end

GATE_HTTP->aqi_ok = 1

-- Optional: react straight away, e.g. recuperator boost on bad air.
-- if GATE_HTTP->aqi_level >= 4 then CLU_SALON->DOU_REKU_BOOST->SwitchOn(0) end
