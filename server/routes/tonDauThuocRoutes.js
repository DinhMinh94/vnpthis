const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const tonDauService = require('../services/tonDauThuocService');
const suaMaThuocService = require('../services/suaMaThuocService');
const db = require('../services/db');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

// Cache Nà Bủng dataset
const naBungJsonPath = path.join(__dirname, '../../data/tondau_thuoc_nabung.json');
let naBungItems = [];
if (fs.existsSync(naBungJsonPath)) {
  try {
    naBungItems = JSON.parse(fs.readFileSync(naBungJsonPath, 'utf8'));
  } catch (e) {
    console.error('Lỗi đọc tondau_thuoc_nabung.json:', e);
  }
}

/**
 * API: Ghép nối 2 file (Biên Bản Kiểm Kê + Báo Cáo Xuất Nhập Tồn)
 * POST /api/tondau-thuoc/merge-files
 */
router.post('/merge-files', upload.fields([
  { name: 'fileKiemKe', maxCount: 1 },
  { name: 'fileXNT', maxCount: 1 }
]), (req, res) => {
  try {
    if (!req.files || !req.files.fileKiemKe || req.files.fileKiemKe.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng tải lên File Biên Bản Kiểm Kê (để lấy Đơn giá, Số kiểm soát/Lô, Hạn dùng, Số lượng thực tế)'
      });
    }

    const kiemKeBuffer = req.files.fileKiemKe[0].buffer;
    const xntBuffer = req.files.fileXNT && req.files.fileXNT.length > 0 ? req.files.fileXNT[0].buffer : null;

    const { rows, summary } = tonDauService.mergeKiemKeAndXntFiles(kiemKeBuffer, xntBuffer);

    // Download trực tiếp Excel
    if (req.query.download === 'excel' || req.body.download === 'excel') {
      const buffer = tonDauService.createExcelBuffer(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS_GhepNoi.xlsx"');
      return res.send(buffer);
    }

    // Download trực tiếp CSV
    if (req.query.download === 'csv' || req.body.download === 'csv') {
      const csvStr = tonDauService.createCsvString(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS_GhepNoi.csv"');
      return res.send(csvStr);
    }

    res.json({
      success: true,
      headers: tonDauService.STANDARD_HEADERS,
      totalRows: rows.length,
      summary,
      previewRows: rows.slice(0, 100),
      allRows: rows
    });
  } catch (error) {
    console.error('Lỗi ghép nối 2 file tồn đầu thuốc:', error);
    res.status(500).json({ success: false, message: 'Lỗi ghép nối file: ' + error.message });
  }
});

/**
 * API: Convert file upload hoặc JSON rows sang cấu trúc Tồn Đầu Thuốc HMIS
 * POST /api/tondau-thuoc/convert
 */
router.post('/convert', upload.single('file'), (req, res) => {
  try {
    let sourceData = [];

    // 1. Upload file Excel / CSV
    if (req.file) {
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      for (const sheetName of wb.SheetNames) {
        const parsed = tonDauService.parseSheetSmart(wb.Sheets[sheetName]);
        if (parsed && parsed.length > 0) {
          sourceData = parsed;
          break;
        }
      }
      if (sourceData.length === 0 && wb.SheetNames.length > 0) {
        sourceData = tonDauService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);
      }
    } 
    // 2. Gửi JSON trực tiếp
    else if (req.body && req.body.data) {
      sourceData = Array.isArray(req.body.data) ? req.body.data : JSON.parse(req.body.data);
    } 
    // 3. Fallback dữ liệu mẫu nếu không có dữ liệu
    else {
      return res.status(400).json({ 
        success: false, 
        message: 'Vui lòng chọn hoặc tải lên file dữ liệu tồn kho thuốc (.xlsx, .xls, .csv)' 
      });
    }

    if (!sourceData || sourceData.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Không tìm thấy dữ liệu thuốc hợp lệ trong file. Vui lòng kiểm tra lại định dạng file.' 
      });
    }

    const { rows, summary } = tonDauService.processTonDauRows(sourceData);

    // Download trực tiếp Excel
    if (req.query.download === 'excel' || req.body.download === 'excel') {
      const buffer = tonDauService.createExcelBuffer(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS.xlsx"');
      return res.send(buffer);
    }

    // Download trực tiếp CSV
    if (req.query.download === 'csv' || req.body.download === 'csv') {
      const csvStr = tonDauService.createCsvString(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS.csv"');
      return res.send(csvStr);
    }

    // Trả về JSON hiển thị trên giao diện SPA
    res.json({
      success: true,
      headers: tonDauService.STANDARD_HEADERS,
      totalRows: rows.length,
      summary,
      previewRows: rows.slice(0, 100),
      allRows: rows
    });

  } catch (error) {
    console.error('Lỗi chuyển đổi file tồn đầu thuốc:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xử lý file: ' + error.message });
  }
});

