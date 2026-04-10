#!/bin/bash
# Build script for Windows and macOS (Linux excluded - requires GTK dependencies)

VERSION=${1:-"1.0.0"}
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Building version $VERSION (commit: $COMMIT, date: $DATE)"
echo "================================"

# Build for Windows AMD64
echo "Building for Windows (amd64)..."
wails build -platform windows/amd64 -clean -ldflags "-X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE"

# Build for macOS ARM64 (Apple Silicon)
echo "Building for macOS (arm64)..."
wails build -platform darwin/arm64 -clean -ldflags "-X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE"

# Build for macOS AMD64 (Intel)
echo "Building for macOS (amd64)..."
wails build -platform darwin/amd64 -clean -ldflags "-X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$DATE"

echo "================================"
echo "Build complete! Check build/bin/ directory"
