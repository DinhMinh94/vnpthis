const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const convertService = require('../services/convertNhanVienService');

// Cấu hình Multer lưu tạm file tải lên
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 } // Tối đa 30MB
});

/**
 * API: Chuyển đổi file Excel / CSV danh sách nhân viên thành file Import VNPT HIS chuẩn
 * POST /api/nhanvien/convert
 */
router.post('/convert', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn file dữ liệu nhân viên cần chuyển đổi.' });
    }

    let sourceData = [];
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.csv') {
      const csvStr = req.file.buffer.toString('utf8');
      const wb = xlsx.read(csvStr, { type: 'string' });
      sourceData = convertService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);
    } else {
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      sourceData = convertService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);
    }

    if (!sourceData || sourceData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy dữ liệu nhân viên hợp lệ trong file. Vui lòng kiểm tra lại cột Tên nhân viên hoặc CCHN.'
      });
    }

    const options = {
      maDonVi: req.body.maDonVi || req.query.maDonVi || '11029',
      defaultDeptId: req.body.defaultDeptId || req.query.defaultDeptId || 'K01',
      defaultMaKhoa: req.body.defaultMaKhoa || req.query.defaultMaKhoa || 'K01',
      defaultTuNgay: req.body.defaultTuNgay || req.query.defaultTuNgay || '20260801',
      defaultNgayCheckGuiBh: req.body.defaultNgayCheckGuiBh || req.query.defaultNgayCheckGuiBh || '20260801',
      defaultTgNgay: req.body.defaultTgNgay || req.query.defaultTgNgay || '',
      defaultTgTuan: req.body.defaultTgTuan || req.query.defaultTgTuan || 'T2T3T4T5T6'
    };

    const convertedDataRows = convertService.convertNhanVienRows(sourceData, options);

    // Nếu client yêu cầu download trực tiếp file Excel
    if (req.query.download === 'excel' || req.body.download === 'excel') {
      const fullWb = convertService.buildFullNhanVienWorkbook(convertedDataRows);
      const buffer = xlsx.write(fullWb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_Nhan_Vien_VNPT_HIS.xlsx"');
      return res.send(buffer);
    }

    // Trả về JSON để hiển thị Preview trên giao diện
    res.json({
      success: true,
      totalRows: convertedDataRows.length,
      columnsCount: convertService.NHAN_VIEN_HEADERS.length,
      previewHeader: convertService.NHAN_VIEN_HEADERS,
      previewRows: convertedDataRows.slice(0, 50),
      allRows: convertedDataRows,
      summary: {
        total: convertedDataRows.length,
        withCchn: convertedDataRows.filter(r => r[7]).length, // r[7] là MA_BAC_SI
        withPhone: convertedDataRows.filter(r => r[15]).length,
        withEmail: convertedDataRows.filter(r => r[16]).length
      }
    });
  } catch (error) {
    console.error('Lỗi chuyển đổi file nhân viên:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xử lý file: ' + error.message });
  }
});

/**
 * API: Nạp & chuyển đổi file dữ liệu nhân viên mẫu (9 cán bộ trạm Y tế)
 * GET /api/nhanvien/sample-convert
 */
router.get('/sample-convert', (req, res) => {
  try {
    const dataPath = path.join(__dirname, '../../data/Danh_Muc_Nhan_Vien_Mau.xlsx');
    if (!fs.existsSync(dataPath)) {
      return res.status(404).json({ success: false, message: 'Chưa tìm thấy file dữ liệu nhân viên mẫu' });
    }

    const wb = xlsx.readFile(dataPath);
    const sourceData = convertService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);

    const options = {
      maDonVi: req.query.maDonVi || '11029',
      defaultDeptId: req.query.defaultDeptId || 'K01',
      defaultMaKhoa: req.query.defaultMaKhoa || 'K01',
      defaultTuNgay: req.query.defaultTuNgay || '20260801',
      defaultNgayCheckGuiBh: req.query.defaultNgayCheckGuiBh || '20260801',
      defaultTgNgay: req.query.defaultTgNgay || '',
      defaultTgTuan: req.query.defaultTgTuan || 'T2T3T4T5T6'
    };

    const convertedDataRows = convertService.convertNhanVienRows(sourceData, options);

    if (req.query.download === 'excel') {
      const fullWb = convertService.buildFullNhanVienWorkbook(convertedDataRows);
      const buffer = xlsx.write(fullWb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_Nhan_Vien_VNPT_HIS_Mau.xlsx"');
      return res.send(buffer);
    }

    res.json({
      success: true,
      fileName: 'Danh_Muc_Nhan_Vien_Mau.xlsx',
      totalRows: convertedDataRows.length,
      columnsCount: convertService.NHAN_VIEN_HEADERS.length,
      previewHeader: convertService.NHAN_VIEN_HEADERS,
      previewRows: convertedDataRows.slice(0, 50),
      allRows: convertedDataRows,
      summary: {
        total: convertedDataRows.length,
        withCchn: convertedDataRows.filter(r => r[7]).length,
        withPhone: convertedDataRows.filter(r => r[15]).length,
        withEmail: convertedDataRows.filter(r => r[16]).length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Tải file Excel mẫu chuẩn VNPT HIS (gồm hướng dẫn, dòng ví dụ Ex. và 3 sheet tra cứu)
 * GET /api/nhanvien/download-template
 */
router.get('/download-template', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '../../data/Mau_Import_Nhan_Vien_VNPT_HIS.xlsx');
    if (fs.existsSync(templatePath)) {
      return res.download(templatePath, 'Mau_Import_Nhan_Vien_VNPT_HIS.xlsx');
    }
    // Nếu chưa có, sinh động
    const fullWb = convertService.buildFullNhanVienWorkbook([]);
    const buffer = xlsx.write(fullWb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Import_Nhan_Vien_VNPT_HIS.xlsx"');
    return res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Tải file dữ liệu nguồn mẫu (Danh_Muc_Nhan_Vien_Mau.xlsx)
 * GET /api/nhanvien/download-sample-source
 */
router.get('/download-sample-source', (req, res) => {
  try {
    const filePath = path.join(__dirname, '../../data/Danh_Muc_Nhan_Vien_Mau.xlsx');
    if (fs.existsSync(filePath)) {
      return res.download(filePath, 'Danh_Muc_Nhan_Vien_Mau.xlsx');
    }
    res.status(404).json({ success: false, message: 'Chưa có file mẫu dữ liệu nguồn.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
