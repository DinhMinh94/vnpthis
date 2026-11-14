const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const STANDARD_HEADERS = [
  'MA',
  'TEN',
  'SOLUONG',
  'GIANHAP',
  'GIABAN',
  'SOLO',
  'HANDUNG',
  'MATHAU',
  'DINHMUC',
  'SLCANHBAO',
  'GHICHULOI'
];

const SAMPLE_ROWS = [
  {
    MA: 'DKLS_000020',
    TEN: 'Budecort Respules 500mcg/2ml',
    SOLUONG: 222,
    GIANHAP: 9850,
    GIABAN: 9850,
    SOLO: 'GA60333',
    HANDUNG: '02/04/2031',
    MATHAU: '',
    DINHMUC: '',
    SLCANHBAO: '',
    GHICHULOI: ''
  },
  {
    MA: 'DKLS_000021',
    TEN: 'Budenase AQ 100mcg-150 liều',
    SOLUONG: 111,
    GIANHAP: 120000,
    GIABAN: 120000,
    SOLO: 'GA55555',
    HANDUNG: '22/10/2031',
    MATHAU: '',
    DINHMUC: '',
    SLCANHBAO: '',
    GHICHULOI: ''
  }
];

function stripVietnamese(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function parseCSVString(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const row = [];
    let inQuotes = false;
    let currentCell = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += c;
      }
    }
    row.push(currentCell.trim());
    rows.push(row);
  }
  return rows;
}

