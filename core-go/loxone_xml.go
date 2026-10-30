package main

// Loxone Config XML templates — port of src/loxone-xml.js, plus the
// deterministic STORE-only ZIP writer of src/zip.js for exports that need
// several blocks (Loxone caps one Virtual Input/Output at ~44 commands).

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"strconv"
	"strings"
	"unicode/utf16"
)

const maxLoxoneCmds = 40

// encodeURIComponent, exactly: everything but A–Z a–z 0–9 - _ . ! ~ * ' ( ).
func encodeURIComponent(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', strings.IndexByte("-_.!~*'()", c) >= 0:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// utf16Slice is JS s.slice(0, n): n UTF-16 code units.
func utf16Slice(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// toFixed1 is Number(x).toFixed(1).
func toFixed1(v any, def float64) string {
	f := def
	if !isNullish(v) {
		f = jsNumber(v)
	}
	return strconv.FormatFloat(f, 'f', 1, 64)
}

func chunkStrings(a []string, n int) [][]string {
	var out [][]string
	for i := 0; i < len(a); i += n {
		out = append(out, a[i:min(i+n, len(a))])
	}
	return out
}

func isOutputSensor(s *OMap) bool {
	return !truthy(s.Get("hidden")) && truthy(s.Get("controllable")) && s.Get("type") != "text"
}

func setURL(deviceKey string, path any, value, token string) string {
	return "/api/device/" + encodeURIComponent(deviceKey) + "/set?sensor=" + encodeURIComponent(jsString(path)) + "&value=" + value + "&token=" + token
}

func sensorTitle(d, s *OMap) string {
	name := s.Get("name")
	if !truthy(name) {
		name = s.Get("label")
	}
	if !truthy(name) {
		name = s.Get("path")
	}
	return jsString(d.Get("label")) + " " + jsString(name)
}

func blockTitle(devices []*OMap, title string) string {
	if title != "" {
		return title
	}
	if len(devices) == 1 {
		return "LSH " + jsString(devices[0].Get("label"))
	}
	return "LSH Devices"
}

type xmlOpts struct {
	host, token, title string
	pollingMs          int
}

// buildInputsXMLs — VirtualInHttp templates polling /api/devices.
func buildInputsXMLs(devices []*OMap, o xmlOpts) []string {
	if o.pollingMs == 0 {
		o.pollingMs = 5000
	}
	var cmds []string
	for _, d := range devices {
		for _, s := range sensorsOf(d) {
			if !isInputSensor(s) {
				continue
			}
			isRange := s.Get("type") == "range" || s.Get("type") == "color-temp"
			minVal, maxVal := "0", "1000000"
			if isRange {
				minVal, maxVal = jsOr(s.Get("min"), 0), jsOr(s.Get("max"), 100)
			} else if s.Get("type") == "boolean" {
				maxVal = "1"
			}
			cmds = append(cmds, fmt.Sprintf("\t<VirtualInHttpCmd Title=\"%s\" Comment=\"%s\" Check=\"%s\" "+
				"Signed=\"true\" Analog=\"true\" SourceValLow=\"0\" DestValLow=\"0\" SourceValHigh=\"0\" DestValHigh=\"0\" "+
				"DefVal=\"0\" MinVal=\"%s\" MaxVal=\"%s\"/>",
				xmlEsc(sensorTitle(d, s)), xmlEsc(d.Str("key")+"/"+jsString(s.Get("path"))), xmlEsc(checkPattern(s)), minVal, maxVal))
		}
	}
	if len(cmds) == 0 {
		return nil
	}
	title := blockTitle(devices, o.title)
	groups := chunkStrings(cmds, maxLoxoneCmds)
	out := make([]string, len(groups))
	for i, g := range groups {
		suffix := ""
		if len(groups) > 1 {
			suffix = fmt.Sprintf(" %d/%d", i+1, len(groups))
		}
		out[i] = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
			fmt.Sprintf("<VirtualInHttp Title=\"%s (feedback)%s\" Comment=\"Reads device states from LSH /api/devices\" "+
				"Address=\"http://%s/api/devices?token=%s\" PollingTime=\"%d\">\n%s\n</VirtualInHttp>\n",
				xmlEsc(title), suffix, xmlEsc(o.host), xmlEsc(o.token), o.pollingMs, strings.Join(g, "\n"))
	}
	return out
}

// jsOr is String(v ?? def) for a number default.
func jsOr(v any, def float64) string {
	if isNullish(v) {
		return numberToString(def)
	}
	return jsString(v)
}

// buildOutputsXMLs — VirtualOut templates calling /api/device/<key>/set.
func buildOutputsXMLs(devices []*OMap, o xmlOpts) []string {
	var cmds []string
	for _, d := range devices {
		key := d.Str("key")
		for _, s := range sensorsOf(d) {
			if !isOutputSensor(s) {
				continue
			}
			typ := s.Get("type")
			typeLabel := "toggle"
			if truthy(typ) {
				typeLabel = jsString(typ)
			}
			comment := fmt.Sprintf("%s/%s [%s]", key, jsString(s.Get("path")), typeLabel)
			if hint := s.Get("hint"); truthy(hint) {
				comment += " " + jsString(hint)
			}
			common := fmt.Sprintf(`Comment="%s" Title="%s" RepeatRate="0" Repeat="0"`, xmlEsc(comment), xmlEsc(sensorTitle(d, s)))
			path := s.Get("path")
			switch {
			case typ == "color":
				cmds = append(cmds, "\t<VirtualOutCmd "+common+` Analog="true" MinVal="0.0" MaxVal="100100100.0" `+
					`CmdOffPost="" CmdOffHTTP="" CmdOff="" CmdOnPost="" CmdOnHTTP="" `+
					`CmdOn="`+xmlEsc(setURL(key, path, "<v>", o.token))+`" CmdOffMethod="GET" CmdOnMethod="GET"/>`)
			case typ == "range" || typ == "color-temp":
				cmds = append(cmds, "\t<VirtualOutCmd "+common+` Analog="true" MinVal="`+toFixed1(s.Get("min"), 0)+`" MaxVal="`+toFixed1(s.Get("max"), 100)+`" `+
					`CmdOffPost="" CmdOffHTTP="" CmdOff="" CmdOnPost="" CmdOnHTTP="" `+
					`CmdOn="`+xmlEsc(setURL(key, path, "<v>", o.token))+`" CmdOffMethod="GET" CmdOnMethod="GET"/>`)
			case typ == "trigger" || isMomentary(s):
				cmds = append(cmds, "\t<VirtualOutCmd "+common+` Analog="false" `+
					`CmdOffPost="" CmdOffHTTP="" CmdOff="" CmdOnPost="" CmdOnHTTP="" `+
					`CmdOn="`+xmlEsc(setURL(key, path, "1", o.token))+`" CmdOffMethod="GET" CmdOnMethod="GET"/>`)
			default:
				cmds = append(cmds, "\t<VirtualOutCmd "+common+` Analog="false" `+
					`CmdOffPost="" CmdOffHTTP="" CmdOff="`+xmlEsc(setURL(key, path, "0", o.token))+`" `+
					`CmdOnPost="" CmdOnHTTP="" CmdOn="`+xmlEsc(setURL(key, path, "1", o.token))+`" CmdOffMethod="GET" CmdOnMethod="GET"/>`)
			}
		}
	}
	if len(cmds) == 0 {
		return nil
	}
	title := blockTitle(devices, o.title)
	return virtualOutBlocks(cmds, o.host, "Device commands via LSH REST API", title)
}

func virtualOutBlocks(cmds []string, host, comment, title string) []string {
	groups := chunkStrings(cmds, maxLoxoneCmds)
	out := make([]string, len(groups))
	for i, g := range groups {
		suffix := ""
		if len(groups) > 1 {
			suffix = fmt.Sprintf(" %d/%d", i+1, len(groups))
		}
		out[i] = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
			fmt.Sprintf("<VirtualOut CmdSep=\"\" CloseAfterSend=\"true\" CmdInit=\"\" Address=\"http://%s\" Comment=\"%s\" Title=\"%s%s\">\n%s\n</VirtualOut>\n",
				xmlEsc(host), comment, xmlEsc(title), suffix, strings.Join(g, "\n"))
	}
	return out
}

// buildScenesXMLs — one pulse command per scene.
func buildScenesXMLs(scenes []*OMap, o xmlOpts) []string {
	var cmds []string
	for _, sc := range scenes {
		id := jsString(sc.Get("id"))
		name := sc.Get("name")
		if !truthy(name) {
			name = sc.Get("id")
		}
		url := "/api/automation/scenes/" + encodeURIComponent(id) + "/run?token=" + o.token
		cmds = append(cmds, fmt.Sprintf("\t<VirtualOutCmd Comment=\"%s\" Title=\"%s\" RepeatRate=\"0\" Repeat=\"0\" "+
			"Analog=\"false\" CmdOffPost=\"\" CmdOffHTTP=\"\" CmdOff=\"\" CmdOnPost=\"\" CmdOnHTTP=\"\" "+
			"CmdOn=\"%s\" CmdOffMethod=\"GET\" CmdOnMethod=\"GET\"/>", xmlEsc("scene "+id), xmlEsc(jsString(name)), xmlEsc(url)))
	}
	if len(cmds) == 0 {
		return nil
	}
	title := o.title
	if title == "" {
		title = "LSH Scenes"
	}
	return virtualOutBlocks(cmds, o.host, "Run LSH scenes via the REST API", title)
}

type zipFile struct {
	name string
	data []byte
}

// zipStore — byte-for-byte the archive src/zip.js writes (stored, DOS date
// 1980-01-01, no extras).
func zipStore(files []zipFile) []byte {
	const dosTime, dosDate = 0, 0x21
	var local, central bytes.Buffer
	le := binary.LittleEndian
	for _, f := range files {
		name := []byte(f.name)
		crc := crc32.ChecksumIEEE(f.data)
		offset := uint32(local.Len())
		h := make([]byte, 30)
		le.PutUint32(h[0:], 0x04034b50)
		le.PutUint16(h[4:], 20)
		le.PutUint16(h[10:], dosTime)
		le.PutUint16(h[12:], dosDate)
		le.PutUint32(h[14:], crc)
		le.PutUint32(h[18:], uint32(len(f.data)))
		le.PutUint32(h[22:], uint32(len(f.data)))
		le.PutUint16(h[26:], uint16(len(name)))
		local.Write(h)
		local.Write(name)
		local.Write(f.data)

		c := make([]byte, 46)
		le.PutUint32(c[0:], 0x02014b50)
		le.PutUint16(c[4:], 20)
		le.PutUint16(c[6:], 20)
		le.PutUint16(c[12:], dosTime)
		le.PutUint16(c[14:], dosDate)
		le.PutUint32(c[16:], crc)
		le.PutUint32(c[20:], uint32(len(f.data)))
		le.PutUint32(c[24:], uint32(len(f.data)))
		le.PutUint16(c[28:], uint16(len(name)))
		le.PutUint32(c[42:], offset)
		central.Write(c)
		central.Write(name)
	}
	end := make([]byte, 22)
	le.PutUint32(end[0:], 0x06054b50)
	le.PutUint16(end[8:], uint16(len(files)))
	le.PutUint16(end[10:], uint16(len(files)))
	le.PutUint32(end[12:], uint32(central.Len()))
	le.PutUint32(end[16:], uint32(local.Len()))
	return append(append(local.Bytes(), central.Bytes()...), end...)
}
