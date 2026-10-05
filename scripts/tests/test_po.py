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

# Every user-visible msgid of core/presenter.ts. They must be literal `_('...')` calls, or
# xgettext cannot see them.
PRESENTER_MSGIDS = [
    "{used} of {total}",
    "{name}, {status}",
    "{name}, {project}, {status}",
    "Incus, {count} running",
    "Incus, {problem}",
    "Incus",
    "No instances",
    "No running instances",
    "Incus is not installed",
    'Add your user to the "incus" group, then log in again',
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


if __name__ == "__main__":
    unittest.main()
