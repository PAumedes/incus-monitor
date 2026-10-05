# SPDX-License-Identifier: GPL-2.0-or-later
import datetime
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import release  # noqa: E402
from release import Commit, ReleaseError, parse_commit  # noqa: E402

SHA = "0123456789abcdef0123456789abcdef01234567"


def commits(*subjects: str) -> list[Commit]:
    return [parse_commit(SHA, subject) for subject in subjects]


class ParseCommitTest(unittest.TestCase):
    def test_parses_type_scope_and_summary(self):
        commit = parse_commit(SHA, "feat(core): decode instance state")
        self.assertEqual((commit.type, commit.scope, commit.summary), ("feat", "core", "decode instance state"))
        self.assertFalse(commit.breaking)

    def test_bang_marks_breaking(self):
        self.assertTrue(parse_commit(SHA, "feat!: drop GNOME 46").breaking)

    def test_footer_marks_breaking(self):
        self.assertTrue(parse_commit(SHA, "fix: rename key", "BREAKING CHANGE: key renamed").breaking)

    def test_non_conventional_subject_is_kept_verbatim(self):
        commit = parse_commit(SHA, "Initial commit")
        self.assertIsNone(commit.type)
        self.assertEqual(commit.summary, "Initial commit")


class NextVersionTest(unittest.TestCase):
    def test_auto_bump(self):
        cases = [
            ("1.2.3", ["fix: a"], "1.2.4"),
            ("1.2.3", ["fix: a", "feat: b"], "1.3.0"),
            ("1.2.3", ["feat!: b"], "2.0.0"),
            ("0.4.1", ["feat!: b"], "0.5.0"),
            ("1.2.3", ["docs: a"], "1.2.4"),
        ]
        for current, subjects, expected in cases:
            with self.subTest(current=current, subjects=subjects):
                self.assertEqual(release.next_version(current, commits(*subjects), "auto"), expected)

    def test_explicit_bump_ignores_commit_types(self):
        self.assertEqual(release.next_version("1.2.3", commits("fix: a"), "major"), "2.0.0")

    def test_refuses_to_guess_after_a_pre_release(self):
        with self.assertRaises(ReleaseError):
            release.next_version("1.0.0-rc.1", commits("fix: a"), "auto")

    def test_rejects_invalid_current_version(self):
        with self.assertRaises(ReleaseError):
            release.next_version("1.0", commits("fix: a"), "auto")


class RenderTest(unittest.TestCase):
    def test_markdown_groups_in_fixed_order_with_breaking_first(self):
        text = release.render_markdown(
            "1.3.0",
            datetime.date(2026, 10, 4),
            commits("fix(ui): x", "feat(core): y", "chore: z", "Merge stuff", "feat!: w"),
        )
        headings = [line for line in text.splitlines() if line.startswith("#")]
        self.assertEqual(
            headings,
            ["## [1.3.0] - 2026-10-04", "### Breaking changes", "### Features", "### Fixes",
             "### Maintenance", "### Other"],
        )
        self.assertIn("- **core:** y (01234567)", text)
        self.assertIn("- w (01234567)", text)

    def test_debian_entry_wraps_and_maps_pre_release(self):
        when = datetime.datetime(2026, 10, 4, 23, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=-3)))
        entry = release.render_debian("1.0.0-rc.1", commits("feat: " + "word " * 30), "A B <a@b.c>", when)
        lines = entry.splitlines()
        self.assertEqual(lines[0], "gnome-shell-extension-incus-monitor (1.0.0~rc.1) unstable; urgency=medium")
        self.assertTrue(all(len(line) <= 78 for line in lines))
        self.assertTrue(lines[3].startswith("    "))
        self.assertEqual(lines[-1], " -- A B <a@b.c>  Sun, 04 Oct 2026 23:00:00 -0300")


class ChangelogFileTest(unittest.TestCase):
    HEADER = "# Changelog\n\nIntro.\n\n"
    OLD = "## [1.0.0] - 2026-01-01\n\n### Fixes\n\n- old (aaaaaaaa)\n"

    def test_inserts_above_newest_release(self):
        result = release.insert_section(self.HEADER + self.OLD, "## [1.1.0] - 2026-02-01\n\n- new\n")
        self.assertLess(result.index("[1.1.0]"), result.index("[1.0.0]"))
        self.assertTrue(result.startswith(self.HEADER))

    def test_appends_when_no_release_exists(self):
        result = release.insert_section(self.HEADER, "## [0.1.0] - 2026-02-01\n")
        self.assertTrue(result.endswith("## [0.1.0] - 2026-02-01\n"))

    def test_extracts_notes_for_one_release(self):
        text = release.insert_section(self.HEADER + self.OLD, "## [1.1.0] - 2026-02-01\n\n- new\n")
        self.assertEqual(release.extract_notes(text, "v1.1.0"), "- new\n")
        self.assertEqual(release.extract_notes(text, "v1.0.0"), "### Fixes\n\n- old (aaaaaaaa)\n")

    def test_missing_release_is_an_error(self):
        with self.assertRaises(ReleaseError):
            release.extract_notes(self.HEADER, "v9.9.9")


class RepositoryInvariantTest(unittest.TestCase):
    def test_debian_changelog_matches_package_version(self):
        import json

        version = json.loads((release.ROOT / "package.json").read_text())["version"]
        first = release.DEBIAN_CHANGELOG.read_text().splitlines()[0]
        self.assertEqual(first.split()[1], f"({release.debian_version(version)})")


if __name__ == "__main__":
    unittest.main()
