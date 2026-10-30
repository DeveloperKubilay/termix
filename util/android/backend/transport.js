'use strict';
const { EventEmitter } = require('events');
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED_BYTES = 2 * MAX_FRAME_BYTES;

function encodeFrame(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (!body.length || body.length > MAX_FRAME_BYTES) throw Object.assign(new Error('JSON frame exceeds the 4 MB limit.'), { code: 'FRAME_TOO_LARGE' });
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(body.length);
    return Buffer.concat([header, body]);
}

class FramedTransport extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.header = Buffer.alloc(4);
        this.headerUsed = 0;
        this.body = null;
        this.bodyUsed = 0;
        socket.on('data', (chunk) => this.receive(chunk));
        socket.on('error', () => this.close());
        socket.once('close', () => this.emit('close'));
    }
    receive(chunk) {
        try {
            let offset = 0;
            while (offset < chunk.length) {
                if (!this.body) {
                    const count = Math.min(4 - this.headerUsed, chunk.length - offset);
                    chunk.copy(this.header, this.headerUsed, offset, offset + count);
                    this.headerUsed += count;
                    offset += count;
                    if (this.headerUsed !== 4) continue;
                    const length = this.header.readUInt32BE(0);
                    if (!length || length > MAX_FRAME_BYTES) throw new Error('Invalid frame length.');
                    this.body = Buffer.allocUnsafe(length);
                    this.bodyUsed = 0;
                    this.headerUsed = 0;
                }
                const count = Math.min(this.body.length - this.bodyUsed, chunk.length - offset);
                chunk.copy(this.body, this.bodyUsed, offset, offset + count);
                this.bodyUsed += count;
                offset += count;
                if (this.bodyUsed === this.body.length) {
                    const body = this.body;
                    this.body = null;
                    const message = JSON.parse(body.toString('utf8'));
                    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Expected a JSON message object.');
                    this.emit('message', message);
                }
            }
        } catch (_) {
            // Invalid peers cannot allocate unbounded buffers or continue framing.
            this.close();
        }
    }
    send(message) {
        if (this.socket.destroyed) return false;
        const frame = encodeFrame(message);
        if (this.socket.writableLength + frame.length > MAX_QUEUED_BYTES) {
            this.close();
            return false;
        }
        this.socket.write(frame);
        return true;
    }
    close() { this.socket.destroy(); }
}
module.exports = { FramedTransport, encodeFrame, MAX_FRAME_BYTES };
