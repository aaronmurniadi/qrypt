package backend

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/rs/zerolog/log"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// DecryptedFile is the payload returned by GetDecryptedFileBase64.
type DecryptedFile struct {
	// Base64-encoded plaintext bytes.
	Data string `json:"data"`
	// MIME type, e.g. "image/png" or "text/plain; charset=utf-8".
	Mime string `json:"mime"`
}

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	log.Info().Msg("QrypT backend service started")
}

func (a *App) PickNewVaultPath() (string, error) {
	return wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Create secure vault",
		DefaultFilename: "vault.qrypt",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "QrypT vault", Pattern: "*.qrypt;*"},
		},
	})
}

func (a *App) FinalizeNewVault(path, password, algorithm string) error {
	log.Info().Str("path", path).Str("algorithm", algorithm).Msg("Creating new vault")
	if path == "" {
		return errors.New("no path selected")
	}
	if password == "" {
		return errors.New("password required")
	}
	if algorithm == "" {
		algorithm = "aes"
	}
	err := createVault(path, password, algorithm)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create vault")
	} else {
		log.Info().Msg("Vault created successfully")
	}
	return err
}

func (a *App) PickExistingVaultPath() (string, error) {
	return wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Open secure vault",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "QrypT vault", Pattern: "*.qrypt;*"},
		},
	})
}

func (a *App) UnlockVaultAtPath(path, password string) error {
	log.Info().Str("path", path).Msg("Unlocking vault")
	if path == "" {
		return errors.New("no path selected")
	}
	if password == "" {
		return errors.New("password required")
	}
	err := openVaultWithPassword(path, password)
	if err != nil {
		log.Error().Err(err).Msg("Failed to unlock vault")
	} else {
		log.Info().Msg("Vault unlocked successfully")
	}
	return err
}

func (a *App) LockVault() {
	log.Info().Msg("Locking vault")
	lockVault()
}

func (a *App) VaultUnlocked() bool {
	return vaultUnlocked()
}

func (a *App) DecryptURLForVaultPath(path string) (string, error) {
	return issueDecryptURL(path)
}

// GetDecryptedFileBase64 decrypts the vault entry at path fully in-memory and
// returns the plaintext encoded as base64 together with the detected MIME type.
// The frontend uses this to build data: URIs or Blob URLs without hitting the
// local HTTP decrypt server, which is inaccessible from an external browser.
func (a *App) GetDecryptedFileBase64(path string) (DecryptedFile, error) {
	raw, mime, err := decryptFileBytes(path)
	if err != nil {
		log.Error().Err(err).Str("path", path).Msg("GetDecryptedFileBase64 failed")
		return DecryptedFile{}, err
	}
	return DecryptedFile{
		Data: base64.StdEncoding.EncodeToString(raw),
		Mime: mime,
	}, nil
}

func (a *App) ListVaultFiles() ([]VaultFileEntry, error) {
	return listVaultFiles()
}

func (a *App) AddFileToVault(folder string) error {
	// Do not set Filters on macOS: Wails maps patterns to extensions; "*" is invalid and greys out all files.
	path, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Add file to vault",
	})
	if err != nil {
		return err
	}
	if path == "" {
		return errors.New("cancelled")
	}
	return addFileToVault(path, folder)
}

func (a *App) AddFileFromUrlToVault(urlStr, folder string) error {
	tmpPath, err := downloadToTemp(urlStr)
	if err != nil {
		return err
	}
	defer os.Remove(tmpPath)
	return a.AddFileFromPathToVault(tmpPath, folder)
}

func (a *App) AddFileFromPathToVault(srcPath, folder string) error {
	srcPath = strings.TrimSpace(srcPath)
	if srcPath == "" {
		return errors.New("empty path")
	}
	st, err := os.Stat(srcPath)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return errors.New("cannot add a folder; drop one or more files")
	}
	return addFileToVault(srcPath, folder)
}

func (a *App) CreateVaultFolder(path string) error {
	return createVaultFolder(path)
}

func (a *App) DeleteVaultPath(path string) error {
	return deleteVaultPath(path)
}

func (a *App) MoveVaultEntry(srcPath, destFolder string) error {
	return moveVaultEntry(srcPath, destFolder)
}

func (a *App) RenameVaultFile(srcPath, newBaseName string) error {
	return renameVaultFile(srcPath, newBaseName)
}

func (a *App) GetSystemTheme() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		// macOS: use defaults command to check appearance
		cmd := exec.Command("defaults", "read", "-g", "AppleInterfaceStyle")
		output, err := cmd.Output()
		if err != nil {
			// If command fails, assume light theme
			return "light", nil
		}
		style := strings.TrimSpace(string(output))
		if style == "Dark" {
			return "dark", nil
		}
		return "light", nil

	case "windows":
		// Windows: check registry via PowerShell
		cmd := exec.Command("powershell", "-Command",
			"Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'AppsUseLightTheme' | Select-Object -ExpandProperty AppsUseLightTheme")
		output, err := cmd.Output()
		if err != nil {
			return "light", nil
		}
		value := strings.TrimSpace(string(output))
		if value == "0" {
			return "dark", nil
		}
		return "light", nil

	case "linux":
		// Linux: check multiple possible sources
		// Try GNOME/GTK theme first
		if dconfCmd := exec.Command("dconf", "read", "/org/gnome/desktop/interface/gtk-theme"); dconfCmd != nil {
			if output, err := dconfCmd.Output(); err == nil {
				theme := strings.ToLower(strings.TrimSpace(string(output)))
				if strings.Contains(theme, "dark") || strings.Contains(theme, "noir") {
					return "dark", nil
				}
			}
		}

		// Try KDE theme
		if kdeCmd := exec.Command("kreadconfig5", "--group", "Colors:Window", "--key", "BackgroundNormal"); kdeCmd != nil {
			if output, err := kdeCmd.Output(); err == nil {
				color := strings.TrimSpace(string(output))
				if color != "" && color != "255,255,255" {
					return "dark", nil
				}
			}
		}

		// Fallback: check environment variable
		if theme := os.Getenv("GTK_THEME"); theme != "" {
			if strings.Contains(strings.ToLower(theme), "dark") {
				return "dark", nil
			}
		}

		return "light", nil

	default:
		return "light", nil
	}
}
