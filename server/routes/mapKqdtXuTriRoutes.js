const express = require('express');
const router = express.Router();
const mapKqdtXuTriService = require('../services/mapKqdtXuTriService');

/**
 * Lấy dữ liệu map kết quả điều trị - xử trí của 1 trạm
 * GET /api/map-kqdt-xutri/station-data?stationId=...
 */
router.get('/station-data', async (req, res) => {
  try {
    const { stationId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const data = await mapKqdtXuTriService.getStationData(stationId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Lỗi lấy dữ liệu map KQDT - xử trí:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Lưu cấu hình mapping cho 1 kết quả điều trị tại 1 trạm
 * POST /api/map-kqdt-xutri/save
 */
router.post('/save', async (req, res) => {
  try {
    const { stationId, ...payload } = req.body;
    if (!stationId || payload.ketQuaDieuTriId == null) {
      return res.status(400).json({ success: false, message: 'Thiếu stationId hoặc ketQuaDieuTriId' });
    }
    const result = await mapKqdtXuTriService.saveStationMapping(stationId, payload);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi lưu map KQDT - xử trí:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xóa toàn bộ mapping của 1 kết quả điều trị tại 1 trạm
 * POST /api/map-kqdt-xutri/delete
 */
router.post('/delete', async (req, res) => {
  try {
    const { stationId, ketQuaDieuTriId } = req.body;
    if (!stationId || ketQuaDieuTriId == null) {
      return res.status(400).json({ success: false, message: 'Thiếu stationId hoặc ketQuaDieuTriId' });
    }
    const result = await mapKqdtXuTriService.deleteStationMapping(stationId, ketQuaDieuTriId);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi xóa map KQDT - xử trí:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PHÂN CÔNG / THÊM XỬ TRÍ CHO TẤT CẢ CÁC TRẠM ĐÃ CẤU HÌNH
 * POST /api/map-kqdt-xutri/batch-add-all
 */
router.post('/batch-add-all', async (req, res) => {
  try {
    const options = req.body || {};
    const result = await mapKqdtXuTriService.batchAddXuTriAllStations(options);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Lỗi phân công xử trí hàng loạt:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xuất file Excel danh mục map của 1 trạm
 * GET /api/map-kqdt-xutri/export-excel?stationId=...
 */
router.get('/export-excel', async (req, res) => {
  try {
    const { stationId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const excelBuffer = await mapKqdtXuTriService.exportExcel(stationId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Map_KQDT_XuTri_${stationId}_${Date.now()}.xlsx"`);
    res.send(excelBuffer);
  } catch (err) {
    console.error('Lỗi xuất file Excel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
