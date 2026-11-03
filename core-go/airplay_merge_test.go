package main

import "testing"

// airplayMerge is the port of src/routes/airplay.js. Checks the subtle bits:
// a "••••" password is replaced by the stored one (matched by id), a speaker
// without a host is dropped, name falls back to id, and port/volume/airplay2
// get their defaults (volume 0 → 60, port 0 → 5000, airplay2 default true).
func TestAirplayMerge(t *testing.T) {
	cfg := rawOrdered([]byte(`{"airplay":{"enabled":false,"speakers":[
		{"id":"s1","name":"Salon","host":"10.0.0.1","port":5000,"airplay2":true,"volume":40,"password":"secret1"},
		{"id":"s2","host":"10.0.0.2","password":"secret2"}]}}`)).(*OMap)
	body := rawOrdered([]byte(`{"enabled":true,"speakers":[
		{"id":"s1","host":"10.0.0.1","password":"••••••••"},
		{"id":"s3","name":"Kuchnia","host":"10.0.0.3","password":"new3","volume":0,"airplay2":false},
		{"id":"s4","name":"NoHost"}]}`)).(*OMap)

	srv := &Server{root: t.TempDir()}
	got := srv.airplayMerge(cfg, body).Get("airplay").(*OMap)

	want := rawOrdered([]byte(`{"enabled":true,"speakers":[
		{"password":"secret1","id":"s1","name":"s1","host":"10.0.0.1","port":5000,"airplay2":true,"volume":60},
		{"password":"new3","id":"s3","name":"Kuchnia","host":"10.0.0.3","port":5000,"airplay2":false,"volume":60}]}`)).(*OMap)

	if a, b := string(mustJSON(t, got)), string(mustJSON(t, want)); a != b {
		t.Errorf("airplayMerge mismatch:\n got  %s\n want %s", a, b)
	}
}
