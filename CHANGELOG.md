# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-04-10

### Changed
- **Security & Privacy**: Transitioned to in-memory file decryption via Wails IPC, removing the reliance on a local HTTP server for file previews.
- **UI/UX**: Refined the vault sidebar, file selection UI, and enhanced loading states/transitions for media previews.
- **Branding**: Updated app icon and branding throughout the application.

### Added
- **Features**: 
    - Added "Copy link" functionality to generate one-time download links for files.
    - Added image preview support in the vault.
- **Logging**: Implemented comprehensive logging system for both backend (using `zerolog`) and frontend.
- **Documentation**: Updated README with screenshots and detailed feature descriptions.

### Removed
- Removed legacy embedded assets (`embed/qrypt.png`).
