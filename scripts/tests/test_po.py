# SPDX-License-Identifier: GPL-2.0-or-later
import json
import pathlib
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


if __name__ == "__main__":
    unittest.main()
