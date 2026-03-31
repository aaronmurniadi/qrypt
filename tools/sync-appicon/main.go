package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func main() {
	wd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	root := wd
	for {
		if _, err := os.Stat(filepath.Join(root, "go.mod")); err == nil {
			break
		}
		next := filepath.Dir(root)
		if next == root {
			fmt.Fprintln(os.Stderr, "sync-appicon: go.mod not found above", wd)
			os.Exit(1)
		}
		root = next
	}
	src := filepath.Join(root, "embed", "qrypt.png")
	dst := filepath.Join(root, "build", "appicon.png")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	in, err := os.Open(src)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
