# SPDX-License-Identifier: GPL-2.0-or-later
"""The Makefile is the single entry point: its targets, help, docs and doctor are specified here."""

import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
MAKE = shutil.which("make") or "make"

SECTIONS = [
    "Test suite",
    "Build suite",
    "Release suite",
    "Run and verify",
    "Clean environments",
    "Housekeeping",
]

# Names that CI, the git hooks and .claude/settings.json call.
STABLE_TARGETS = [
    "ci", "check", "lint", "test", "test-gjs", "build", "zip", "format", "incus-ci",
    "incus-ci-all", "incus-package", "changelog-preview", "release", "smoke", "nested",
    "install",
]  # fmt: skip
NEW_TARGETS = ["test-all", "doctor", "shell-logs"]

HELP_VARIABLES = ["RELEASE", "SERIES", "SCHEME", "VM", "BUMP", "NEW_VERSION"]

EXPECTED_SECTION = {
    "test-all": "Test suite",
    "build": "Build suite",
    "release": "Release suite",
    "doctor": "Run and verify",
    "incus-ci": "Clean environments",
    "clean": "Housekeeping",
}

# `make release` commits and tags in the working repository, even when its output is only read.
DRY_RUN_SKIPPED = {"release"}

REQUIRED_TOOLS = ["node", "npm", "python3", "gjs", "zip", "gettext", "glib-compile-schemas"]
OPTIONAL_TOOLS = ["gnome-extensions", "lintian", "debsign", "dpkg-parsechangelog"]


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if k not in ("NO_COLOR", "CI", "MAKEFLAGS", "MFLAGS")}
    env.update(extra)
    return env


def run_make(*args, env=None):
    return subprocess.run(
        [MAKE, *args], cwd=ROOT, env=env or clean_env(), capture_output=True, text=True, timeout=60
    )


def parse_makefile():
    """Returns {target: (section, description)} for every .PHONY target, in file order."""
    targets = {}
    section = None
    phony = set()
    lines = (ROOT / "Makefile").read_text().splitlines()
    for line in lines:
        if line.startswith("##@ "):
            section = line[4:].strip()
        match = re.match(r"\.PHONY:\s*(.+)", line)
        if match:
            phony.update(match.group(1).split())
        match = re.match(r"([a-z0-9-]+):.*?(?:##\s*(.*))?$", line)
        if match and match.group(1) in phony:
            targets[match.group(1)] = (section, match.group(2))
    return targets


def help_targets(text):
    return re.findall(r"^  ([a-z0-9-]+)\s", text, re.M)


class MakefileStructure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.targets = parse_makefile()
        cls.text = (ROOT / "Makefile").read_text()

    def test_named_targets_keep_existing(self):
        for name in STABLE_TARGETS + NEW_TARGETS:
            with self.subTest(target=name):
                self.assertIn(name, self.targets)

    def test_every_phony_target_has_a_description(self):
        for name, (_, description) in self.targets.items():
            with self.subTest(target=name):
                self.assertTrue(description, f"{name} has no '## description'")

    def test_sections_are_the_documented_ones_in_order(self):
        sections = re.findall(r"^##@ (.+)$", self.text, re.M)
        self.assertEqual([s.strip() for s in sections], SECTIONS)

    def test_every_target_belongs_to_a_section(self):
        for name, (section, _) in self.targets.items():
            with self.subTest(target=name):
                self.assertIn(section, SECTIONS)

    def test_targets_sit_in_their_suite(self):
        for name, section in EXPECTED_SECTION.items():
            with self.subTest(target=name):
                self.assertEqual(self.targets.get(name, (None,))[0], section)

    def test_test_all_runs_check_and_test_gjs(self):
        result = run_make("-n", "test-all")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("test-gjs.sh", result.stdout)
        self.assertIn("unittest discover", result.stdout)

    def test_header_explains_the_suites(self):
        header = "\n".join(
            line
            for line in self.text.split(".DEFAULT_GOAL")[0].splitlines()
            if line.startswith("#") and not line.startswith("##@")
        ).lower()
        for word in ("test suite", "build suite", "release suite"):
            with self.subTest(word=word):
                self.assertIn(word, header)


