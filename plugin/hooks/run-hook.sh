#!/usr/bin/env bash
# Hook runner for Entendi plugin
# Wraps Node.js hook scripts to avoid shell profile pollution
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SCRIPT_NAME="$1"
shift
exec node "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
