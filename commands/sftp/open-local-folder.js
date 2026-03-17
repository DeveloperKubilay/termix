const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = function openLocalFolder(filesPath, targetPath) {
    if (!targetPath) {
        return { success: false, message: 'No target path provided.' };
    }

    const resolved = path.resolve(String(targetPath));

    if (!fs.existsSync(resolved)) {
        return { success: false, message: 'Path does not exist: ' + resolved };
    }

    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
        return { success: false, message: 'Path is not a directory: ' + resolved };
    }

    const platform = process.platform;
    let command;

    if (platform === 'win32') {
        command = `explorer "${resolved}"`;
    } else if (platform === 'darwin') {
        command = `open "${resolved}"`;
    } else {
        command = `xdg-open "${resolved}"`;
    }

    return new Promise((resolve) => {
        exec(command, (error) => {
            if (error) {
                // explorer on Windows exits with code 1 even on success; ignore that
                if (platform === 'win32' && error.code === 1) {
                    resolve({ success: true });
                    return;
                }
                console.error('Failed to open folder:', error);
                resolve({ success: false, message: error.message || String(error) });
                return;
            }
            resolve({ success: true });
        });
    });
};