/**
 * API: Lấy dữ liệu 130 khoản chuẩn Trạm Y Tế Nà Bủng
 * GET /api/tondau-thuoc/nabung-data
 */
router.get('/nabung-data', (req, res) => {
  try {
    if (naBungItems.length === 0 && fs.existsSync(naBungJsonPath)) {
      naBungItems = JSON.parse(fs.readFileSync(naBungJsonPath, 'utf8'));
    }
    const { rows, summary } = tonDauService.processTonDauRows(naBungItems);
    res.json({
      success: true,
      headers: tonDauService.STANDARD_HEADERS,
      totalRows: rows.length,
      summary,
      previewRows: rows,
      allRows: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Tải trực tiếp file Nà Bủng (Excel hoặc CSV)
 * GET /api/tondau-thuoc/nabung-download
 */
router.get('/nabung-download', (req, res) => {
  try {
    const format = req.query.format || 'excel';
    const filePath = format === 'csv'
      ? path.join(__dirname, '../../data/File_Import_TonDau_Thuoc_Tram_Y_Te_Na_Bung.csv')
      : path.join(__dirname, '../../data/File_Import_TonDau_Thuoc_Tram_Y_Te_Na_Bung.xlsx');

    if (fs.existsSync(filePath)) {
      const fileName = format === 'csv' 
        ? 'File_Import_TonDau_Thuoc_Tram_Y_Te_Na_Bung.csv'
        : 'File_Import_TonDau_Thuoc_Tram_Y_Te_Na_Bung.xlsx';
      return res.download(filePath, fileName);
    }

    // Fallback: sinh động
    if (naBungItems.length === 0 && fs.existsSync(naBungJsonPath)) {
      naBungItems = JSON.parse(fs.readFileSync(naBungJsonPath, 'utf8'));
    }
    if (format === 'csv') {
      const csvStr = tonDauService.createCsvString(naBungItems);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_Tram_Y_Te_Na_Bung.csv"');
      return res.send(csvStr);
    } else {
      const buffer = tonDauService.createExcelBuffer(naBungItems);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_Tram_Y_Te_Na_Bung.xlsx"');
      return res.send(buffer);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Lấy dữ liệu mẫu 2 dòng tồn đầu thuốc
 * GET /api/tondau-thuoc/sample-data
 */
router.get('/sample-data', (req, res) => {
  try {
    const { rows, summary } = tonDauService.processTonDauRows(tonDauService.SAMPLE_ROWS);
    res.json({
      success: true,
      headers: tonDauService.STANDARD_HEADERS,
      totalRows: rows.length,
      summary,
      previewRows: rows,
      allRows: rows
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Tải file mẫu chuẩn (Excel hoặc CSV)
 * GET /api/tondau-thuoc/download-template
 */
router.get('/download-template', (req, res) => {
  try {
    const format = req.query.format || 'excel';
    const sampleRows = tonDauService.SAMPLE_ROWS;

    if (format === 'csv') {
      const csvStr = tonDauService.createCsvString(sampleRows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS_Mau.csv"');
      return res.send(csvStr);
    }

    const buffer = tonDauService.createExcelBuffer(sampleRows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS_Mau.xlsx"');
    return res.send(buffer);
  } catch (error) {
    console.error('Lỗi tải template tồn đầu thuốc:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Xuất dữ liệu đã sửa đổi trên bảng web ra file Excel hoặc CSV
 * POST /api/tondau-thuoc/export
 */
router.post('/export', (req, res) => {
  try {
    const { rows } = req.body;
    const format = req.query.format || req.body.format || 'excel';

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Không có dữ liệu để xuất file' });
    }

    if (format === 'csv') {
      const csvStr = tonDauService.createCsvString(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS.csv"');
      return res.send(csvStr);
    }

    const buffer = tonDauService.createExcelBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="File_Import_TonDau_Thuoc_VNPT_HIS.xlsx"');
    return res.send(buffer);
  } catch (error) {
    console.error('Lỗi xuất file tồn đầu thuốc:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Lấy dữ liệu file mẫu Trạm 11109 (128 khoản thuốc)
 * GET /api/tondau-thuoc/sample-11109
 */
router.get('/sample-11109', (req, res) => {
  try {
    const filePath = path.join(__dirname, '../../data/11109File_Import_TonDau_Thuoc_VNPT_HIS.xlsx');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Chưa có file mẫu 11109' });
    }
    const wb = xlsx.readFile(filePath);
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const { rows: processedRows, summary } = tonDauService.processTonDauRows(rows);
    res.json({
      success: true,
      headers: tonDauService.STANDARD_HEADERS,
      totalRows: processedRows.length,
      summary,
      previewRows: processedRows,
      allRows: processedRows,
      stationCode: '11109',
      stationName: 'Trạm Y Tế Nà Bủng Trạm chính'
    });
  } catch (error) {
    console.error('Lỗi lấy file mẫu 11109:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Đối soát danh sách thuốc tồn đầu với danh mục thuốc trạm trên HMIS
 * POST /api/tondau-thuoc/doi-soat-ma
 */
router.post('/doi-soat-ma', async (req, res) => {
  try {
    const { stationId, rows } = req.body;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn trạm y tế để đối soát' });
    }
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách thuốc tồn đầu rỗng hoặc không hợp lệ' });
    }

    // 1. Tải danh mục thuốc hiện tại của trạm trên cổng HMIS
    const { station, catalog } = await suaMaThuocService.fetchCatalogForStation(stationId);

    // 2. Chạy thuật toán so khớp theo tên, giá, số ĐK và ngày QĐ mới nhất
    const { summary, items, uniqueUpdates } = suaMaThuocService.compareInventoryWithCatalog(rows, catalog);

    res.json({
      success: true,
      station: {
        id: station.id,
        ten: station.tenTram || station.ten,
        maTram: station.maTram,
        user: station.username
      },
      catalogCount: catalog.length,
      summary,
      items,
      uniqueUpdates
    });
  } catch (error) {
    console.error('Lỗi đối soát mã thuốc:', error);
    res.status(500).json({ success: false, message: 'Lỗi đối soát mã thuốc: ' + error.message });
  }
});

/**
 * API: Sửa ALL mã thuốc trên cổng HMIS cho trạm
 * POST /api/tondau-thuoc/sua-all-ma-hmis
 */
router.post('/sua-all-ma-hmis', async (req, res) => {
  try {
    const { stationId, updateList } = req.body;
    if (!stationId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn trạm y tế' });
    }
    if (!updateList || !Array.isArray(updateList) || updateList.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách thuốc cần sửa rỗng' });
    }

    const result = await suaMaThuocService.batchUpdateDrugsOnHmis(stationId, updateList);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Lỗi sửa all mã thuốc HMIS:', error);
    res.status(500).json({ success: false, message: 'Lỗi cập nhật mã thuốc HMIS: ' + error.message });
  }
});

/**
 * API: Sửa mã của 1 thuốc đơn lẻ trên HMIS
 * POST /api/tondau-thuoc/sua-mot-thuoc-hmis
 */
router.post('/sua-mot-thuoc-hmis', async (req, res) => {
  try {
    const { stationId, hmisId, newMa, oldMa, ten } = req.body;
    if (!stationId || !hmisId || !newMa) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin trạm, ID thuốc hoặc mã mới' });
    }

    const station = db.getStationById(stationId, true);
    if (!station) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trạm' });
    }

    const cauhinhService = require('../services/cauhinhService');
    const auth = await cauhinhService.loginToHmis(station);
    const result = await suaMaThuocService.updateSingleDrugOnHmis(auth, hmisId, newMa);

    res.json({
      success: true,
      hmisId,
      newMa,
      oldMa,
      ten,
      message: result.message
    });
  } catch (error) {
    console.error(`Lỗi sửa mã thuốc ID ${req.body?.hmisId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Xuất danh sách import những thuốc chưa có trong danh mục (mẫu chuẩn VNPT HIS 78 cột)
 * POST /api/tondau-thuoc/export-chua-co-dm
 */
router.post('/export-chua-co-dm', (req, res) => {
  try {
    const { items, stationCode } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách thuốc chưa có trong danh mục rỗng' });
    }

    const { buffer, count } = suaMaThuocService.exportChuaCoTrongDmExcel(items);
    const safeStation = String(stationCode || 'HMIS').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `File_Import_Thuoc_Chua_Co_Trong_DM_${safeStation}_${count}Thuoc.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Lỗi xuất file import thuốc chưa có trong DM:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
