package main

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
	"net"
	"net/http"
	"net/url"
	"sort"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

const (
	vaultMagic      = "QRYPTV01"
	formatV3AES     = uint32(3)
	headerSize      = 4096
	headerMetaOffV3 = 56
	gcmNonceSize   = 12
	gcmTagSize     = 16
	fileChunkPlain = 256 * 1024
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
	Format          uint32
	Salt            [32]byte
	ArgonTime       uint32
	ArgonMemoryKiB  uint32
	ArgonThreads    uint32
	CatalogEncLen   uint64
	DataEndOffset   uint64
}

type vaultState struct {
	mu               sync.RWMutex
	path             string
	f                *os.File
	header           vaultHeader
	chunkKey         []byte
	pwdKey           []byte
	files            []vaultFileRecord
	srv              *http.Server
	mediaBase        string
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
	if ver != formatV3AES {
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

	if err := startDecryptServer(); err != nil {
		globalVault.closeLocked()
		return err
	}
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
		Format:         formatV3AES,
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

	if err := startDecryptServer(); err != nil {
		globalVault.closeLocked()
		return err
	}
	return nil
}

func (v *vaultState) closeLocked() {
	zero(v.chunkKey)
	zero(v.pwdKey)
	v.chunkKey = nil
	v.pwdKey = nil
	v.files = nil
	v.mediaBase = ""
	if v.srv != nil {
		_ = v.srv.Close()
		v.srv = nil
	}
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

func decryptServerURL() (string, error) {
	globalVault.mu.RLock()
	defer globalVault.mu.RUnlock()
	if globalVault.mediaBase == "" {
		return "", errVaultLocked
	}
	return globalVault.mediaBase, nil
}

func issueDecryptURL(p string) (string, error) {
	globalVault.mu.Lock()
	defer globalVault.mu.Unlock()
	if globalVault.f == nil {
		return "", errVaultLocked
	}
	if globalVault.mediaBase == "" {
		return "", errors.New("decrypt server not started")
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
	return globalVault.mediaBase + "/decrypt?token=" + url.QueryEscape(token), nil
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
		Mime:      mimeForVaultPath(vaultPath),
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
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		if ext == ".jpg" {
			return "image/jpeg"
		}
		return "image/" + strings.TrimPrefix(ext, ".")
	case ".mp4", ".webm", ".ogg":
		if ext == ".ogg" {
			return "video/ogg"
		}
		return "video/" + strings.TrimPrefix(ext, ".")
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

func streamDecryptedFile(w http.ResponseWriter, r *http.Request, rec vaultFileRecord) error {
	if rec.IsDir {
		return errors.New("cannot decrypt a directory")
	}
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

func decryptHandler(w http.ResponseWriter, r *http.Request) {
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
	w.Header().Set("Content-Type", rec.Mime)
	w.Header().Set("Content-Disposition", contentDispositionInline(rec.Path))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if err := streamDecryptedFile(w, r, rec); err != nil {
		http.Error(w, "decrypt error", http.StatusInternalServerError)
	}
}

func startDecryptServer() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/decrypt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type")
			return
		}
		decryptHandler(w, r)
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: mux}
	globalVault.srv = srv
	go func() {
		_ = srv.Serve(ln)
	}()
	globalVault.mediaBase = "http://" + ln.Addr().String()
	return nil
}
