const express = require('express');
const router = express.Router();
const phongSuDungKhoService = require('../services/phongSuDungKhoService');

/**
 * Lấy toàn bộ dữ liệu cấu hình Phòng ban sử dụng kho vật tư của 1 trạm
 * GET /api/phong-su-dung-kho/station-data?stationId=...
 */
router.get('/station-data', async (req, res) => {
  try {
    const { stationId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const data = await phongSuDungKhoService.getStationData(stationId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Lỗi lấy dữ liệu phòng sử dụng kho:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Lấy danh sách phòng theo Khoa của 1 trạm
 * GET /api/phong-su-dung-kho/phong-by-khoa?stationId=...&khoaId=...
 */
router.get('/phong-by-khoa', async (req, res) => {
  try {
    const { stationId, khoaId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const data = await phongSuDungKhoService.getPhongByKhoa(stationId, khoaId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Lưu / Thêm mới cấu hình phòng ban sử dụng kho vật tư tại 1 trạm
 * POST /api/phong-su-dung-kho/create
 */
router.post('/create', async (req, res) => {
  try {
    const { stationId, ...payload } = req.body;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const data = await phongSuDungKhoService.createStationConfig(stationId, payload);
    res.json({
      success: true,
      message: 'Lưu cấu hình phòng ban sử dụng kho vật tư thành công!',
      data
    });
  } catch (err) {
    console.error('Lỗi lưu phòng sử dụng kho:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Cập nhật STT order của 1 dòng cấu hình kho
 * POST /api/phong-su-dung-kho/update-stt
 */
router.post('/update-stt', async (req, res) => {
  try {
    const { stationId, id, stt } = req.body;
    if (!stationId || id == null) {
      return res.status(400).json({ success: false, message: 'Thiếu stationId hoặc id' });
    }
    const data = await phongSuDungKhoService.updateStationStt(stationId, id, stt);
    res.json({
      success: true,
      message: 'Cập nhật Stt order thành công!',
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xóa 1 dòng cấu hình phòng ban sử dụng kho vật tư
 * DELETE /api/phong-su-dung-kho/delete?stationId=...&id=...
 */
router.delete('/delete', async (req, res) => {
  try {
    const { stationId, id } = req.query;
    if (!stationId || !id) {
      return res.status(400).json({ success: false, message: 'Thiếu stationId hoặc id' });
    }
    const data = await phongSuDungKhoService.deleteStationConfig(stationId, id);
    res.json({
      success: true,
      message: 'Xóa cấu hình phòng sử dụng kho thành công!',
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Đồng bộ / Thêm cấu hình phòng sử dụng kho vật tư hàng loạt cho nhiều trạm
 * POST /api/phong-su-dung-kho/batch-create
 */
router.post('/batch-create', async (req, res) => {
  try {
    const data = await phongSuDungKhoService.batchCreateForStations(req.body || {});
    res.json({
      success: true,
      message: `Đã xử lý ${data.totalStations} trạm: Thêm mới ${data.totalAdded}, bỏ qua trùng ${data.totalSkipped}`,
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xuất Excel danh sách phòng ban sử dụng kho vật tư của 1 trạm
 * GET /api/phong-su-dung-kho/export-excel?stationId=...
 */
router.get('/export-excel', async (req, res) => {
  try {
    const { stationId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const buffer = await phongSuDungKhoService.exportExcel(stationId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Phong_Su_Dung_Kho_${stationId}_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
