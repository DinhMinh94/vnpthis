const path = require('path');

module.exports = {
  PORT: process.env.PORT || 5000,
  DATA_DIR: path.join(__dirname, '../../data'),
  DB_FILE: path.join(__dirname, '../../data/stations.json'),
  SETTINGS_FILE: path.join(__dirname, '../../data/settings.json'),
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'vnpt-his-secret-key-32-chars-long!',
  DEFAULT_HIS_URL: 'https://his-portal.vnpt.vn',
  MAX_CONCURRENT_TESTS: 5,
  SECURITY_PIN: process.env.SECURITY_PIN || null
};
