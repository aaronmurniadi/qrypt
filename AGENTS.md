# QrypT Agent Instructions

This repository is a Wails application (Go backend + React/Vite frontend).

## Agent CLI & Commands
- **Always prefix shell commands with `rtk`** (e.g., `rtk ls -la`, `rtk grep "pattern"`).
- Do this with ALL shell commands.
- If `rtk` is not found, install it using: `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh`

## Architecture & Boundaries
- **Backend**: Go code is located in `backend/`.
- **Frontend**: React application is in `frontend/`. Uses Vite, Tailwind CSS, and shadcn/ui.

## Development & Build Commands
- **Run Dev Server**: `wails dev` (starts both Go backend and Vite HMR server).
- **Build**: `wails build` or use the platform-specific scripts in `scripts/` (e.g., `./scripts/build-all.sh`).

## Frontend Workflow
- Always `cd frontend` before running npm commands.
- **Test**: `npm run test` (uses Vitest).
- **Lint**: `npm run lint`.
- **Add UI Components**: `cd frontend && npx shadcn@latest add [component-name]`.

## Backend Workflow
- **Test**: `go test ./...` from the root or `backend/` directory.

## Quirks & Notes
- Wails generates frontend bindings for Go methods in `frontend/wailsjs/`. Do not edit these generated files manually.
- The app uses in-memory decryption; be mindful of memory usage and avoid temporary disk writes when handling files in the backend.