class MakeHelp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.targets = parse_makefile()
        cls.help = run_make("help", env=clean_env(NO_COLOR="1"))

    def test_help_succeeds(self):
        self.assertEqual(self.help.returncode, 0, self.help.stderr)

    def test_help_lists_exactly_the_documented_targets(self):
        self.assertEqual(sorted(help_targets(self.help.stdout)), sorted(self.targets))

    def test_help_lists_each_target_with_its_description(self):
        for name, (_, description) in self.targets.items():
            with self.subTest(target=name):
                line = next(
                    (ln for ln in self.help.stdout.splitlines() if re.match(rf"  {name}\s", ln)), ""
                )
                self.assertIn(description, line)

    def test_help_shows_sections_in_order(self):
        positions = [self.help.stdout.find(section) for section in SECTIONS]
        self.assertNotIn(-1, positions)
        self.assertEqual(positions, sorted(positions))

    def test_help_opens_with_a_quick_start_of_three_make_commands(self):
        before_first_section = self.help.stdout.split(SECTIONS[0])[0]
        commands = [ln for ln in before_first_section.splitlines() if "make " in ln]
        self.assertGreaterEqual(len(commands), 3, before_first_section)

    def test_help_lists_the_variables(self):
        for variable in HELP_VARIABLES:
            with self.subTest(variable=variable):
                self.assertRegex(self.help.stdout, rf"\b{variable}\b")

    def test_help_is_plain_when_not_a_terminal(self):
        for label, env in [
            ("pipe", clean_env()),
            ("NO_COLOR", clean_env(NO_COLOR="1")),
            ("CI", clean_env(CI="1")),
        ]:
            with self.subTest(env=label):
                out = run_make("help", env=env).stdout
                self.assertNotIn("\x1b", out)
                self.assertTrue(out.isascii())


class MakeDryRun(unittest.TestCase):
    def test_every_target_runs_with_dry_run(self):
        for name in parse_makefile():
            if name in DRY_RUN_SKIPPED:
                continue
            with self.subTest(target=name):
                result = run_make("-n", name)
                self.assertEqual(result.returncode, 0, result.stderr)


def doc_files():
    files = [ROOT / "README.md", ROOT / "CONTRIBUTING.md"]
    files += sorted((ROOT / "docs").rglob("*.md"))
    files += sorted((ROOT / ".claude").rglob("*.md"))
    files += sorted((ROOT / ".githooks").glob("*"))
    files += sorted((ROOT / ".github" / "workflows").glob("*"))
    files += [
        p for p in sorted((ROOT / "scripts").rglob("*")) if p.suffix in (".sh", ".py")
        and "tests" not in p.relative_to(ROOT / "scripts").parts
    ]  # fmt: skip
    return [f for f in files if f.is_file()]


# `make` must start a command (line start, quote, `$`, `&&`, `;`, `|`, `run:`), so package lists
# such as `apt install make gjs` and prose such as "under make or" are not taken for commands.
COMMAND = re.compile(
    r"(?:^|[`'\"$(|;&]|\brun:|\bthen\b|\bdo\b|\bsudo\b)\s*make((?: +[a-z][a-z0-9-]*)+)(?=$|[\s`'\"|;&)<.,:])"
)


def mentioned_targets(path):
    """Yields (line number, target) for `make <target>` in code spans, code blocks and scripts."""
    in_fence = False
    markdown = path.suffix == ".md"
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if markdown:
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            spans = [line] if in_fence else re.findall(r"`([^`]*)`", line)
        else:
            if line.lstrip().startswith("#"):
                continue
            spans = [line]
        for span in spans:
            for match in COMMAND.finditer(span):
                for word in match.group(1).split():
                    yield number, word


class DocsDrift(unittest.TestCase):
    def test_every_make_target_mentioned_exists(self):
        known = set(parse_makefile())
        for path in doc_files():
            for number, word in mentioned_targets(path):
                with self.subTest(file=str(path.relative_to(ROOT)), line=number, target=word):
                    self.assertTrue(
                        word in known,
                        f"`make {word}` is not a Makefile target",
                    )

    def test_testing_doc_has_a_command_map_with_test_all(self):
        text = (ROOT / "docs" / "TESTING.md").read_text()
        section = re.search(r"^## Command map\n(.*?)(?=^## )", text, re.M | re.S)
        self.assertIsNotNone(section, "TESTING.md has no 'Command map' section")
        rows = [ln for ln in section.group(1).splitlines() if ln.startswith("|")]
        self.assertTrue(any("make test-all" in row for row in rows), rows)

    def test_releasing_doc_names_the_release_suite_targets(self):
        text = (ROOT / "docs" / "RELEASING.md").read_text()
        for target in ("changelog-preview", "release", "ppa-source"):
            with self.subTest(target=target):
                self.assertIn(f"make {target}", text)


