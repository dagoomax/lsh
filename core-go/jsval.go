package main

// JavaScript value semantics the automation engine depends on: Number(),
// String(), `??`, and undefined (distinct from null — `global` get of an
// unset name, a message without a payload).

import (
	"math"
	"strconv"
	"strings"
)

type undefinedT struct{}

func (undefinedT) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

// Undefined is JS undefined; nil is null.
var Undefined any = undefinedT{}

func isNullish(v any) bool { return v == nil || v == Undefined }

// orEmpty is `v ?? ”`.
func orEmpty(v any) any {
	if isNullish(v) {
		return ""
	}
	return v
}

// jsNumber is Number(v).
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case undefinedT:
		return math.NaN()
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		return strToNumber(x)
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1:
			return jsNumber(jsString(x[0]))
		}
	}
	return math.NaN()
}

func strToNumber(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	low := strings.ToLower(s)
	for _, p := range []struct {
		prefix string
		base   int
	}{{"0x", 16}, {"0o", 8}, {"0b", 2}} {
		if strings.HasPrefix(low, p.prefix) {
			n, err := strconv.ParseUint(s[2:], p.base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	// strconv accepts things Number() doesn't (inf, nan, 1_000, hex floats)
	for _, r := range low {
		if !strings.ContainsRune("0123456789.e+-", r) {
			return math.NaN()
		}
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return n
}

// jsString is String(v).
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case undefinedT:
		return "undefined"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return x
	case float64:
		return numberToString(x)
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if !isNullish(e) {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// numberToString follows Number.prototype.toString(): plain digits within
// 1e-6 <= |x| < 1e21, exponent form outside.
func numberToString(x float64) string {
	switch {
	case math.IsNaN(x):
		return "NaN"
	case math.IsInf(x, 1):
		return "Infinity"
	case math.IsInf(x, -1):
		return "-Infinity"
	case x == 0:
		return "0"
	}
	abs := math.Abs(x)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(x, 'e', -1, 64) // 1e+21, 1.5e-7
		mant, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		exp = strings.TrimLeft(exp[1:], "0")
		return mant + "e" + string(sign) + exp
	}
	return strconv.FormatFloat(x, 'f', -1, 64)
}

// templateText substitutes {value} / {key} like the JS .replace() chains.
func templateText(s string, payload, key any) string {
	s = strings.ReplaceAll(s, "{value}", jsString(orEmpty(payload)))
	return strings.ReplaceAll(s, "{key}", jsString(orEmpty(key)))
}

// clean turns Undefined into null for values leaving the engine (IPC,
// store, JSON), as JSON.stringify would.
func clean(v any) any {
	if v == Undefined {
		return nil
	}
	return v
}
