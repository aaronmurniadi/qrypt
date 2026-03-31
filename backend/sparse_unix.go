//go:build !windows

package backend

import (
	"os"
)

func prepareSparseVaultFile(f *os.File) error {
	return nil
}
