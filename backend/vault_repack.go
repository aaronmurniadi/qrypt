package backend

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const maxRepackWireBytes = 256 << 20

func encryptedBlobWireSize(f *os.File, off int64) (int64, error) {
	var hdr [4]byte
	if _, err := f.ReadAt(hdr[:], off); err != nil {
		return 0, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > 1<<20 {
		return 0, errors.New("corrupt vault: too many chunks")
	}
	pos := off + 4
	var total int64 = 4
	for range int(n) {
		pos += gcmNonceSize
		var clenRaw [4]byte
		if _, err := f.ReadAt(clenRaw[:], pos); err != nil {
			return 0, err
		}
		pos += 4
		clen := int64(binary.BigEndian.Uint32(clenRaw[:]))
		if clen < 0 || clen > 1<<30 {
			return 0, errors.New("corrupt vault chunk")
		}
		pos += clen
		total += int64(gcmNonceSize) + 4 + clen
	}
	return total, nil
}

func repackVaultLocked() error {
	var dirs []vaultFileRecord
	var fileRecs []vaultFileRecord
	for _, e := range globalVault.files {
		if e.IsDir {
			dirs = append(dirs, e)
		} else {
			fileRecs = append(fileRecs, e)
		}
	}
	sort.Slice(fileRecs, func(i, j int) bool { return fileRecs[i].Offset < fileRecs[j].Offset })

	var wireSum int64
	rawByPath := make(map[string][]byte, len(fileRecs))
	for _, fr := range fileRecs {
		sz, err := encryptedBlobWireSize(globalVault.f, fr.Offset)
		if err != nil {
			return err
		}
		wireSum += sz
		if wireSum > maxRepackWireBytes {
			return errors.New("vault is too large to repack in memory")
		}
		buf := make([]byte, sz)
		if _, err := globalVault.f.ReadAt(buf, fr.Offset); err != nil {
			return err
		}
		rawByPath[fr.Path] = buf
	}

	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Path < dirs[j].Path })

	catOldLen := int64(globalVault.header.CatalogEncLen)
	catLenGuess := catOldLen
	var finalCat []byte
	var lastRecs []vaultFileRecord
	converged := false

	for iter := 0; iter < 32; iter++ {
		base := headerSize + catLenGuess
		recs := make([]vaultFileRecord, 0, len(dirs)+len(fileRecs))
		for _, d := range dirs {
			recs = append(recs, vaultFileRecord{Path: d.Path, IsDir: true})
		}
		sort.Slice(fileRecs, func(i, j int) bool { return fileRecs[i].Path < fileRecs[j].Path })
		off := base
		for _, fr := range fileRecs {
			raw := rawByPath[fr.Path]
			recs = append(recs, vaultFileRecord{
				Path:      fr.Path,
				Mime:      fr.Mime,
				PlainSize: fr.PlainSize,
				Offset:    off,
				IsDir:     false,
			})
			off += int64(len(raw))
		}
		plain, err := json.Marshal(recs)
		if err != nil {
			return err
		}
		enc, err := encryptCatalog(globalVault.chunkKey, plain)
		if err != nil {
			return err
		}
		newLen := int64(len(enc))
		if newLen == catLenGuess && iter > 0 {
			finalCat = enc
			lastRecs = recs
			converged = true
			break
		}
		catLenGuess = newLen
		finalCat = enc
		lastRecs = recs
	}
	if !converged || finalCat == nil || len(lastRecs) == 0 && len(dirs)+len(fileRecs) > 0 {
		if len(dirs)+len(fileRecs) == 0 {
			empty := []byte("[]")
			enc, err := encryptCatalog(globalVault.chunkKey, empty)
			if err != nil {
				return err
			}
			if _, err := globalVault.f.WriteAt(enc, headerSize); err != nil {
				return err
			}
			globalVault.files = nil
			globalVault.header.CatalogEncLen = uint64(len(enc))
			globalVault.header.DataEndOffset = uint64(headerSize) + uint64(len(enc))
			if err := globalVault.f.Truncate(int64(globalVault.header.DataEndOffset)); err != nil {
				return err
			}
			return nil
		}
		return errors.New("vault repack did not converge")
	}

	if len(dirs)+len(fileRecs) == 0 {
		enc, err := encryptCatalog(globalVault.chunkKey, []byte("[]"))
		if err != nil {
			return err
		}
		if _, err := globalVault.f.WriteAt(enc, headerSize); err != nil {
			return err
		}
		globalVault.files = nil
		globalVault.header.CatalogEncLen = uint64(len(enc))
		globalVault.header.DataEndOffset = uint64(headerSize) + uint64(len(enc))
		return globalVault.f.Truncate(int64(globalVault.header.DataEndOffset))
	}

	if _, err := globalVault.f.WriteAt(finalCat, headerSize); err != nil {
		return err
	}
	dataEnd := int64(headerSize) + int64(len(finalCat))
	for _, r := range lastRecs {
		if r.IsDir {
			continue
		}
		data := rawByPath[r.Path]
		if _, err := globalVault.f.WriteAt(data, r.Offset); err != nil {
			return err
		}
		end := r.Offset + int64(len(data))
		if end > dataEnd {
			dataEnd = end
		}
	}
	if err := globalVault.f.Truncate(dataEnd); err != nil {
		return err
	}
	globalVault.files = lastRecs
	globalVault.header.CatalogEncLen = uint64(len(finalCat))
	globalVault.header.DataEndOffset = uint64(dataEnd)
	return nil
}

