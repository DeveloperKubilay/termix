const { contextBridge, ipcRenderer, clipboard } = require('electron');
const { getChannels } = require('./ipc-loader');

const channels = getChannels();
const api = {};

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
