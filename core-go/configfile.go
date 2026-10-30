package main

// config.json read/write — port of readConfigFile() (routes/helpers.js) and
// writeConfigFile() (src/config-file-cache.js): atomic temp + fsync + rename,
// the previous parseable file kept as config.json.bak, the real file written
// when config.json is a symlink (Home Assistant add-on), existing mode kept
// (0600 for a new file). Key order survives, so a save from the Go core
// changes only what it meant to.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func readConfigOrdered(path string) *OMap {
	b, err := os.ReadFile(path)
	if err != nil {
		return NewOMap()
	}
	if o, ok := rawOrdered(b).(*OMap); ok {
		return o
	}
	return NewOMap()
}

func writeConfigFile(path string, data *OMap) error {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		path = real
	}
	raw, err := marshalJS(data)
	if err != nil {
		return err
	}
	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		return err
	}
	mode := os.FileMode(0o600)
	if st, err := os.Stat(path); err == nil {
		mode = st.Mode().Perm()
	}
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := f.Write(out.Bytes()); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	f.Close()
	// back up only a file that parses — a broken one never replaces the last good backup
	if cur, err := os.ReadFile(path); err == nil && json.Valid(cur) {
		os.WriteFile(path+".bak", cur, mode)
	}
	return os.Rename(tmp, path)
}
