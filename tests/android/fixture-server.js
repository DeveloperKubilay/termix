'use strict';

// Disposable SSH/SFTP fixture. Never uses saved Termix hosts or production files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

function createFixture(options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-ssh-fixture-'));
    const files = path.join(directory, 'files');
    fs.mkdirSync(files);
    fs.writeFileSync(path.join(files, 'hello.txt'), 'Termix fixture — Türkçe ✅\n');
    const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    const clientKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    const allowedKey = utils.parseKey(clientKey);
    const password = options.password || 'termix-fixture-only';
    const clients = new Set();
    let sessionCount = 0;
    const observations = { inputs: [], windows: [], authentications: [] };

    function resolveRemote(value) {
        const normalized = path.posix.normalize('/' + String(value || '/'));
        const target = path.resolve(files, '.' + normalized);
        if (target !== files && !target.startsWith(files + path.sep)) throw new Error('Outside fixture root');
        // The fixture never creates symlinks. Reject any accidentally introduced link.
        let current = target;
        while (current !== files && current.startsWith(files + path.sep)) {
            if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink denied');
            current = path.dirname(current);
        }
        return target;
    }

    function attrs(stat) {
        return { mode: stat.mode, uid: 1000, gid: 1000, size: stat.size, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) };
    }

    function serveSftp(sftp) {
        const handles = new Map();
        let nextHandle = 1;
        const allocate = (entry) => { const handle = Buffer.alloc(4); handle.writeUInt32BE(nextHandle++); handles.set(handle.toString('hex'), entry); return handle; };
        const get = (handle) => handles.get(handle.toString('hex'));
        const operation = (request, callback) => {
            try { callback(); } catch (error) { sftp.status(request, error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE); }
        };
        for (const kind of ['STAT', 'LSTAT']) sftp.on(kind, (id, name) => operation(id, () => sftp.attrs(id, attrs(fs.statSync(resolveRemote(name))))));
        sftp.on('REALPATH', (id, name) => operation(id, () => {
            const real = resolveRemote(name);
            const filename = '/' + path.relative(files, real).split(path.sep).join('/');
            sftp.name(id, [{ filename, longname: filename, attrs: attrs(fs.statSync(real)) }]);
        }));
        sftp.on('OPENDIR', (id, name) => operation(id, () => {
            const target = resolveRemote(name);
            const entries = fs.readdirSync(target).map((filename) => ({ filename, longname: filename, attrs: attrs(fs.statSync(path.join(target, filename))) }));
            sftp.handle(id, allocate({ entries }));
        }));
        sftp.on('READDIR', (id, handle) => operation(id, () => {
            const entry = get(handle);
            if (!entry || !entry.entries) return sftp.status(id, STATUS_CODE.FAILURE);
            if (!entry.entries.length) return sftp.status(id, STATUS_CODE.EOF);
            sftp.name(id, entry.entries.splice(0, 100));
        }));
        sftp.on('OPEN', (id, name, flags) => operation(id, () => {
            let mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.APPEND ? 'a+' : flags & OPEN_MODE.TRUNC ? 'w+' : 'r+') : 'r';
            if ((flags & OPEN_MODE.CREAT) && !fs.existsSync(resolveRemote(name))) mode = 'w+';
            sftp.handle(id, allocate({ fd: fs.openSync(resolveRemote(name), mode) }));
        }));
        sftp.on('READ', (id, handle, offset, length) => operation(id, () => {
            const entry = get(handle);
            if (!entry || entry.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
            const buffer = Buffer.alloc(Math.min(length, 1024 * 1024));
            const read = fs.readSync(entry.fd, buffer, 0, buffer.length, offset);
            if (!read) return sftp.status(id, STATUS_CODE.EOF);
            sftp.data(id, buffer.subarray(0, read));
        }));
        sftp.on('WRITE', (id, handle, offset, buffer) => operation(id, () => {
            const entry = get(handle);
            if (!entry || entry.fd === undefined) return sftp.status(id, STATUS_CODE.FAILURE);
            fs.writeSync(entry.fd, buffer, 0, buffer.length, offset);
            sftp.status(id, STATUS_CODE.OK);
        }));
        sftp.on('FSTAT', (id, handle) => operation(id, () => sftp.attrs(id, attrs(fs.fstatSync(get(handle).fd)))));
        sftp.on('CLOSE', (id, handle) => operation(id, () => {
            const entry = get(handle);
            if (entry && entry.fd !== undefined) fs.closeSync(entry.fd);
            handles.delete(handle.toString('hex'));
            sftp.status(id, STATUS_CODE.OK);
        }));
        sftp.on('MKDIR', (id, name) => operation(id, () => { fs.mkdirSync(resolveRemote(name)); sftp.status(id, STATUS_CODE.OK); }));
        sftp.on('REMOVE', (id, name) => operation(id, () => { fs.unlinkSync(resolveRemote(name)); sftp.status(id, STATUS_CODE.OK); }));
        sftp.on('RMDIR', (id, name) => operation(id, () => { const target = resolveRemote(name); if (target === files) throw Error('Cannot remove fixture root'); fs.rmdirSync(target); sftp.status(id, STATUS_CODE.OK); }));
        sftp.on('RENAME', (id, from, to) => operation(id, () => { fs.renameSync(resolveRemote(from), resolveRemote(to)); sftp.status(id, STATUS_CODE.OK); }));
        sftp.on('SETSTAT', (id) => sftp.status(id, STATUS_CODE.OK));
        sftp.on('FSETSTAT', (id) => sftp.status(id, STATUS_CODE.OK));
        sftp.on('EXTENDED', (id, type, data) => operation(id, () => {
            if (!options.disablePosixRename && type === 'posix-rename@openssh.com') {
                let p = 0;
                const oldLen = data.readUInt32BE(p); p += 4;
                const oldPath = data.toString('utf8', p, p + oldLen); p += oldLen;
                const newLen = data.readUInt32BE(p); p += 4;
                const newPath = data.toString('utf8', p, p + newLen);
                fs.renameSync(resolveRemote(oldPath), resolveRemote(newPath));
                sftp.status(id, STATUS_CODE.OK);
                return;
            }
            sftp.status(id, STATUS_CODE.OP_UNSUPPORTED);
        }));
        sftp.on('close', () => { for (const entry of handles.values()) { if (entry.fd !== undefined) { try { fs.closeSync(entry.fd); } catch (_) {} } } handles.clear(); });
    }

    const server = new Server({ hostKeys: [hostKey] }, (client) => {
        clients.add(client);
        client.on('error', () => {});
        client.on('close', () => clients.delete(client));
        client.on('authentication', (context) => {
            const validUser = context.username === 'termix';
            let valid = validUser && context.method === 'password' && context.password === password;
            if (validUser && context.method === 'publickey' && context.key.data.equals(allowedKey.getPublicSSH())) {
                valid = !context.signature || allowedKey.verify(context.blob, context.signature, context.hashAlgo) === true;
            }
            observations.authentications.push({ method: context.method, accepted: Boolean(valid) });
            if (valid) context.accept(); else context.reject(['password', 'publickey']);
        });
        client.on('ready', () => client.on('session', (accept) => {
            const session = accept();
            sessionCount++;
            session.on('pty', (acceptPty, reject, info) => { observations.windows.push(info); acceptPty(); });
            session.on('window-change', (acceptChange, reject, info) => { observations.windows.push(info); if (acceptChange) acceptChange(); });
            session.on('shell', (acceptShell) => {
                const stream = acceptShell();
                stream.write('TERMIX_FIXTURE_READY\r\nTürkçe terminal ✅\r\n$ ');
                let command = '';
                stream.on('data', (data) => {
                    observations.inputs.push(data.toString('utf8'));
                    for (const character of data.toString('utf8')) {
                        if (character === '\u0003') { command = ''; stream.write('^C\r\n$ '); }
                        else if (character === '\r' || character === '\n') {
                            const text = command.trim();
                            command = '';
                            stream.write('\r\n');
                            if (text === 'exit') { stream.exit(0); stream.end(); return; }
                            if (text === 'pwd') stream.write('/\r\n');
                            else if (text.startsWith('echo ')) stream.write(text.slice(5) + '\r\n');
                            else if (text) stream.write('TERMIX_COMMAND_OK: ' + text + '\r\n');
                            stream.write('$ ');
                        } else if (character === '\u007f') command = command.slice(0, -1);
                        else { command += character; stream.write(character); }
                    }
                });
            });
            session.on('exec', (acceptExec, reject, info) => {
                const stream = acceptExec();
                if (info.command.includes('pwd') || info.command.includes('HOME')) stream.write('/\n');
                else stream.write('TERMIX_EXEC_OK\n');
                stream.exit(0); stream.end();
            });
            session.on('sftp', (acceptSftp) => serveSftp(acceptSftp()));
        }));
    });
    return {
        directory, files, password, clientKey, hostKey, observations,
        get sessionCount() { return sessionCount; },
        async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server.address().port; },
        async close() { for (const client of clients) client.end(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
    };
}

if (require.main === module) {
    const fixture = createFixture();
    fixture.listen(Number(process.env.TERMIX_FIXTURE_PORT || 22222)).then((port) => {
        const keyPath = path.join(fixture.directory, 'client.pem');
        fs.writeFileSync(keyPath, fixture.clientKey, { mode: 0o600 });
        console.log(JSON.stringify({ port, username: 'termix', password: fixture.password, clientKey: keyPath, remoteRoot: fixture.files }));
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
    process.on('SIGINT', () => fixture.close().then(() => process.exit(0)));
    process.on('SIGTERM', () => fixture.close().then(() => process.exit(0)));
}
module.exports = { createFixture };
