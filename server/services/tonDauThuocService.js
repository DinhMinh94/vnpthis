const xlsx = require('xlsx');
const path = require('path');

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
    HANDUNG: '2031-04-02',
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
    HANDUNG: '2031-10-22',
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

function parseNumberVi(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim();
  // Thousands separated by dot: 120.000 or 1.600
  if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
    return Number(str.replace(/\./g, ''));
  }
  // Thousands separated by comma: 120,000 or 1,600
  if (/^\d{1,3}(,\d{3})+$/.test(str)) {
    return Number(str.replace(/,/g, ''));
  }
  // Decimal with comma: 1600,5
  if (/^\d+,\d+$/.test(str)) {
    return Number(str.replace(',', '.'));
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function normalizeDate(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    // Excel serial number (e.g. 47940 -> 2031-04-02)
    try {
      const formatted = xlsx.SSF.format('yyyy-mm-dd', val);
      if (formatted && /^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
        return formatted;
      }
    } catch (e) {
      // fallback
    }
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  const str = String(val).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
  }
  // DD/MM/YYYY or D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }
  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(str)) {
    const parts = str.split('-');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }

  // Attempt Date parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1990) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return str;
}

/**
 * Tự động tìm dòng header và ánh xạ các cột thông minh
 */
function parseSheetSmart(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows || rows.length === 0) return [];

  // Tìm dòng header tốt nhất
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

  // Nếu không tìm thấy header, mặc định dòng đầu
  if (headerIdx === -1) headerIdx = 0;

  const headerRow = rows[headerIdx];
  const colMap = {};

  headerRow.forEach((cell, idx) => {
    if (cell === null || cell === undefined) return;
    const raw = String(cell).trim().toUpperCase();
    const stripped = stripVietnamese(cell).replace(/[_\s-]+/g, '');

    // 1. MA
    if (['MA', 'MATHUOC', 'MAHANG', 'MAVATTI', 'ITEMCODE', 'CODE'].includes(stripped) || raw === 'MA' || raw === 'MÃ' || raw === 'MÃ THUỐC') {
      if (colMap.MA === undefined) colMap.MA = idx;
    }
    // 2. TEN
    else if (['TEN', 'TENTHUOC', 'TENHANG', 'TENDUOC', 'NAME', 'ITEMNAME', 'DESCRIPTION'].includes(stripped) || raw === 'TEN' || raw === 'TÊN' || raw === 'TÊN THUỐC') {
      if (colMap.TEN === undefined) colMap.TEN = idx;
    }
    // 3. SOLUONG
    else if (['SOLUONG', 'SL', 'SOLUONGTON', 'TONKHO', 'TON', 'QTY', 'QUANTITY'].includes(stripped) || raw === 'SOLUONG' || raw === 'SỐ LƯỢNG') {
      if (colMap.SOLUONG === undefined) colMap.SOLUONG = idx;
    }
    // 4. GIANHAP
    else if (['GIANHAP', 'DONGIA', 'DONGIANHAP', 'GIAMUA', 'COST', 'PRICE', 'PURCHASEPRICE'].includes(stripped) || raw === 'GIANHAP' || raw === 'GIÁ NHẬP' || raw === 'ĐƠN GIÁ') {
      if (colMap.GIANHAP === undefined) colMap.GIANHAP = idx;
    }
    // 5. GIABAN
    else if (['GIABAN', 'DONGIABAN', 'SALEPRICE', 'SELLINGPRICE'].includes(stripped) || raw === 'GIABAN' || raw === 'GIÁ BÁN') {
      if (colMap.GIABAN === undefined) colMap.GIABAN = idx;
    }
    // 6. SOLO
    else if (['SOLO', 'LO', 'BATCH', 'BATCHNO', 'LOT', 'LOTNO'].includes(stripped) || raw === 'SOLO' || raw === 'SỐ LÔ' || raw === 'LÔ') {
      if (colMap.SOLO === undefined) colMap.SOLO = idx;
    }
    // 7. HANDUNG
    else if (['HANDUNG', 'HANSUDUNG', 'HSD', 'EXP', 'EXPIRY', 'EXPIRYDATE'].includes(stripped) || raw === 'HANDUNG' || raw === 'HẠN DÙNG' || raw === 'HSD') {
      if (colMap.HANDUNG === undefined) colMap.HANDUNG = idx;
    }
    // 8. MATHAU
    else if (['MATHAU', 'THAU', 'SOQD', 'TENDER', 'TENDERCODE'].includes(stripped) || raw === 'MATHAU' || raw === 'MÃ THẦU') {
      if (colMap.MATHAU === undefined) colMap.MATHAU = idx;
    }
    // 9. DINHMUC
    else if (['DINHMUC', 'QUOTA', 'COSOTUTRUC'].includes(stripped) || raw === 'DINHMUC' || raw === 'ĐỊNH MỨC') {
      if (colMap.DINHMUC === undefined) colMap.DINHMUC = idx;
    }
    // 10. SLCANHBAO
    else if (['SLCANHBAO', 'CANHBAOTON', 'MINQTY', 'ALERTQTY'].includes(stripped) || raw === 'SLCANHBAO' || raw === 'CẢNH BÁO') {
      if (colMap.SLCANHBAO === undefined) colMap.SLCANHBAO = idx;
    }
    // 11. GHICHULOI
    else if (['GHICHULOI', 'GHICHU', 'NOTE', 'ERROR'].includes(stripped) || raw === 'GHICHULOI' || raw === 'GHI CHÚ') {
      if (colMap.GHICHULOI === undefined) colMap.GHICHULOI = idx;
    }
  });

  // Chuyển các dòng data thành JSON objects
  const result = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row) || row.length === 0) continue;
    // Bỏ qua dòng trống hoàn toàn
    const hasData = row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasData) continue;

    const ma = colMap.MA !== undefined ? String(row[colMap.MA] || '').trim() : '';
    const ten = colMap.TEN !== undefined ? String(row[colMap.TEN] || '').trim() : '';

    // Nếu không có cả mã lẫn tên thì bỏ qua dòng rác
    if (!ma && !ten) continue;

    const soLuong = colMap.SOLUONG !== undefined ? parseNumberVi(row[colMap.SOLUONG]) : 0;
    const giaNhap = colMap.GIANHAP !== undefined ? parseNumberVi(row[colMap.GIANHAP]) : 0;
    let giaBan = colMap.GIABAN !== undefined ? parseNumberVi(row[colMap.GIABAN]) : giaNhap;
    if (!giaBan) giaBan = giaNhap;

    const soLo = colMap.SOLO !== undefined ? String(row[colMap.SOLO] || '').trim() : '';
    const hanDung = colMap.HANDUNG !== undefined ? normalizeDate(row[colMap.HANDUNG]) : '';
    const maThau = colMap.MATHAU !== undefined ? String(row[colMap.MATHAU] || '').trim() : '';
    const dinhMuc = colMap.DINHMUC !== undefined ? String(row[colMap.DINHMUC] || '').trim() : '';
    const slCanhBao = colMap.SLCANHBAO !== undefined ? String(row[colMap.SLCANHBAO] || '').trim() : '';
    const ghiChuLoi = colMap.GHICHULOI !== undefined ? String(row[colMap.GHICHULOI] || '').trim() : '';

    result.push({
      MA: ma,
      TEN: ten,
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

/**
 * Chuẩn hóa danh sách dòng và tính toán tổng số liệu
 */
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
    const hanDung = normalizeDate(r.HANDUNG !== undefined ? r.HANDUNG : r.handung);
    const maThau = String(r.MATHAU || r.mathau || '').trim();
    const dinhMuc = r.DINHMUC !== undefined ? String(r.DINHMUC).trim() : (r.dinhmuc !== undefined ? String(r.dinhmuc).trim() : '');
    const slCanhBao = r.SLCANHBAO !== undefined ? String(r.SLCANHBAO).trim() : (r.slcanhbao !== undefined ? String(r.slcanhbao).trim() : '');
    const ghiChuLoi = String(r.GHICHULOI || r.ghichuloi || '').trim();

    totalQuantity += soLuong;
    totalValue += (soLuong * giaNhap);

    return {
      stt: index + 1,
      MA: ma,
      TEN: ten,
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

/**
 * Chuyển đổi danh sách đối tượng thành ma trận 2 chiều [Header, Row1, Row2...]
 */
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

/**
 * Tạo Buffer Excel file
 */
function createExcelBuffer(rows, sheetName = 'Trang tính1') {
  const aoa = toArrayOfArrays(rows);
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(aoa);

  // Set column widths
  ws['!cols'] = [
    { wch: 18 }, // MA
    { wch: 38 }, // TEN
    { wch: 12 }, // SOLUONG
    { wch: 14 }, // GIANHAP
    { wch: 14 }, // GIABAN
    { wch: 15 }, // SOLO
    { wch: 14 }, // HANDUNG
    { wch: 14 }, // MATHAU
    { wch: 12 }, // DINHMUC
    { wch: 14 }, // SLCANHBAO
    { wch: 20 }  // GHICHULOI
  ];

  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Xuất ra định dạng CSV chuẩn UTF-8 có BOM
 */
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

  // UTF-8 BOM
  return '\uFEFF' + csvLines.join('\r\n');
}

module.exports = {
  STANDARD_HEADERS,
  SAMPLE_ROWS,
  stripVietnamese,
  parseNumberVi,
  normalizeDate,
  parseSheetSmart,
  processTonDauRows,
  toArrayOfArrays,
  createExcelBuffer,
  createCsvString
};
