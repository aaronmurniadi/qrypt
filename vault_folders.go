package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

func validateVaultPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.Trim(p, "/")
	if p == "" {
		return "", errors.New("empty path")
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", errors.New("invalid path segment")
		}
	}
	return p, nil
}

func normalizeFolderPrefix(folder string) (string, error) {
	folder = strings.TrimSpace(folder)
	folder = strings.ReplaceAll(folder, "\\", "/")
	folder = strings.Trim(folder, "/")
	if folder == "" {
		return "", nil
	}
	return validateVaultPath(folder)
}

func vaultJoinFolderAndBaseName(folder, baseName string) (string, error) {
	baseName = strings.TrimSpace(filepath.Base(baseName))
	if baseName == "" || baseName == "." || baseName == ".." {
		return "", errors.New("invalid file name")
	}
	if strings.Contains(baseName, "/") || strings.Contains(baseName, "\\") {
		return "", errors.New("invalid file name")
	}
	if folder == "" {
		return validateVaultPath(baseName)
	}
	f, err := normalizeFolderPrefix(folder)
	if err != nil {
		return "", err
	}
	return validateVaultPath(f + "/" + baseName)
}

func pathConflict(files []vaultFileRecord, newPath string, isDir bool) error {
	for _, e := range files {
		if e.Path == newPath {
			return fmt.Errorf("%q already exists", newPath)
		}
		if strings.HasPrefix(e.Path, newPath+"/") {
			return fmt.Errorf("%q conflicts with existing path %q", newPath, e.Path)
		}
		if strings.HasPrefix(newPath, e.Path+"/") && !e.IsDir {
			return fmt.Errorf("%q cannot be placed under file %q", newPath, e.Path)
		}
	}
	if isDir {
		return nil
	}
	for _, e := range files {
		if e.IsDir {
			continue
		}
		if strings.HasPrefix(newPath, e.Path+"/") {
			return fmt.Errorf("%q cannot be placed under file %q", newPath, e.Path)
		}
	}
	return nil
}

func pathConflictMove(files []vaultFileRecord, oldPath, newPath string, isDir bool) error {
	for _, e := range files {
		if e.Path == oldPath {
			continue
		}
		if e.Path == newPath {
			return fmt.Errorf("%q already exists", newPath)
		}
		if strings.HasPrefix(e.Path, newPath+"/") {
			return fmt.Errorf("%q conflicts with existing path %q", newPath, e.Path)
		}
		if strings.HasPrefix(newPath, e.Path+"/") && !e.IsDir {
			return fmt.Errorf("%q cannot be placed under file %q", newPath, e.Path)
		}
	}
	if isDir {
		return nil
	}
	for _, e := range files {
		if e.Path == oldPath || e.IsDir {
			continue
		}
		if strings.HasPrefix(newPath, e.Path+"/") {
			return fmt.Errorf("%q cannot be placed under file %q", newPath, e.Path)
		}
	}
	return nil
}

type catalogRecordJSON struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Mime      string `json:"mime"`
	PlainSize int64  `json:"plainSize"`
	Offset    int64  `json:"offset"`
	IsDir     bool   `json:"isDir"`
}

func catalogFromJSON(plain []byte) ([]vaultFileRecord, error) {
	if len(plain) == 0 {
		return nil, nil
	}
	var rows []catalogRecordJSON
	if err := json.Unmarshal(plain, &rows); err != nil {
		return nil, err
	}
	out := make([]vaultFileRecord, 0, len(rows))
	for _, r := range rows {
		p := r.Path
		if p == "" {
			p = r.Name
		}
		if p == "" {
			continue
		}
		out = append(out, vaultFileRecord{
			Path:      p,
			Mime:      r.Mime,
			PlainSize: r.PlainSize,
			Offset:    r.Offset,
			IsDir:     r.IsDir,
		})
	}
	return out, nil
}
