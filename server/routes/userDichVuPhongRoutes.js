const express = require('express');
const router = express.Router();
const userDichVuPhongService = require('../services/userDichVuPhongService');

/**
 * Lấy dữ liệu phân công công khám & phòng khám của 1 trạm
 * GET /api/user-dichvu-phong/station-data?stationId=...
 */
router.get('/station-data', async (req, res) => {
  try {
    const { stationId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const data = await userDichVuPhongService.getStationData(stationId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Lỗi lấy dữ liệu trạm:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Lưu 1 bản ghi phân công
 * POST /api/user-dichvu-phong/save
 */
router.post('/save', async (req, res) => {
  try {
    const { stationId, ...payload } = req.body;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const result = await userDichVuPhongService.saveMapping(stationId, payload);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi lưu phân công:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xóa 1 bản ghi phân công
 * DELETE /api/user-dichvu-phong/delete
 */
router.delete('/delete', async (req, res) => {
  try {
    const { stationId, id } = req.query;
    if (!stationId || !id) {
      return res.status(400).json({ success: false, message: 'Thiếu stationId hoặc id' });
    }
    const result = await userDichVuPhongService.deleteMapping(stationId, id);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi xóa phân công:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xóa toàn bộ phân công của 1 trạm
 * POST /api/user-dichvu-phong/clear-all
 */
router.post('/clear-all', async (req, res) => {
  try {
    const { stationId } = req.body;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const result = await userDichVuPhongService.clearAllStationMappings(stationId);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi xóa tất cả phân công:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Phân công hàng loạt Yêu cầu khám - Phòng khám ALL CHO CÁC TRẠM
 * POST /api/user-dichvu-phong/batch-assign-all
 */
router.post('/batch-assign-all', async (req, res) => {
  try {
    const options = req.body || {};
    const result = await userDichVuPhongService.executeBatchAssignAllStations(options);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi phân công hàng loạt ALL trạm:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xuất file Excel danh sách map
 * GET /api/user-dichvu-phong/export-excel?stationId=...
 */
router.get('/export-excel', async (req, res) => {
  try {
    const { stationId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const buffer = await userDichVuPhongService.exportExcel(stationId);
    const fileName = `Danh_Muc_Cong_Kham_Theo_User_${stationId}_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Lỗi xuất Excel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
