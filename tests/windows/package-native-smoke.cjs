'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
    const executable = path.resolve(__dirname, '../../dist/store-test/win-unpacked/Termix Store Test.exe');
    const result = spawnSync(executable, [__filename], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8', timeout: 20000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0);
} else {
    const packagedRequire = createRequire(path.resolve(__dirname, '../../dist/store-test/win-unpacked/resources/app.asar/package.json'));
    const pty = packagedRequire('node-pty');
    const serial = packagedRequire('serialport');
    assert.equal(typeof serial.SerialPort.list, 'function');
    assert.equal(typeof packagedRequire('ssh2').Client, 'function');
    let output = '';
    const terminal = pty.spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', "[Console]::Write('TERMIX_NATIVE_OK')"
    ], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.env.SystemRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, useConpty: false });
    const timer = setTimeout(() => { terminal.kill(); process.exitCode = 1; }, 10000);
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => {
        clearTimeout(timer);
        assert.equal(exitCode, 0);
        assert.ok(output.includes('TERMIX_NATIVE_OK'));
        console.log(`Packaged Electron ${process.versions.electron}: WinPTY shell, serial binding and SSH2 load passed.`);
        process.exit(0);
    });
}
