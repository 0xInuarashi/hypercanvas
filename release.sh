#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Build a release and upload to the public releases repo.
#
# Usage:
#   ./release.sh              # auto-increments patch (v0.1.0 → v0.1.1)
#   ./release.sh v1.0.0       # explicit version
# ---------------------------------------------------------------------------

RELEASES_REPO="0xInuarashi/ambiguous-melon-4556-releases"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Determine version
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  LATEST=$(gh release view --repo "$RELEASES_REPO" --json tagName -q .tagName 2>/dev/null || echo "v0.0.0")
  MAJOR=$(echo "$LATEST" | sed 's/v//' | cut -d. -f1)
  MINOR=$(echo "$LATEST" | sed 's/v//' | cut -d. -f2)
  PATCH=$(echo "$LATEST" | sed 's/v//' | cut -d. -f3)
  VERSION="v${MAJOR}.${MINOR}.$((PATCH + 1))"
fi

echo "==> Building release ${VERSION}"

# Write VERSION file for builds to pick up
echo "$VERSION" > VERSION

# Build frontend + binary
echo "==> Building frontend..."
bun run build

echo "==> Compiling binary..."
bun run build:bin

# Package
TARBALL="hypercanvas-linux-x64.tar.gz"
echo "==> Packaging ${TARBALL}..."
tar -czf "$TARBALL" hypercanvas dist/ VERSION

SIZE=$(du -h "$TARBALL" | cut -f1)
echo "==> Tarball: ${TARBALL} (${SIZE})"

# Upload
echo "==> Creating release ${VERSION} on ${RELEASES_REPO}..."
gh release create "$VERSION" "$TARBALL" \
  --repo "$RELEASES_REPO" \
  --title "Hypercanvas ${VERSION}" \
  --notes "$(cat <<EOF
**Hypercanvas ${VERSION}**

- Binary: \`hypercanvas\` (Linux x64, standalone — no runtime needed)
- Frontend: \`dist/\` (pre-built)

\`\`\`bash
tar -xzf ${TARBALL}
./hypercanvas
\`\`\`
EOF
)"

# Cleanup
rm -f "$TARBALL" hypercanvas VERSION
echo "==> Done! Release ${VERSION} published to ${RELEASES_REPO}"
