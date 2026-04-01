package backend

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
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

func (a *App) FinalizeNewVault(path, password string) error {
	if path == "" {
		return errors.New("no path selected")
	}
	if password == "" {
		return errors.New("password required")
	}
	return createVault(path, password)
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
	if path == "" {
		return errors.New("no path selected")
	}
	if password == "" {
		return errors.New("password required")
	}
	return openVaultWithPassword(path, password)
}

func (a *App) LockVault() {
	lockVault()
}

func (a *App) VaultUnlocked() bool {
	return vaultUnlocked()
}

func (a *App) DecryptServerURL() (string, error) {
	return decryptServerURL()
}

func (a *App) DecryptURLForVaultPath(path string) (string, error) {
	return issueDecryptURL(path)
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
