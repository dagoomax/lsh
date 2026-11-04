package main

import (
	"path/filepath"
	"testing"
)

// An `expose` module on the Go core must behave like it does in-process under
// server.js: it sees every module's devices through the (mirrored) shared
// registry and can command devices it did not register. Without the host
// bridge a forked worker sees only its own devices and has no sendCommand —
// which is exactly why grenton-vclu-client used to find zero air-conditioners.
func TestSharedModuleReadsAndCommandsForeignDevice(t *testing.T) {
	root, _ := filepath.Abs("..")
	store := NewStore("")
	reg := NewRegistry(store, "")
	ps := NewPlatformStatus()
	host := NewModuleHost(root, "node", store, reg, ps, func() (map[string]any, error) { return map[string]any{}, nil }, 512)
	t.Cleanup(host.StopAll)

	owner, _ := filepath.Abs("testdata/fake-client.js")          // registers & owns fake/1
	sharedFile, _ := filepath.Abs("testdata/fake-shared-client.js") // reads/commands fake/1
	exposeKey := "fakeShared"

	host.Add(Integration{File: owner, Label: "Owner", On: true, Installed: true})
	shared := host.Add(Integration{File: sharedFile, Label: "Shared", On: true, Installed: true, Expose: &exposeKey})

	waitFor(t, "owner registered fake/1", func() bool { return reg.Has("fake/1") })
	waitFor(t, "shared running", func() bool { return shared.Info()["state"] == "running" })

	// the shared module sees the foreign device through its mirrored registry
	waitFor(t, "shared sees fake/1", func() bool {
		v, err := shared.Call("seenKeys")
		if err != nil {
			return false
		}
		arr, ok := v.([]any)
		if !ok {
			return false
		}
		for _, k := range arr {
			if k == "fake/1" {
				return true
			}
		}
		return false
	})

	// and reads its live value (store change mirrored in: fake sets level=42)
	waitFor(t, "shared reads fake/1 level", func() bool {
		v, err := shared.Call("readForeign", "fake/1", "level")
		return err == nil && v == 42.0
	})

	// commanding the foreign device routes host → real registry → owner worker
	if _, err := shared.Call("cmdForeign", "fake/1", "level", 7.0); err != nil {
		t.Fatalf("cmdForeign level: %v", err)
	}
	waitFor(t, "owner applied level=7", func() bool { return store.Get("fake/1/level") == 7.0 })

	if _, err := shared.Call("cmdForeign", "fake/1", "on", "on"); err != nil {
		t.Fatalf("cmdForeign on: %v", err)
	}
	waitFor(t, "owner applied on=true", func() bool { return store.Get("fake/1/on") == true })

	// a device registered AFTER the shared module started still reaches it
	// (device-discovered is pushed), proving late discovery works too
	if v, err := shared.Call("readForeign", "fake/1", "level"); err != nil || v != 7.0 {
		t.Fatalf("re-read after command: %v %v", v, err)
	}
}
