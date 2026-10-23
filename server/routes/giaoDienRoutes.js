const express = require('express');
const router = express.Router();
const giaoDienService = require('../services/giaoDienService');

/**
 * GET /api/giaodien/list
 * Lấy danh sách cấu hình giao diện từ cache (nếu chưa có tự làm mới từ HMIS)
 */
router.get('/list', async (req, res) => {
  try {
    let list = giaoDienService.getCachedGiaoDien();
    if (!list || list.length === 0) {
      try {
        const refreshed = await giaoDienService.refreshGiaoDienFromHmis();
        list = refreshed.list;
      } catch (e) {
        console.warn('Chưa thể tự động tải cấu hình giao diện từ HMIS:', e.message);
      }
    }
    res.json({
      success: true,
      count: list ? list.length : 0,
      data: list || []
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * POST /api/giaodien/refresh
 * Kết nối HMIS tải lại danh sách 125 cấu hình giao diện
 */
router.post('/refresh', async (req, res) => {
  try {
    const { stationId } = req.body || {};
    const result = await giaoDienService.refreshGiaoDienFromHmis(stationId);
    res.json({
      success: true,
      count: result.count,
      data: result.list,
      message: `Đã làm mới thành công ${result.count} cấu hình giao diện từ HMIS`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * POST /api/giaodien/update-bulk
 * Cập nhật cấu hình giao diện cho các trạm đã chọn hoặc tất cả các trạm
 */
router.post('/update-bulk', async (req, res) => {
  try {
    const { stationIds, targetScope, maCauHinh, updateData } = req.body || {};
    if (!maCauHinh) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp mã cấu hình (maCauHinh)'
      });
    }

    const result = await giaoDienService.updateGiaoDienForStations({
      stationIds,
      targetScope,
      maCauHinh,
      updateData
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
