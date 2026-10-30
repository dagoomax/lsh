package main

import (
	"io"
	"log"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	if os.Getenv("LSH_TEST_LOG") == "" {
		log.SetOutput(io.Discard)
	}
	os.Exit(m.Run())
}
