package main

import (
	"embed"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"qrypt/backend"
)

//go:embed all:frontend/dist
var assets embed.FS

var (
	// Build-time variables
	version = "0.2.1"
	commit  = "none"
	date    = "unknown"
)

func main() {
	app := backend.NewApp()

	appOptions := &options.App{
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/decrypt" {
						backend.DecryptHandler(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
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
		Logger:    backend.NewWailsLogger(),
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
