#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Record sanitized Incus REST API responses as test fixtures.

Read-only: only GET requests are issued. Identifying data (certificates,
fingerprints, addresses, MAC addresses, host and user names) is replaced
with documentation values (RFC 5737 / RFC 3849) before anything is written.

Usage:
    scripts/record-fixtures.py --version 7.0 [--socket PATH] [--project NAME]

Always review the diff before committing recorded fixtures.
"""

import argparse
import getpass
import json
import pathlib
import re
import socket
import subprocess

REDACTED_KEYS = {
    "auth_user_name",
    "certificate",
    "certificate_fingerprint",
    "hostname",
    "image.serial",
    "kernel_version",
    "os_version",
    "server_pid",
    "volatile.base_image",
    "volatile.cloud-init.instance-id",
    "volatile.uuid",
    "volatile.uuid.generation",
}


def scrub(value, replacements):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key in REDACTED_KEYS or key.endswith(".hwaddr"):
                out[key] = "REDACTED" if isinstance(item, str) else item
            elif key == "server_name":
                out[key] = "host01"
            elif key == "hwaddr":
                out[key] = "00:16:3e:00:00:01"
            elif key == "address" and isinstance(item, str):
                out[key] = "2001:db8::10" if ":" in item else "192.0.2.10"
            elif key == "addresses" and isinstance(item, list) and all(isinstance(x, str) for x in item):
                out[key] = ["192.0.2.1:8443"] if item else []
            else:
                out[key] = scrub(item, replacements)
        return out
    if isinstance(value, list):
        return [scrub(item, replacements) for item in value]
    if isinstance(value, str):
        for pattern, replacement in replacements:
            value = pattern.sub(replacement, value)
    return value


def get(socket_path, path):
    result = subprocess.run(
        ["curl", "-s", "--unix-socket", socket_path, f"http://incus{path}", "-w", "\n%{http_code}"],
        capture_output=True,
        text=True,
        check=True,
    )
    body, status = result.stdout.rsplit("\n", 1)
    return int(status), json.loads(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True, help="Incus series, e.g. 6.0 or 7.0")
    parser.add_argument("--socket", default="/var/lib/incus/unix.socket.user")
    parser.add_argument("--project", default=None, help="project for single-project requests")
    args = parser.parse_args()

    project = args.project or f"user-{subprocess.run(['id', '-u'], capture_output=True, text=True).stdout.strip()}"
    out_dir = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "incus" / args.version
    out_dir.mkdir(parents=True, exist_ok=True)

    replacements = [
        (re.compile(rf"\b{re.escape(getpass.getuser())}\b"), "user"),
        (re.compile(rf"\b{re.escape(socket.gethostname())}\b"), "host01"),
    ]
    cases = {
        "server.json": "/1.0",
        "instances-recursion1.json": "/1.0/instances?all-projects=true&recursion=1",
        "instances-recursion2.json": "/1.0/instances?all-projects=true&recursion=2",
        "error-forbidden-project.json": "/1.0/instances?recursion=1",
        "error-not-found.json": f"/1.0/instances/does-not-exist?project={project}",
    }
    for name, path in cases.items():
        status, body = get(args.socket, path)
        fixture = {"request": path, "http_status": status, "body": scrub(body, replacements)}
        (out_dir / name).write_text(json.dumps(fixture, indent=2) + "\n")
        print(f"{name}: HTTP {status}")
    print(f"Review before committing: git diff -- {out_dir}")


if __name__ == "__main__":
    main()
