const xlsx = require('xlsx');
const path = require('path');

function formatDate(val) {
  if (!val) return '';
  const str = String(val).trim();
  // If YYYYMMDD (e.g. 20230101)
  if (/^\d{8}$/.test(str)) {
    const y = str.substring(0, 4);
    const m = str.substring(4, 6);
    const d = str.substring(6, 8);
    return `${d}/${m}/${y}`;
  }
  // If already DD/MM/YYYY or D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${d}/${m}/${y}`;
  }
  return str;
}

function parseNumberVi(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  let str = String(val).trim();
  // E.g. 1.600 or 16.000 or 123.456.789 (thousands separated by dot)
  if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
    return Number(str.replace(/\./g, ''));
  }
  // E.g. 1,600 or 16,000 (thousands separated by comma)
  if (/^\d{1,3}(,\d{3})+$/.test(str)) {
    return Number(str.replace(/,/g, ''));
  }
  // Decimal with comma e.g. 1600,50
  if (/^\d+,\d+$/.test(str)) {
    return Number(str.replace(',', '.'));
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function extractGoiThau(ttThau) {
  if (!ttThau) return '';
  // e.g. 1219/QĐ-SYT;G1;N1;2022 -> G1 -> 1
  const m = String(ttThau).match(/;G(\d+);/i);
  if (m) return m[1];
  return '';
}

function extractNhomThau(ttThau, nhomThau) {
  if (nhomThau) {
    const m = String(nhomThau).match(/N?(\d+)/i);
    if (m) return m[1];
  }
  if (ttThau) {
    const m = String(ttThau).match(/;N(\d+);/i);
    if (m) return m[1];
  }
  return '';
}

/**
 * Tự động tìm dòng tiêu đề và chuẩn hóa tên cột cho file Excel/CSV
 */
function parseSheetSmart(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length === 0) return [];

  // Tìm dòng header
  let headerIdx = -1;
  const headerKeywords = [
    'stt', 'ma_thuoc', 'mã thuốc', 'ten_thuoc', 'tên thuốc', 
    'hoat_chat', 'hoạt chất', 'ma_hoat_chat', 'don_gia', 'đơn giá', 
    'so_dang_ky', 'số đăng ký', 'hàm lượng', 'ham_luong'
  ];

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row)) continue;
    const matchCount = row.filter(cell => {
      if (typeof cell !== 'string') return false;
      const lower = cell.toLowerCase().trim();
      return headerKeywords.some(k => lower.includes(k));
    }).length;

    if (matchCount >= 2) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    headerIdx = 0;
  }

  const rawHeader = rows[headerIdx];

  function normalizeKey(str) {
    if (!str || typeof str !== 'string') return '';
    const clean = str.trim();
    const upper = clean.toUpperCase();
    if (upper === 'STT') return 'STT';
    if (upper.includes('MÃ THUỐC') || upper === 'MA_THUOC') return 'MA_THUOC';
    if (upper.includes('HOẠT CHẤT') || upper.includes('HOAT_CHAT')) return 'TEN_HOAT_CHAT';
    if (upper.includes('THUỐC THÀNH PHẨM') || upper.includes('TÊN THUỐC') || upper === 'TEN_THUOC') return 'TEN_THUOC';
    if (upper.includes('HÀM LƯỢNG') || upper.includes('HAM_LUONG')) return 'HAM_LUONG';
    if (upper.includes('ĐƠN VỊ TÍNH') || upper === 'ĐVT' || upper === 'DON_VI_TINH') return 'DON_VI_TINH';
    if (upper.includes('MÃ ĐƯỜNG DÙNG') || upper === 'MA_DUONG_DUNG') return 'MA_DUONG_DUNG';
    if (upper.includes('ĐƯỜNG DÙNG') || upper === 'DUONG_DUNG') return 'DUONG_DUNG';
    if (upper.includes('DẠNG BÀO CHẾ') || upper === 'DANG_BAO_CHE') return 'DANG_BAO_CHE';
    if (upper.includes('ĐĂNG KÝ') || upper.includes('GPNK') || upper === 'SO_DANG_KY') return 'SO_DANG_KY';
    if (upper.includes('SỐ LƯỢNG') || upper === 'SO_LUONG') return 'SO_LUONG';
    if (upper.includes('ĐƠN GIÁ') || upper.includes('GIÁ THẦU') || upper === 'DON_GIA') return 'DON_GIA';
    if (upper.includes('QUY CÁCH') || upper.includes('DONG_GOI')) return 'QUY_CACH';
    if (upper.includes('HÃNG SX') || upper.includes('NHÀ SX') || upper.includes('NHA_SX')) return 'NHA_SX';
    if (upper.includes('NƯỚC SX') || upper.includes('NUOC_SX')) return 'NUOC_SX';
    if (upper.includes('NHÀ THẦU') || upper.includes('NHA_THAU')) return 'NHA_THAU';
    if (upper.includes('THẦU') || upper.includes('TT_THAU')) return 'TT_THAU';
    if (upper.includes('TỪ NGÀY') || upper === 'TU_NGAY') return 'TU_NGAY';
    if (upper.includes('ĐẾN NGÀY') || upper === 'DEN_NGAY' || upper === 'DENNGAY') return 'DEN_NGAY';
    if (upper.includes('CSKCB') || upper === 'MA_CSKCB') return 'MA_CSKCB';
    return clean;
  }

  const normalizedKeys = rawHeader.map(normalizeKey);

  const result = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row) || row.length === 0) continue;
    // Bỏ qua dòng sub-header dạng (1), (2), (3)...
    if (row.every(c => c === null || c === undefined || c === '' || (typeof c === 'string' && /^\(\d+\)$/.test(c.trim())))) {
      continue;
    }
    const item = {};
    let hasData = false;
    for (let c = 0; c < normalizedKeys.length; c++) {
      const k = normalizedKeys[c];
      const val = row[c];
      if (k && val !== undefined && val !== null && val !== '') {
        item[k] = val;
        hasData = true;
      }
    }
    if (hasData && (item.TEN_THUOC || item.MA_THUOC || item.TEN_HOAT_CHAT)) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Chuyển đổi dữ liệu từ bảng nguồn sang bảng mẫu VNPT HIS import thuốc (78 cột chuẩn)
 * @param {Array<Object>} sourceRows - Mảng các object tương ứng từng dòng dữ liệu nguồn
 * @param {Object} options - Tùy chọn chuyển đổi (vd: maCskcbOverride, nhomBhxhDefault,...)
 */
