package main

import (
	"embed"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"qrypt/backend"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed embed/qrypt.png
var qryptIcon []byte

var (
	// Build-time variables
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	app := backend.NewApp()

	appOptions := &options.App{
		AlwaysOnTop: backend.AlwaysOnTop,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
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
		Windows: &windows.Options{
			WebviewIsTransparent:              true,
			WindowIsTranslucent:               false,
			DisableFramelessWindowDecorations: false,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: false,
				HideTitle:                  false,
				HideTitleBar:               false,
				FullSizeContent:            true,
				UseToolbar:                 false,
			},
		},
		Bind: []interface{}{
			app,
		},
		LogLevel:  logger.INFO,
		OnStartup: app.Startup,
		Title:     "QrypT",
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
