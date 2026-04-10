package backend

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
)

func downloadToTemp(urlStr string) (string, error) {
	resp, err := http.Get(urlStr)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	parsed, err := url.Parse(urlStr)
	if err != nil {
		return "", err
	}
	base := path.Base(parsed.Path)
	if base == "" || base == "/" || base == "." {
		base = "downloaded_file"
	}

	tmpFile, err := os.CreateTemp("", "*_"+base)
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		os.Remove(tmpFile.Name())
		return "", err
	}

	return tmpFile.Name(), nil
}
