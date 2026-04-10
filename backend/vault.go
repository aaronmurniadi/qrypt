package backend

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

const (
	vaultMagic      = "QRYPTV01"
	formatV1AES     = uint32(3)
	headerSize      = 4096
	headerMetaOffV3 = 56
	gcmNonceSize    = 12
	gcmTagSize      = 16
	fileChunkPlain  = 256 * 1024
)

var errVaultLocked = errors.New("vault is locked")

type VaultFileEntry struct {
	Path      string `json:"path"`
	Mime      string `json:"mime"`
	PlainSize int64  `json:"plainSize"`
	IsDir     bool   `json:"isDir"`
}

type vaultFileRecord struct {
	Path      string `json:"path"`
	Mime      string `json:"mime,omitempty"`
	PlainSize int64  `json:"plainSize,omitempty"`
	Offset    int64  `json:"offset,omitempty"`
	IsDir     bool   `json:"isDir,omitempty"`
}

type vaultHeader struct {
	Format         uint32
	Salt           [32]byte
	ArgonTime      uint32
	ArgonMemoryKiB uint32
	ArgonThreads   uint32
	CatalogEncLen  uint64
	DataEndOffset  uint64
}

type vaultState struct {
	mu               sync.RWMutex
	path             string
	f                *os.File
	header           vaultHeader
	chunkKey         []byte
	pwdKey           []byte
	files            []vaultFileRecord
	decryptToken     string
	decryptVaultPath string
}

var globalVault vaultState

func parseHeader(buf []byte) (vaultHeader, error) {
	var h vaultHeader
	if len(buf) < headerSize {
		return h, errors.New("short header")
	}
	if string(buf[0:8]) != vaultMagic {
		return h, errors.New("invalid vault magic")
	}
	ver := binary.LittleEndian.Uint32(buf[8:12])
	if ver != formatV1AES {
		return h, fmt.Errorf("unsupported vault format %d (create a new vault with this app version)", ver)
	}
	h.Format = ver
	copy(h.Salt[:], buf[12:44])
	h.ArgonTime = binary.LittleEndian.Uint32(buf[44:48])
	h.ArgonMemoryKiB = binary.LittleEndian.Uint32(buf[48:52])
	h.ArgonThreads = binary.LittleEndian.Uint32(buf[52:56])
	if headerMetaOffV3+16 > len(buf) {
		return h, errors.New("invalid header layout")
	}
	h.CatalogEncLen = binary.LittleEndian.Uint64(buf[headerMetaOffV3 : headerMetaOffV3+8])
	h.DataEndOffset = binary.LittleEndian.Uint64(buf[headerMetaOffV3+8 : headerMetaOffV3+16])
	return h, nil
}

func (h *vaultHeader) marshal() []byte {
	buf := make([]byte, headerSize)
	copy(buf[0:8], []byte(vaultMagic))
	binary.LittleEndian.PutUint32(buf[8:12], h.Format)
	copy(buf[12:44], h.Salt[:])
	binary.LittleEndian.PutUint32(buf[44:48], h.ArgonTime)
	binary.LittleEndian.PutUint32(buf[48:52], h.ArgonMemoryKiB)
	binary.LittleEndian.PutUint32(buf[52:56], h.ArgonThreads)
	binary.LittleEndian.PutUint64(buf[headerMetaOffV3:headerMetaOffV3+8], h.CatalogEncLen)
	binary.LittleEndian.PutUint64(buf[headerMetaOffV3+8:headerMetaOffV3+16], h.DataEndOffset)
	return buf
}

// deriveKey runs Argon2id; memoryKiB is passed to argon2.IDKey in KiB (per golang.org/x/crypto/argon2).
func deriveKey(password string, salt []byte, time, memoryKiB, threads uint32) []byte {
	return argon2.IDKey([]byte(password), salt, time, memoryKiB, uint8(threads), 32)
}

