const { contextBridge, ipcRenderer, clipboard } = require('electron');
const { getChannels } = require('./ipc-loader');

const channels = getChannels();
const validSendChannels = ['term-input', 'term-resize', 'term-close'];
const validOnChannels = ['term-data', 'ssh-ready', 'term-error', 'term-disconnected', 'updater:status', 'sftp:copy-progress', 'ai:stream', 'mcp:open-terminal'];
const pendingChannelEvents = new Map();
const channelListeners = new Map();
const MAX_PENDING_EVENTS_PER_CHANNEL = 200;

validOnChannels.forEach((channel) => {
    pendingChannelEvents.set(channel, []);
    channelListeners.set(channel, new Set());

    ipcRenderer.on(channel, (event, ...args) => {
        const listeners = channelListeners.get(channel);
        if (listeners && listeners.size > 0) {
            listeners.forEach((listener) => {
                try {
                    listener(event, ...args);
                } catch (err) {
                    console.error(`IPC listener failed for ${channel}:`, err);
                }
            });
            return;
        }

        const queue = pendingChannelEvents.get(channel);
        if (!queue) return;

        queue.push(args);
        if (queue.length > MAX_PENDING_EVENTS_PER_CHANNEL) {
            queue.shift();
        }
    });
});

const api = {
    send: (channel, data) => {
        if (validSendChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        if (!validOnChannels.includes(channel) || typeof func !== 'function') {
            return { dispose: () => {} };
        }

        const listeners = channelListeners.get(channel);
        listeners.add(func);

        const queue = pendingChannelEvents.get(channel);
        if (queue && queue.length > 0) {
            const pending = queue.splice(0, queue.length);
            pending.forEach((args) => {
                try {
                    func(undefined, ...args);
                } catch (err) {
                    console.error(`IPC listener failed for queued ${channel}:`, err);
                }
            });
        }

        return {
            dispose: () => {
                const activeListeners = channelListeners.get(channel);
                if (!activeListeners) return;
                activeListeners.delete(func);
            }
        };
    }
};

Object.keys(channels).forEach(moduleName => {
  api[moduleName] = {};
  Object.keys(channels[moduleName]).forEach(handlerName => {
    const channelName = channels[moduleName][handlerName];
    api[moduleName][handlerName] = (...args) => ipcRenderer.invoke(channelName, ...args);
  });
});

contextBridge.exposeInMainWorld('electronAPI', api);

contextBridge.exposeInMainWorld('clipboard', {
  readText: () => clipboard.readText(),
  writeText: (text) => clipboard.writeText(text)
});
