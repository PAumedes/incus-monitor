#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Compile and run the GJS integration tests (adapters against a fake Incus socket).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/ui.sh

ui_step "GJS integration tests"
rm -rf build/gjs
npx tsc -p tsconfig.gjs.json
exec gjs -m build/gjs/tests/gjs/run.js
