#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Compile TypeScript and assemble the installable extension tree in dist/.
# dist/ is the single source for every package format (zip, .deb, PPA).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/ui.sh

ui_step "Building dist/"
rm -rf dist
npx tsc -p tsconfig.json

# Reviewers read the shipped JavaScript: keep it formatted like the sources.
npx prettier --log-level warn --ignore-path /dev/null --write 'dist/**/*.js'

cp data/metadata.json data/stylesheet.css dist/
mkdir -p dist/schemas
cp data/schemas/*.gschema.xml dist/schemas/
glib-compile-schemas --strict --dry-run dist/schemas

domain=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["gettext-domain"])')
while read -r lang; do
    [[ -z $lang || $lang == \#* ]] && continue
    mkdir -p "dist/locale/$lang/LC_MESSAGES"
    msgfmt --check --output-file="dist/locale/$lang/LC_MESSAGES/$domain.mo" "po/$lang.po"
done <po/LINGUAS

ui_ok "Built dist/"
