const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const convertService = require('../services/convertThuocService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

/**
 * API: Convert and preview / download
 * POST /api/thuoc/convert
 */
router.post('/convert', upload.single('file'), (req, res) => {
  try {
    let sourceData = [];

    // Trường hợp 1: Upload file excel / csv
    if (req.file) {
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      for (const sheetName of wb.SheetNames) {
        const parsed = convertService.parseSheetSmart(wb.Sheets[sheetName]);
        if (parsed && parsed.length > 0) {
          sourceData = parsed;
          break;
        }
      }
      if (sourceData.length === 0 && wb.SheetNames.length > 0) {
        sourceData = convertService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);
      }
    } 
    // Trường hợp 2: Gửi JSON rows trực tiếp
    else if (req.body && req.body.data) {
      sourceData = Array.isArray(req.body.data) ? req.body.data : JSON.parse(req.body.data);
    } else {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn hoặc tải lên file dữ liệu thuốc (.xlsx, .xls, .csv)' });
    }

    if (!sourceData || sourceData.length === 0) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy dữ liệu thuốc hợp lệ trong file. Vui lòng kiểm tra lại định dạng file.' });
    }

    const options = {
      maCskcbOverride: req.body.maCskcb || '',
      nhomBhxhDefault: req.body.nhomBhxh || 4,
      nguonCtDefault: req.body.nguonCt || '74'
    };

    const convertedRows = convertService.convertRows(sourceData, options);

    // Nếu client yêu cầu download trực tiếp file Excel
    if (req.query.download === 'excel' || req.body.download === 'excel') {
      const newWb = xlsx.utils.book_new();
      const newWs = xlsx.utils.aoa_to_sheet(convertedRows);
      xlsx.utils.book_append_sheet(newWb, newWs, 'Mẫu');
      const buffer = xlsx.write(newWb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_Thuoc_VNPT_HIS.xlsx"');
      return res.send(buffer);
    }

    // Trả về JSON để hiển thị Preview trên giao diện
    const header = convertedRows[0];
    const dataRows = convertedRows.slice(1);

    res.json({
      success: true,
      totalRows: dataRows.length,
      columnsCount: header.length,
      previewHeader: header,
      previewRows: dataRows.slice(0, 50),
      allRows: dataRows,
      summary: {
        total: dataRows.length,
        thCount: dataRows.filter(r => r[1] === 'TH').length,
        cpCount: dataRows.filter(r => r[1] === 'CP').length,
      }
    });
  } catch (error) {
    console.error('Lỗi chuyển đổi file thuốc:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xử lý file: ' + error.message });
  }
});

/**
 * API: Hỗ trợ GET /api/thuoc/convert (tránh lỗi Cannot GET khi người dùng mở URL hoặc client gửi GET)
 * GET /api/thuoc/convert
 */
