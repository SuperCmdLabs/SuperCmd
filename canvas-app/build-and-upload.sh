#!/bin/bash
#
# Build and upload the Excalidraw bundle to S3.
# Usage: ./canvas-app/build-and-upload.sh
#
# Prerequisites:
#   - Node.js installed
#   - AWS CLI configured (aws configure)
#   - S3_EXTENSIONS_BUCKET env var set, or defaults to supercmd-extensions
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
S3_BUCKET="${S3_EXTENSIONS_BUCKET:-supercmd-extensions}"

echo "==> Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

echo "==> Building Excalidraw bundle..."
npm run build

echo "==> Packaging tarball..."
npm run package

echo "==> Uploading to S3 (s3://$S3_BUCKET/canvas/excalidraw-bundle.tgz)..."
aws s3 cp "$SCRIPT_DIR/excalidraw-bundle.tgz" \
  "s3://$S3_BUCKET/canvas/excalidraw-bundle.tgz" \
  --cache-control "public, max-age=3600"

echo "==> Done! Bundle uploaded successfully."
