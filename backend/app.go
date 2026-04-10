func (a *App) AddFileFromUrlToVault(urlStr, folder string) error {
	tmpPath, err := downloadToTemp(urlStr)
	if err != nil {
		return err
	}
	defer os.Remove(tmpPath)
	return a.AddFileFromPathToVault(tmpPath, folder)
}