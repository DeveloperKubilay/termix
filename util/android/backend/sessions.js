'use strict';
const crypto = require('crypto');
const connectSSH = require('../../connections/ssh');

class TerminalSessions {
    constructor(emit, trust, { connector = connectSSH, onCountChange = null } = {}) {
        this.emit = emit;
        this.trust = trust;
        this.connector = connector;
        this.sessions = new Map();
        this.closed = false;
        this.onCountChange = onCountChange;
    }
    _notifyCount() {
        if (typeof this.onCountChange === 'function') {
            try { this.onCountChange(this.sessions.size); } catch (_) {}
        }
    }
    async connect(host, options = {}) {
        if (this.closed) return { status: 'error', message: 'Backend transport is closed.' };
        if (!host || !['SSH', 'SFTP'].includes(String(host.protocol || 'SSH').toUpperCase())) {
            return { status: 'error', message: 'Only SSH terminals are supported on Android.' };
        }
        const sessionId = crypto.randomUUID();
        const requestId = String(options.clientRequestId || '');
        if (requestId && [...this.sessions.values()].some((item) => item.requestId === requestId)) {
            return { status: 'error', message: 'Duplicate connection request id.' };
        }
        const controller = new AbortController();
        const record = { sessionId, requestId, controller, connection: null };
        this.sessions.set(sessionId, record);
        this._notifyCount();
        const onEvent = (message) => {
            if (controller.signal.aborted) return;
            if (message.type === 'connected') this.emit('ssh-ready', { sessionId });
            else if (message.type === 'data') this.emit('term-data', { sessionId, data: message.data });
            else if (message.type === 'error') this.emit('term-error', { sessionId, message: message.message });
            else if (message.type === 'disconnected') {
                this.sessions.delete(sessionId);
                this._notifyCount();
                this.emit('term-disconnected', { sessionId, exitCode: message.exitCode, signal: message.signal, message: message.message });
            }
        };
        try {
            const connection = await this.connector(host, {
                sessionId, signal: controller.signal, onEvent,
                hostVerifier: this.trust.verifier(host, { sessionId, signal: controller.signal })
            });
            // A cancelled connector may still resolve its shell callback later.
            if (controller.signal.aborted || this.closed || !this.sessions.has(sessionId)) {
                connection.end();
                return { status: 'error', message: 'SSH connection cancelled.' };
            }
            record.connection = connection;
            return { status: 'connected', sessionId };
        } catch (err) {
            this.sessions.delete(sessionId);
            this._notifyCount();
            return { status: 'error', message: controller.signal.aborted ? 'SSH connection cancelled.' : err.message };
        }
    }
    send(channel, payload = {}) {
        const sessionId = String(payload.sessionId || '');
        if (channel === 'term-close') {
            for (const [id, record] of this.sessions) {
                if ((sessionId && id === sessionId) || (payload.requestId && record.requestId === String(payload.requestId))) {
                    this.sessions.delete(id);
                    this._notifyCount();
                    record.controller.abort();
                    if (record.connection) record.connection.end();
                }
            }
            return;
        }
        const record = this.sessions.get(sessionId);
        if (!record || !record.connection) return;
        if (channel === 'term-input') {
            const value = payload.data == null ? payload.message : payload.data;
            if (typeof value !== 'string') throw new Error('Terminal input must be a string.');
            record.connection.write({ type: 'input', message: value });
        } else if (channel === 'term-resize') {
            const cols = Number(payload.cols), rows = Number(payload.rows);
            if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) throw new Error('Invalid terminal dimensions.');
            record.connection.write({ type: 'resize', cols, rows, width: 0, height: 0 });
        }
    }
    close() {
        this.closed = true;
        for (const id of [...this.sessions.keys()]) this.send('term-close', { sessionId: id });
    }
}
module.exports = { TerminalSessions };
