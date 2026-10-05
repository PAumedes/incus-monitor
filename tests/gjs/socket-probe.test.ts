// SPDX-License-Identifier: GPL-2.0-or-later
// GioSocketProbe against real sockets, files and directories in a temp directory.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { GioSocketProbe } from '../../src/adapters/socket-probe.js';
import type { SocketAccess } from '../../src/core/ports.js';
import { CancelSource } from '../../src/core/cancel.js';
import { FakeServer } from './fake-server.js';
import { assert, test } from './harness.js';
import { collectingWarnings, withTempDir, writeFile } from './support.js';

const idle = (): Promise<void> => Promise.resolve();

function probe(path: string): Promise<SocketAccess> {
    return new GioSocketProbe().access(path, new CancelSource().signal);
}

test('probe: a socket the user can write to is usable', () =>
    withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, idle);
        try {
            assert.equal(await probe(server.path), 'usable');
        } finally {
            server.stop();
        }
    }));

test('probe: it does not connect to the socket', () =>
    withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, idle);
        try {
            await probe(server.path);
            assert.equal(server.connections, 0);
        } finally {
            server.stop();
        }
    }));

test('probe: a socket without write permission is denied', () =>
    withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, idle);
        try {
            GLib.chmod(server.path, 0o444);
            assert.equal(await probe(server.path), 'denied');
        } finally {
            server.stop();
        }
    }));

test('probe: a socket inside an inaccessible directory is denied', () =>
    withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, idle);
        try {
            GLib.chmod(dir, 0o000);
            assert.equal(await probe(`${dir}/unix.socket`), 'denied');
        } finally {
            GLib.chmod(dir, 0o700);
            server.stop();
        }
    }));

test('probe: a missing file is missing and logs nothing', () =>
    withTempDir(async dir => {
        const warnings = await collectingWarnings(async () => {
            assert.equal(await probe(`${dir}/absent.socket`), 'missing');
        });
        assert.equal(warnings.length, 0);
    }));

test('probe: a missing parent directory is missing', async () => {
    assert.equal(await probe('/nonexistent-incus-dir/unix.socket'), 'missing');
});

test('probe: a path below a regular file (NOT_DIRECTORY) is missing and logs nothing', () =>
    withTempDir(async dir => {
        writeFile(`${dir}/plain`, 'x');
        const warnings = await collectingWarnings(async () => {
            assert.equal(await probe(`${dir}/plain/unix.socket`), 'missing');
        });
        assert.equal(warnings.length, 0);
    }));

test('probe: a regular file is not a socket, so it is missing', () =>
    withTempDir(async dir => {
        writeFile(`${dir}/unix.socket`, 'x', 0o666);
        assert.equal(await probe(`${dir}/unix.socket`), 'missing');
    }));

test('probe: a directory is not a socket, so it is missing', () =>
    withTempDir(async dir => {
        const file = Gio.File.new_for_path(`${dir}/unix.socket`);
        file.make_directory(null);
        assert.equal(await probe(`${dir}/unix.socket`), 'missing');
    }));

test('probe: any other error is missing and warned about exactly once', () =>
    withTempDir(async dir => {
        // A 300-character name fails with ENAMETOOLONG, which is none of the mapped errors.
        const warnings = await collectingWarnings(async () => {
            assert.equal(await probe(`${dir}/${'a'.repeat(300)}`), 'missing');
        });
        assert.equal(warnings.length, 1);
    }));

test('probe: a symlink loop is not a socket, so it is missing', () =>
    withTempDir(async dir => {
        Gio.File.new_for_path(`${dir}/loop`).make_symbolic_link('loop', null);
        assert.equal(await probe(`${dir}/loop`), 'missing');
    }));

test('probe: a symlink to a usable socket is usable', () =>
    withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, idle);
        try {
            Gio.File.new_for_path(`${dir}/link`).make_symbolic_link('unix.socket', null);
            assert.equal(await probe(`${dir}/link`), 'usable');
        } finally {
            server.stop();
        }
    }));

test('probe: a cancelled probe answers missing (the caller discards it) without warning', () =>
    withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, idle);
        try {
            const source = new CancelSource();
            source.cancel();
            const warnings = await collectingWarnings(async () => {
                const answer = await new GioSocketProbe().access(server.path, source.signal);
                assert.equal(answer, 'missing');
            });
            assert.equal(warnings.length, 0);
        } finally {
            server.stop();
        }
    }));

const TOO_LONG = 'a'.repeat(300);

test('probe: the same unexpected error on one probe warns only once per path', () =>
    withTempDir(async dir => {
        const warnings = await collectingWarnings(async () => {
            const instance = new GioSocketProbe();
            for (let i = 0; i < 3; i++) {
                assert.equal(
                    await instance.access(`${dir}/${TOO_LONG}`, new CancelSource().signal),
                    'missing',
                );
            }
        });
        assert.equal(warnings.length, 1);
    }));

test('probe: a different path with the same error warns again', () =>
    withTempDir(async dir => {
        const warnings = await collectingWarnings(async () => {
            const instance = new GioSocketProbe();
            for (const path of [`${dir}/${TOO_LONG}`, `${dir}/${'b'.repeat(300)}`]) {
                await instance.access(path, new CancelSource().signal);
            }
        });
        assert.equal(warnings.length, 2);
    }));

test('probe: each probe instance warns independently', () =>
    withTempDir(async dir => {
        const warnings = await collectingWarnings(async () => {
            for (let i = 0; i < 2; i++) {
                await new GioSocketProbe().access(`${dir}/${TOO_LONG}`, new CancelSource().signal);
            }
        });
        assert.equal(warnings.length, 2);
    }));