func moveVaultEntry(srcPath, destFolder string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return errVaultLocked
	}
	sp, err := validateVaultPath(srcPath)
	if err != nil {
		return err
	}
	df, err := normalizeFolderPrefix(destFolder)
	if err != nil {
		return err
	}
	base := filepath.Base(strings.ReplaceAll(sp, "\\", "/"))
	np, err := vaultJoinFolderAndBaseName(df, base)
	if err != nil {
		return err
	}
	if sp == np {
		return nil
	}
	idx := -1
	for i, e := range globalVault.files {
		if e.Path == sp {
			idx = i
			break
		}
	}
	if idx < 0 {
		return errors.New("path not found")
	}
	if globalVault.files[idx].IsDir {
		return errors.New("moving folders is not supported")
	}
	if err := pathConflictMove(globalVault.files, sp, np, false); err != nil {
		return err
	}
	old := globalVault.files[idx].Path
	globalVault.files[idx].Path = np
	if err := persistCatalogLocked(); err != nil {
		globalVault.files[idx].Path = old
		return err
	}
	if err := writeHeaderLocked(); err != nil {
		globalVault.files[idx].Path = old
		return err
	}
	return globalVault.f.Sync()
}

func renameVaultFile(srcPath, newBaseName string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return errVaultLocked
	}
	sp, err := validateVaultPath(srcPath)
	if err != nil {
		return err
	}
	norm := strings.ReplaceAll(sp, "\\", "/")
	parent := ""
	if i := strings.LastIndex(norm, "/"); i >= 0 {
		parent = norm[:i]
	}
	df, err := normalizeFolderPrefix(parent)
	if err != nil {
		return err
	}
	np, err := vaultJoinFolderAndBaseName(df, newBaseName)
	if err != nil {
		return err
	}
	if sp == np {
		return nil
	}
	idx := -1
	for i, e := range globalVault.files {
		if e.Path == sp {
			idx = i
			break
		}
	}
	if idx < 0 {
		return errors.New("path not found")
	}
	if globalVault.files[idx].IsDir {
		return errors.New("renaming folders is not supported")
	}
	if err := pathConflictMove(globalVault.files, sp, np, false); err != nil {
		return err
	}
	old := globalVault.files[idx].Path
	globalVault.files[idx].Path = np
	if err := persistCatalogLocked(); err != nil {
		globalVault.files[idx].Path = old
		return err
	}
	if err := writeHeaderLocked(); err != nil {
		globalVault.files[idx].Path = old
		return err
	}
	return globalVault.f.Sync()
}

func deleteVaultPath(p string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return errVaultLocked
	}
	vp, err := validateVaultPath(p)
	if err != nil {
		return err
	}
	idx := -1
	for i, e := range globalVault.files {
		if e.Path == vp {
			idx = i
			break
		}
	}
	if idx < 0 {
		return errors.New("path not found")
	}
	rec := globalVault.files[idx]
	if rec.IsDir {
		for _, e := range globalVault.files {
			if e.Path == vp {
				continue
			}
			if strings.HasPrefix(e.Path, vp+"/") {
				return errors.New("folder is not empty")
			}
		}
	}
	snap := append([]vaultFileRecord(nil), globalVault.files...)
	globalVault.files = append(globalVault.files[:idx], globalVault.files[idx+1:]...)
	if rec.IsDir {
		if err := persistCatalogLocked(); err != nil {
			globalVault.files = snap
			return err
		}
		if err := writeHeaderLocked(); err != nil {
			globalVault.files = snap
			return err
		}
		return globalVault.f.Sync()
	}
	if err := repackVaultLocked(); err != nil {
		globalVault.files = snap
		return err
	}
	if err := writeHeaderLocked(); err != nil {
		return err
	}
	return globalVault.f.Sync()
}
