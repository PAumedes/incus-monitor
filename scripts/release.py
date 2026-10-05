#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Cut a release from the Conventional Commits since the last tag.

Every commit of the new version is written to CHANGELOG.md and debian/changelog, the version
is bumped in package.json, and the result is committed and tagged locally. Nothing is pushed.

    scripts/release.py --dry-run               preview the next release
    scripts/release.py --bump auto             major if breaking, minor if feat, else patch
    scripts/release.py --version 1.0.0-rc.1    explicit version; pre-releases allowed
    scripts/release.py --notes v1.0.0          print a release's notes from CHANGELOG.md
"""

from __future__ import annotations

import argparse
import datetime
import email.utils
import json
import pathlib
import re
import subprocess
import sys
import textwrap
from dataclasses import dataclass

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHANGELOG = ROOT / "CHANGELOG.md"
DEBIAN_CHANGELOG = ROOT / "debian" / "changelog"
DEBIAN_SOURCE = "gnome-shell-extension-incus-monitor"
RELEASE_BRANCH = "main"

SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:alpha|beta|rc)\.(?:0|[1-9]\d*)))?$"
)
SUBJECT = re.compile(
    r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9-]+)\))?(?P<breaking>!)?: (?P<summary>.+)$"
)
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE: ", re.MULTILINE)

SECTIONS: list[tuple[str, frozenset[str]]] = [
    ("Features", frozenset({"feat"})),
    ("Fixes", frozenset({"fix"})),
    ("Performance", frozenset({"perf"})),
    ("Refactoring", frozenset({"refactor"})),
    ("Documentation", frozenset({"docs"})),
    ("Tests", frozenset({"test"})),
    ("Build and CI", frozenset({"build", "ci"})),
    ("Maintenance", frozenset({"chore", "style", "revert"})),
]


class ReleaseError(Exception):
    pass


@dataclass(frozen=True)
class Commit:
    sha: str
    subject: str
    type: str | None
    scope: str | None
    summary: str
    breaking: bool


def parse_commit(sha: str, subject: str, body: str = "") -> Commit:
    match = SUBJECT.match(subject)
    footer_breaking = BREAKING_FOOTER.search(body) is not None
    if match is None:
        return Commit(sha, subject, None, None, subject, footer_breaking)
    return Commit(
        sha,
        subject,
        match["type"],
        match["scope"],
        match["summary"],
        match["breaking"] is not None or footer_breaking,
    )


def next_version(current: str, commits: list[Commit], bump: str) -> str:
    match = SEMVER.match(current)
    if match is None:
        raise ReleaseError(f"current version {current!r} is not valid SemVer")
    if match[4] is not None:
        raise ReleaseError(f"current version {current} is a pre-release: pass --version explicitly")
    major, minor, patch = (int(part) for part in match.groups()[:3])

    if bump == "auto":
        if any(commit.breaking for commit in commits):
            # SemVer: while in 0.x, breaking changes bump the minor version.
            bump = "major" if major > 0 else "minor"
        elif any(commit.type == "feat" for commit in commits):
            bump = "minor"
        else:
            bump = "patch"

    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ReleaseError(f"unknown bump {bump!r}")


def debian_version(version: str) -> str:
    """SemVer pre-releases sort before the release in Debian only with a tilde."""
    return version.replace("-", "~", 1)


def group(commits: list[Commit]) -> list[tuple[str, list[Commit]]]:
    groups: list[tuple[str, list[Commit]]] = []
    breaking = [commit for commit in commits if commit.breaking]
    if breaking:
        groups.append(("Breaking changes", breaking))
    for title, types in SECTIONS:
        matching = [c for c in commits if c.type in types and not c.breaking]
        if matching:
            groups.append((title, matching))
    known = frozenset().union(*(types for _, types in SECTIONS))
    other = [c for c in commits if c.type not in known and not c.breaking]
    if other:
        groups.append(("Other", other))
    return groups


def render_markdown(version: str, date: datetime.date, commits: list[Commit]) -> str:
    lines = [f"## [{version}] - {date.isoformat()}", ""]
    for title, members in group(commits):
        lines += [f"### {title}", ""]
        for commit in members:
            scope = f"**{commit.scope}:** " if commit.scope else ""
            lines.append(f"- {scope}{commit.summary} ({commit.sha[:8]})")
        lines.append("")
    return "\n".join(lines)


def render_debian(
    version: str, commits: list[Commit], maintainer: str, when: datetime.datetime
) -> str:
    lines = [f"{DEBIAN_SOURCE} ({debian_version(version)}) unstable; urgency=medium", ""]
    for commit in commits:
        lines += textwrap.wrap(
            commit.subject, width=78, initial_indent="  * ", subsequent_indent="    "
        )
    lines += ["", f" -- {maintainer}  {email.utils.format_datetime(when)}", ""]
    return "\n".join(lines)


def insert_section(changelog: str, section: str) -> str:
    """Insert a release section above the newest existing release."""
    marker = re.search(r"^## \[", changelog, re.MULTILINE)
    if marker is None:
        return changelog.rstrip("\n") + "\n\n" + section
    return changelog[: marker.start()] + section + "\n" + changelog[marker.start() :]


def extract_notes(changelog: str, tag: str) -> str:
    version = tag.removeprefix("v")
    pattern = re.compile(
        rf"^## \[{re.escape(version)}\][^\n]*\n(?P<body>.*?)(?=^## \[|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(changelog)
    if match is None:
        raise ReleaseError(f"no section for {version} in CHANGELOG.md")
    return match["body"].strip() + "\n"


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise ReleaseError(f"git {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout


def last_tag() -> str | None:
    try:
        return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*").strip()
    except ReleaseError:
        return None


def commits_since(tag: str | None) -> list[Commit]:
    revision = f"{tag}..HEAD" if tag else "HEAD"
    log = git("log", "--no-merges", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", revision)
    commits = []
    for record in log.split("\x1e"):
        if record.strip():
            sha, subject, body = record.strip("\n").split("\x1f")
            commits.append(parse_commit(sha, subject, body))
    return commits


def maintainer() -> str:
    for line in DEBIAN_CHANGELOG.read_text().splitlines():
        if line.startswith(" -- "):
            return line[4:].split("  ")[0]
    raise ReleaseError("cannot find the maintainer in debian/changelog")


def ensure_releasable(version: str) -> None:
    if git("status", "--porcelain").strip():
        raise ReleaseError("working tree is not clean")
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch != RELEASE_BRANCH:
        raise ReleaseError(f"releases are cut from {RELEASE_BRANCH}, not {branch}")
    if git("tag", "--list", f"v{version}").strip():
        raise ReleaseError(f"tag v{version} already exists")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--bump", choices=["auto", "major", "minor", "patch"], default="auto")
    action.add_argument("--version", dest="explicit")
    action.add_argument("--notes", metavar="TAG")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if args.notes:
        sys.stdout.write(extract_notes(CHANGELOG.read_text(), args.notes))
        return 0

    tag = last_tag()
    commits = commits_since(tag)
    if not commits:
        raise ReleaseError(f"no commits since {tag or 'the beginning'}")

    current = json.loads((ROOT / "package.json").read_text())["version"]
    version = args.explicit or next_version(current, commits, args.bump)
    if SEMVER.match(version) is None:
        raise ReleaseError(f"{version!r} is not valid SemVer (x.y.z or x.y.z-rc.n)")

    now = datetime.datetime.now().astimezone()
    section = render_markdown(version, now.date(), commits)
    if args.dry_run:
        print(f"{current} -> {version} ({len(commits)} commits since {tag or 'start'})\n")
        print(section)
        return 0

    ensure_releasable(version)
    CHANGELOG.write_text(insert_section(CHANGELOG.read_text(), section))
    DEBIAN_CHANGELOG.write_text(
        render_debian(version, commits, maintainer(), now) + "\n" + DEBIAN_CHANGELOG.read_text()
    )
    subprocess.run(
        ["npm", "version", version, "--no-git-tag-version", "--allow-same-version"],
        cwd=ROOT, check=True, capture_output=True,
    )
    git("add", "CHANGELOG.md", "debian/changelog", "package.json", "package-lock.json")
    notes = extract_notes(CHANGELOG.read_text(), version)
    git("commit", "--message", f"chore(release): v{version}\n\n{notes}")
    git("tag", "--annotate", f"v{version}", "--message", f"Incus Monitor v{version}\n\n{notes}")

    print(f"Released v{version} locally. Review with `git show`, then publish:")
    print(f"  git push origin {RELEASE_BRANCH} v{version}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ReleaseError as error:
        print(f"release: {error}", file=sys.stderr)
        sys.exit(1)
