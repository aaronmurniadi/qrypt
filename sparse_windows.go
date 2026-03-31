//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

const fsctlSetSparse = 0x000900c4

func prepareSparseVaultFile(f *os.File) error {
	h := windows.Handle(f.Fd())
	var bytesReturned uint32
	_ = windows.DeviceIoControl(
		h,
		fsctlSetSparse,
		nil,
		0,
		nil,
		0,
		&bytesReturned,
		nil,
	)
	return nil
}
