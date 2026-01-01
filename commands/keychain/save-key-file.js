const fs = require('fs').promises;
const path = require('path');

module.exports = async function(filesPath, oldFileName, newFileName, content) {
    try {
        const oldFilePath = path.join(filesPath, oldFileName);
        const newFilePath = path.join(filesPath, newFileName);
        
        // Security check to prevent directory traversal
        if (!oldFilePath.startsWith(filesPath) || !newFilePath.startsWith(filesPath)) {
            throw new Error('Access denied');
        }

        // If filename changed, rename first
        if (oldFileName !== newFileName) {
            // Check if old file exists
            try {
                await fs.access(oldFilePath);
                // Rename
                await fs.rename(oldFilePath, newFilePath);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    // Old file doesn't exist, just write to new file
                } else {
                    throw err;
                }
            }
        }

        await fs.writeFile(newFilePath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        console.error('Error saving key file:', error);
        return { success: false, error: error.message };
    }
};
