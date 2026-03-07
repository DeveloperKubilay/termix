const { shell } = require('electron');

const SOURCE_CODE_URL = 'https://github.com/DeveloperKubilay/termix';

module.exports = async function () {
    await shell.openExternal(SOURCE_CODE_URL);

    return {
        success: true,
        url: SOURCE_CODE_URL
    };
};
