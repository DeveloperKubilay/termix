const fs = require('fs');
const path = require('path');

function scanHandlers() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const modules = fs.readdirSync(commandsPath, { withFileTypes: true });
  
  const channels = {};

  modules.forEach(module => {
    if (module.isDirectory()) {
      const modulePath = path.join(commandsPath, module.name);
      const files = fs.readdirSync(modulePath);
      
      files.forEach(file => {
        if (file.endsWith('.js')) {
          const handlerName = file.replace('.js', '');
          const channelName = `${module.name}:${handlerName}`;
          const camelCase = handlerName.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          
          if (!channels[module.name]) {
            channels[module.name] = {};
          }
          
          channels[module.name][camelCase] = {
            channelName,
            path: path.join(modulePath, file)
          };
        }
      });
    }
  });

  return channels;
}

function loadIPC() {
  const { ipcMain } = require('electron');
  const channels = scanHandlers();
  const filesPath = path.join(__dirname, '..', 'files');
  
  const loaded = [];

  Object.keys(channels).forEach(moduleName => {
    Object.keys(channels[moduleName]).forEach(handlerName => {
      const { channelName, path: handlerPath } = channels[moduleName][handlerName];
      const handler = require(handlerPath);
      
      ipcMain.handle(channelName, async (event, ...args) => {
        return handler(filesPath, ...args, event);
      });
      
      loaded.push(channelName);
    });
  });

  return loaded;
}

function getChannels() {
  const channels = scanHandlers();
  const api = {};

  Object.keys(channels).forEach(moduleName => {
    api[moduleName] = {};
    Object.keys(channels[moduleName]).forEach(handlerName => {
      api[moduleName][handlerName] = channels[moduleName][handlerName].channelName;
    });
  });

  return api;
}

module.exports = { loadIPC, getChannels };
