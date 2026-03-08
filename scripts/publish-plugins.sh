#!/usr/bin/env bash
# Build, sign, zip, and publish all Grafana plugins as GitHub releases.
# Idempotent: skips any plugin version that already has a GitHub release tag.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLUGINS=(
  "heatmap-panel"
  "timeseries-selection-panel"
  "heatmap-app"
  "slo-app"
)

# Validate required environment variables
if [[ -z "${GRAFANA_ACCESS_POLICY_TOKEN:-}" ]]; then
  echo "Error: GRAFANA_ACCESS_POLICY_TOKEN is not set. Cannot sign Grafana plugins." >&2
  exit 1
fi

if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "Error: GITHUB_REPOSITORY is not set." >&2
  exit 1
fi

# Build all plugins
echo "Building all plugins..."
npm run build --prefix "$ROOT_DIR"

for PLUGIN in "${PLUGINS[@]}"; do
  PLUGIN_DIR="$ROOT_DIR/plugins/$PLUGIN"
  echo ""
  echo "==> Processing $PLUGIN..."

  # Read plugin ID from the built dist/plugin.json
  PLUGIN_ID=$(node -e "process.stdout.write(require('${PLUGIN_DIR}/dist/plugin.json').id)")

  # Read version from package.json (updated by changeset version)
  VERSION=$(node -e "process.stdout.write(require('${PLUGIN_DIR}/package.json').version)")

  TAG="${PLUGIN_ID}-v${VERSION}"

  # Skip if this release already exists (idempotent)
  if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" &>/dev/null; then
    echo "    Release $TAG already exists — skipping."
    continue
  fi

  # Sign the plugin dist folder and surface actionable conflict errors.
  echo "    Signing plugin..."
  set +e
  SIGN_OUTPUT=$(cd "$PLUGIN_DIR" && GRAFANA_ACCESS_POLICY_TOKEN="$GRAFANA_ACCESS_POLICY_TOKEN" npm run sign 2>&1)
  SIGN_EXIT=$?
  set -e
  printf '%s\n' "$SIGN_OUTPUT"
  if [[ $SIGN_EXIT -ne 0 ]]; then
    if [[ "$SIGN_OUTPUT" == *"status code 409"* ]]; then
      echo "    Error: signing conflict for ${PLUGIN_ID} v${VERSION} (HTTP 409)." >&2
      echo "    Fix: bump the plugin version and verify plugin ID ownership in Grafana Cloud." >&2
    fi
    exit $SIGN_EXIT
  fi

  # Package: rename dist → plugin-id, zip, restore
  echo "    Creating zip archive ${PLUGIN_ID}-${VERSION}.zip..."
  cd "$PLUGIN_DIR"
  cp -r dist "$PLUGIN_ID"
  zip -r "${PLUGIN_ID}-${VERSION}.zip" "$PLUGIN_ID"
  rm -rf "$PLUGIN_ID"
  cd "$ROOT_DIR"

  # Extract release notes for this version from CHANGELOG.md
  NOTES=""
  if [[ -f "$PLUGIN_DIR/CHANGELOG.md" ]]; then
    NOTES=$(awk \
      "/^## ${VERSION}[[:space:]]*$/{found=1; next} found && /^## /{exit} found{print}" \
      "$PLUGIN_DIR/CHANGELOG.md" \
      | sed '/^[[:space:]]*$/d' \
      || true)
  fi
  if [[ -z "$NOTES" ]]; then
    NOTES="Release ${PLUGIN_ID} v${VERSION}"
  fi

  # Create the GitHub release and attach the zip
  echo "    Creating GitHub release $TAG..."
  gh release create "$TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --title "${PLUGIN_ID} v${VERSION}" \
    --notes "$NOTES" \
    "$PLUGIN_DIR/${PLUGIN_ID}-${VERSION}.zip"

  # Clean up the zip from the plugin directory
  rm -f "$PLUGIN_DIR/${PLUGIN_ID}-${VERSION}.zip"

  echo "    Released $TAG"
done

echo ""
echo "All plugins processed."
