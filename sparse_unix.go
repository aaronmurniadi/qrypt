//go:build !windows

package main

import (
	"os"
)

func prepareSparseVaultFile(f *os.File) error {
	return nil
}
