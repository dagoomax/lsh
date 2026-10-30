package main

// OMap — a JSON object that keeps its key order. Device descriptors, sensor
// readings and values coming from the Node modules are serialized exactly as
// Node would: Loxone Virtual HTTP Inputs match /api/devices on literal
// substrings like `"path":"value","name":"Value",…,"value":\v`, so the
// order is part of the contract, not cosmetics.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
)

type OMap struct {
	keys []string
	m    map[string]any
}

func NewOMap() *OMap { return &OMap{m: map[string]any{}} }

// OM builds an OMap from alternating key, value arguments.
func OM(kv ...any) *OMap {
	o := NewOMap()
	for i := 0; i+1 < len(kv); i += 2 {
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

func (o *OMap) Get(k string) any {
	if o == nil {
		return nil
	}
	return o.m[k]
}

func (o *OMap) Lookup(k string) (any, bool) {
	if o == nil {
		return nil, false
	}
	v, ok := o.m[k]
	return v, ok
}

func (o *OMap) Str(k string) string {
	s, _ := o.Get(k).(string)
	return s
}

// Set keeps an existing key's position and appends a new one — the same as
// assigning a property on a JS object.
func (o *OMap) Set(k string, v any) {
	if _, ok := o.m[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.m[k] = v
}

func (o *OMap) Delete(k string) {
	if _, ok := o.m[k]; !ok {
		return
	}
	delete(o.m, k)
	for i, x := range o.keys {
		if x == k {
			o.keys = append(o.keys[:i:i], o.keys[i+1:]...)
			break
		}
	}
}

func (o *OMap) Keys() []string {
	if o == nil {
		return nil
	}
	return o.keys
}

func (o *OMap) Len() int {
	if o == nil {
		return 0
	}
	return len(o.keys)
}

// Clone is a shallow copy ({...obj}).
func (o *OMap) Clone() *OMap {
	c := &OMap{keys: append([]string(nil), o.keys...), m: make(map[string]any, len(o.m))}
	for k, v := range o.m {
		c.m[k] = v
	}
	return c
}

func (o *OMap) MarshalJSON() ([]byte, error) {
	if o == nil {
		return []byte("null"), nil
	}
	var b bytes.Buffer
	b.WriteByte('{')
	first := true
	for _, k := range o.keys {
		v := o.m[k]
		if v == Undefined { // JSON.stringify leaves undefined properties out
			continue
		}
		if !first {
			b.WriteByte(',')
		}
		first = false
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := marshalJS(v)
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// marshalJS encodes like JSON.stringify: no HTML escaping of <, >, &, and
// NaN / Infinity / undefined become null.
func marshalJS(v any) ([]byte, error) {
	switch x := v.(type) {
	case undefinedT:
		return []byte("null"), nil
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return []byte("null"), nil
		}
	case *OMap:
		return x.MarshalJSON()
	case []any:
		var b bytes.Buffer
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			eb, err := marshalJS(e)
			if err != nil {
				return nil, err
			}
			b.Write(eb)
		}
		b.WriteByte(']')
		return b.Bytes(), nil
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

func (o *OMap) UnmarshalJSON(data []byte) error {
	v, err := decodeOrdered(data)
	if err != nil {
		return err
	}
	m, ok := v.(*OMap)
	if !ok {
		return fmt.Errorf("not an object")
	}
	*o = *m
	return nil
}

// decodeOrdered parses JSON with objects as *OMap, arrays as []any, numbers
// as float64 — what a JS JSON.parse gives, order included.
func decodeOrdered(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	v, err := decodeValue(dec)
	if err != nil {
		return nil, err
	}
	return v, nil
}

func decodeValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			o := NewOMap()
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				o.Set(kt.(string), v)
			}
			_, err := dec.Token()
			return o, err
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			_, err := dec.Token()
			return arr, err
		}
	}
	return tok, nil
}

func rawOrdered(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	v, err := decodeOrdered(raw)
	if err != nil {
		return nil
	}
	return v
}
