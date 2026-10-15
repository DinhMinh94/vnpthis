const express = require('express');
const router = express.Router();
const phieuInService = require('../services/phieuInService');
const db = require('../services/db');

/**
 * Lấy danh sách phiếu in / báo cáo từ cache
 */
router.get('/list', (req, res) => {
  try {
    const list = phieuInService.getCachedPhieuIn();
    const config = phieuInService.getEndpointConfig();
    res.json({ success: true, count: list.length, data: list, config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Lấy cấu hình endpoint hiện tại
 */
router.get('/config', (req, res) => {
  try {
    res.json({ success: true, data: phieuInService.getEndpointConfig() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật đường dẫn endpoint HMIS (từ Network F12 hoặc tự động)
 */
router.post('/config', (req, res) => {
  try {
    const { searchPath, updatePath, fullUrl } = req.body;
    let newCfg = {};
    if (fullUrl) {
      // Tự động phân tách từ URL đầy đủ người dùng copy từ F12
      // Ví dụ: https://ytcs-gw.hmis.vn/api/common/phieuinbaocao/search?page=0&size=10
      const match = fullUrl.match(/api\/(.+?)(\?|$)/);
      if (match) {
        newCfg.searchPath = match[1];
        newCfg.updatePath = match[1].replace(/\/search$/, '/update');
      }
    }
    if (searchPath) newCfg.searchPath = searchPath;
    if (updatePath) newCfg.updatePath = updatePath;

    phieuInService.saveEndpointConfig(newCfg);
    res.json({
      success: true,
      message: 'Đã lưu cấu hình endpoint API phiếu in báo cáo',
      data: phieuInService.getEndpointConfig()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Làm mới / tải danh sách từ cổng HMIS
 */
router.post('/refresh', async (req, res) => {
  try {
    const { stationId, customSearchPath } = req.body;
    const result = await phieuInService.fetchPhieuInFromHmis(stationId, customSearchPath);
    res.json({
      success: true,
      message: `Đã tải thành công ${result.total} phiếu in / báo cáo từ cổng HMIS!`,
      count: result.total,
      data: result.list
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật cấu hình phiếu in cho tất cả các trạm đang được tích chọn
 */
router.post('/batch-update', async (req, res) => {
  try {
    const { stationIds, reportData } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 trạm y tế' });
    }
    if (!reportData || (!reportData.maBaoCao && !reportData.id)) {
      return res.status(400).json({ success: false, message: 'Thiếu dữ liệu phiếu in cần cập nhật' });
    }

    const result = await phieuInService.updatePhieuInForStations(stationIds, reportData);
    res.json({
      success: true,
      message: `Đã cập nhật phiếu in cho ${result.successCount}/${result.total} trạm thành công`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
