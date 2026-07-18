#!/usr/bin/env bash
set -euo pipefail

MAX_SIZE="10M"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$PROJECT_ROOT"

if [ ! -f bfg.jar ]; then
  echo "Downloading BFG Repo-Cleaner..."
  curl -L -o bfg.jar https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
fi

echo "Cleaning Git history for blobs larger than ${MAX_SIZE}..."
git fetch --all --prune
java -jar bfg.jar --strip-blobs-bigger-than "$MAX_SIZE"
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo "Cleanup complete. Push with --force if you are ready to overwrite remote history."
