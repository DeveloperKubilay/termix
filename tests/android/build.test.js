'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateGradleArgument } = require('../../util/android/build');

const abiArgument = '-PtermixAbis=arm64-v8a,x86_64';

test('Gradle arguments accept supported single and multiple runtime ABIs', () => {
    for (const arg of ['assembleDebug', '-PtermixAllowEolRuntime=true', '--stacktrace', '-PtermixAbis=arm64-v8a', '-PtermixAbis=x86_64', abiArgument]) {
        assert.doesNotThrow(() => validateGradleArgument(arg));
    }
});

test('Gradle arguments reject unsupported ABIs, malformed lists and shell syntax', () => {
    for (const arg of ['-PtermixAbis=', '-PtermixAbis=armeabi-v7a', '-PtermixAbis=arm64-v8a,', '-PtermixAbis=,x86_64', '-PtermixAbis=arm64-v8a,,x86_64', '-PtermixAbis=arm64-v8a, x86_64', '-Pother=a,b', '-PtermixAbis=arm64-v8a;whoami', 'assembleDebug && whoami', '$(whoami)', '%PATH%']) {
        assert.throws(() => validateGradleArgument(arg), /Unsupported Gradle argument/);
    }
});

for (const platform of ['linux', 'win32']) {
    test(`preview build passes the workflow ABI list unchanged to Gradle on ${platform}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '../../util/android/build.js'), 'utf8');
        const calls = [];
        const module = { exports: {} };
        const requireMock = name => {
            if (name === 'fs') return { existsSync: () => true };
            if (name === 'path') return path;
            if (name === './runtime.json') return require('../../util/android/runtime.json');
            if (name === './prepare-assets') return { prepare: () => calls.push('prepare') };
            if (name === 'child_process') return {
                spawnSync(command, args, options) {
                    calls.push({ command, args, options });
                    return { status: 0 };
                }
            };
            throw new Error(`Unexpected module: ${name}`);
        };
        const processMock = {
            argv: ['node', 'build.js', '--allow-eol-preview', abiArgument],
            platform,
            env: {}
        };
        vm.runInNewContext(source, { require: requireMock, module, process: processMock, console, __dirname: path.resolve(__dirname, '../../util/android') });
        module.exports.build();
        assert.equal(calls[0], 'prepare');
        assert.deepEqual(Array.from(calls[1].args), ['assembleDebug', '-PtermixAllowEolRuntime=true', abiArgument]);
        assert.equal(calls[1].options.shell, platform === 'win32');
        assert.match(calls[1].command, platform === 'win32' ? /gradlew\.bat$/ : /gradlew$/);

        calls.length = 0;
        processMock.argv[3] = '-PtermixAbis=unknown';
        assert.throws(() => module.exports.build(), /Unsupported Gradle argument/);
        assert.equal(calls.length, 0, 'invalid arguments must fail before asset preparation or Gradle');
    });
}
