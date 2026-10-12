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

/**
 * Tự động tìm dòng tiêu đề và chuẩn hóa tên cột cho file Excel/CSV
 */
function parseSheetSmart(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length === 0) return [];

  // Tìm dòng header
  let headerIdx = -1;
  let maxMatches = 0;
  const headerKeywords = [
    'stt', 'ma thuoc', 'ma_thuoc', 'ten thuoc', 'ten_thuoc', 
    'hoat chat', 'hoat_chat', 'ma hoat chat', 'don gia', 'don_gia', 
    'so dang ky', 'so_dang_ky', 'ham luong', 'ham_luong',
    'ma hang', 'ten hang', 'biet duoc', 'don vi tinh', 'dvt', 'gia thau',
    'quyet dinh', 'thau'
  ];

  for (let i = 0; i < Math.min(rows.length, 35); i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row)) continue;
    let matchCount = 0;
    for (const cell of row) {
      if (cell === null || cell === undefined || typeof cell === 'boolean') continue;
      const stripped = stripVietnamese(cell);
      if (headerKeywords.some(k => stripped.includes(k))) {
        matchCount++;
      }
    }

    if (matchCount > maxMatches) {
      maxMatches = matchCount;
      headerIdx = i;
    }
  }

  if (headerIdx === -1 || maxMatches === 0) {
    headerIdx = 0;
  }

  const rawHeader = rows[headerIdx];

  function normalizeKey(str) {
    if (!str) return '';
    const clean = String(str).replace(/\r?\n|\r/g, ' ').trim();
    const upperClean = clean.toUpperCase().replace(/\s+/g, '_');

    // Giữ nguyên các cột chuẩn đã đúng tên theo chuẩn Cổng Giám Định BHYT / VNPT HIS
    const standardKeys = [
      'STT', 'TT_THAU', 'NHOM_THAU', 'LOAI_THAU', 'HT_THAU', 'QUYET_DINH',
      'MA_CSKCB_THUOC', 'MA_CSKCB_DAU_THAU', 'MA_THUOC', 'TEN_THUOC', 'TEN_HOAT_CHAT',
      'MA_HOAT_CHAT', 'DON_VI_TINH', 'HAM_LUONG', 'DUONG_DUNG', 'MA_DUONG_DUNG',
      'DANG_BAO_CHE', 'SO_DANG_KY', 'SO_LUONG', 'DON_GIA', 'DON_GIA_BH', 'QUY_CACH',
      'NHA_SX', 'NUOC_SX', 'NHA_THAU', 'TU_NGAY', 'DEN_NGAY', 'DENNGAY', 'MA_CSKCB',
      'LOAI_THUOC', 'MA_DVKT', 'TCCL', 'BO_PHAN_VT', 'TEN_KHOA_HOC', 'NGUON_GOC',
      'PP_CHEBIEN', 'TLHH_CB', 'TLHH_BQ', 'MA_HOAT_CHAT_AX', 'HOAT_CHAT_AX',
      'TEN_THUOC_AX', 'MA_DUONG_DUNG_AX', 'DUONG_DUNG_AX', 'SO_DANG_KY_AX',
      'TIEU_CHUAN', 'MA_NHOM_9324', 'MA_NHOM_5937', 'MA_CSKCB_TBYT', 'THAUGHEP'
    ];
    if (standardKeys.includes(upperClean)) {
      return upperClean;
    }

    const stripped = stripVietnamese(clean);

    if (stripped === 'stt') return 'STT';
    if (stripped.includes('ma cskcb thuoc') || stripped.includes('ma thuoc bv') || stripped.includes('ma_thuoc_bv')) return 'MA_CSKCB_THUOC';
    if (stripped.includes('ma cskcb dau thau')) return 'MA_CSKCB_DAU_THAU';
    if (stripped.includes('ma cskcb tbyt')) return 'MA_CSKCB_TBYT';
    if (stripped.includes('thau ghep') || stripped.includes('thaughep')) return 'THAUGHEP';
    if (stripped.includes('ten thuoc ax') || stripped.includes('ten_thuoc_ax')) return 'TEN_THUOC_AX';
    if (stripped.includes('ma hoat chat')) return 'MA_HOAT_CHAT';
    if (stripped.includes('ma thuoc') || stripped.includes('ma hang') || stripped.includes('ma sp') || stripped.includes('ma duoc') || stripped.includes('ma hieu')) return 'MA_THUOC';
    if (stripped.includes('hoat chat')) return 'TEN_HOAT_CHAT';
    if (stripped.includes('ten thuoc') || stripped.includes('biet duoc') || stripped.includes('thuoc thanh pham') || stripped.includes('ten hang') || stripped.includes('ten thuong mai') || stripped.includes('ten vat tu') || stripped.includes('ten hoa chat') || stripped.includes('ten san pham')) return 'TEN_THUOC';
    if (stripped.includes('ham luong') || stripped.includes('nong do')) return 'HAM_LUONG';
    if (stripped.includes('don vi tinh') || stripped === 'dvt' || stripped === 'don vi' || stripped === 'don_vi_tinh') return 'DON_VI_TINH';
    if (stripped.includes('ma duong dung')) return 'MA_DUONG_DUNG';
    if (stripped.includes('duong dung')) return 'DUONG_DUNG';
    if (stripped.includes('dang bao che')) return 'DANG_BAO_CHE';
    if (stripped.includes('dang ky') || stripped.includes('gpnk') || stripped.includes('sdk') || stripped.includes('gdklh')) return 'SO_DANG_KY';
    if (stripped.includes('so luong')) return 'SO_LUONG';
    if (stripped.includes('don gia bh') || stripped.includes('gia bh')) return 'DON_GIA_BH';
    if (stripped.includes('don gia') || stripped.includes('gia thau') || stripped.includes('gia trung thau') || stripped.includes('gia ban')) return 'DON_GIA';
    if (stripped.includes('quy cach') || stripped.includes('dong goi')) return 'QUY_CACH';
    if (stripped.includes('hang sx') || stripped.includes('nha sx') || stripped.includes('san xuat')) return 'NHA_SX';
    if (stripped.includes('nuoc sx') || stripped.includes('quoc gia')) return 'NUOC_SX';
    if (stripped.includes('nha thau') || stripped.includes('nha cung cap') || stripped.includes('don vi trung thau') || stripped.includes('cong ty trung thau')) return 'NHA_THAU';
    if (stripped.includes('nhom thau') || stripped === 'nhom_thau') return 'NHOM_THAU';
    if (stripped.includes('loai thau') || stripped === 'loai_thau') return 'LOAI_THAU';
    if (stripped.includes('hinh thuc thau') || stripped.includes('ht thau') || stripped === 'ht_thau') return 'HT_THAU';
    if (stripped.includes('tt thau') || stripped.includes('thong tin thau') || stripped === 'tt_thau') return 'TT_THAU';
    if (stripped.includes('quyet dinh')) return 'QUYET_DINH';
    if (stripped.includes('tu ngay')) return 'TU_NGAY';
    if (stripped.includes('den ngay') || stripped.includes('han dung')) return 'DEN_NGAY';
    if (stripped.includes('cskcb') || stripped.includes('ma tram')) return 'MA_CSKCB';
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
    if (hasData) {
      if (item.TEN_THUOC || item.MA_THUOC || item.TEN_HOAT_CHAT) {
        result.push(item);
      } else {
        const nonNullCells = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
        if (nonNullCells.length >= 2) {
          item.TEN_THUOC = String(nonNullCells[1] || nonNullCells[0]);
          item.MA_THUOC = `TH_${String(i).padStart(5, '0')}`;
          result.push(item);
        }
      }
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
    
    // MA_THUOC trên HIS: nếu nhập prefix thì sinh mã (VD: thuoc -> thuoc001, TH -> TH001), nếu để trống thì giữ rỗng
    let maThuoc = '';
    if (options.prefixMaThuoc && String(options.prefixMaThuoc).trim() !== '') {
      const prefix = String(options.prefixMaThuoc).trim();
      maThuoc = `${prefix}${String(stt).padStart(3, '0')}`;
    }
    const tenThuoc = d.TEN_THUOC || d.TEN_THUOC_AX || '';
    const hamLuong = d.HAM_LUONG || '';
    const donViTinh = d.DON_VI_TINH || '';
    const duongDung = d.DUONG_DUNG || d.DUONG_DUNG_AX || '';
    const maDuongDung = d.MA_DUONG_DUNG || d.MA_DUONG_DUNG_AX || '';
    const hangSx = d.NHA_SX || d.HANG_SX || '';
    const nuocSx = d.NUOC_SX || '';
    const giaThau = parseNumberVi(d.DON_GIA || d.DON_GIA_BH || 0);
    
    // Nhóm BHXH: Lấy theo tham số cấu hình (9, 10, 11, 14, 15, 16, 17), hoặc lấy từ file nguồn
    const nhomBhxh = (options.nhomBhxhDefault !== undefined && options.nhomBhxhDefault !== null && options.nhomBhxhDefault !== '')
      ? Number(options.nhomBhxhDefault)
      : (d.MA_NHOM_9324 || d.MA_NHOM_5937 || 10);
    const giaBan = giaThau;
    const giaDichVu = giaThau;
    const giaBhyt = parseNumberVi(d.DON_GIA_BH || d.DON_GIA || 0);
    const giaBhytQuyetToan = giaBhyt;
    
    // BHYT_CHI_TRA: mặc định 100 theo yêu cầu người dùng
    const bhytChiTra = 100;
    
    const soDangKy = d.SO_DANG_KY || d.SO_DANG_KY_AX || '';
    const dongGoi = d.QUY_CACH || d.DONG_GOI || '';
    const lieuLuong = hamLuong;
    const nhaCungCap = d.NHA_THAU || d.NHA_CUNG_CAP || '';
    
    // SO_GOI_THAU: bỏ trống theo yêu cầu người dùng
    const soGoiThau = '';
    const dangBaoChe = d.DANG_BAO_CHE || '';
    const tyleHuHao = d.TLHH_CB || '';
    const congBo = formatDate(d.NGAY_NHAN || d.TU_NGAY);
    
    // STT_THAU: để trống theo yêu cầu người dùng
    const sttThau = '';
    
    // TEN_GIAM_DINH_BH: lấy theo cột TEN_THUOC_AX của file mẫu
    const tenGiamDinhBh = d.TEN_THUOC_AX || d.TEN_THUOC || tenThuoc || '';
    
    const maThuocBv = d.MA_CSKCB_THUOC || d.MA_THUOC || '';
    const nguonCt = options.nguonCtDefault || '74';
    
    // THAUGHEP: lấy theo cột TT_THAU của file dữ liệu
    const thauGhep = d.TT_THAU || d.THAU_GHEP || d.THAUGHEP || '';
    
    const maPpCheBien = d.PP_CHEBIEN || '';
    const tuNgay = formatDate(d.TU_NGAY) || '01/01/2024';
    const denNgay = formatDate(d.DEN_NGAY || d.DENNGAY) || '31/12/2026';
    const soLuong = parseNumberVi(d.SO_LUONG || 0);
    
    // MA_CSKCB: để mặc định luôn theo file dữ liệu
    const maCskcb = d.MA_CSKCB || '';
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
    
    // MA_CSKCB_TBYT: bỏ trống theo yêu cầu người dùng
    const maCskcbTbyt = '';
    
    const tlhhCb = d.TLHH_CB || '';
    const tlhhBq = d.TLHH_BQ || '';
    const thanhTienThuoc = '';

    const row = [
      stt, maNhom, '', maHoatChat, hoatChat, maThuoc, tenThuoc, hamLuong,
      donViTinh, duongDung, maDuongDung, hangSx, nuocSx, giaThau, nhomBhxh,
      giaBan, giaDichVu, giaBhyt, giaBhytQuyetToan, bhytChiTra, '', '',
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