router.get('/convert', (req, res) => {
  try {

    const path = require('path');
    const dataPath = path.join(__dirname, '../../data/Danh_Muc_609_Thuoc_Mau.xlsx');
    if (!require('fs').existsSync(dataPath)) {
      return res.status(404).json({ success: false, message: 'Chưa tìm thấy file dữ liệu mẫu' });
    }
    const wb = xlsx.readFile(dataPath);
    const sourceData = convertService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);

    const options = {
      maCskcbOverride: req.query.maCskcb || '',
      nhomBhxhDefault: req.query.nhomBhxh ? Number(req.query.nhomBhxh) : 4,
      nguonCtDefault: req.query.nguonCt || '74'
    };

    const convertedRows = convertService.convertRows(sourceData, options);

    // Nếu yêu cầu tải trực tiếp file Excel
    if (req.query.download === 'excel') {
      const newWb = xlsx.utils.book_new();
      const newWs = xlsx.utils.aoa_to_sheet(convertedRows);
      xlsx.utils.book_append_sheet(newWb, newWs, 'Mẫu');
      const buffer = xlsx.write(newWb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_Thuoc_VNPT_HIS.xlsx"');
      return res.send(buffer);
    }

    const header = convertedRows[0];
    const dataRows = convertedRows.slice(1);

    res.json({
      success: true,
      totalRows: dataRows.length,
      columnsCount: header.length,
      previewHeader: header,
      previewRows: dataRows.slice(0, 50),
      allRows: dataRows,
      summary: {
        total: dataRows.length,
        thCount: dataRows.filter(r => r[1] === 'TH').length,
        cpCount: dataRows.filter(r => r[1] === 'CP').length,
      }
    });
  } catch (error) {
    console.error('Lỗi GET convert:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Tải file Excel mẫu chuẩn VNPT HIS (gồm 78 cột và dữ liệu mẫu)
 * GET /api/thuoc/download-template
 */
router.get('/download-template', (req, res) => {
  try {
    const templatePath = require('path').join(__dirname, '../../data/Mau_Import_Thuoc_VNPT_HIS.xlsx');
    if (require('fs').existsSync(templatePath)) {
      return res.download(templatePath, 'Mau_Import_Thuoc_VNPT_HIS.xlsx');
    }

    // Nếu không tìm thấy file, tạo file rỗng 78 cột
    const header = [
      'STT', 'MA_NHOM', 'MA_LOAI', 'MA_HOAT_CHAT', 'HOAT_CHAT', 'MA_THUOC', 'TEN_THUOC', 'HAM_LUONG',
      'DON_VI_TINH', 'DUONG_DUNG', 'MA_DUONG_DUNG', 'HANG_SX', 'NUOC_SX', 'GIA_THAU', 'NHOM_BHXH',
      'GIA_BAN', 'GIA_DICH_VU', 'GIA_BHYT', 'GIA_BHYT_QUYET_TOAN', 'BHYT_CHI_TRA', 'MA_ACT', 'MA_BYT',
      'SO_DANG_KY', 'DONG_GOI', 'LIEU_LUONG', 'NHA_CUNG_CAP', 'SO_GOI_THAU', 'DANGBAOCHE', 'TYLEHUHAO',
      'CONG_BO', 'STT_THAU', 'TEN_GIAM_DINH_BH', 'MA_THUOC_BV', 'NGUONCT', 'SOGIAYPHEP', 'THAUGHEP',
      'MA_PP_CHEBIEN', 'MAHIEUSP', 'TU_NGAY', 'DEN_NGAY', 'TUNGAY_HD', 'DENNGAY_HD', 'SO_LUONG',
      'MA_CSKCB', 'LOAI_THUOC', 'LOAI_THAU', 'HT_THAU', 'MA_DVKT', 'TIEUCHUANCHATLUONG', 'BOPHANSUDUNG',
      'TENKHVITHUOC', 'NGUONGOC', 'TINHTRANGDUOCLIEU', 'DMGUIBH', 'NGAYCHECKGUIBH', 'TINHNANG_KT',
      'SO_LUU_HANH', 'MA_CSKCB_TBYT', 'DM_NSX_CDD', 'DM_THUCTE_CDD', 'TLHH_CB', 'TLHH_BQ',
      'THANH_TIEN_THUOC', 'LIEU_BQ_PX', 'DUOCPHEPKELE', 'KETRUNGHOATCHAT', 'THUOCKHANGSINH',
      'KHONGTINHXNT', 'DANHSTTDUNGTHUOC', 'THUOCNHIEUHOATCHAT', 'THUOCKEDON', 'TIENCHATGNHT',
      'QLTHEOTUIMAU', 'DUOCDUYETLE', 'THUOCDIEUTRILAO', 'THUOCCORTICOID', 'VATNHAP', 'VATXUAT'
    ];
    const newWb = xlsx.utils.book_new();
    const newWs = xlsx.utils.aoa_to_sheet([header]);
    xlsx.utils.book_append_sheet(newWb, newWs, 'Mẫu');
    const buffer = xlsx.write(newWb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Import_Thuoc_VNPT_HIS.xlsx"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * API: Nạp & chuyển đổi trực tiếp file thuốc cổng giám định
 * GET /api/thuoc/sample-convert
 */
router.get('/sample-convert', (req, res) => {
  try {
    const dataPath = require('path').join(__dirname, '../../data/Danh_Muc_609_Thuoc_Mau.xlsx');
    if (!require('fs').existsSync(dataPath)) {
      return res.status(404).json({ success: false, message: 'Chưa tìm thấy file dữ liệu mẫu' });
    }
    const wb = xlsx.readFile(dataPath);
    const sourceData = convertService.parseSheetSmart(wb.Sheets[wb.SheetNames[0]]);

    const options = {
      maCskcbOverride: req.query.maCskcb || '',
      nhomBhxhDefault: req.query.nhomBhxh || 4,
      nguonCtDefault: req.query.nguonCt || '74'
    };

    const convertedRows = convertService.convertRows(sourceData, options);

    if (req.query.download === 'excel') {
      const newWb = xlsx.utils.book_new();
      const newWs = xlsx.utils.aoa_to_sheet(convertedRows);
      xlsx.utils.book_append_sheet(newWb, newWs, 'Mẫu');
      const buffer = xlsx.write(newWb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="File_Import_Thuoc_VNPT_HIS_CongGiamDinh.xlsx"');
      return res.send(buffer);
    }

    const header = convertedRows[0];
    const dataRows = convertedRows.slice(1);

    res.json({
      success: true,
      fileName: 'Danh_Muc_Thuoc_Cong_Giam_Dinh.xlsx',
      totalRows: dataRows.length,
      columnsCount: header.length,
      previewHeader: header,
      previewRows: dataRows.slice(0, 50),
      allRows: dataRows,
      summary: {
        total: dataRows.length,
        thCount: dataRows.filter(r => r[1] === 'TH').length,
        cpCount: dataRows.filter(r => r[1] === 'CP').length,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
