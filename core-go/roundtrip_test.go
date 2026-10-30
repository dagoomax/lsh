package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The real automations.json, loaded and saved by the Go engine, must come
// out exactly as Node's JSON.stringify(…, null, 2) writes it.
func TestRealAutomationsRoundTrip(t *testing.T) {
	src := filepath.Join("..", "automations.json")
	orig, err := os.ReadFile(src)
	if err != nil {
		t.Skip("no automations.json in this checkout")
	}
	want, err := exec.Command("node", "-e", `const a=require(process.argv[1]);process.stdout.write(JSON.stringify({rules:a.rules||[],scenes:a.scenes||[],flows:a.flows||[]},null,2))`, src).Output()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	f := filepath.Join(dir, "automations.json")
	os.WriteFile(f, orig, 0o644)
	a := NewAutomation(NewStore(filepath.Join(dir, "s.gz")), NewRegistry(NewStore(""), ""), map[string]any{}, f, dir, func(string, any) {})
	a.load()
	a.mu.Lock()
	err = a.save()
	a.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(f)
	if !bytes.Equal(got, want) {
		for i := range min(len(got), len(want)) {
			if got[i] != want[i] {
				lo := max(0, i-80)
				t.Fatalf("differs at byte %d:\nnode: %q\ngo:   %q", i, want[lo:min(len(want), i+80)], got[lo:min(len(got), i+80)])
			}
		}
		t.Fatalf("length differs: node %d, go %d", len(want), len(got))
	}
	t.Logf("%d bytes identical", len(got))
}
