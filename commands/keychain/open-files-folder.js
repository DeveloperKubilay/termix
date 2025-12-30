const fs = require('fs');
const { exec } = require('child_process');

module.exports = function openFilesFolder(filesPath) {
  if (!fs.existsSync(filesPath)) {
    fs.mkdirSync(filesPath, { recursive: true });
  }

  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `explorer "${filesPath}"`;
  } else if (platform === 'darwin') {
    command = `open "${filesPath}"`;
  } else {
    command = `xdg-open "${filesPath}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.error('Failed to open folder:', error);
    }
  });

  return { success: true };
};
