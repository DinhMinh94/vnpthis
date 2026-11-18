const express = require('express');
const router = express.Router();
const cauHinhMenuService = require('../services/cauHinhMenuService');

/**
 * Tải toàn bộ danh sách cấu hình menu / button / tab của 1 trạm
 * GET /api/cauhinh-menu/station-data?stationId=...&forceRefresh=true
 */
router.get('/station-data', async (req, res) => {
  try {
    const { stationId, forceRefresh } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const data = await cauHinhMenuService.getStationMenuData(stationId, {
      forceRefresh: forceRefresh === 'true'
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('Lỗi tải cấu hình menu:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Test thử (Dry-Run) hoặc Cập nhật thật cấu hình menu cho 1 trạm / nhiều trạm / ALL 43 trạm
 * POST /api/cauhinh-menu/execute
 */
router.post('/execute', async (req, res) => {
  try {
    const result = await cauHinhMenuService.executeMenuUpdateForStations(req.body || {});
    const msg = result.dryRun
      ? `[TEST THỬ AN TOÀN] Đã kiểm tra ${result.totalStations} trạm: ${result.willUpdateCount} trạm sẽ thay đổi, ${result.unchangedCount} trạm đã khớp sẵn, ${result.notFoundCount} trạm không có mục này.`
      : `[CẬP NHẬT THÀNH CÔNG] Đã cập nhật ${result.updatedCount}/${result.totalStations} trạm (Giữ nguyên: ${result.unchangedCount}, Lỗi: ${result.errorCount}).`;
    res.json({
      success: true,
      message: msg,
      data: result
    });
  } catch (err) {
    console.error('Lỗi thực thi cấu hình menu:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Xuất file Excel danh sách cấu hình menu của 1 trạm
 * GET /api/cauhinh-menu/export-excel?stationId=...&nhomId=...
 */
router.get('/export-excel', async (req, res) => {
  try {
    const { stationId, nhomId } = req.query;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số stationId' });
    }
    const buffer = await cauHinhMenuService.exportStationMenuExcel(stationId, nhomId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="CauHinh_Menu_HMIS_${stationId}_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
