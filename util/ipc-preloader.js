const { contextBridge, ipcRenderer, clipboard } = require('electron');
const { getChannels } = require('./ipc-loader');

const channels = getChannels();
const api = {
    send: (channel, data) => {
        // Allow-list channels for security if needed, but for now open
        let validChannels = ['term-input', 'term-resize', 'term-close'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        let validChannels = ['term-data', 'ssh-ready', 'term-error', 'term-disconnected'];
        if (validChannels.includes(channel)) {
            // Remove existing listeners to avoid duplicates if any (basic implementation)
            // ipcRenderer.removeAllListeners(channel); 
            ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
        }
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
