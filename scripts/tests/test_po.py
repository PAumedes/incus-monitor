# SPDX-License-Identifier: GPL-2.0-or-later
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

NBSP = "\u00a0"

# Strings that core/format.ts passes through an injected translate function. Unit templates keep
# a no-break space in the msgid, as GLib's own size strings do, so translators see and keep it.
INJECTED_MSGIDS = [
    f"{{value}}{NBSP}MB",
    f"{{value}}{NBSP}kB/s",
    "< 1 min",
    "{hours} h {minutes} min",
]

# Every user-visible msgid of core/presenter.ts. They must be literal `_('...')` calls, or
# xgettext cannot see them.
PRESENTER_MSGIDS = [
    "{used} of {total}",
    "{name}, {status}",
    "{name}, {project}, {status}",
    "Incus, {count} running",
    "Incus",
    "No instances",
    "No running instances",
    "Incus is not installed",
    "Add your user to the \u201cincus\u201d group, then log in again",
    "Incus is not responding",
    "Incus 6.0 or later is required",
    "Running",
    "Frozen",
    "Stopped",
    "Busy",
    "Error",
    "Unknown",
    "Start",
    "Stop",
    "Restart",
    "Freeze",
    "Unfreeze",
    "Open Shell",
    "Open Console",
    "This action is not available for this instance",
    "Could not confirm the result. Check the instance state.",
    "The action failed",
    "Could not start {name}",
    "Could not stop {name}",
    "Could not restart {name}",
    "Could not freeze {name}",
    "Could not unfreeze {name}",
    "Instance not running",
    "{count} instances not running",
]

# Templates whose placeholders translators must keep: the entry needs a Translators: comment.
PLACEHOLDER_MSGIDS = [m for m in PRESENTER_MSGIDS if "{" in m]


