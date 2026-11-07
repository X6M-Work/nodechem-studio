#!/usr/bin/env bash
# Build a source-only hand-off bundle. Never includes node_modules, dist, .git, runs or logs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version)")"
NAME="gaussian-node-studio-v${VERSION}"
OUT="${1:-$ROOT/release}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/gns-bundle.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$OUT" "$STAGE/$NAME"
for item in electron src test docs scripts .github package.json package-lock.json vite.config.js index.html README.md AGENTS.md HANDOFF.md .gitignore; do
  if [ -e "$ROOT/$item" ]; then
    cp -R "$ROOT/$item" "$STAGE/$NAME/"
  fi
done

# A deterministic, source-relative manifest makes the hand-off auditable.
(
  cd "$STAGE/$NAME"
  find . -type f ! -name 'BUNDLE-MANIFEST.txt' -print0 \
    | sort -z \
    | xargs -0 sha256sum > BUNDLE-MANIFEST.txt
)

tar -czf "$OUT/$NAME.tar.gz" -C "$STAGE" "$NAME"
sha256sum "$OUT/$NAME.tar.gz" | sed "s|  .*/|  |" > "$OUT/$NAME.tar.gz.sha256"

if command -v zip >/dev/null 2>&1; then
  (cd "$STAGE" && zip -qr "$OUT/$NAME.zip" "$NAME")
else
  python3 - "$STAGE" "$NAME" "$OUT" <<'PY'
import os, sys, zipfile
stage, name, out = sys.argv[1:4]
with zipfile.ZipFile(os.path.join(out, f"{name}.zip"), "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _dirs, files in os.walk(os.path.join(stage, name)):
        for file in sorted(files):
            full = os.path.join(root, file)
            zf.write(full, os.path.relpath(full, stage))
PY
fi
sha256sum "$OUT/$NAME.zip" | sed "s|  .*/|  |" > "$OUT/$NAME.zip.sha256"

echo "Bundle: $OUT/$NAME.tar.gz"
[ -f "$OUT/$NAME.zip" ] && echo "Zip:    $OUT/$NAME.zip"
echo "Files:  $(find "$STAGE/$NAME" -type f | wc -l)"
du -h "$OUT/$NAME.tar.gz" | awk '{print "Size:   " $1}'
