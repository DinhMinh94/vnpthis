const express = require('express');
const router = express.Router();
const nhanVienHmisService = require('../services/nhanVienHmisService');
const db = require('../services/db');

/**
 * Lấy danh sách các trạm y tế sẵn sàng kết nối HMIS
 * GET /api/nhanvien-hmis/stations
 */
router.get('/stations', (req, res) => {
  try {
    const stations = db.getStations(false);
    const validStations = stations.filter(s => s.username && s.url && s.url.includes('hmis.vn'));
    res.json({
      success: true,
      count: validStations.length,
      data: validStations.map(s => ({
        id: s.id,
        name: s.name,
        code: s.code,
        username: s.username,
        district: s.district || '',
        status: s.status || 'unknown'
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Tải toàn bộ nhân viên, tài khoản, nhóm quyền và chức danh ký số của 1 trạm
 * GET /api/nhanvien-hmis/data?stationId=...
 */
router.get('/data', async (req, res) => {
  try {
    const { stationId } = req.query;
    const data = await nhanVienHmisService.getStationNhanVienData(stationId);
    res.json(data);
  } catch (error) {
    console.error('Lỗi tải dữ liệu nhân viên HMIS:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Lấy chi tiết 1 tài khoản người dùng
 * GET /api/nhanvien-hmis/detail?stationId=...&userId=...
 */
router.get('/detail', async (req, res) => {
  try {
    const { stationId, userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Thiếu userId' });
    }
    const data = await nhanVienHmisService.getUserDetail(stationId, userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật phân công nhóm quyền & chức danh cho 1 tài khoản
 * PUT /api/nhanvien-hmis/update
 */
router.put('/update', async (req, res) => {
  try {
    const stationId = req.body.stationId;
    const userId = req.body.userId;
    const updateData = req.body.updateData || req.body;
    if (!stationId || !userId) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin cập nhật (stationId, userId)' });
    }
    const specificPart = req.body.specificPart || updateData.specificPart || 'all';
    const result = await nhanVienHmisService.updateUserPhanCong(stationId, userId, updateData, specificPart);
    res.json(result);
  } catch (error) {
    console.error('Lỗi cập nhật người dùng:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật phân công đồng thời cho nhiều tài khoản đã tích chọn
 * PUT /api/nhanvien-hmis/update-multiple
 */
router.put('/update-multiple', async (req, res) => {
  try {
    const stationId = req.body.stationId;
    const userIds = req.body.userIds;
    const updateData = req.body.updateData || req.body;
    const specificPart = req.body.specificPart || 'all';
    if (!stationId || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin cập nhật (stationId, userIds)' });
    }
    const result = await nhanVienHmisService.updateMultipleUsersPhanCong(stationId, userIds, updateData, specificPart);
    res.json(result);
  } catch (error) {
    console.error('Lỗi cập nhật nhiều người dùng:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Phân công hàng loạt chức danh và nhóm quyền cho nhiều trạm hoặc nhiều người dùng
 * POST /api/nhanvien-hmis/batch-assign
 */
router.post('/batch-assign', async (req, res) => {
  try {
    const result = await nhanVienHmisService.batchAssignNhanVien(req.body);
    res.json(result);
  } catch (error) {
    console.error('Lỗi phân công hàng loạt:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