function parseNumberVi(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim();
  str = str.replace(/\./g, '').replace(/,/g, '.');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function convertHanDung(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    try {
      const formatted = xlsx.SSF.format('yyyy-mm-dd', val);
      if (formatted && /^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
        const [y, m, d] = formatted.split('-');
        return `${d}/${m}/${y}`;
      }
    } catch (e) {}
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const mon = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${mon}/${d.getFullYear()}`;
    }
  }

  const str = String(val).trim();
  // 6 digits: DDMMYY e.g. 100228 -> 10/02/2028, 310329 -> 31/03/2029
  if (/^\d{6}$/.test(str)) {
    const d = str.substring(0, 2);
    const m = str.substring(2, 4);
    const y = '20' + str.substring(4, 6);
    return `${d}/${m}/${y}`;
  }
  // 4 digits: MMYY e.g. 0129 -> 01/01/2029
  if (/^\d{4}$/.test(str)) {
    const m = str.substring(0, 2);
    const y = '20' + str.substring(2, 4);
    return `01/${m}/${y}`;
  }
  // 8 digits: YYYYMMDD or DDMMYYYY
  if (/^\d{8}$/.test(str)) {
    if (str.startsWith('20')) {
      return `${str.substring(6, 8)}/${str.substring(4, 6)}/${str.substring(0, 4)}`;
    } else {
      return `${str.substring(0, 2)}/${str.substring(2, 4)}/${str.substring(4, 8)}`;
    }
  }
  // Already DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parts = str.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return str;
}

/**
 * Đọc buffer (Excel hoặc CSV) thành mảng 2 chiều
 */
function readBufferToRows(buffer) {
  if (!buffer) return [];
  // Kiểm tra nếu là file CSV dạng text
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK for .xlsx
  const isOle = buffer[0] === 0xD0 && buffer[1] === 0xCF; // OLE for .xls
  if (!isZip && !isOle) {
    const text = buffer.toString('utf8');
    if (text.includes(',') || text.includes(';')) {
      return parseCSVString(text);
    }
  }

  // File Excel nhị phân
  const wb = xlsx.read(buffer, { type: 'buffer' });
  for (const sName of wb.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[sName], { header: 1, defval: '' });
    if (rows && rows.length > 0) return rows;
  }
  return [];
}

/**
 * Ghép nối 2 file: Biên Bản Kiểm Kê + Báo Cáo Xuất Nhập Tồn
 */
function mergeKiemKeAndXntFiles(kiemKeBuffer, xntBuffer) {
  const xntRows = readBufferToRows(xntBuffer);
  const bbkkRows = readBufferToRows(kiemKeBuffer);

  if (!bbkkRows || bbkkRows.length === 0) {
    throw new Error('File Biên Bản Kiểm Kê không có dữ liệu hoặc định dạng không hợp lệ');
  }

  // 1. Phân tích file Báo Cáo Xuất Nhập Tồn (XNT)
  const xntMap = new Map();
  if (xntRows && xntRows.length > 0) {
    for (const r of xntRows) {
      if (!Array.isArray(r) || r.length < 3) continue;
      const stt = String(r[0] || '').trim();
      const ma = String(r[1] || '').trim();
      const ten = String(r[2] || '').trim();
      const dvt = String(r[3] || '').trim();
      if (stt && /^\d+$/.test(stt) && ma && ten) {
        xntMap.set(ma, { ma, ten, dvt });
      }
    }
  }

  // 2. Phân tích file Biên Bản Kiểm Kê (BBKK)
  const finalItems = [];
  let totalQuantity = 0;
  let totalValue = 0;

  for (const r of bbkkRows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const stt = String(r[0] || '').trim();
    // Bỏ qua dòng tiêu đề, subtotal, hoặc nhóm
    if (!stt || !/^\d+$/.test(stt) || parseInt(stt) === 0) continue;
    if (!r[1] && !r[2]) continue;

    const maBBKK = String(r[1] || '').trim();
    const tenBBKK = String(r[2] || '').trim();
    const dvtBBKK = String(r[3] || '').trim();
    const donGia = parseNumberVi(r[4]);
    const soKiemSoat = String(r[5] || '').trim();
    const nuocSxBBKK = String(r[6] || '').trim();
    const hanDungRaw = r[7];
    const soLuongThucTe = parseNumberVi(r[9] !== undefined && r[9] !== '' ? r[9] : r[8]);

    // Ánh xạ Mã & Tên từ file Báo cáo XNT
    let finalMa = maBBKK;
    let finalTen = tenBBKK;
    let finalDvt = dvtBBKK;
    if (xntMap.has(maBBKK)) {
      const fromXnt = xntMap.get(maBBKK);
      finalMa = fromXnt.ma;
      finalTen = fromXnt.ten;
      if (!finalDvt && fromXnt.dvt) finalDvt = fromXnt.dvt;
    }

    const { autoDetectDvt } = require('./suaMaThuocService');
    if (!finalDvt) {
      finalDvt = autoDetectDvt(finalTen);
    }

    const finalHanDung = convertHanDung(hanDungRaw);
    const thanhTien = soLuongThucTe * donGia;

    totalQuantity += soLuongThucTe;
    totalValue += thanhTien;

    finalItems.push({
      stt: finalItems.length + 1,
      MA: finalMa,
      TEN: finalTen,
      DVT: finalDvt,
      NUOC_SX: nuocSxBBKK || 'Việt Nam',
      SOLUONG: soLuongThucTe,
      GIANHAP: donGia,
      GIABAN: donGia,
      SOLO: soKiemSoat,
      HANDUNG: finalHanDung,
      MATHAU: '',
      DINHMUC: '',
      SLCANHBAO: '',
      GHICHULOI: '',
      THANHTIEN: thanhTien
    });
  }

  return {
    rows: finalItems,
    summary: {
      totalRecords: finalItems.length,
      totalQuantity,
      totalValue,
      totalValueFormatted: new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalValue)
    }
  };
}

/**
 * Tự động tìm dòng header và ánh xạ các cột thông minh cho 1 file duy nhất
 */
function parseSheetSmart(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows || rows.length === 0) return [];

  let headerIdx = -1;
  let maxMatches = 0;
  const targetKeywords = [
    'ma', 'ma thuoc', 'ten', 'ten thuoc', 'so luong', 'soluong', 
    'gia nhap', 'gianhap', 'gia ban', 'giaban', 'so lo', 'solo', 
    'han dung', 'handung', 'ma thau', 'mathau', 'dinh muc', 'dinhmuc'
  ];

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row)) continue;
    let matchCount = 0;
    for (const cell of row) {
      if (cell === null || cell === undefined || typeof cell === 'boolean') continue;
      const stripped = stripVietnamese(cell).replace(/[_\s-]+/g, ' ');
      for (const kw of targetKeywords) {
        if (stripped === kw || stripped.includes(kw)) {
          matchCount++;
          break;
        }
      }
    }
    if (matchCount > maxMatches) {
      maxMatches = matchCount;
      headerIdx = i;
    }
  }

  if (headerIdx === -1) headerIdx = 0;
  const headerRow = rows[headerIdx];
  const colMap = {};

  headerRow.forEach((cell, idx) => {
    if (cell === null || cell === undefined) return;
    const raw = String(cell).trim().toUpperCase();
    const stripped = stripVietnamese(cell).replace(/[_\s-]+/g, '');

    if (['MA', 'MATHUOC', 'MAHANG', 'MAVATTI', 'ITEMCODE', 'CODE'].includes(stripped) || raw === 'MA' || raw === 'MÃ' || raw === 'MÃ THUỐC') {
      if (colMap.MA === undefined) colMap.MA = idx;
    }
    else if (['TEN', 'TENTHUOC', 'TENHANG', 'TENDUOC', 'NAME', 'ITEMNAME', 'DESCRIPTION'].includes(stripped) || raw === 'TEN' || raw === 'TÊN' || raw === 'TÊN THUỐC') {
      if (colMap.TEN === undefined) colMap.TEN = idx;
    }
    else if (['SOLUONG', 'SL', 'SOLUONGTON', 'TONKHO', 'TON', 'QTY', 'QUANTITY'].includes(stripped) || raw === 'SOLUONG' || raw === 'SỐ LƯỢNG') {
      if (colMap.SOLUONG === undefined) colMap.SOLUONG = idx;
    }
    else if (['GIANHAP', 'DONGIA', 'DONGIANHAP', 'GIAMUA', 'COST', 'PRICE', 'PURCHASEPRICE'].includes(stripped) || raw === 'GIANHAP' || raw === 'GIÁ NHẬP' || raw === 'ĐƠN GIÁ') {
      if (colMap.GIANHAP === undefined) colMap.GIANHAP = idx;
    }
    else if (['GIABAN', 'DONGIABAN', 'SALEPRICE', 'SELLINGPRICE'].includes(stripped) || raw === 'GIABAN' || raw === 'GIÁ BÁN') {
      if (colMap.GIABAN === undefined) colMap.GIABAN = idx;
    }
    else if (['SOLO', 'LO', 'BATCH', 'BATCHNO', 'LOT', 'LOTNO', 'SOKIEMSOAT'].includes(stripped) || raw === 'SOLO' || raw === 'SỐ LÔ' || raw === 'LÔ' || raw === 'SỐ KIỂM SOÁT') {
      if (colMap.SOLO === undefined) colMap.SOLO = idx;
    }
    else if (['HANDUNG', 'HANSUDUNG', 'HSD', 'EXP', 'EXPIRY', 'EXPIRYDATE'].includes(stripped) || raw === 'HANDUNG' || raw === 'HẠN DÙNG' || raw === 'HSD') {
      if (colMap.HANDUNG === undefined) colMap.HANDUNG = idx;
    }
    else if (['MATHAU', 'THAU', 'SOQD', 'TENDER', 'TENDERCODE'].includes(stripped) || raw === 'MATHAU' || raw === 'MÃ THẦU') {
      if (colMap.MATHAU === undefined) colMap.MATHAU = idx;
    }
    else if (['DINHMUC', 'QUOTA', 'COSOTUTRUC'].includes(stripped) || raw === 'DINHMUC' || raw === 'ĐỊNH MỨC') {
      if (colMap.DINHMUC === undefined) colMap.DINHMUC = idx;
    }
    else if (['SLCANHBAO', 'CANHBAOTON', 'MINQTY', 'ALERTQTY'].includes(stripped) || raw === 'SLCANHBAO' || raw === 'CẢNH BÁO') {
      if (colMap.SLCANHBAO === undefined) colMap.SLCANHBAO = idx;
    }
    else if (['GHICHULOI', 'GHICHU', 'NOTE', 'ERROR'].includes(stripped) || raw === 'GHICHULOI' || raw === 'GHI CHÚ') {
      if (colMap.GHICHULOI === undefined) colMap.GHICHULOI = idx;
    }
    else if (['DVT', 'DONVITINH', 'DONVI', 'UNIT'].includes(stripped) || raw === 'ĐVT' || raw === 'ĐƠN VỊ TÍNH' || raw === 'ĐƠN VỊ' || raw === 'DVT') {
      if (colMap.DVT === undefined) colMap.DVT = idx;
    }
    else if (['NUOCSX', 'NUOCSANXUAT', 'COUNTRY', 'ORIGIN'].includes(stripped) || raw === 'NƯỚC SX' || raw === 'NƯỚC SẢN XUẤT' || raw === 'NUOC_SX') {
      if (colMap.NUOC_SX === undefined) colMap.NUOC_SX = idx;
    }
  });

  const result = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row) || row.length === 0) continue;
    const hasData = row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasData) continue;

    const ma = colMap.MA !== undefined ? String(row[colMap.MA] || '').trim() : '';
    const ten = colMap.TEN !== undefined ? String(row[colMap.TEN] || '').trim() : '';

    if (!ma && !ten) continue;

    const soLuong = colMap.SOLUONG !== undefined ? parseNumberVi(row[colMap.SOLUONG]) : 0;
    const giaNhap = colMap.GIANHAP !== undefined ? parseNumberVi(row[colMap.GIANHAP]) : 0;
    let giaBan = colMap.GIABAN !== undefined ? parseNumberVi(row[colMap.GIABAN]) : giaNhap;
    if (!giaBan) giaBan = giaNhap;

    const soLo = colMap.SOLO !== undefined ? String(row[colMap.SOLO] || '').trim() : '';
    const hanDung = colMap.HANDUNG !== undefined ? convertHanDung(row[colMap.HANDUNG]) : '';
    const maThau = colMap.MATHAU !== undefined ? String(row[colMap.MATHAU] || '').trim() : '';
    const dinhMuc = colMap.DINHMUC !== undefined ? String(row[colMap.DINHMUC] || '').trim() : '';
    const slCanhBao = colMap.SLCANHBAO !== undefined ? String(row[colMap.SLCANHBAO] || '').trim() : '';
    const ghiChuLoi = colMap.GHICHULOI !== undefined ? String(row[colMap.GHICHULOI] || '').trim() : '';
    let dvt = colMap.DVT !== undefined ? String(row[colMap.DVT] || '').trim() : '';
    if (!dvt) {
      const { autoDetectDvt } = require('./suaMaThuocService');
      dvt = autoDetectDvt(ten);
    }
    const nuocSx = colMap.NUOC_SX !== undefined ? String(row[colMap.NUOC_SX] || '').trim() : '';

    result.push({
      MA: ma,
      TEN: ten,
      DVT: dvt,
      NUOC_SX: nuocSx,
      SOLUONG: soLuong,
      GIANHAP: giaNhap,
      GIABAN: giaBan,
      SOLO: soLo,
      HANDUNG: hanDung,
      MATHAU: maThau,
      DINHMUC: dinhMuc,
      SLCANHBAO: slCanhBao,
      GHICHULOI: ghiChuLoi
    });
  }

  return result;
}

function processTonDauRows(rows) {
  let totalQuantity = 0;
  let totalValue = 0;

  const processed = rows.map((r, index) => {
    const ma = String(r.MA || r.ma || '').trim();
    const ten = String(r.TEN || r.ten || '').trim();
    const soLuong = parseNumberVi(r.SOLUONG !== undefined ? r.SOLUONG : r.soluong);
    const giaNhap = parseNumberVi(r.GIANHAP !== undefined ? r.GIANHAP : r.gianhap);
    let giaBan = parseNumberVi(r.GIABAN !== undefined ? r.GIABAN : r.giaban);
    if (!giaBan && giaNhap) giaBan = giaNhap;

    const soLo = String(r.SOLO || r.solo || '').trim();
    const hanDung = convertHanDung(r.HANDUNG !== undefined ? r.HANDUNG : r.handung);
    const maThau = String(r.MATHAU || r.mathau || '').trim();
    const dinhMuc = r.DINHMUC !== undefined ? String(r.DINHMUC).trim() : (r.dinhmuc !== undefined ? String(r.dinhmuc).trim() : '');
    const slCanhBao = r.SLCANHBAO !== undefined ? String(r.SLCANHBAO).trim() : (r.slcanhbao !== undefined ? String(r.slcanhbao).trim() : '');
    const ghiChuLoi = String(r.GHICHULOI || r.ghichuloi || '').trim();
    let dvt = String(r.DVT || r.dvt || r.DON_VI_TINH || '').trim();
    if (!dvt) {
      const { autoDetectDvt } = require('./suaMaThuocService');
      dvt = autoDetectDvt(ten);
    }
    const nuocSx = String(r.NUOC_SX || r.nuocSx || r.NUOCSANXUAT || r.nuoc_sx || '').trim();

    totalQuantity += soLuong;
    totalValue += (soLuong * giaNhap);

    return {
      stt: index + 1,
      MA: ma,
      TEN: ten,
      DVT: dvt,
      NUOC_SX: nuocSx,
      SOLUONG: soLuong,
      GIANHAP: giaNhap,
      GIABAN: giaBan,
      SOLO: soLo,
      HANDUNG: hanDung,
      MATHAU: maThau,
      DINHMUC: dinhMuc,
      SLCANHBAO: slCanhBao,
      GHICHULOI: ghiChuLoi,
      THANHTIEN: soLuong * giaNhap
    };
  });

  return {
    rows: processed,
    summary: {
      totalRecords: processed.length,
      totalQuantity,
      totalValue,
      totalValueFormatted: new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalValue)
    }
  };
}

function toArrayOfArrays(rows) {
  const aoa = [STANDARD_HEADERS];
  for (const r of rows) {
    aoa.push([
      r.MA || '',
      r.TEN || '',
      r.SOLUONG !== undefined ? r.SOLUONG : '',
      r.GIANHAP !== undefined ? r.GIANHAP : '',
      r.GIABAN !== undefined ? r.GIABAN : '',
      r.SOLO || '',
      r.HANDUNG || '',
      r.MATHAU || '',
      r.DINHMUC || '',
      r.SLCANHBAO || '',
      r.GHICHULOI || ''
    ]);
  }
  return aoa;
}

function createExcelBuffer(rows, sheetName = 'Trang tính1') {
  const aoa = toArrayOfArrays(rows);
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(aoa);

  ws['!cols'] = [
    { wch: 18 }, // MA
    { wch: 40 }, // TEN
    { wch: 12 }, // SOLUONG
    { wch: 14 }, // GIANHAP
    { wch: 14 }, // GIABAN
    { wch: 28 }, // SOLO
    { wch: 14 }, // HANDUNG
    { wch: 14 }, // MATHAU
    { wch: 12 }, // DINHMUC
    { wch: 14 }, // SLCANHBAO
    { wch: 20 }  // GHICHULOI
  ];

  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function createCsvString(rows) {
  const aoa = toArrayOfArrays(rows);
  const csvLines = aoa.map(row => {
    return row.map(cell => {
      if (cell === null || cell === undefined) return '';
      const str = String(cell);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });

  return '\uFEFF' + csvLines.join('\r\n');
}

module.exports = {
  STANDARD_HEADERS,
  SAMPLE_ROWS,
  stripVietnamese,
  parseNumberVi,
  convertHanDung,
  readBufferToRows,
  mergeKiemKeAndXntFiles,
  parseSheetSmart,
  processTonDauRows,
  toArrayOfArrays,
  createExcelBuffer,
  createCsvString
};