class Doctor(unittest.TestCase):
    @staticmethod
    def snapshot():
        state = {}
        for base, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__")]
            for name in files:
                p = pathlib.Path(base, name)
                state[str(p)] = p.stat().st_mtime_ns
        return state

    @staticmethod
    def path_without(tool):
        """A directory of symlinks to every executable on PATH except `tool`."""
        directory = tempfile.mkdtemp()
        for entry in os.environ["PATH"].split(os.pathsep):
            if not os.path.isdir(entry):
                continue
            for name in os.listdir(entry):
                full = os.path.join(entry, name)
                link = os.path.join(directory, name)
                if name != tool and not os.path.lexists(link) and os.access(full, os.X_OK):
                    os.symlink(full, link)
        return directory

    def setUp(self):
        missing = [t for t in REQUIRED_TOOLS if shutil.which(t) is None]
        if missing:
            self.skipTest(f"host lacks required tools: {missing}")

    def test_doctor_exits_0_when_required_tools_are_present(self):
        result = run_make("doctor")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for tool in REQUIRED_TOOLS:
            with self.subTest(tool=tool):
                self.assertIn(tool, result.stdout + result.stderr)

    def test_doctor_exits_1_and_names_a_missing_required_tool(self):
        path = self.path_without("zip")
        self.addCleanup(shutil.rmtree, path, True)
        env = clean_env(PATH=path)
        direct = subprocess.run(
            ["bash", str(ROOT / "scripts" / "doctor.sh")],
            env=env,
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        direct_output = direct.stdout + direct.stderr
        self.assertEqual(direct.returncode, 1, direct_output)
        self.assertRegex(direct_output, r"\bzip\b")
        # GNU make reports a failed recipe as exit 2, so only non-zero is asserted.
        result = run_make("doctor", env=env)
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertRegex(output, r"\bzip\b")

    def test_doctor_prints_an_install_hint_for_the_missing_tool(self):
        path = self.path_without("zip")
        self.addCleanup(shutil.rmtree, path, True)
        output = run_make("doctor", env=clean_env(PATH=path))
        text = output.stdout + output.stderr
        self.assertTrue(
            any(re.search(r"apt(-get)? install\b.*\bzip\b", line) for line in text.splitlines()), text
        )

    def test_doctor_output_is_plain_on_a_pipe(self):
        for label, env in [("pipe", clean_env()), ("CI", clean_env(CI="1"))]:
            with self.subTest(env=label):
                result = run_make("doctor", env=env)
                text = result.stdout + result.stderr
                self.assertNotIn("\x1b", text)
                self.assertTrue(text.isascii())

    def test_doctor_treats_optional_tools_as_optional(self):
        for tool in OPTIONAL_TOOLS:
            with self.subTest(tool=tool):
                path = self.path_without(tool)
                self.addCleanup(shutil.rmtree, path, True)
                result = subprocess.run(
                    ["bash", str(ROOT / "scripts" / "doctor.sh")],
                    env=clean_env(PATH=path), cwd=ROOT, capture_output=True, text=True,
                )  # fmt: skip
                text = result.stdout + result.stderr
                self.assertEqual(result.returncode, 0, text)
                self.assertIn(tool, text)
                self.assertRegex(text, r"apt(-get)? install\b")

    def test_doctor_does_not_write_files(self):
        before = self.snapshot()
        run_make("doctor")
        self.assertEqual(self.snapshot(), before)


class BuildDebPrerequisites(unittest.TestCase):
    def test_missing_prerequisite_prints_a_single_error_line(self):
        """Runs a copy of the script in a scratch tree, so nothing in the repository is touched."""
        tree = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tree, True)
        shutil.copytree(ROOT / "scripts" / "lib", pathlib.Path(tree, "scripts", "lib"))
        shutil.copy(ROOT / "scripts" / "build-deb.sh", pathlib.Path(tree, "scripts"))
        pathlib.Path(tree, "dist").mkdir()
        pathlib.Path(tree, "dist", "metadata.json").write_text("{}")
        pathlib.Path(tree, "package.json").write_text('{"version": "1.0.0"}')
        path = Doctor.path_without("dpkg-parsechangelog")
        self.addCleanup(shutil.rmtree, path, True)
        result = subprocess.run(
            ["bash", str(pathlib.Path(tree, "scripts", "build-deb.sh"))],
            env=clean_env(PATH=path), cwd=tree, capture_output=True, text=True, timeout=30,
        )  # fmt: skip
        self.assertNotEqual(result.returncode, 0)
        errors = [ln for ln in result.stderr.splitlines() if ln.startswith("error:")]
        self.assertEqual(len(errors), 1, result.stderr)
        self.assertIn("dpkg-parsechangelog", errors[0])


if __name__ == "__main__":
    unittest.main()