func newAESGCM(key []byte) (cipher.AEAD, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

func aesGCMOpen(key, nonce, ciphertext []byte) ([]byte, error) {
	g, err := newAESGCM(key)
	if err != nil {
		return nil, err
	}
	if len(nonce) != g.NonceSize() {
		return nil, errors.New("bad nonce size")
	}
	return g.Open(nil, nonce, ciphertext, nil)
}

func aesGCMSeal(key, nonce, plaintext []byte) ([]byte, error) {
	g, err := newAESGCM(key)
	if err != nil {
		return nil, err
	}
	return g.Seal(nil, nonce, plaintext, nil), nil
}

func encryptCatalog(key, plain []byte) ([]byte, error) {
	nonce := make([]byte, gcmNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct, err := aesGCMSeal(key, nonce, plain)
	if err != nil {
		return nil, err
	}
	return append(nonce, ct...), nil
}

func decryptCatalog(key, blob []byte) ([]byte, error) {
	if len(blob) < gcmNonceSize+gcmTagSize {
		return nil, errors.New("short catalog blob")
	}
	nonce := blob[:gcmNonceSize]
	return aesGCMOpen(key, nonce, blob[gcmNonceSize:])
}

func sealFileChunk(aead cipher.AEAD, plain []byte) ([]byte, error) {
	nonce := make([]byte, gcmNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := aead.Seal(nil, nonce, plain, nil)
	out := make([]byte, gcmNonceSize+4+len(ct))
	copy(out[:gcmNonceSize], nonce)
	binary.BigEndian.PutUint32(out[gcmNonceSize:gcmNonceSize+4], uint32(len(ct)))
	copy(out[gcmNonceSize+4:], ct)
	return out, nil
}

func openVaultWithPassword(path, password string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f != nil {
		return errors.New("vault already open")
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	hdrBuf := make([]byte, headerSize)
	if _, err := io.ReadFull(f, hdrBuf); err != nil {
		f.Close()
		return err
	}
	h, err := parseHeader(hdrBuf)
	if err != nil {
		f.Close()
		return err
	}
	pwdK := deriveKey(password, h.Salt[:], h.ArgonTime, h.ArgonMemoryKiB, h.ArgonThreads)
	chunkK := append([]byte(nil), pwdK...)
	zero(pwdK)

	catStart := int64(headerSize)
	catBlob := make([]byte, h.CatalogEncLen)
	if _, err := f.ReadAt(catBlob, catStart); err != nil {
		zero(chunkK)
		f.Close()
		return err
	}
	plainCat, err := decryptCatalog(chunkK, catBlob)
	if err != nil {
		zero(chunkK)
		f.Close()
		return errors.New("catalog decrypt failed")
	}
	files, err := catalogFromJSON(plainCat)
	if err != nil {
		zero(chunkK)
		f.Close()
		return errors.New("invalid catalog")
	}

	globalVault.path = path
	globalVault.f = f
	globalVault.header = h
	globalVault.chunkKey = chunkK
	globalVault.files = files

	return nil
}

func createVault(path, password string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f != nil {
		return errors.New("close the open vault first")
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if err := prepareSparseVaultFile(f); err != nil {
		f.Close()
		return err
	}

	var salt [32]byte
	if _, err := rand.Read(salt[:]); err != nil {
		f.Close()
		return err
	}
	const argonTime = uint32(3)
	const argonMemKiB = uint32(64 * 1024)
	const argonThreads = uint32(4)
	pwdK := deriveKey(password, salt[:], argonTime, argonMemKiB, argonThreads)
	chunkK := append([]byte(nil), pwdK...)
	zero(pwdK)

	emptyJSON := []byte("[]")
	catBlob, err := encryptCatalog(chunkK, emptyJSON)
	if err != nil {
		zero(chunkK)
		f.Close()
		return err
	}
	catEncLen := uint64(len(catBlob))
	dataEnd := uint64(headerSize) + catEncLen

	h := vaultHeader{
		Format:         formatV1AES,
		Salt:           salt,
		ArgonTime:      argonTime,
		ArgonMemoryKiB: argonMemKiB,
		ArgonThreads:   argonThreads,
		CatalogEncLen:  catEncLen,
		DataEndOffset:  dataEnd,
	}
	hdrBytes := h.marshal()
	if _, err := f.WriteAt(hdrBytes, 0); err != nil {
		zero(chunkK)
		f.Close()
		return err
	}
	if _, err := f.WriteAt(catBlob, headerSize); err != nil {
		zero(chunkK)
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		zero(chunkK)
		f.Close()
		return err
	}

	globalVault.path = path
	globalVault.f = f
	globalVault.header = h
	globalVault.chunkKey = chunkK
	globalVault.files = nil

	return nil
}

func (v *vaultState) closeLocked() {
	zero(v.chunkKey)
	zero(v.pwdKey)
	v.chunkKey = nil
	v.pwdKey = nil
	v.files = nil
	if v.f != nil {
		_ = v.f.Close()
		v.f = nil
	}
	v.path = ""
	v.decryptToken = ""
	v.decryptVaultPath = ""
}

func lockVault() {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	globalVault.closeLocked()
}

func vaultUnlocked() bool {
	globalVault.mu.RLock()
	defer globalVault.mu.RUnlock()
	return globalVault.f != nil
}

func listVaultFiles() ([]VaultFileEntry, error) {
	globalVault.mu.RLock()
	defer globalVault.mu.RUnlock()
	if globalVault.f == nil {
		return nil, errVaultLocked
	}
	out := make([]VaultFileEntry, 0, len(globalVault.files))
	for _, r := range globalVault.files {
		out = append(out, VaultFileEntry{
			Path:      r.Path,
			Mime:      r.Mime,
			PlainSize: r.PlainSize,
			IsDir:     r.IsDir,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir && !out[j].IsDir
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}

func issueDecryptURL(p string) (string, error) {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return "", errVaultLocked
	}
	vp, err := validateVaultPath(p)
	if err != nil {
		return "", err
	}
	var rec *vaultFileRecord
	for i := range globalVault.files {
		if globalVault.files[i].Path == vp {
			rec = &globalVault.files[i]
			break
		}
	}
	if rec == nil {
		return "", errors.New("path not found")
	}
	if rec.IsDir {
		return "", errors.New("not a file")
	}
	var tokBytes [16]byte
	if _, err := rand.Read(tokBytes[:]); err != nil {
		return "", err
	}
	token := hex.EncodeToString(tokBytes[:])
	globalVault.decryptToken = token
	globalVault.decryptVaultPath = vp
	return "/decrypt?token=" + url.QueryEscape(token), nil
}

func addFileToVault(srcPath, folderPrefix string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return errVaultLocked
	}
	vaultPath, err := vaultJoinFolderAndBaseName(folderPrefix, srcPath)
	if err != nil {
		return err
	}
	if err := pathConflict(globalVault.files, vaultPath, false); err != nil {
		return err
	}
	in, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer in.Close()
	st, err := in.Stat()
	if err != nil {
		return err
	}
	plainSize := st.Size()
	if plainSize < 0 {
		return errors.New("negative file size")
	}

	detectedMime := mimeForVaultPath(vaultPath)
	if plainSize > 0 {
		buf512 := make([]byte, 512)
		n, err := in.Read(buf512)
		if err != nil && err != io.EOF {
			return err
		}
		dt := http.DetectContentType(buf512[:n])
		if dt != "application/octet-stream" && dt != "text/plain; charset=utf-8" {
			detectedMime = dt
		} else if detectedMime == "application/octet-stream" {
			detectedMime = dt
		}
		if _, serr := in.Seek(0, 0); serr != nil {
			return serr
		}
	}

	aead, err := newAESGCM(globalVault.chunkKey)
	if err != nil {
		return err
	}

	appendOff := int64(globalVault.header.DataEndOffset)
	var blob []byte
	var nChunks uint32
	if plainSize == 0 {
		// empty file: zero chunks
	} else {
		buf := make([]byte, fileChunkPlain)
		for {
			n, rerr := io.ReadFull(in, buf)
			if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
				if n == 0 {
					break
				}
				chunk, serr := sealFileChunk(aead, buf[:n])
				if serr != nil {
					return serr
				}
				blob = append(blob, chunk...)
				nChunks++
				break
			}
			if rerr != nil {
				return rerr
			}
			chunk, serr := sealFileChunk(aead, buf)
			if serr != nil {
				return serr
			}
			blob = append(blob, chunk...)
			nChunks++
		}
	}
	prefix := make([]byte, 4+len(blob))
	binary.BigEndian.PutUint32(prefix, nChunks)
	copy(prefix[4:], blob)

	if _, err := globalVault.f.WriteAt(prefix, appendOff); err != nil {
		return err
	}
	newEnd := uint64(appendOff) + uint64(len(prefix))
	globalVault.files = append(globalVault.files, vaultFileRecord{
		Path:      vaultPath,
		Mime:      detectedMime,
		PlainSize: plainSize,
		Offset:    appendOff,
	})
	globalVault.header.DataEndOffset = newEnd
	if err := persistCatalogLocked(); err != nil {
		return err
	}
	if err := writeHeaderLocked(); err != nil {
		return err
	}
	return globalVault.f.Sync()
}

func createVaultFolder(folderPath string) error {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return errVaultLocked
	}
	p, err := validateVaultPath(folderPath)
	if err != nil {
		return err
	}
	if err := pathConflict(globalVault.files, p, true); err != nil {
		return err
	}
	snap := append([]vaultFileRecord(nil), globalVault.files...)
	globalVault.files = append(globalVault.files, vaultFileRecord{Path: p, IsDir: true})
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

func persistCatalogLocked() error {
	oldLen := int64(globalVault.header.CatalogEncLen)
	dataStart := int64(headerSize) + oldLen
	fileTailLen := int64(globalVault.header.DataEndOffset) - dataStart
	if fileTailLen < 0 {
		return errors.New("corrupt vault size")
	}

	// Catalog ciphertext length changes when file entries change. File blobs on disk must sit
	// immediately after the catalog, so each byte of catalog growth shifts all blob offsets.
	// The JSON we store must list those post-shift offsets. Converge shift == len(blob)-oldLen.
	var finalBlob []byte
	shift := int64(0)
	converged := false
	for iter := 0; iter < 16; iter++ {
		recs := make([]vaultFileRecord, len(globalVault.files))
		for i, f := range globalVault.files {
			recs[i] = f
			if f.IsDir {
				recs[i].Offset = 0
			} else {
				recs[i].Offset = f.Offset + shift
			}
		}
		plain, err := json.Marshal(recs)
		if err != nil {
			return err
		}
		nb, err := encryptCatalog(globalVault.chunkKey, plain)
		if err != nil {
			return err
		}
		nextShift := int64(len(nb)) - oldLen
		if nextShift == shift {
			finalBlob = nb
			converged = true
			break
		}
		shift = nextShift
		finalBlob = nb
	}
	if !converged {
		return errors.New("catalog persist did not converge")
	}
	delta := int64(len(finalBlob)) - oldLen
	if delta != 0 && fileTailLen > 0 {
		if err := shiftFileRegion(globalVault.f, dataStart, dataStart+delta, fileTailLen); err != nil {
			return err
		}
	}
	if _, err := globalVault.f.WriteAt(finalBlob, headerSize); err != nil {
		return err
	}
	for i := range globalVault.files {
		if !globalVault.files[i].IsDir {
			globalVault.files[i].Offset += delta
		}
	}
	globalVault.header.CatalogEncLen = uint64(len(finalBlob))
	globalVault.header.DataEndOffset = uint64(int64(headerSize) + int64(len(finalBlob)) + fileTailLen)
	return nil
}

func shiftFileRegion(f *os.File, srcStart, dstStart, length int64) error {
	const block = 4 * 1024 * 1024
	buf := make([]byte, block)
	for length > 0 {
		step := length
		if step > int64(len(buf)) {
			step = int64(len(buf))
		}
		off := srcStart + length - step
		doff := dstStart + length - step
		slice := buf[:step]
		if _, err := f.ReadAt(slice, off); err != nil {
			return err
		}
		if _, err := f.WriteAt(slice, doff); err != nil {
			return err
		}
		length -= step
	}
	return nil
}

func writeHeaderLocked() error {
	b := globalVault.header.marshal()
	_, err := globalVault.f.WriteAt(b, 0)
	return err
}

func mimeForVaultPath(vaultPath string) string {
	base := vaultPath
	if i := strings.LastIndex(vaultPath, "/"); i >= 0 {
		base = vaultPath[i+1:]
	}
	return mimeForPath(base)
}

func mimeForPath(name string) string {
	// Use extension-based detection as primary method
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".ogg":
		return "video/ogg"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/x-msvideo"
	case ".mkv":
		return "video/x-matroska"
	case ".flv":
		return "video/x-flv"
	case ".wmv":
		return "video/x-ms-wmv"
	case ".m4v":
		return "video/mp4"
	case ".txt", ".md", ".json", ".csv", ".log":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}



func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func findVaultEntry(path string) (vaultFileRecord, bool) {
	globalVault.mu.RLock()
	defer globalVault.mu.RUnlock()
	for _, r := range globalVault.files {
		if r.Path == path {
			return r, true
		}
	}
	return vaultFileRecord{}, false
}

// decryptFileBytes decrypts a vault file fully in memory and returns the plaintext bytes.
// This is used by the Wails binding so the frontend can access file content without
// relying on the local HTTP decrypt server URL.
func decryptFileBytes(path string) ([]byte, string, error) {
	vp, err := validateVaultPath(path)
	if err != nil {
		return nil, "", err
	}

	globalVault.mu.RLock()
	if globalVault.f == nil {
		globalVault.mu.RUnlock()
		return nil, "", errVaultLocked
	}
	var rec *vaultFileRecord
	for i := range globalVault.files {
		if globalVault.files[i].Path == vp {
			rec = &globalVault.files[i]
			break
		}
	}
	if rec == nil {
		globalVault.mu.RUnlock()
		return nil, "", errors.New("path not found")
	}
	if rec.IsDir {
		globalVault.mu.RUnlock()
		return nil, "", errors.New("not a file")
	}
	f := globalVault.f
	key := append([]byte(nil), globalVault.chunkKey...)
	mime := rec.Mime
	if mime == "" {
		mime = mimeForVaultPath(rec.Path)
	}
	plainSize := rec.PlainSize
	offset := rec.Offset
	globalVault.mu.RUnlock()
	defer zero(key)

	block, err := newAESGCM(key)
	if err != nil {
		return nil, "", err
	}

	var hdr [4]byte
	if _, err := f.ReadAt(hdr[:], offset); err != nil {
		return nil, "", err
	}
	nChunks := binary.BigEndian.Uint32(hdr[:])
	off := offset + 4
	out := make([]byte, 0, plainSize)

	for range int(nChunks) {
		nonce := make([]byte, gcmNonceSize)
		if _, err := f.ReadAt(nonce, off); err != nil {
			return nil, "", err
		}
		off += gcmNonceSize
		var clenRaw [4]byte
		if _, err := f.ReadAt(clenRaw[:], off); err != nil {
			return nil, "", err
		}
		off += 4
		clen := int64(binary.BigEndian.Uint32(clenRaw[:]))
		ct := make([]byte, clen)
		if _, err := f.ReadAt(ct, off); err != nil {
			return nil, "", err
		}
		off += clen
		pt, err := block.Open(nil, nonce, ct, nil)
		if err != nil {
			return nil, "", err
		}
		out = append(out, pt...)
	}
	return out, mime, nil
}

func streamDecryptedFile(w http.ResponseWriter, r *http.Request, rec vaultFileRecord) error {
	if rec.IsDir {
		return errors.New("cannot decrypt a directory")
	}

	// Handle range requests for video streaming
	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		return streamDecryptedFileRange(w, r, rec, rangeHeader)
	}

	// Non-range request - stream entire file
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Length", strconv.FormatInt(rec.PlainSize, 10))

	globalVault.mu.RLock()
	f := globalVault.f
	key := append([]byte(nil), globalVault.chunkKey...)
	globalVault.mu.RUnlock()
	defer zero(key)

	block, err := newAESGCM(key)
	if err != nil {
		return err
	}
	var hdr [4]byte
	if _, err := f.ReadAt(hdr[:], rec.Offset); err != nil {
		return err
	}
	nChunks := binary.BigEndian.Uint32(hdr[:])
	off := rec.Offset + 4
	var written int64
	w.Header().Set("Cache-Control", "no-store")
	for range int(nChunks) {
		nonce := make([]byte, gcmNonceSize)
		if _, err := f.ReadAt(nonce, off); err != nil {
			return err
		}
		off += gcmNonceSize
		var clenRaw [4]byte
		if _, err := f.ReadAt(clenRaw[:], off); err != nil {
			return err
		}
		off += 4
		clen := int64(binary.BigEndian.Uint32(clenRaw[:]))
		ct := make([]byte, clen)
		if _, err := f.ReadAt(ct, off); err != nil {
			return err
		}
		off += clen
		pt, err := block.Open(nil, nonce, ct, nil)
		if err != nil {
			return err
		}
		nw, err := w.Write(pt)
		if err != nil {
			return err
		}
		written += int64(nw)
	}
	if written != rec.PlainSize && rec.PlainSize > 0 {
		return errors.New("size mismatch after decrypt")
	}
	return nil
}

func streamDecryptedFileRange(w http.ResponseWriter, r *http.Request, rec vaultFileRecord, rangeHeader string) error {
	// Parse range header: "bytes=start-end"
	ranges := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.Split(ranges, "-")
	if len(parts) != 2 {
		return errors.New("invalid range header")
	}

	var start int64
	var end int64
	var err error

	if parts[0] == "" {
		// Suffix byte range request (e.g. bytes=-500)
		suffix, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return errors.New("invalid range suffix")
		}
		start = rec.PlainSize - suffix
		if start < 0 {
			start = 0
		}
		end = rec.PlainSize - 1
	} else {
		start, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return errors.New("invalid range start")
		}
		if parts[1] == "" {
			end = rec.PlainSize - 1
		} else {
			end, err = strconv.ParseInt(parts[1], 10, 64)
			if err != nil {
				return errors.New("invalid range end")
			}
		}
	}

	if start < 0 || end >= rec.PlainSize || start > end {
		return errors.New("invalid range")
	}

	contentLength := end - start + 1

	// Set range response headers
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, rec.PlainSize))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", contentLength))
	w.Header().Set("Accept-Ranges", "bytes")
	w.WriteHeader(http.StatusPartialContent)

	// Only decrypt exactly the needed chunks
	globalVault.mu.RLock()
	f := globalVault.f
	key := append([]byte(nil), globalVault.chunkKey...)
	globalVault.mu.RUnlock()
	defer zero(key)

	block, err := newAESGCM(key)
	if err != nil {
		return err
	}
	var hdr [4]byte
	if _, err := f.ReadAt(hdr[:], rec.Offset); err != nil {
		return err
	}
	nChunks := binary.BigEndian.Uint32(hdr[:])
	off := rec.Offset + 4

	var currentPTInt64 int64 = 0

	for range int(nChunks) {
		nonceOff := off
		off += gcmNonceSize
		var clenRaw [4]byte
		if _, err := f.ReadAt(clenRaw[:], off); err != nil {
			return err
		}
		off += 4
		clen := int64(binary.BigEndian.Uint32(clenRaw[:]))
		ptLen := clen - gcmTagSize

		chunkStart := currentPTInt64
		chunkEnd := currentPTInt64 + ptLen - 1

		if chunkEnd < start || chunkStart > end {
			off += clen
			currentPTInt64 += ptLen
			continue
		}

		nonce := make([]byte, gcmNonceSize)
		if _, err := f.ReadAt(nonce, nonceOff); err != nil {
			return err
		}

		ct := make([]byte, clen)
		if _, err := f.ReadAt(ct, off); err != nil {
			return err
		}
		off += clen
		
		pt, err := block.Open(nil, nonce, ct, nil)
		if err != nil {
			return err
		}

		writeStart := start - chunkStart
		if writeStart < 0 {
			writeStart = 0
		}
		writeEnd := end - chunkStart
		if writeEnd >= int64(len(pt)) {
			writeEnd = int64(len(pt)) - 1
		}

		if writeStart <= writeEnd {
			if _, err := w.Write(pt[writeStart : writeEnd+1]); err != nil {
				return err
			}
		}

		currentPTInt64 += ptLen
	}

	return nil
}

