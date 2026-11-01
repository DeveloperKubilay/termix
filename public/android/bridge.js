/* Android WebMessageListener transport. Load before app.js; desktop is untouched. */
(function (global) {
    'use strict';
    const bridge = global.termixNative;
    if (!bridge || typeof bridge.postMessage !== 'function') return;

    const MAX_PENDING = 128;
    const MAX_EARLY_EVENTS = 200;
    const MAX_EARLY_BYTES = 1024 * 1024;
    const eventChannels = new Set([
        'term-data', 'ssh-ready', 'term-error', 'term-disconnected',
        'sftp:copy-progress', 'android:host-key', 'android:transfer-progress',
        'android:all-connections-stopped'
    ]);
    const listeners = new Map();
    const earlyEvents = new Map();
    const pending = new Map();
    let earlyBytes = 0;
    let sequence = 0;
    let ready = false;
    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // A packer must await this before loading app.js. No synthetic readiness.
    global.termixAndroidReady = readyPromise;

    const android = {
        protocol: 1,
        capabilities: Object.freeze({}),
        hasCapability(name) { return this.capabilities[name] === true; },
        invoke,
        showKeyboard: () => invoke('native:show-keyboard'),
        ready: readyPromise
    };
    global.TermixAndroid = android;
    if (global.document) global.document.documentElement.classList.add('termix-android');

    function transportError(message, code) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function post(message) {
        bridge.postMessage(JSON.stringify(message));
    }

    async function invoke(channel, ...args) {
        await readyPromise;
        if (pending.size >= MAX_PENDING) throw transportError('Too many pending Android requests.', 'BUSY');
        const id = `web-${++sequence}`;
        return new Promise((resolve, reject) => {
            // Pickers wait for the user; transfers have native idle/cancellation deadlines.
            const waitsForNative = ['native:export-file', 'native:import-key', 'native:pick-upload-file', 'native:create-download-document', 'native:transfer-run'].includes(channel);
            const timer = waitsForNative ? null : global.setTimeout(() => {
                pending.delete(id);
                reject(transportError(`Android request timed out: ${channel}`, 'TIMEOUT'));
            }, channel === 'connection:connect' || channel === 'sftp:connect' ? 120000 : 60000);
            pending.set(id, { resolve, reject, timer });
            try {
                post({ type: 'request', id, channel, args });
            } catch (error) {
                global.clearTimeout(timer);
                pending.delete(id);
                reject(error);
            }
        });
    }

    function deliver(callback, payload) {
        try { callback(undefined, payload); }
        catch (error) { console.error('Android event listener failed:', error); }
    }

    function on(channel, callback) {
        if (!eventChannels.has(channel) || typeof callback !== 'function') return { dispose() {} };
        let callbacks = listeners.get(channel);
        if (!callbacks) listeners.set(channel, callbacks = new Set());
        callbacks.add(callback);
        const queued = earlyEvents.get(channel);
        if (queued) {
            earlyEvents.delete(channel);
            queued.forEach((entry) => {
                earlyBytes -= entry.size;
                if (callbacks.has(callback)) deliver(callback, entry.payload);
            });
        }
        return { dispose() { callbacks.delete(callback); } };
    }

    bridge.onmessage = function (event) {
        let message;
        try {
            message = JSON.parse(typeof event === 'string' ? event : event.data);
        } catch (_) { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') {
            if (ready) return;
            if (message.protocol !== 1) {
                rejectReady(transportError('Unsupported Android bridge protocol.', 'PROTOCOL'));
                return;
            }
            ready = true;
            android.capabilities = Object.freeze({ ...(message.capabilities || {}) });
            resolveReady(android);
            return;
        }
        if (message.type === 'response') {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            global.clearTimeout(request.timer);
            if (message.error) request.reject(transportError(message.error.message || 'Android request failed.', message.error.code || 'NATIVE_ERROR'));
            else request.resolve(message.result);
            return;
        }
        if (message.type !== 'event' || !eventChannels.has(message.channel)) return;
        const callbacks = listeners.get(message.channel);
        if (callbacks && callbacks.size) {
            Array.from(callbacks).forEach(callback => deliver(callback, message.payload));
            return;
        }
        let queue = earlyEvents.get(message.channel);
        if (!queue) earlyEvents.set(message.channel, queue = []);
        const size = JSON.stringify(message.payload ?? null).length * 2;
        if (size > MAX_EARLY_BYTES) return;
        queue.push({ payload: message.payload, size });
        earlyBytes += size;
        while (queue.length > MAX_EARLY_EVENTS) earlyBytes -= queue.shift().size;
        // Limit memory across all channels as well as per-channel event count.
        while (earlyBytes > MAX_EARLY_BYTES) {
            const oldestQueue = Array.from(earlyEvents.values()).find(entries => entries.length);
            if (!oldestQueue) break;
            earlyBytes -= oldestQueue.shift().size;
        }
    };

    // Exact IPC filenames: module names retain hyphens, methods use preload camelCase.
    const commands = {
        hosts: ['get-data', 'set-data', 'get-tags', 'add-tag', 'delete-tag', 'get-serial-ports', 'update-terminal-font-size'],
        connection: ['connect', 'get-settings', 'save-settings'],
        profiles: ['get-profiles', 'create-profile', 'switch-profile', 'delete-profile'],
        keychain: ['get-key-files', 'read-key-file', 'save-key-file', 'delete-key-file', 'open-files-folder'],
        'known-hosts': ['get-hosts', 'delete-host'],
        snippets: ['get-snippets', 'save-snippet', 'delete-snippet', 'import-from-url'],
        sftp: ['connect', 'disconnect', 'list-directory', 'read-file', 'write-file', 'create-file', 'create-directory', 'rename-item', 'delete-items', 'copy-items', 'open-local-folder'],
        settings: ['get-settings', 'save-settings', 'get-update-settings', 'set-update-settings', 'check-for-updates', 'download-update', 'install-update', 'open-config-file', 'open-profile-folder', 'open-source-code', 'sync-firebase'],
        'port-forwarding': ['get-forwards', 'save-forward', 'delete-forward', 'start-forward'],
        mcp: ['get-settings', 'save-settings', 'get-status', 'regenerate-token'],
        ai: ['ask']
    };
    const api = {
        on,
        send(channel, payload) {
            if (!['term-input', 'term-resize', 'term-close'].includes(channel)) return;
            if (!ready) throw transportError('Android backend is not ready.', 'NOT_READY');
            post({ type: 'send', channel, payload });
        }
    };
    Object.entries(commands).forEach(([moduleName, handlers]) => {
        api[moduleName] = {};
        handlers.forEach(handler => {
            const method = handler.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            api[moduleName][method] = (...args) => invoke(`${moduleName}:${handler}`, ...args);
        });
    });
    global.electronAPI = api;
    global.clipboard = {
        readText: () => invoke('native:clipboard-read-text'),
        writeText: text => invoke('native:clipboard-write-text', String(text))
    };
    // Establish the origin-bound native reply proxy, then receive buffered ready/events.
    post({ type: 'bridge:attach' });
})(window);
