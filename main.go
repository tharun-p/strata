package main

import (
	"context"
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Strata — PostgreSQL Database Studio",
		Frameless: true,
		Width:     1480,
		Height:    940,
		MinWidth:  1100,
		MinHeight: 700,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHidden(),
			Appearance:           mac.DefaultAppearance,
			WebviewIsTransparent: true,
			// Translucent + transparent often paints black corner fill on macOS.
			// Native corner masking (mac_window_darwin.go) clips the window shape instead.
			WindowIsTranslucent: false,
		},
		OnStartup: app.startup,
		OnDomReady: func(ctx context.Context) {
			applyMacRoundedWindow(14)
		},
		OnShutdown: app.shutdown,
		OnBeforeClose: func(ctx context.Context) bool {
			if !app.preventWindowClose() {
				return false
			}
			runtime.EventsEmit(ctx, "strata:close-requested")
			return true
		},
		Bind: []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
