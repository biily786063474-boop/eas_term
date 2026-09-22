package main

import (
	"eas-term/excel-engine"
	"fmt"
	"os"
	"runtime/debug"
	"time"
)

func main() {
	// Go's memory limit is a soft GC budget, NOT an OS memory sandbox.
	debug.SetMemoryLimit(128 << 20)
	timer := time.AfterFunc(15*time.Second, func() { fmt.Fprintln(os.Stderr, "Excel engine deadline exceeded"); os.Exit(124) })
	defer timer.Stop()
	if err := engine.Run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
