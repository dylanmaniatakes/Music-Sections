const { app } = require('electron');
app.setPath('userData', process.env.MUSIC_SECTIONS_TEST_PROFILE);
require('../electron/main.cjs');