function convertRows(sourceRows, options = {}) {
  const targetHeader = [
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

  const resultRows = [];
  resultRows.push(targetHeader);

  sourceRows.forEach((d, idx) => {
    const stt = idx + 1;
    const loaiThuoc = d.LOAI_THUOC || 1;
    const maNhom = d.MA_NHOM || (String(loaiThuoc) === '2' ? 'CP' : 'TH');
    const maHoatChat = d.MA_HOAT_CHAT_AX || d.MA_HOAT_CHAT || d.MA_THUOC || '';
    const hoatChat = d.HOAT_CHAT_AX || d.TEN_HOAT_CHAT || d.HOAT_CHAT || '';
    
    // MA_THUOC trên HIS: nếu có MA_CSKCB_THUOC thì dùng, nếu không dùng d.MA_THUOC (hoặc TH_00001)
    const maThuoc = d.MA_CSKCB_THUOC || d.MA_THUOC || `TH_${String(stt).padStart(5, '0')}`;
    const tenThuoc = d.TEN_THUOC || d.TEN_THUOC_AX || '';
    const hamLuong = d.HAM_LUONG || '';
    const donViTinh = d.DON_VI_TINH || '';
    const duongDung = d.DUONG_DUNG || d.DUONG_DUNG_AX || '';
    const maDuongDung = d.MA_DUONG_DUNG || d.MA_DUONG_DUNG_AX || '';
    const hangSx = d.NHA_SX || d.HANG_SX || '';
    const nuocSx = d.NUOC_SX || '';
    const giaThau = parseNumberVi(d.DON_GIA || d.DON_GIA_BH || 0);
    
    // Nhóm BHXH: Thuốc là 4 (hoặc lấy từ MA_NHOM_9324)
    const nhomBhxh = d.MA_NHOM_9324 || d.MA_NHOM_5937 || options.nhomBhxhDefault || 4;
    const giaBan = giaThau;
    const giaDichVu = giaThau;
    const giaBhyt = parseNumberVi(d.DON_GIA_BH || d.DON_GIA || 0);
    const giaBhytQuyetToan = giaBhyt;
    
    const soDangKy = d.SO_DANG_KY || d.SO_DANG_KY_AX || '';
    const dongGoi = d.QUY_CACH || d.DONG_GOI || '';
    const lieuLuong = hamLuong;
    const nhaCungCap = d.NHA_THAU || d.NHA_CUNG_CAP || '';
    const soGoiThau = extractGoiThau(d.TT_THAU) || '';
    const dangBaoChe = d.DANG_BAO_CHE || '';
    const tyleHuHao = d.TLHH_CB || '';
    const congBo = formatDate(d.NGAY_NHAN || d.TU_NGAY);
    const sttThau = extractNhomThau(d.TT_THAU, d.NHOM_THAU) || stt;
    const tenGiamDinhBh = tenThuoc;
    const maThuocBv = d.MA_CSKCB_THUOC || d.MA_THUOC || '';
    const nguonCt = options.nguonCtDefault || '74';
    const thauGhep = d.TT_THAU || '';
    const maPpCheBien = d.PP_CHEBIEN || '';
    const tuNgay = formatDate(d.TU_NGAY) || '01/01/2024';
    const denNgay = formatDate(d.DEN_NGAY || d.DENNGAY) || '31/12/2026';
    const soLuong = parseNumberVi(d.SO_LUONG || 0);
    const maCskcb = options.maCskcbOverride || d.MA_CSKCB || '';
    const loaiThau = d.LOAI_THAU || 4;
    const htThau = d.HT_THAU || 1;
    const maDvkt = d.MA_DVKT || '';
    const tieuChuanChatLuong = d.TCCL || d.TIEU_CHUAN || '';
    const boPhanSuDung = d.BO_PHAN_VT || '';
    const tenKhViThuoc = d.TEN_KHOA_HOC || '';
    const nguonGoc = d.NGUON_GOC || '';
    const tinhTrangDuocLieu = '';
    const dmGuiBh = 1;
    const ngayCheckGuiBh = denNgay || '01/04/2027';
    const maCskcbTbyt = 1;
    const tlhhCb = d.TLHH_CB || '';
    const tlhhBq = d.TLHH_BQ || '';
    const thanhTienThuoc = '';

    const row = [
      stt, maNhom, '', maHoatChat, hoatChat, maThuoc, tenThuoc, hamLuong,
      donViTinh, duongDung, maDuongDung, hangSx, nuocSx, giaThau, nhomBhxh,
      giaBan, giaDichVu, giaBhyt, giaBhytQuyetToan, '', '', '',
      soDangKy, dongGoi, lieuLuong, nhaCungCap, soGoiThau, dangBaoChe, tyleHuHao,
      congBo, sttThau, tenGiamDinhBh, maThuocBv, nguonCt, '', thauGhep,
      maPpCheBien, '', tuNgay, denNgay, tuNgay, denNgay, soLuong,
      maCskcb, loaiThuoc, loaiThau, htThau, maDvkt, tieuChuanChatLuong, boPhanSuDung,
      tenKhViThuoc, nguonGoc, tinhTrangDuocLieu, dmGuiBh, ngayCheckGuiBh, '',
      '', maCskcbTbyt, '', '', tlhhCb, tlhhBq,
      thanhTienThuoc, '', '', '', '',
      '', '', '', '', '',
      '', '', '', '', '', ''
    ];

    resultRows.push(row);
  });

  return resultRows;
}

module.exports = {
  convertRows,
  formatDate,
  parseNumberVi,
  parseSheetSmart
};
