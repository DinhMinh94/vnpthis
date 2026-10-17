const express = require('express');
const router = express.Router();
const logService = require('../services/logService');

/**
 * Lấy danh sách nhật ký cấu hình hệ thống
 */
router.get('/', (req, res) => {
  try {
    const { actionType, search, page, limit } = req.query;
    const result = logService.getLogs({ actionType, search, page, limit });
    res.json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xuất file Excel toàn bộ nhật ký hệ thống
 */
router.get('/export-excel', (req, res) => {
  try {
    const buffer = logService.exportLogsToExcelBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Nhat_Ky_Cau_Hinh_He_Thong_${dateStr}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xóa 1 bản ghi log theo ID
 */
router.delete('/:id', (req, res) => {
  try {
    const success = logService.deleteLog(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi nhật ký' });
    }
    res.json({ success: true, message: 'Đã xóa bản ghi nhật ký thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xóa toàn bộ nhật ký hệ thống
 */
router.delete('/', (req, res) => {
  try {
    logService.clearLogs();
    res.json({ success: true, message: 'Đã xóa toàn bộ nhật ký hệ thống' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
