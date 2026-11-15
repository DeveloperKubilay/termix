const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// Set the test data root before modules resolve profile paths.
const userData = path.join(app.getPath('appData'), 'Termix Store Test');
fs.mkdirSync(userData, { recursive: true });
app.setName('Termix Store Test');
app.setPath('userData', userData);

require('../../index');
