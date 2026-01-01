const fs = require('fs').promises;
const path = require('path');

module.exports = async function(filesPath, fileName) {
    try {
        const filePath = path.join(filesPath, fileName);
        
        // Security check to prevent directory traversal
        if (!filePath.startsWith(filesPath)) {
            throw new Error('Access denied');
        }

        const content = await fs.readFile(filePath, 'utf-8');
        return { success: true, content };
    } catch (error) {
        console.error('Error reading key file:', error);
        return { success: false, error: error.message };
    }
};
