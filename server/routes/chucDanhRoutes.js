const express = require('express');
const router = express.Router();
const chucDanhService = require('../services/chucDanhService');
const db = require('../services/db');

/**
 * Lấy danh sách chức danh ký số từ cache
 * GET /api/chucdanh/list
 */
router.get('/list', (req, res) => {
  try {
    const list = chucDanhService.getCachedChucDanh();
    const config = chucDanhService.getEndpointConfig();
    res.json({ success: true, count: list.length, data: list, config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Lấy cấu hình endpoint API
 * GET /api/chucdanh/config
 */
router.get('/config', (req, res) => {
  try {
    res.json({ success: true, data: chucDanhService.getEndpointConfig() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật cấu hình endpoint API (F12 hoặc thủ công)
 * POST /api/chucdanh/config
 */
router.post('/config', (req, res) => {
  try {
    const { searchPath, createPath, updatePath, deletePath, fullUrl } = req.body;
    let newCfg = {};
    if (fullUrl) {
      const match = fullUrl.match(/api\/(.+?)(\?|$)/);
      if (match) {
        const basePath = match[1].replace(/\/(search|create|update|delete)$/, '');
        newCfg.searchPath = `${basePath}/search`;
        newCfg.createPath = `${basePath}/create`;
        newCfg.updatePath = `${basePath}/update`;
        newCfg.deletePath = `${basePath}/delete`;
      }
    }
    if (searchPath) newCfg.searchPath = searchPath;
    if (createPath) newCfg.createPath = createPath;
    if (updatePath) newCfg.updatePath = updatePath;
    if (deletePath) newCfg.deletePath = deletePath;

    chucDanhService.saveEndpointConfig(newCfg);
    res.json({
      success: true,
      message: 'Đã lưu cấu hình endpoint API chức danh ký số',
      data: chucDanhService.getEndpointConfig()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Làm mới / tải danh sách từ cổng HMIS
 * POST /api/chucdanh/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { stationId } = req.body;
    const result = await chucDanhService.fetchChucDanhFromHmis(stationId);
    res.json({
      success: true,
      message: `Đã tải thành công ${result.total} chức danh ký số từ cổng HMIS!`,
      count: result.total,
      data: result.list
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Thêm mới hoặc cập nhật chức danh ký số cho danh sách các trạm y tế
 * POST /api/chucdanh/batch-create
 */
router.post('/batch-create', async (req, res) => {
  try {
    const { stationIds, titleData, updateIfExists } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 trạm y tế' });
    }
    if (!titleData || !titleData.titleCode || !titleData.titleName) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập Mã chức danh và Tên chức danh' });
    }

    const result = await chucDanhService.createChucDanhForStations(
      stationIds,
      titleData,
      updateIfExists !== false
    );

    res.json({
      success: true,
      message: `Đã xử lý cho ${result.successCount}/${result.total} trạm thành công!`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xóa chức danh ký số khỏi danh sách trạm y tế
 * POST /api/chucdanh/batch-delete
 */
router.post('/batch-delete', async (req, res) => {
  try {
    const { stationIds, titleCode } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 trạm y tế' });
    }
    if (!titleCode) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mã chức danh cần xóa' });
    }

    const result = await chucDanhService.deleteChucDanhForStations(stationIds, titleCode);
    res.json({
      success: true,
      message: `Đã xử lý xóa cho ${result.successCount}/${result.total} trạm`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
