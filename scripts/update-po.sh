#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Regenerate po/<gettext-domain>.pot from the sources and merge it into every translation.
# A run without source changes leaves po/ byte-identical.
set -euo pipefail
cd "$(dirname "$0")/.."

domain=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["gettext-domain"])')
pot="po/$domain.pot"
fresh=$(mktemp)
trap 'rm -f "$fresh"' EXIT

find src -name '*.ts' | sort | xargs xgettext \
    --from-code=UTF-8 --language=JavaScript \
    --keyword=_ --keyword=ngettext:1,2 \
    --no-location --add-comments=Translators \
    --package-name="$domain" \
    --copyright-holder=Patricio \
    --msgid-bugs-address=patricioaumedes@gmail.com \
    --output="$fresh"

if ! grep -q '^msgid "[^"]' "$fresh"; then
    echo "error: no translatable strings found in src/" >&2
    exit 1
fi

# xgettext writes a placeholder header meant to be edited by hand.
sed -i \
    -e 's/^# SOME DESCRIPTIVE TITLE\./# Translation template for '"$domain"'./' \
    -e 's/^# Copyright (C) YEAR /# Copyright (C) 2026 /' \
    -e '/^# FIRST AUTHOR/d' \
    -e '/^#, fuzzy$/d' \
    -e 's/^"Last-Translator: .*/"Last-Translator: Patricio <patricioaumedes@gmail.com>\\n"/' \
    -e 's/^"Language-Team: .*/"Language-Team: \\n"/' \
    -e 's/^"Plural-Forms: .*/"Plural-Forms: nplurals=2; plural=(n != 1);\\n"/' \
    "$fresh"

# Keep the old file when only the creation date differs, so the catalogues do not churn.
if [[ -e $pot ]] && diff -q <(grep -v '^"POT-Creation-Date:' "$pot") \
    <(grep -v '^"POT-Creation-Date:' "$fresh") >/dev/null; then
    :
else
    cp "$fresh" "$pot"
fi

for po in po/*.po; do
    [[ -e $po ]] || continue
    msgmerge --quiet --update --no-location --backup=none "$po" "$pot"
done

echo "Updated $pot"
