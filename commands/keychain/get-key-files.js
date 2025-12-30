const fs = require('fs');
const path = require('path');

const keyExtensions = ['.pem', '.key', '.pub', '.ppk', '.cer', '.crt', '.pfx'];

function scanDirectory(dirPath, baseDir) {
  let results = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const items = fs.readdirSync(dirPath);

  items.forEach(item => {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      results = results.concat(scanDirectory(fullPath, baseDir));
    } else {
      const ext = path.extname(item).toLowerCase();
      if (keyExtensions.includes(ext)) {
        const relativePath = path.relative(baseDir, fullPath);
        results.push({
          name: item,
          relativePath: relativePath,
          size: (stat.size / 1024).toFixed(2),
          path: fullPath
        });
      }
    }
  });

  return results;
}

module.exports = function getKeyFiles(filesPath) {
  if (!fs.existsSync(filesPath)) {
    fs.mkdirSync(filesPath, { recursive: true });
    return [];
  }

  return scanDirectory(filesPath, filesPath);
};
