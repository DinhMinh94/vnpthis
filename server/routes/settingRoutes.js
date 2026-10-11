const express = require('express');
const router = express.Router();
const db = require('../services/db');

router.get('/', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/', (req, res) => {
  try {
    const updated = db.updateSettings(req.body);
    res.json({ success: true, message: 'Đã lưu cài đặt hệ thống', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
