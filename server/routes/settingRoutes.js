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

// Xác thực Mã PIN bảo vệ hệ thống (hỗ trợ tự động phục hồi khi Render restart)
router.post('/verify-pin', (req, res) => {
  try {
    const { pin, clientSavedPin } = req.body;
    const settings = db.getSettings();
    let systemPin = String(process.env.SECURITY_PIN || settings.securityPin || '123456').trim();

    // Nếu server Render vừa restart về mặc định 123456, nhưng client có lưu PIN đã đổi:
    if (clientSavedPin && String(clientSavedPin).length >= 4 && systemPin === '123456' && String(clientSavedPin).trim() !== '123456') {
      systemPin = String(clientSavedPin).trim();
      db.updateSettings({ ...settings, securityPin: systemPin });
    }

    const inputPin = String(pin).trim();
    if (inputPin === systemPin || (clientSavedPin && inputPin === String(clientSavedPin).trim())) {
      // Đảm bảo lưu đúng mã PIN vào file cấu hình
      if (systemPin !== inputPin) {
        db.updateSettings({ ...settings, securityPin: inputPin });
      }
      return res.json({ success: true, message: 'Xác thực Mã PIN thành công!' });
    }
    return res.status(401).json({ success: false, message: 'Mã PIN không đúng, vui lòng thử lại!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Tự động đồng bộ mã PIN từ client khi mở trang (phòng trường hợp Render xóa file tạm khi restart)
router.post('/sync-pin', (req, res) => {
  try {
    const { pin } = req.body;
    if (pin && String(pin).length >= 4 && String(pin).length <= 8) {
      const settings = db.getSettings();
      const currentPin = String(process.env.SECURITY_PIN || settings.securityPin || '123456').trim();
      if (currentPin === '123456' && String(pin).trim() !== '123456') {
        db.updateSettings({ ...settings, securityPin: String(pin).trim() });
        return res.json({ success: true, message: 'Đã tự động khôi phục Mã PIN' });
      }
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Đổi Mã PIN bảo vệ
router.post('/change-pin', (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    const settings = db.getSettings();
    const systemPin = String(process.env.SECURITY_PIN || settings.securityPin || '123456').trim();

    if (String(oldPin).trim() !== systemPin) {
      return res.status(400).json({ success: false, message: 'Mã PIN hiện tại không chính xác!' });
    }

    if (!newPin || String(newPin).length < 4 || String(newPin).length > 8) {
      return res.status(400).json({ success: false, message: 'Mã PIN mới phải có độ dài từ 4 đến 8 chữ số!' });
    }

    const newPinStr = String(newPin).trim();
    db.updateSettings({ ...settings, securityPin: newPinStr });
    res.json({ success: true, message: 'Đổi Mã PIN bảo mật thành công!', pin: newPinStr });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
