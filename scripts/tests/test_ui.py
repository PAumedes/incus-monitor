# SPDX-License-Identifier: GPL-2.0-or-later
"""scripts/lib/ui.sh: readable output on a terminal, plain ASCII everywhere else."""

import os
import pathlib
import pty
import re
import select
import subprocess
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
UI = ROOT / "scripts" / "lib" / "ui.sh"

SCRIPT = (
    "source scripts/lib/ui.sh; "
    "ui_step 'building'; ui_info 'some info'; ui_ok 'it worked'; ui_warn 'careful'; "
    "ui_fail 'it broke'; ui_done 'finished'"
)


def env(**extra):
    base = {k: v for k, v in os.environ.items() if k not in ("NO_COLOR", "CI", "LC_ALL", "LANG")}
    base.update(extra)
    return base


def run_piped(script=SCRIPT, **extra):
    return subprocess.run(
        ["bash", "-c", script], cwd=ROOT, env=env(**extra), capture_output=True, text=True, timeout=20
    )


def run_on_tty(script=SCRIPT, redirect=None, **extra):
    """Runs the script with stdout and stderr on a pseudo terminal; returns what it printed.

    `redirect` ("stdout" or "stderr") sends that stream to /dev/null-like pipe instead, so the
    other one is the only terminal; the pipe's content is discarded.
    """
    master, slave = pty.openpty()
    streams = {"stdout": slave, "stderr": slave}
    if redirect:
        streams[redirect] = subprocess.DEVNULL
    process = subprocess.Popen(
        ["bash", "-c", script], cwd=ROOT, env=env(**{"TERM": "xterm-256color", **extra}),
        stdin=subprocess.DEVNULL, stdout=streams["stdout"], stderr=streams["stderr"],
    )  # fmt: skip
    os.close(slave)
    chunks = []
    while True:
        ready, _, _ = select.select([master], [], [], 10)
        if not ready:
            break
        try:
            data = os.read(master, 4096)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)
    process.wait(timeout=10)
    os.close(master)
    return b"".join(chunks).decode("utf-8")


