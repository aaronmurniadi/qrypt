package backend

import (
	"os"
	"strings"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func init() {
	// Configure zerolog with a pretty console writer for development
	log.Logger = zerolog.New(zerolog.ConsoleWriter{
		Out:        os.Stderr,
		TimeFormat: "15:04:05",
	}).With().Timestamp().Logger()
}

// WailsLogger wraps zerolog to satisfy the github.com/wailsapp/wails/v2/pkg/logger.Logger interface.
type WailsLogger struct {
	logger zerolog.Logger
}

func NewWailsLogger() *WailsLogger {
	return &WailsLogger{
		logger: log.With().Str("component", "wails").Logger(),
	}
}

func (l *WailsLogger) Print(message string)   { l.logger.Debug().Msg(message) }
func (l *WailsLogger) Trace(message string)   { l.logger.Trace().Msg(message) }
func (l *WailsLogger) Debug(message string)   { l.logger.Debug().Msg(message) }
func (l *WailsLogger) Info(message string)    { l.logger.Info().Msg(message) }
func (l *WailsLogger) Warning(message string) { l.logger.Warn().Msg(message) }
func (l *WailsLogger) Error(message string)   { l.logger.Error().Msg(message) }
func (l *WailsLogger) Fatal(message string)   { l.logger.Fatal().Msg(message) }

// LogFrontend allows the frontend to log using the backend's configured zerolog instance.
func (a *App) LogFrontend(level string, message string) {
	zl := log.With().Str("component", "frontend").Logger()
	switch strings.ToLower(level) {
	case "debug":
		zl.Debug().Msg(message)
	case "info":
		zl.Info().Msg(message)
	case "warn", "warning":
		zl.Warn().Msg(message)
	case "error":
		zl.Error().Msg(message)
	case "fatal":
		zl.Fatal().Msg(message)
	default:
		zl.Info().Msg(message)
	}
}
