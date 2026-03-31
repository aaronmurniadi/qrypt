# QRYPT

## Development

Run the app in development mode with hot reload:

```bash
wails dev
```

The frontend dev server runs on http://localhost:5173 with Vite's fast HMR.

## Building

### Current Platform
```bash
wails build
# or
./scripts/build.sh
```

### Cross-Platform Builds
```bash
# Build for all platforms
./scripts/build-all.sh

# Individual platforms
./scripts/build-windows.sh      # Windows AMD64
./scripts/build-linux.sh         # Linux AMD64
./scripts/build-macos-arm.sh     # macOS Apple Silicon
./scripts/build-macos-intel.sh   # macOS Intel
./scripts/build-macos-universal.sh  # macOS Universal Binary
```

Built applications will be in `build/bin/`

## shadcn/ui Components

This template includes pre-configured shadcn/ui components:
- Button
- Input
- Label
- Card

Add more components:
```bash
cd frontend
npx shadcn@latest add [component-name]
```

Browse components at [ui.shadcn.com](https://ui.shadcn.com/)

## Project Structure

```
.
├── app.tmpl.go              # Main application logic
├── main.tmpl.go             # Entry point
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main React component
│   │   ├── components/ui/   # shadcn/ui components
│   │   └── lib/utils.ts     # Utility functions
│   ├── vite.config.ts       # Vite configuration
│   └── package.json         # Frontend dependencies
└── scripts/                 # Build scripts
```