class UiFunctions(unittest.TestCase):
    def test_each_level_prints_its_message(self):
        result = run_piped()
        for message in ("building", "some info", "it worked", "careful", "finished"):
            with self.subTest(message=message):
                self.assertIn(message, result.stdout)

    def test_fail_writes_to_stderr_only(self):
        result = run_piped("source scripts/lib/ui.sh; ui_fail 'it broke'")
        self.assertIn("it broke", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_done_prints_the_elapsed_time(self):
        result = run_piped("source scripts/lib/ui.sh; ui_done 'finished'")
        self.assertRegex(result.stdout, r"finished \((\d+s|\d+min \d+s)\)")

    def test_sourcing_prints_nothing(self):
        result = run_piped("source scripts/lib/ui.sh")
        self.assertEqual((result.stdout, result.stderr), ("", ""))


class UiPlainOutput(unittest.TestCase):
    def test_no_escape_codes_or_non_ascii_when_not_a_terminal(self):
        for label, extra in [
            ("pipe", {"LC_ALL": "C.UTF-8"}),
            ("NO_COLOR", {"LC_ALL": "C.UTF-8", "NO_COLOR": "1"}),
            ("CI", {"LC_ALL": "C.UTF-8", "CI": "1"}),
        ]:
            with self.subTest(env=label):
                result = run_piped(**extra)
                text = result.stdout + result.stderr
                self.assertIn("it broke", text)
                self.assertNotIn("\x1b", text)
                self.assertTrue(text.isascii(), text)


class UiTerminalOutput(unittest.TestCase):
    def test_terminal_with_utf8_gets_colour_and_emoji(self):
        out = run_on_tty(LC_ALL="C.UTF-8")
        self.assertRegex(out, r"\x1b\[[0-9;]*m")
        self.assertFalse(out.isascii(), out)

    def test_no_color_removes_colour_and_emoji_on_a_terminal(self):
        out = run_on_tty(LC_ALL="C.UTF-8", NO_COLOR="1")
        self.assertIn("it broke", out)
        self.assertNotIn("\x1b", out)
        self.assertTrue(out.isascii(), out)

    def test_ci_removes_colour_and_emoji_on_a_terminal(self):
        out = run_on_tty(LC_ALL="C.UTF-8", CI="1")
        self.assertNotIn("\x1b", out)
        self.assertTrue(out.isascii(), out)

    def test_non_utf8_locale_keeps_colour_but_drops_emoji(self):
        out = run_on_tty(LC_ALL="C")
        self.assertRegex(out, r"\x1b\[[0-9;]*m")
        self.assertTrue(out.isascii(), out)

    def test_every_level_is_marked_with_a_distinct_prefix_on_a_terminal(self):
        out = run_on_tty(LC_ALL="C.UTF-8")
        lines = {
            m: next((re.sub(r"\x1b\[[0-9;]*m", "", ln) for ln in out.splitlines() if m in ln), "")
            for m in ("it worked", "careful", "it broke")
        }
        prefixes = {line.split(m)[0].strip() for m, line in lines.items()}
        self.assertEqual(len(prefixes), 3, lines)
        self.assertNotIn("", prefixes)


def now():
    return int(time.time())


class UiElapsedTime(unittest.TestCase):
    def done_with(self, t0):
        return run_piped("source scripts/lib/ui.sh; ui_done 'finished'", UI_T0=str(t0)).stdout

    def test_minutes_and_seconds_after_two_minutes(self):
        out = self.done_with(now() - 125)
        self.assertRegex(out, r"\(2min [4-6]s\)")

    def test_seconds_only_under_a_minute(self):
        out = self.done_with(now() - 30)
        self.assertRegex(out, r"\((29|30|31)s\)")

    def test_unusable_start_times_are_ignored(self):
        for label, t0 in [("text", "soon"), ("future", now() + 100000), ("empty", "")]:
            with self.subTest(t0=label):
                out = self.done_with(t0)
                self.assertRegex(out, r"\([0-2]s\)")
                self.assertNotIn("-", out.split("finished")[1])


class UiStreamAwareness(unittest.TestCase):
    def test_fail_is_plain_when_only_stdout_is_a_terminal(self):
        out = run_on_tty("source scripts/lib/ui.sh; ui_fail 'it broke' 2>&1 >/dev/null | cat",
                         LC_ALL="C.UTF-8")  # fmt: skip
        self.assertIn("it broke", out)
        self.assertNotIn("\x1b", out)
        self.assertTrue(out.isascii(), out)

    def test_fail_keeps_colour_when_only_stderr_is_a_terminal(self):
        out = run_on_tty("source scripts/lib/ui.sh; ui_fail 'it broke'", redirect="stdout",
                         LC_ALL="C.UTF-8")  # fmt: skip
        self.assertRegex(out, r"\x1b\[[0-9;]*m")


class UiHostileInput(unittest.TestCase):
    def test_control_characters_in_a_message_are_neutralised(self):
        script = "source scripts/lib/ui.sh; ui_info $'a\\e]0;pwn\\ab\\rc'"
        out = run_on_tty(script, LC_ALL="C.UTF-8")
        own = re.sub(r"\x1b\[[0-9;]*m", "", out)
        self.assertNotIn("\x1b", own)
        self.assertNotIn("\a", own)
        self.assertNotIn("\r\r", own)
        self.assertIn("a?]0;pwn?b?c", own)

    def test_dumb_terminal_gets_no_colour_and_no_emoji(self):
        out = run_on_tty(LC_ALL="C.UTF-8", TERM="dumb")
        self.assertIn("it broke", out)
        self.assertNotIn("\x1b", out)
        self.assertTrue(out.isascii(), out)


if __name__ == "__main__":
    unittest.main()
