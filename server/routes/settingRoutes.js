const express = require('express');
const router = express.Router();
const db = require('../services/db');

router.get('/', (req, res) => {
  try {
    const settings = db.getSettings();
    // Ẩn securityPin gốc trong API để bảo mật
    const safeSettings = {
      ...settings,
      hasSecurityPin: !!settings.securityPin
    };
    delete safeSettings.securityPin;
    res.json({ success: true, data: safeSettings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/', (req, res) => {
  try {
    const updated = db.updateSettings(req.body);
    const safeUpdated = { ...updated, hasSecurityPin: !!updated.securityPin };
    delete safeUpdated.securityPin;
    res.json({ success: true, message: 'Đã lưu cài đặt hệ thống', data: safeUpdated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Xác thực Mã PIN bảo vệ hệ thống
router.post('/verify-pin', (req, res) => {
  try {
    const { pin } = req.body;
    const settings = db.getSettings();
    const systemPin = String(settings.securityPin || '123456').trim();

    if (String(pin).trim() === systemPin) {
      return res.json({ success: true, message: 'Xác thực Mã PIN thành công!' });
    }
    return res.status(401).json({ success: false, message: 'Mã PIN không đúng, vui lòng thử lại!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Đổi Mã PIN bảo vệ
router.post('/change-pin', (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    const settings = db.getSettings();
    const systemPin = String(settings.securityPin || '123456').trim();

    if (String(oldPin).trim() !== systemPin) {
      return res.status(400).json({ success: false, message: 'Mã PIN hiện tại không chính xác!' });
    }

    if (!newPin || String(newPin).length < 4 || String(newPin).length > 8) {
      return res.status(400).json({ success: false, message: 'Mã PIN mới phải có độ dài từ 4 đến 8 chữ số!' });
    }

    const updated = db.updateSettings({ ...settings, securityPin: String(newPin).trim() });
    res.json({ success: true, message: 'Đổi Mã PIN bảo mật thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
