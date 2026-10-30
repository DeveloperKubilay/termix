'use strict';
const { Duplex } = require('stream');
class MemorySocket extends Duplex {
    constructor(peer) {
        super();
        this.peer = peer || null;
        if (peer) peer.peer = this;
        this.destroyed = false;
    }
    _write(chunk, enc, cb) {
        if (this.peer && !this.peer.destroyed) this.peer.push(chunk);
        cb();
    }
    _read() {}
    destroy() {
        if (this.destroyed) return this;
        this.destroyed = true;
        this.emit('close');
        if (this.peer && !this.peer.destroyed) this.peer.push(null);
        this.push(null);
        return this;
    }
}
function createSocketPair() {
    const a = new MemorySocket();
    const b = new MemorySocket(a);
    return [a, b];
}
module.exports = { createSocketPair };
