'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-trust-'));
process.env.TERMIX_PLATFORM = 'android';
process.env.TERMIX_DATA_ROOT = root;
process.env.TERMIX_PORTABLE_KEY = crypto.randomBytes(48).toString('base64');
for (const sub of ['files', 'profiles', 'local']) fs.mkdirSync(path.join(root, sub), { recursive: true });
const db = require('../../util/profile-db');
const { HostTrust } = require('../../util/android/backend/trust');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const host = { address: 'fixture-only.invalid', port: 22 };

test('first-use pins automatically without approval; matching pins pass and changed pins fail closed', () => {
    db.set('knownHosts', []);
    const events = [];
    const trust = new HostTrust((channel, payload) => events.push({ channel, payload }));
    const results = [];
    trust.verifier(host)(Buffer.from('fixture-key'), value => results.push(value));
    assert.deepEqual(results, [true]);
    assert.deepEqual(events, []);
    const pinned = db.get('knownHosts');
    assert.equal(pinned[0].key, Buffer.from('fixture-key').toString('hex'));
    assert.match(pinned[0].fingerprint, /^SHA256:/);
    trust.verifier(host)(Buffer.from('fixture-key'), value => results.push(value));
    trust.verifier(host)(Buffer.from('different-key'), value => results.push(value));
    assert.deepEqual(results, [true, true, false]);
    assert.deepEqual(db.get('knownHosts'), pinned);
    assert.equal(events[0].payload.changed, true);
    trust.close();
});

test('aborted and empty-key connections never pin a host', () => {
    db.set('knownHosts', []);
    const trust = new HostTrust(() => {});
    const controller = new AbortController();
    controller.abort();
    const results = [];
    trust.verifier(host, { signal: controller.signal })(Buffer.from('fixture-key'), value => results.push(value));
    trust.verifier(host)(Buffer.alloc(0), value => results.push(value));
    assert.deepEqual(results, [false, false]);
    assert.deepEqual(db.get('knownHosts'), []);
});

test('profile changes cannot pin the key into another profile', () => {
    const originalGet = db.get;
    const originalPath = db.getActiveProfilePath;
    const originalSet = db.set;
    let pathCalls = 0;
    let writes = 0;
    db.get = () => [];
    db.getActiveProfilePath = () => ++pathCalls === 1 ? 'profile-one' : 'profile-two';
    db.set = () => { writes++; };
    try {
        let accepted;
        new HostTrust(() => {}).verifier(host)(Buffer.from('fixture-key'), value => { accepted = value; });
        assert.equal(accepted, false);
        assert.equal(writes, 0);
    } finally { db.get = originalGet; db.getActiveProfilePath = originalPath; db.set = originalSet; }
});

test('storage failure rejects first use and separate ports have separate pins', () => {
    const original = db.set;
    db.set('knownHosts', []);
    db.set = () => { throw new Error('fixture write failure'); };
    try {
        let accepted;
        new HostTrust(() => {}).verifier(host)(Buffer.from('fixture-key'), value => { accepted = value; });
        assert.equal(accepted, false);
    } finally { db.set = original; }
    db.set('knownHosts', []);
    const results = [];
    const trust = new HostTrust(() => {});
    trust.verifier(host)(Buffer.from('one'), value => results.push(value));
    trust.verifier(host)(Buffer.from('two'), value => results.push(value));
    trust.verifier({ ...host, port: 2222 })(Buffer.from('two'), value => results.push(value));
    assert.deepEqual(results, [true, false, true]);
    assert.equal(db.get('knownHosts').length, 2);
});