@unittest.skipUnless(shutil.which("xgettext"), "xgettext is not installed")
class UpdatePoTest(unittest.TestCase):
    def test_template_contains_the_msgids_translated_through_the_injected_function(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            for name in ("src", "po", "data", "scripts"):
                shutil.copytree(ROOT / name, work / name, ignore=shutil.ignore_patterns("__pycache__"))
            subprocess.run(["bash", "scripts/update-po.sh"], cwd=work, check=True, capture_output=True)

            domain = json.loads((work / "data/metadata.json").read_text())["gettext-domain"]
            pot = work / "po" / f"{domain}.pot"
            self.assertTrue(pot.exists())
            content = pot.read_text()
            for msgid in INJECTED_MSGIDS:
                with self.subTest(msgid=msgid):
                    self.assertIn(f'msgid "{msgid}"', content)

    def test_template_contains_the_presenter_msgids_and_explains_their_placeholders(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            for name in ("src", "po", "data", "scripts"):
                shutil.copytree(ROOT / name, work / name, ignore=shutil.ignore_patterns("__pycache__"))
            subprocess.run(["bash", "scripts/update-po.sh"], cwd=work, check=True, capture_output=True)

            domain = json.loads((work / "data/metadata.json").read_text())["gettext-domain"]
            content = (work / "po" / f"{domain}.pot").read_text()
            entries = {}
            for block in content.split("\n\n"):
                msgid = ""
                in_msgid = False
                for line in block.splitlines():
                    if line.startswith("msgid "):
                        in_msgid = True
                    elif not line.startswith('"'):
                        in_msgid = False
                    if in_msgid:
                        msgid += line.split('"', 1)[1].rsplit('"', 1)[0]
                if msgid:
                    entries[msgid.replace('\\"', '"')] = block
            for msgid in PRESENTER_MSGIDS:
                with self.subTest(msgid=msgid):
                    self.assertIn(msgid, entries)
            for msgid in PLACEHOLDER_MSGIDS:
                with self.subTest(msgid=msgid, check="Translators comment"):
                    self.assertIn("#. Translators:", entries.get(msgid, ""))


def parse_po(text):
    """Entries as dicts: msgid, plural (or None), strs (list), fuzzy. The header (empty msgid) is included."""
    entries = []
    for block in re.split(r"\n\n+", text.strip()):
        entry = {"msgid": "", "plural": None, "strs": {}, "fuzzy": False}
        field = None
        for line in block.splitlines():
            if line.startswith("#,") and "fuzzy" in line:
                entry["fuzzy"] = True
                continue
            if line.startswith("#"):
                continue
            match = re.match(r"(msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(.*)$", line)
            if match:
                field = ("plural" if match.group(1) == "msgid_plural" else "msgid") if not match.group(1).startswith("msgstr") else int(match.group(2) or 0)
                value = json.loads(match.group(3))
                if field == "msgid":
                    entry["msgid"] = value
                elif field == "plural":
                    entry["plural"] = value
                else:
                    entry["strs"][field] = value
            elif line.startswith('"') and field is not None:
                value = json.loads(line)
                if field == "msgid":
                    entry["msgid"] += value
                elif field == "plural":
                    entry["plural"] += value
                else:
                    entry["strs"][field] += value
        if "msgid" in entry and (entry["msgid"] or entry["strs"]):
            entries.append(entry)
    return entries


def placeholders(text):
    return set(re.findall(r"\{[a-z_]+\}", text))


@unittest.skipUnless(shutil.which("xgettext") and shutil.which("msgfmt"), "gettext tools are not installed")
class SpanishTranslationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.domain = json.loads((ROOT / "data/metadata.json").read_text())["gettext-domain"]
        cls.es_path = ROOT / "po/es.po"
        cls.tmp = tempfile.TemporaryDirectory()
        work = pathlib.Path(cls.tmp.name)
        for name in ("src", "po", "data", "scripts"):
            shutil.copytree(ROOT / name, work / name, ignore=shutil.ignore_patterns("__pycache__"))
        subprocess.run(["bash", "scripts/update-po.sh"], cwd=work, check=True, capture_output=True)
        cls.fresh = [e for e in parse_po((work / "po" / f"{cls.domain}.pot").read_text()) if e["msgid"]]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def es_entries(self):
        self.assertTrue(self.es_path.exists(), "po/es.po is missing")
        return {e["msgid"]: e for e in parse_po(self.es_path.read_text())}

    def test_linguas_lists_spanish(self):
        langs = [l.strip() for l in (ROOT / "po/LINGUAS").read_text().splitlines() if l.strip() and not l.startswith("#")]
        self.assertIn("es", langs)

    def test_spanish_header_declares_the_language_and_plural_forms(self):
        header = self.es_entries().get("", {}).get("strs", {}).get(0, "")
        self.assertRegex(header, r"(?m)^Language: es\s*$")
        self.assertRegex(header, r"(?m)^Plural-Forms: nplurals=\d+; plural=.+;$")
        self.assertRegex(header, r"(?m)^Content-Type: text/plain; charset=UTF-8$")

    def test_committed_template_is_in_sync_with_the_sources(self):
        committed = ROOT / "po" / f"{self.domain}.pot"
        self.assertTrue(committed.exists(), f"{committed.name} is not committed")
        ids = lambda entries: sorted((e["msgid"], e["plural"]) for e in entries if e["msgid"])
        self.assertEqual(ids(parse_po(committed.read_text())), ids(self.fresh))

    def test_every_template_msgid_is_translated_without_fuzzy_marks(self):
        es = self.es_entries()
        for entry in self.fresh:
            with self.subTest(msgid=entry["msgid"]):
                self.assertIn(entry["msgid"], es)
                translated = es[entry["msgid"]]
                self.assertFalse(translated["fuzzy"])
                forms = 2 if entry["plural"] is not None else 1
                self.assertEqual(sorted(translated["strs"]), list(range(forms)))
                for index, text in translated["strs"].items():
                    self.assertNotEqual(text.strip(), "", f"msgstr[{index}] is empty")

    def test_es_po_has_no_obsolete_entries(self):
        obsolete = [l for l in self.es_path.read_text().splitlines() if l.startswith("#~")]
        self.assertEqual(obsolete, [])
        known = {e["msgid"] for e in self.fresh}
        extra = [m for m in self.es_entries() if m and m not in known]
        self.assertEqual(extra, [])

    def test_placeholders_match_the_msgid_in_every_form(self):
        es = self.es_entries()
        for entry in self.fresh:
            translated = es.get(entry["msgid"])
            for index, text in (translated or {"strs": {}})["strs"].items():
                source = entry["plural"] if index == 1 and entry["plural"] is not None else entry["msgid"]
                with self.subTest(msgid=entry["msgid"], form=index):
                    self.assertEqual(placeholders(text), placeholders(source))
            if translated is None:
                with self.subTest(msgid=entry["msgid"]):
                    self.fail("not translated")

    def test_unit_templates_keep_the_no_break_space(self):
        es = self.es_entries()
        units = [e for e in self.fresh if NBSP in e["msgid"]]
        self.assertGreaterEqual(len(units), 10)
        for entry in units:
            with self.subTest(msgid=entry["msgid"]):
                self.assertIn(NBSP, es.get(entry["msgid"], {"strs": {0: ""}})["strs"][0])

    def test_msgfmt_check_accepts_the_spanish_catalogue(self):
        self.assertTrue(self.es_path.exists(), "po/es.po is missing")
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["msgfmt", "--check", "--statistics", "--output-file", f"{tmp}/es.mo", str(self.es_path)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("fuzzy", result.stderr)
            self.assertNotIn("untranslated", result.stderr)


BOILERPLATE = [
    "SOME DESCRIPTIVE TITLE",
    "FIRST AUTHOR",
    "nplurals=INTEGER",
    "LL@li.org",
    "EMAIL@ADDRESS",
    "YEAR THE PACKAGE",
]


def copy_project(work):
    for name in ("src", "po", "data", "scripts"):
        shutil.copytree(ROOT / name, work / name, ignore=shutil.ignore_patterns("__pycache__"))


def run_update(work):
    subprocess.run(["bash", "scripts/update-po.sh"], cwd=work, check=True, capture_output=True)


def assert_clean_header(test, text, label):
    for marker in BOILERPLATE:
        test.assertNotIn(marker, text, f"{label} keeps xgettext boilerplate: {marker}")
    header = text.split('msgid ""', 1)[0]
    test.assertNotIn("#, fuzzy", header, f"{label} header is marked fuzzy")


@unittest.skipUnless(shutil.which("xgettext") and shutil.which("msgmerge"), "gettext tools are not installed")
class TemplateHygieneTest(unittest.TestCase):
    domain = json.loads((ROOT / "data/metadata.json").read_text())["gettext-domain"]

    def test_committed_template_header_is_not_xgettext_boilerplate(self):
        text = (ROOT / "po" / f"{self.domain}.pot").read_text()
        assert_clean_header(self, text, "committed pot")

    def test_generated_template_header_is_not_xgettext_boilerplate(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            copy_project(work)
            (work / "po" / f"{self.domain}.pot").unlink()
            run_update(work)
            assert_clean_header(self, (work / "po" / f"{self.domain}.pot").read_text(), "generated pot")

    def test_committed_catalogues_have_no_location_reference_lines(self):
        for path in (ROOT / "po").glob("*.po*"):
            with self.subTest(file=path.name):
                refs = [l for l in path.read_text().splitlines() if l.startswith("#: ")]
                self.assertEqual(refs, [])

    def test_generated_template_has_no_location_reference_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            copy_project(work)
            run_update(work)
            for path in (work / "po").glob("*.po*"):
                with self.subTest(file=path.name):
                    refs = [l for l in path.read_text().splitlines() if l.startswith("#: ")]
                    self.assertEqual(refs, [])

    def test_running_update_twice_without_source_changes_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            copy_project(work)
            run_update(work)
            # Age the creation date so a script that restamps it cannot hide inside one clock minute.
            for path in (work / "po").glob("*.po*"):
                text = path.read_text()
                path.write_text(re.sub(r'"POT-Creation-Date: [^\\]*', '"POT-Creation-Date: 2000-01-01 00:00+0000', text))
            first = {p.name: p.read_bytes() for p in (work / "po").iterdir()}
            run_update(work)
            second = {p.name: p.read_bytes() for p in (work / "po").iterdir()}
            self.assertEqual(first, second)

    def test_update_on_the_committed_tree_leaves_the_catalogues_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            copy_project(work)
            before = {p.name: p.read_bytes() for p in (work / "po").iterdir()}
            run_update(work)
            after = {p.name: p.read_bytes() for p in (work / "po").iterdir()}
            self.assertEqual(before, after)


@unittest.skipUnless(shutil.which("msgfmt"), "msgfmt is not installed")
class LocaleBuildTest(unittest.TestCase):
    def test_every_linguas_entry_compiles_to_a_non_empty_mo(self):
        domain = json.loads((ROOT / "data/metadata.json").read_text())["gettext-domain"]
        langs = [l.strip() for l in (ROOT / "po/LINGUAS").read_text().splitlines() if l.strip() and not l.startswith("#")]
        self.assertTrue(langs)
        with tempfile.TemporaryDirectory() as tmp:
            for lang in langs:
                with self.subTest(lang=lang):
                    out = pathlib.Path(tmp) / lang / f"{domain}.mo"
                    out.parent.mkdir()
                    result = subprocess.run(
                        ["msgfmt", "--check", "-o", str(out), str(ROOT / "po" / f"{lang}.po")],
                        capture_output=True,
                        text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertGreater(out.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
