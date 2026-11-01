'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const { abis } = require('./runtime.json');

function validateGradleArgument(arg) {
    if (arg.startsWith('-PtermixAbis=')) {
        const requestedAbis = arg.slice('-PtermixAbis='.length).split(',');
        if (requestedAbis.every((abi) => abis.includes(abi))) return;
    } else if (/^[A-Za-z0-9_=:.\/-]+$/.test(arg)) {
        return;
    }
    throw new Error('Unsupported Gradle argument: ' + arg);
}

function build() {
    if (!process.argv.includes('--allow-eol-preview')) throw new Error('This build uses an EOL preview runtime; pass --allow-eol-preview explicitly.');
    const args = ['assembleDebug', '-PtermixAllowEolRuntime=true', ...process.argv.slice(2).filter((arg) => arg !== '--allow-eol-preview')];
    args.forEach(validateGradleArgument);
    require('./prepare-assets').prepare();
    const android = path.join(ROOT, 'android');
    if (!fs.existsSync(path.join(android, 'runtime/provenance.json'))) throw new Error('Prepare the verified native runtime first: npm run android:runtime:preview');
    const windows = process.platform === 'win32';
    const command = windows ? path.join(android, 'gradlew.bat') : path.join(android, 'gradlew');
    const buildEnv = { ...process.env };
    if (windows) {
        const candidateJdks = [
            'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.10.7-hotspot',
            'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.18.8-hotspot',
            'C:\\Program Files\\Android\\Android Studio\\jbr',
            'C:\\Program Files\\Java\\jdk-25.0.2'
        ];
        const chosen = candidateJdks.find((candidate) => fs.existsSync(path.join(candidate, 'bin', 'javac.exe')));
        if (chosen) {
            buildEnv.JAVA_HOME = chosen;
            buildEnv.PATH = `${path.join(chosen, 'bin')}${path.delimiter}${buildEnv.PATH || ''}`;
        }
    }
    const result = spawnSync(command, args, { cwd: android, stdio: 'inherit', env: buildEnv, shell: windows });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Android Gradle build failed (${result.status}).`);
}

if (require.main === module) {
    try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build, validateGradleArgument };
