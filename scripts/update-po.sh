#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Regenerate po/incus-monitor.pot from the sources and merge it into every translation.
set -euo pipefail
cd "$(dirname "$0")/.."

domain=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["gettext-domain"])')
pot="po/$domain.pot"

rm -f "$pot"
find src -name '*.ts' | sort | xargs xgettext \
    --from-code=UTF-8 --language=JavaScript \
    --keyword=_ \
    --package-name="$domain" --add-comments=Translators \
    --output="$pot"

if [[ ! -s $pot ]]; then
    echo "error: no translatable strings found in src/" >&2
    exit 1
fi

for po in po/*.po; do
    [[ -e $po ]] || continue
    msgmerge --quiet --update --backup=none "$po" "$pot"
done

echo "Updated $pot"
