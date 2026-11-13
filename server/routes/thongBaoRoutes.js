const express = require('express');
const router = express.Router();
const thongBaoService = require('../services/thongBaoService');

/**
 * Lấy danh sách thông báo đã lưu đệm
 * GET /api/thongbao/list
 */
router.get('/list', (req, res) => {
  try {
    const list = thongBaoService.getCachedThongBao();
    const options = thongBaoService.getOptions();
    res.json({
      success: true,
      total: list.length,
      data: list,
      options,
      currentDateTime: thongBaoService.formatCurrentDateTime()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Lấy danh mục các tùy chọn cấu hình
 * GET /api/thongbao/options
 */
router.get('/options', (req, res) => {
  try {
    const options = thongBaoService.getOptions();
    res.json({
      success: true,
      data: options,
      currentDateTime: thongBaoService.formatCurrentDateTime()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Làm mới danh sách thông báo từ cổng HMIS
 * POST /api/thongbao/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { stationId } = req.body;
    const result = await thongBaoService.fetchThongBaoFromHmis(stationId);
    res.json({
      success: true,
      total: result.total,
      data: result.list,
      stationName: result.stationName,
      message: `Đã nạp thành công ${result.total} thông báo từ cổng HMIS!`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Phát / Cập nhật thông báo hệ thống hàng loạt đến danh sách trạm y tế
 * POST /api/thongbao/broadcast
 */
router.post('/broadcast', async (req, res) => {
  try {
    const { stationIds, thongBaoData } = req.body;
    if (!stationIds || !Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn danh sách trạm y tế nhận thông báo'
      });
    }
    if (!thongBaoData) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp dữ liệu thông báo'
      });
    }

    const result = await thongBaoService.broadcastThongBaoToStations(stationIds, thongBaoData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xóa thông báo hàng loạt trên các trạm y tế
 * POST /api/thongbao/delete-batch
 */
router.post('/delete-batch', async (req, res) => {
  try {
    const { stationIds, tieuDe } = req.body;
    if (!stationIds || !Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn danh sách trạm y tế'
      });
    }
    if (!tieuDe) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chỉ định tiêu đề thông báo cần xóa'
      });
    }

    const result = await thongBaoService.deleteThongBaoForStations(stationIds, tieuDe);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
