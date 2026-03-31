package backend

import (
	"context"
	"errors"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Create secure vault",
		DefaultFilename: "vault.qrypt",
		Filters: []runtime.FileFilter{
			{DisplayName: "Qrypt vault", Pattern: "*.qrypt;*"},
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
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open secure vault",
		Filters: []runtime.FileFilter{
			{DisplayName: "Qrypt vault", Pattern: "*.qrypt;*"},
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
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
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
