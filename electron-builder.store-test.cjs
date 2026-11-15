const path = require('node:path');

module.exports = {
    extends: null,
    appId: 'com.termix.storetest',
    productName: 'Termix Store Test',
    artifactName: 'Termix-Store-Test-${version}-${arch}.${ext}',
    directories: {
        output: 'dist/store-test'
    },
    extraMetadata: {
        name: 'termix-store-test',
        main: 'util/windows/store-test-main.js'
    },
    publish: null,
    npmRebuild: false,
    files: [
        'index.js',
        'index.html',
        'package.json',
        'public/**/*',
        'commands/**/*',
        'util/**/*',
        '!util/android{,/**/*}',
        '!commands/profiles/profiles{,/**/*}',
        '!**/profiles/registry.json',
        '!**/kubitdb.json',
        '!**/.env{,.*}',
        '!**/*.{pem,key,pfx,p12,jks,keystore}',
        '!profiles{,/**/*}',
        '!files{,/**/*}',
        '!node_modules/cpu-features{,/**/*}'
    ],
    asarUnpack: [
        '**/*.node',
        '**/node-pty/**/*'
    ],
    win: {
        target: [{ target: 'appx', arch: ['x64'] }],
        icon: path.join(__dirname, 'public/icons/favicon.ico'),
        signAndEditExecutable: false
    },
    appx: {
        identityName: 'Termix.StoreTest',
        applicationId: 'TermixStoreTest',
        displayName: 'Termix Store Test',
        publisher: 'CN=Termix Store Test, OID.2.25.311729368913984317654407730594956997722=1',
        publisherDisplayName: 'Termix Local Test',
        capabilities: ['runFullTrust'],
        setBuildNumber: false,
        minVersion: '10.0.22000.0',
        maxVersionTested: '10.0.22000.0'
    }
};
