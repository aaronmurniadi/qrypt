package main

import (
	"embed"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed embed/qrypt.png
var qryptIcon []byte

func main() {
	app := NewApp()

	appOptions := &options.App{
		AlwaysOnTop: AlwaysOnTop,
		AssetServer: &assetserver.Options{
			Assets: assets,
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method == http.MethodGet && r.URL.Path == "/qrypt.png" {
						w.Header().Set("Content-Type", "image/png")
						w.Header().Set("Cache-Control", "no-store")
						_, _ = w.Write(qryptIcon)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Linux: &linux.Options{
			Icon: qryptIcon,
		},
		Bind: []interface{}{
			app,
		},
		LogLevel: logger.INFO,
		OnStartup: app.startup,
		Title:     "Qrypt",
		Width:     960,
		Height:    640,
		MinWidth:  720,
		MinHeight: 480,
	}

	err := wails.Run(appOptions)

	if err != nil {
		println("Error:", err.Error())
	}
}
