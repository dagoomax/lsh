package main

// /api/status payload — port of DataStore.getGrouped() (src/data-store.js).

import (
	"context"
	"net/http"
	"sort"
	"strings"
)

func contextWith(r *http.Request, user map[string]any) context.Context {
	return context.WithValue(r.Context(), ctxUser{}, user)
}

func grouped(st *Store) map[string]any {
	all := st.GetAll()
	v := func(k string) any { return all[k] }

	var sa any
	keys := make([]string, 0)
	for k := range all {
		if strings.HasPrefix(k, "solaraccelerator/") {
			keys = append(keys, k)
		}
	}
	if len(keys) > 0 {
		sort.Strings(keys)
		prefix := strings.Split(keys[0], "/")[1]
		key := func(p string) string { return "solaraccelerator/" + prefix + "/" + p }
		sv := func(p string) any { return v(key(p)) }
		sa = map[string]any{
			"pvPower": sv("pv_total_power"), "dailyPvEnergy": sv("day_pv_energy"), "batteryPower": sv("battery_power"),
			"batterySoc": sv("battery_soc"), "gridPower": sv("grid_power"), "gridVoltage": sv("grid_l1_voltage"),
			"gridFrequency": sv("grid_frequency"), "loadPower": sv("load_power"),
			"pvPowerKey": key("pv_total_power"), "batterySocKey": key("battery_soc"), "dailyEnergyKey": key("day_pv_energy"),
		}
	}

	var tariff any
	if v("tauron-tariff/pl/currentPrice") != nil {
		currency, _ := v("tauron-tariff/pl/currency").(string)
		if currency == "" {
			currency = "PLN"
		}
		local := v("tauron-tariff/pl/currentPriceLocal")
		t := map[string]any{"currentPrice": v("tauron-tariff/pl/currentPrice"), "currentPricePln": v("tauron-tariff/pl/currentPrice"),
			"currentPriceRce": v("tauron-tariff/pl/currentPriceRce"), "currency": "PLN"}
		if currency != "PLN" && local != nil {
			t["currentPrice"], t["currency"] = local, currency
		}
		tariff = t
	}

	return map[string]any{
		"battery": map[string]any{
			"soc": v("system/0/Dc/Battery/Soc"), "voltage": v("system/0/Dc/Battery/Voltage"), "current": v("system/0/Dc/Battery/Current"),
			"power": v("system/0/Dc/Battery/Power"), "state": v("system/0/Dc/Battery/BatteryState"), "timeToGo": v("system/0/Dc/Battery/TimeToGo"),
			"temperature": v("battery/0/Temperature"), "chargedEnergy": v("battery/0/History/ChargedEnergy"),
			"dischargedEnergy": v("battery/0/History/DischargedEnergy"),
		},
		"solar": map[string]any{
			"power": v("system/0/Dc/Pv/Power"), "current": v("system/0/Dc/Pv/Current"), "dailyYield": v("system/0/PvChargerAggregated/Yield/User"),
			"totalYield": v("solarcharger/0/Yield/Total"), "temperature": v("solarcharger/0/Temperature"),
		},
		"grid": map[string]any{
			"power": v("system/0/Ac/Grid/L1/Power"), "powerL2": v("system/0/Ac/Grid/L2/Power"), "powerL3": v("system/0/Ac/Grid/L3/Power"),
			"current": v("system/0/Ac/Grid/L1/Current"), "currentL2": v("system/0/Ac/Grid/L2/Current"), "currentL3": v("system/0/Ac/Grid/L3/Current"),
			"voltage": v("system/0/Ac/Grid/L1/Voltage"), "voltageL2": v("system/0/Ac/Grid/L2/Voltage"), "voltageL3": v("system/0/Ac/Grid/L3/Voltage"),
			"frequency": v("system/0/Ac/Grid/L1/Frequency"), "connected": v("system/0/Ac/Grid/Available"),
		},
		"acLoads": map[string]any{"power": v("system/0/Ac/Consumption/L1/Power"), "powerL2": v("system/0/Ac/Consumption/L2/Power"), "powerL3": v("system/0/Ac/Consumption/L3/Power")},
		"dcLoads": map[string]any{"power": v("system/0/Dc/System/Power")},
		"system":  map[string]any{"state": v("system/0/SystemState/State"), "serial": v("system/0/Serial")},
		"solaredge": map[string]any{
			"currentPower": v("solaredge/currentPower"), "gridPower": v("solaredge/gridPower"), "batteryPower": v("solaredge/batteryPower"),
			"loadPower": v("solaredge/loadPower"), "dailyEnergy": v("solaredge/dailyEnergy"), "lifetimeEnergy": v("solaredge/lifetimeEnergy"),
			"batteryLevel": v("solaredge/batteryLevel"), "currentPowerKey": "solaredge/currentPower", "batteryLevelKey": "solaredge/batteryLevel",
			"dailyEnergyKey": "solaredge/dailyEnergy",
		},
		"solaraccelerator": sa,
		"tariff":           tariff,
	}
}