// contentDispositionInline sets a suggested filename for Save dialogs while keeping inline display
// for img/video in the WebView (attachment would force download in some clients).
func contentDispositionInline(vaultPath string) string {
	base := filepath.Base(strings.ReplaceAll(vaultPath, "\\", "/"))
	if base == "" || base == "." {
		base = "file"
	}
	fallback := strings.Map(func(r rune) rune {
		if r >= 32 && r < 127 && r != '"' && r != '\\' {
			return r
		}
		return '_'
	}, base)
	if strings.Trim(fallback, "_") == "" {
		fallback = "file"
	}
	return fmt.Sprintf(`inline; filename="%s"; filename*=UTF-8''%s`, fallback, url.PathEscape(base))
}

func DecryptHandler(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}
	globalVault.mu.RLock()
	unlocked := globalVault.f != nil
	if !unlocked {
		globalVault.mu.RUnlock()
		http.Error(w, "locked", http.StatusServiceUnavailable)
		return
	}
	if globalVault.decryptToken == "" || token != globalVault.decryptToken {
		globalVault.mu.RUnlock()
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	vaultPath := globalVault.decryptVaultPath
	globalVault.mu.RUnlock()

	rec, ok := findVaultEntry(vaultPath)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if rec.IsDir {
		http.Error(w, "not a file", http.StatusBadRequest)
		return
	}

	detectedMime := rec.Mime
	if detectedMime == "" {
		detectedMime = mimeForVaultPath(rec.Path)
	}
	w.Header().Set("Content-Type", detectedMime)
	w.Header().Set("Content-Disposition", contentDispositionInline(rec.Path))
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if r.Method == http.MethodHead {
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Length", strconv.FormatInt(rec.PlainSize, 10))
		w.WriteHeader(http.StatusOK)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")

	if err := streamDecryptedFile(w, r, rec); err != nil {
		fmt.Printf("ERROR streaming file %s: %v\n", rec.Path, err)
		// Do not use http.Error here, because headers (like 206 Partial Content) 
		// and video bytes have already been sent over the wire.
		// Writing an error now will corrupt the HTTP Keep-Alive connection
		// and cause the browser's video player to permanently fail for this vault session.
	}
}
