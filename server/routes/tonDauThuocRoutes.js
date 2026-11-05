const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const tonDauService = require('../services/tonDauThuocService');

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

module.exports = router;
