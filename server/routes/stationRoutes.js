const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../services/db');
const excelService = require('../services/excelService');
const hisService = require('../services/hisService');
const cauhinhService = require('../services/cauhinhService');

// Cấu hình multer nhận file Excel trong RAM
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * Lấy danh sách tất cả trạm y tế
 */
router.get('/', (req, res) => {
  try {
    const showPasswords = req.query.show_passwords === 'true';
    const stations = db.getStations(showPasswords);
    res.json({ success: true, count: stations.length, data: stations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Tải file Excel toàn bộ cấu hình nghiệp vụ HMIS
 */
router.get('/cauhinh-nghiepvu/download-excel', (req, res) => {
  const filePath = require('path').join(__dirname, '../../CauHinh_NghiepVu_HMIS.xlsx');
  if (require('fs').existsSync(filePath)) {
    res.download(filePath, 'CauHinh_NghiepVu_HMIS.xlsx');
  } else {
    res.status(404).json({ success: false, message: 'Chưa có file cấu hình' });
  }
});

/**
 * Lấy dữ liệu JSON toàn bộ cấu hình nghiệp vụ HMIS
 */
router.get('/cauhinh-nghiepvu', (req, res) => {
  try {
    const list = cauhinhService.getCachedCauHinh();
    res.json({ success: true, count: list.length, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Refresh / Làm mới cấu hình nghiệp vụ trực tiếp từ HMIS
 */
router.post('/cauhinh-nghiepvu/refresh', async (req, res) => {
  try {
    const { stationId } = req.body;
    const result = await cauhinhService.refreshCauHinhFromHmis(stationId);
    res.json({
      success: true,
      message: `Đã làm mới thành công ${result.count} nhóm cấu hình và ${result.paramCount} tham số từ cổng HMIS!`,
      count: result.count,
      paramCount: result.paramCount,
      data: result.list
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Sửa tham số cấu hình nhanh cho các trạm đang được tích chọn
 */
router.post('/cauhinh-nghiepvu/batch-update-param', async (req, res) => {
  try {
    const { stationIds, maCauHinh, paramKey, paramValue } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 trạm y tế' });
    }
    if (!maCauHinh || !paramKey) {
      return res.status(400).json({ success: false, message: 'Thiếu mã cấu hình hoặc khóa tham số' });
    }

    const result = await cauhinhService.updateParamForStations(stationIds, maCauHinh, paramKey, paramValue);
    res.json({
      success: true,
      message: `Đã cập nhật tham số cho ${result.successCount}/${result.total} trạm thành công`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Lấy chi tiết 1 trạm
 */
router.get('/:id', (req, res) => {
  try {
    const station = db.getStationById(req.params.id, true);
    if (!station) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trạm' });
    }
    res.json({ success: true, data: station });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Thêm mới 1 trạm
 */
router.post('/', (req, res) => {
  try {
    const { name, code, district, url, username, password, notes, active } = req.body;
    if (!name || !username) {
      return res.status(400).json({ success: false, message: 'Tên trạm và tên đăng nhập là bắt buộc' });
    }
    const newStation = db.addStation({ name, code, district, url, username, password, notes, active });
    res.status(201).json({ success: true, message: 'Thêm trạm thành công', data: newStation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Thiết lập nhanh hàng loạt (Batch Upsert 15-20 trạm)
 */
router.post('/batch', (req, res) => {
  try {
    const { stations } = req.body;
    if (!Array.isArray(stations) || stations.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách trạm không hợp lệ' });
    }
    const result = db.batchUpsertStations(stations);
    res.json({
      success: true,
      message: `Đã lưu thành công: thêm mới ${result.addedCount} trạm, cập nhật ${result.updatedCount} trạm`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật thông tin 1 trạm
 */
router.put('/:id', (req, res) => {
  try {
    const updated = db.updateStation(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trạm cần cập nhật' });
    }
    res.json({ success: true, message: 'Cập nhật trạm thành công', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Cập nhật nhanh URL Portal chung cho danh sách trạm được chọn
 */
router.post('/batch-update-url', (req, res) => {
  try {
    const { stationIds, url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, message: 'URL không được để trống' });
    }
    const ids = Array.isArray(stationIds) && stationIds.length > 0 
      ? stationIds 
      : db.getStations().map(s => s.id);

    let updatedCount = 0;
    for (const id of ids) {
      db.updateStation(id, { url });
      updatedCount++;
    }

    res.json({ success: true, message: `Đã cập nhật URL cho ${updatedCount} trạm`, updatedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xóa toàn bộ tất cả trạm y tế
 */
router.post('/clear-all', (req, res) => {
  try {
    const count = db.clearAllStations();
    res.json({ success: true, message: `Đã xóa toàn bộ ${count} trạm y tế`, deletedCount: count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/clear-all', (req, res) => {
  try {
    const count = db.clearAllStations();
    res.json({ success: true, message: `Đã xóa toàn bộ ${count} trạm y tế`, deletedCount: count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xóa 1 trạm
 */
router.delete('/:id', (req, res) => {
  try {
    const success = db.deleteStation(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trạm' });
    }
    res.json({ success: true, message: 'Đã xóa trạm y tế' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xóa hàng loạt trạm
 */
router.post('/delete-batch', (req, res) => {
  try {
    const { stationIds } = req.body;
    if (!Array.isArray(stationIds) || stationIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách ID cần xóa không hợp lệ' });
    }
    const count = db.deleteBatchStations(stationIds);
    res.json({ success: true, message: `Đã xóa ${count} trạm y tế`, deletedCount: count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Kiểm tra kết nối 1 trạm
 */
router.post('/:id/test', async (req, res) => {
  try {
    const result = await hisService.testStationConnection(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Kiểm tra kết nối hàng loạt (Bulk test 15-20 trạm)
 */
router.post('/test-batch', async (req, res) => {
  try {
    const { stationIds } = req.body;
    const result = await hisService.testBatchStations(stationIds);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Tải file Excel mẫu để điền cấu hình 15-20 trạm
 */
router.get('/excel/template', (req, res) => {
  try {
    const buffer = excelService.generateTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Cau_Hinh_Tram_Y_Te_VNPT_HIS.xlsx"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Xuất dữ liệu cấu hình hiện tại ra Excel
 */
router.get('/excel/export', (req, res) => {
  try {
    const buffer = excelService.exportStationsToExcelBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Danh_Sach_Tram_Y_Te_${dateStr}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Import danh sách trạm từ file Excel
 */
router.post('/excel/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn file Excel để tải lên' });
    }

    const { stations, errors } = excelService.parseExcelBuffer(req.file.buffer);

    if (stations.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy dữ liệu trạm y tế hợp lệ trong file Excel',
        errors
      });
    }

    const result = db.batchUpsertStations(stations);

    res.json({
      success: true,
      message: `Đã nạp thành công: Thêm mới ${result.addedCount} trạm, Cập nhật ${result.updatedCount} trạm`,
      data: result,
      parsedCount: stations.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({ success: false, message: `Lỗi đọc file Excel: ${error.message}` });
  }
});

module.exports = router;
