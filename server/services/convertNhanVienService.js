/**
 * Service chuyển đổi dữ liệu Cán bộ / Nhân viên y tế sang định dạng Import chuẩn VNPT HMIS 4.0
 * Cấu trúc: 33 cột, dữ liệu điền từ dòng 4 (sau header, rule, example row), kèm 3 sheet danh mục tra cứu.
 */

const xlsx = require('xlsx');

// 33 Cột chuẩn VNPT HMIS 4.0
const NHAN_VIEN_HEADERS = [
  'STT',
  'USER_NAME\n(Cấu trúc: mã đơn vị.tên nhân viên viết tắt họ, đệm)',
  'MÃ NHÂN VIÊN\nOFFICER_CODE',
  'TÊN NHÂN VIÊN\nOFFICER_NAME',
  'KHOA\nDEPT_ID',
  'CHỨC DANH ĐẨY CỔNG\n(Tham chiếu sheet CHUCDANH_NN)',
  'LOẠI NHÂN VIÊN\nOFFICER_TYPE\n(Tham chiếu sheet DMC Loại)',
  'Mã bác sĩ\nMA_BAC_SI',
  'NGAYCAPCCHN',
  'NOICAPCCHN',
  'CMT/ CCCD',
  'SO_BHYT',
  'SO_BHXH',
  'NGÀY SINH',
  'GIỚI TÍNH\n(1: nam; 2 :nữ)',
  'PHONE',
  'EMAIL',
  'MA_KHOA',
  'VITRICHUYENMON\n(Tham chiếu sheet VITRICHUYENMON)',
  'PHAMVI_CHUYENMON',
  'SOQDPHAMVIHANHNGHE',
  'DVKTPHANCONGTH',
  'SOQDDVKTPHANCONGTH',
  'TGDANGKYHANHNGHE\n(1: Toàn thời gian; 2: Không toàn thời gian)',
  'TGLAMVIECNGAY',
  'TGLAMVIECTUAN',
  'CSLAMVIECKHAC',
  'QDCHUYENGIAOKT',
  'TUNGAY',
  'DENNGAY',
  'DMGUIBH',
  'NGAYCHECKGUIBH',
  'STATUS\n(Mặc định là 1)'
];

const ROW_2_GUIDANCE = [
  '',
  'Không được nhập trùng',
  'Không được nhập trùng',
  '',
  '',
  '',
  '',
  'Không được nhập trùng',
  'yyyymmdd',
  '',
  '',
  'Không được nhập trùng',
  'Không được nhập trùng',
  'yyyymmdd',
  '',
  'Không được nhập trùng',
  'Không được nhập trùng',
  'Nhập mã khoa TT12',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  'yyyymmdd',
  'yyyymmdd',
  '',
  'yyyymmdd',
  ''
];

const ROW_3_EXAMPLE = [
  'Ex.',
  'xxxxx.NVHOANG',
  'xxxxx',
  'Nguyễn Văn Hoàng',
  'K01',
  1,
  4,
  '005310/TG-CCHN',
  '2024-04-20',
  'Sở y tế Tỉnh Tiền Giang',
  '094195xxxxxx',
  '821000xxxx',
  '821000xxxx',
  '1990-07-30',
  1,
  '09xxx',
  'xxxx@gmail.com',
  '02.16',
  5,
  '102;103',
  '20000101_LAT/QĐ-SYT',
  '31.123.123',
  '20250909_123QD/BYT',
  1,
  'T20800-1500;T40800-1100;T41400-1700',
  'T2T3T5',
  'XXX',
  'XXX',
  '2024-07-30',
  '2027-07-30',
  1,
  '2026-04-01',
  1
];

// Danh mục Sheet 2: CHUCDANH_NN
const CHUC_DANH_NN_SHEET = [
  ['ID', 'Chức danh nghề nghiệp'],
  [1, 'Bác sĩ'],
  [2, 'Y sĩ'],
  [3, 'Điều dưỡng'],
  [4, 'Hộ sinh'],
  [5, 'Kỹ thuật y'],
  [6, 'Cử nhân tâm lý lâm sàng'],
  [7, 'Lương y'],
  [8, 'Dược sỹ'],
  [9, 'Người tham gia vào quá trình khám bệnh, chữa bệnh nhưng không cần phải cấp giấy phép hành nghề']
];

// Danh mục Sheet 3: DMC Loại
const DMC_LOAI_SHEET = [
  ['LOẠI', 'TÊN LOẠI'],
  [2, 'Quản trị hệ thống'],
  [3, 'Lễ tân'],
  [4, 'Bác sỹ'],
  [5, 'Y tá'],
  [6, 'Điều dưỡng'],
  [7, 'Tài chính'],
  [8, 'Nhân viên kho thuốc'],
  [9, 'Xét nghiệm'],
  [10, 'Chẩn đoán hình ảnh'],
  [11, 'Phẫu thuật thủ thuật viên'],
  [12, 'Đỡ đẻ'],
  [13, 'HIS-Quản lý danh mục'],
  [14, 'Khác']
];

// Danh mục Sheet 4: VITRICHUYENMON
const VI_TRI_CHUYEN_MON_SHEET = [
  ['ID', 'Vị trí chuyên môn'],
  [1, 'Người chịu trách nhiệm chuyên môn'],
  [2, 'Trưởng khoa/ Trưởng đơn nguyên/người phụ trách phòng khám'],
  [3, 'Người chịu trách nhiệm chuyên môn kiêm Trưởng khoa'],
  [4, 'Người đứng đầu cơ sở khám bệnh, chữa bệnh hoặc được ủy quyền'],
  [5, 'Người hành nghề được giao phụ trách khoa'],
  [6, 'Người được ủy quyền chịu trách nhiệm chuyên môn kỹ thuật']
];

/**
 * Xóa dấu tiếng Việt chuẩn
 */
function removeVietnameseTones(str) {
  if (!str) return '';
  str = str.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  str = str.replace(/[đĐ]/g, 'd');
  return str;
}

/**
 * Tạo USER_NAME theo quy chuẩn: [mã_đơn_vị].[viết_tắt_họ_đệm+tên_viết_hoa]
 * Ví dụ: "Nguyễn Văn Hoàng", mã "11055" -> "11055.NVHOANG"
 * Nếu trùng lặp: tự động thêm hậu tố 1, 2,...
 */
function generateUserName(fullName, unitCode = '11055', usedSet = new Set()) {
  if (!fullName) return '';
  const clean = removeVietnameseTones(fullName.trim()).replace(/[^a-zA-Z0-9\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  
  let shortName = '';
  if (words.length === 1) {
    shortName = words[0].toUpperCase();
  } else {
    const lastName = words[words.length - 1].toUpperCase();
    const initials = words.slice(0, words.length - 1).map(w => w[0].toUpperCase()).join('');
    shortName = initials + lastName;
  }

  const baseUser = unitCode ? `${unitCode}.${shortName}` : shortName;
  let finalUser = baseUser;
  let counter = 1;
  while (usedSet.has(finalUser.toLowerCase())) {
    finalUser = `${baseUser}${counter}`;
    counter++;
  }
  usedSet.add(finalUser.toLowerCase());
  return finalUser;
}

/**
 * Định dạng ngày YYYY-MM-DD
 */
function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val)) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const numVal = typeof val === 'number' ? val : parseFloat(val);
  if (!isNaN(numVal) && numVal > 20000 && numVal < 90000 && !val.toString().includes('-') && !val.toString().includes('/')) {
    try {
      const p = xlsx.SSF.parse_date_code(numVal);
      if (p && p.y && p.m && p.d) {
        return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
      }
    } catch (e) {}
  }
  const s = val.toString().trim();
  // 2024-04-20
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 20240420
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // 20/04/2024
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }
  return s;
}

/**
 * Trích xuất năm sinh từ số CCCD 12 số nếu không có ngày sinh
 * Ví dụ: 011185003116 -> Nữ, 1985 -> '1985-01-01'
 */
function extractBirthDateFromCccd(cccd) {
  if (!cccd) return '';
  const s = cccd.toString().replace(/\D/g, '');
  if (s.length === 12) {
    const genderCentury = parseInt(s[3], 10);
    const twoYear = s.slice(4, 6);
    let fullYear = 1900 + parseInt(twoYear, 10);
    if (genderCentury === 2 || genderCentury === 3) {
      fullYear = 2000 + parseInt(twoYear, 10);
    }
    return `${fullYear}-01-01`;
  }
  return '';
}

/**
 * Chuẩn hóa key header
 */
function normalizeKey(str) {
  if (!str) return '';
  return str.toString()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Ánh xạ chức danh nghề nghiệp sang ID chuẩn CHUCDANH_NN
 */
function mapChucDanhNN(val) {
  if (!val) return '';
  const s = val.toString().trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const norm = removeVietnameseTones(s).toLowerCase();
  if (norm.includes('bac si')) return 1;
  if (norm.includes('y si') || norm.includes('y sy')) return 2;
  if (norm.includes('dieu duong')) return 3;
  if (norm.includes('ho sinh')) return 4;
  if (norm.includes('ky thuat')) return 5;
  if (norm.includes('tam ly')) return 6;
  if (norm.includes('luong y')) return 7;
  if (norm.includes('duoc')) return 8;
  return 9;
}

/**
 * Ánh xạ loại nhân viên sang ID chuẩn DMC Loại
 */
function mapOfficerType(val) {
  if (!val) return 14; // Khác
  const s = val.toString().trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const norm = removeVietnameseTones(s).toLowerCase();
  if (norm.includes('quan tri')) return 2;
  if (norm.includes('le tan')) return 3;
  if (norm.includes('bac sy') || norm.includes('bac si')) return 4;
  if (norm.includes('y ta')) return 5;
  if (norm.includes('dieu duong')) return 6;
  if (norm.includes('tai chinh') || norm.includes('ke toan')) return 7;
  if (norm.includes('kho') || norm.includes('duoc')) return 8;
  if (norm.includes('xet nghiem')) return 9;
  if (norm.includes('chan doan') || norm.includes('x-quang')) return 10;
  if (norm.includes('phau thuat') || norm.includes('thu thuat')) return 11;
  if (norm.includes('do de')) return 12;
  return 14;
}

/**
/**
 * Hàm tìm giá trị linh hoạt từ đối tượng dòng theo danh sách mẫu key
 */
function getRowValue(obj, patterns) {
  if (!obj || typeof obj !== 'object') return '';
  for (const p of patterns) {
    if (obj[p] !== undefined && obj[p] !== null && String(obj[p]).trim() !== '') {
      return String(obj[p]).trim();
    }
  }
  const keys = Object.keys(obj);
  for (const p of patterns) {
    const pUpper = p.toUpperCase();
    for (const k of keys) {
      if (k.toUpperCase().includes(pUpper)) {
        if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
          return String(obj[k]).trim();
        }
      }
    }
  }
  return '';
}

/**
 * Trích xuất tên nhân viên chính xác từ dòng dữ liệu
 */
function extractOfficerName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const primaryPatterns = ['OFFICER_NAME', 'TEN_NHAN_VIEN', 'HO_TEN', 'HOTEN', 'TEN_NV', 'TEN_CAN_BO', 'CAN_BO', 'HO_VA_TEN'];
  for (const p of primaryPatterns) {
    for (const k of Object.keys(obj)) {
      if (k.toUpperCase().includes(p)) {
        const val = String(obj[k] || '').trim();
        if (val) return val;
      }
    }
  }
  for (const k of Object.keys(obj)) {
    const ku = k.toUpperCase();
    if (ku.includes('TEN') && !ku.includes('KHOA') && !ku.includes('DON_VI') && !ku.includes('TINH') && !ku.includes('HUYEN') && !ku.includes('XA')) {
      const val = String(obj[k] || '').trim();
      if (val) return val;
    }
  }
  return '';
}

/**
 * Đọc bảng tính linh hoạt (Excel hoặc CSV)
 */
function parseSheetSmart(sheet) {
  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rawRows || rawRows.length === 0) return [];

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
    const row = rawRows[i];
    if (!Array.isArray(row)) continue;
    const normLine = row.map(c => normalizeKey(c)).join(' ');
    if (
      (normLine.includes('TEN') && (normLine.includes('NHAN_VIEN') || normLine.includes('OFFICER') || normLine.includes('HO_TEN'))) ||
      normLine.includes('OFFICER_NAME') ||
      (normLine.includes('CHUCDANH') && normLine.includes('CCHN'))
    ) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    headerRowIdx = 0;
  }

  const rawHeaders = rawRows[headerRowIdx];
  const keys = rawHeaders.map(h => normalizeKey(h));

  const items = [];
  for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
    const rowData = rawRows[r];
    if (!rowData || !Array.isArray(rowData)) continue;

    // Bỏ qua dòng trống hoặc dòng hướng dẫn / ví dụ Ex.
    const firstCell = String(rowData[0] || '').trim().toLowerCase();
    if (firstCell === 'ex.' || firstCell === 'khong duoc nhap trung') continue;

    const obj = {};
    let hasValue = false;
    for (let c = 0; c < keys.length; c++) {
      const k = keys[c];
      if (k) {
        const val = rowData[c] !== undefined ? rowData[c] : '';
        obj[k] = val;
        if (val !== '' && val !== null && val !== undefined) {
          hasValue = true;
        }
      }
    }

    const name = extractOfficerName(obj);
    const hasIdentifier = name || getRowValue(obj, ['MA_BAC_SI', 'CCHN', 'CCCD', 'CMND', 'CMT', 'PHONE', 'SO_BHXH']);
    if (hasValue && hasIdentifier) {
      items.push(obj);
    }
  }

  return items;
}

/**
 * Chuyển đổi mảng dữ liệu nhân viên nguồn thành cấu trúc 33 cột chuẩn VNPT HIS (dữ liệu điền từ dòng 4)
 */
function convertNhanVienRows(sourceRows, options = {}) {
  const maDonVi = (options.maDonVi || options.maCskcb || '11055').toString().trim();
  const defaultDeptId = (options.defaultDeptId || '').toString().trim();
  const defaultMaKhoa = (options.defaultMaKhoa || defaultDeptId || '').toString().trim();
  const defaultTgNgay = options.defaultTgNgay !== undefined && options.defaultTgNgay !== ''
    ? options.defaultTgNgay
    : 'T20700-1130;T21330-1700;T30700-1130;T31330-1700;T40700-1130;T41330-1700;T50700-1130;T51330-1700;T60700-1130;T61330-1700';
  const defaultTgTuan = options.defaultTgTuan || 'T2T3T4T5T6';
  const defaultStatus = options.defaultStatus !== undefined ? options.defaultStatus : 1;

  const usedUsernames = new Set();
  const dataRows = [];

  sourceRows.forEach((d, idx) => {
    const stt = idx + 1;

    // 1. TÊN NHÂN VIÊN
    const officerName = extractOfficerName(d);

    // 2. USER_NAME: cấu trúc mã đơn vị.tên nhân viên viết tắt họ, đệm
    let userName = getRowValue(d, ['USER_NAME', 'USERNAME', 'TAI_KHOAN']);
    if (!userName && officerName) {
      userName = generateUserName(officerName, maDonVi, usedUsernames);
    } else if (userName) {
      usedUsernames.add(userName.toLowerCase());
    }

    // 3. MÃ NHÂN VIÊN OFFICER_CODE: Lấy giống USER_NAME theo yêu cầu
    const officerCode = userName || getRowValue(d, ['OFFICER_CODE', 'MA_NHAN_VIEN']) || `NV${String(stt).padStart(3, '0')}`;

    // 4. KHOA DEPT_ID: Lấy theo ô nhập ở tab (defaultDeptId) nếu có, fallback 'K01'
    const deptId = defaultDeptId || getRowValue(d, ['DEPT_ID', 'KHOA', 'TEN_KHOA', 'PHONG_BAN', 'BO_PHAN']) || 'K01';

    // 5. CHỨC DANH ĐẨY CỔNG (Tham chiếu sheet CHUCDANH_NN)
    const chucDanhVal = getRowValue(d, ['CHUCDANH_NN', 'CHUC_DANH_NN', 'CHUCDANH', 'CHUC_DANH', 'CHUC_VU']);
    const chucDanhNn = mapChucDanhNN(chucDanhVal);

    // 6. LOẠI NHÂN VIÊN OFFICER_TYPE (Tham chiếu sheet DMC Loại)
    const loaiVal = getRowValue(d, ['OFFICER_TYPE', 'LOAI_NHAN_VIEN', 'LOAI_NV', 'LOAI']);
    const officerType = mapOfficerType(loaiVal);

    // 7. Mã bác sĩ MA_BAC_SI (CCHN)
    const maBacSi = getRowValue(d, ['MA_BAC_SI', 'CHUNG_CHI_HANH_NGHE', 'CCHN', 'SO_CCHN', 'GPHN']).toString().trim();

    // 8. NGAYCAPCCHN
    const ngayCapCchn = formatDate(getRowValue(d, ['NGAYCAPCCHN', 'NGAY_CAP_CCHN', 'NGAY_CAP']));

    // 9. NOICAPCCHN
    const noiCapCchn = getRowValue(d, ['NOICAPCCHN', 'NOI_CAP_CCHN', 'NOI_CAP']).toString().trim();

    // 10. CMT/ CCCD
    let cccd = getRowValue(d, ['CMT_CCCD', 'CCCD', 'CMND', 'CMT', 'CAN_CUOC']).toString().trim();
    if (cccd.length === 11) cccd = '0' + cccd;

    // 11. SO_BHYT
    const soBhyt = getRowValue(d, ['SO_BHYT', 'BHYT', 'MA_THE_BHYT']).toString().trim();

    // 12. SO_BHXH
    let soBhxh = getRowValue(d, ['SO_BHXH', 'BHXH', 'MA_SO_BHXH', 'CMND', 'CCCD']).toString().trim();
    if (soBhxh.length === 11) soBhxh = '0' + soBhxh;

    // 13. NGÀY SINH: Người dùng yêu cầu bỏ trống
    const ngaySinh = '';

    // 14. GIỚI TÍNH (1: nam; 2: nữ)
    let gioiTinhRaw = getRowValue(d, ['GIOITINH', 'GIOI_TINH', 'GENDER']);
    let gioiTinh = 1;
    if (gioiTinhRaw === 'Nam' || gioiTinhRaw === 'nam' || String(gioiTinhRaw).trim() === '1') {
      gioiTinh = 1;
    } else if (gioiTinhRaw === 'Nữ' || gioiTinhRaw === 'nu' || String(gioiTinhRaw).trim() === '2') {
      gioiTinh = 2;
    } else if (cccd && cccd.length === 12) {
      const gDigit = parseInt(cccd[3], 10);
      gioiTinh = (gDigit === 0 || gDigit === 2) ? 1 : 2;
    } else {
      gioiTinh = 1;
    }

    // 15. PHONE
    let phone = getRowValue(d, ['PHONE', 'DIEN_THOAI', 'SDT', 'SO_DIEN_THOAI', 'TEL']).toString().trim();
    if (phone && !phone.startsWith('0') && phone.length === 9) {
      phone = '0' + phone;
    }

    // 16. EMAIL
    const email = getRowValue(d, ['EMAIL', 'THU_DIEN_TU', 'MAIL']).toString().trim().replace(/\.$/, '');

    // 17. MA_KHOA: Lấy theo ô nhập ở tab (defaultMaKhoa hoặc defaultDeptId)
    const maKhoa = defaultMaKhoa || defaultDeptId || getRowValue(d, ['MA_KHOA']) || 'K01';

    // 18. VITRICHUYENMON
    const viTriChuyenMon = getRowValue(d, ['VITRICHUYENMON', 'VI_TRI_CHUYEN_MON']);

    // 19. PHAMVI_CHUYENMON
    const phamViChuyenMon = getRowValue(d, ['PHAMVI_CHUYENMON', 'PHAM_VI_CHUYEN_MON']);

    // 20. SOQDPHAMVIHANHNGHE
    const soQdPhamVi = getRowValue(d, ['SOQDPHAMVIHANHNGHE', 'SO_QD_PHAM_VI']);

    // 21. DVKTPHANCONGTH
    const dvktPhanCong = getRowValue(d, ['DVKTPHANCONGTH', 'DVKT_PHAN_CONG']);

    // 22. SOQDDVKTPHANCONGTH
    const soQdDvkt = getRowValue(d, ['SOQDDVKTPHANCONGTH', 'SO_QD_DVKT']);

    // 23. TGDANGKYHANHNGHE (1: Toàn thời gian; 2: Không toàn thời gian)
    let tgDangKy = getRowValue(d, ['TGDANGKYHANHNGHE', 'TG_DANG_KY_HN']);
    if (!tgDangKy) {
      tgDangKy = 1;
    }

    // 24. TGLAMVIECNGAY: Theo mẫu người dùng cung cấp
    const tgLamViecNgay = defaultTgNgay || getRowValue(d, ['TGLAMVIECNGAY', 'TG_LAM_VIEC_NGAY']) || 'T20700-1130;T21330-1700;T30700-1130;T31330-1700;T40700-1130;T41330-1700;T50700-1130;T51330-1700;T60700-1130;T61330-1700';

    // 25. TGLAMVIECTUAN
    const tgLamViecTuan = getRowValue(d, ['TGLAMVIECTUAN', 'TG_LAM_VIEC_TUAN']) || defaultTgTuan;

    // 26. CSLAMVIECKHAC
    const csLamViecKhac = getRowValue(d, ['CSLAMVIECKHAC', 'CS_LAM_VIEC_KHAC']);

    // 27. QDCHUYENGIAOKT
    const qdChuyenGiaoKt = getRowValue(d, ['QDCHUYENGIAOKT', 'QD_CHUYEN_GIAO_KT']);

    // 28. TUNGAY
    const tuNgay = formatDate(getRowValue(d, ['TUNGAY', 'TU_NGAY']));

    // 29. DENNGAY
    const denNgay = formatDate(getRowValue(d, ['DENNGAY', 'DEN_NGAY']));

    // 30. DMGUIBH
    const dmGuiBhVal = getRowValue(d, ['DMGUIBH', 'DM_GUI_BH']);
    const dmGuiBh = dmGuiBhVal !== undefined && dmGuiBhVal !== '' ? dmGuiBhVal : (maBacSi ? 1 : '');

    // 31. NGAYCHECKGUIBH
    const ngayCheckGuiBh = formatDate(getRowValue(d, ['NGAYCHECKGUIBH', 'NGAY_CHECK_GUI_BH']));

    // 32. STATUS (Mặc định là 1)
    const statusVal = getRowValue(d, ['STATUS', 'TRANG_THAI']);
    const status = statusVal !== undefined && statusVal !== '' ? Number(statusVal) : defaultStatus;

    const row = [
      stt,               // 1: STT
      userName,          // 2: USER_NAME
      officerCode,       // 3: OFFICER_CODE
      officerName,       // 4: OFFICER_NAME
      deptId,            // 5: DEPT_ID
      chucDanhNn,        // 6: CHUCDANH_NN
      officerType,       // 7: OFFICER_TYPE
      maBacSi,           // 8: MA_BAC_SI
      ngayCapCchn,       // 9: NGAYCAPCCHN
      noiCapCchn,        // 10: NOICAPCCHN
      cccd,              // 11: CMT/ CCCD
      soBhyt,            // 12: SO_BHYT
      soBhxh,            // 13: SO_BHXH
      ngaySinh,          // 14: NGÀY SINH
      gioiTinh,          // 15: GIỚI TÍNH
      phone,             // 16: PHONE
      email,             // 17: EMAIL
      maKhoa,            // 18: MA_KHOA
      viTriChuyenMon,    // 19: VITRICHUYENMON
      phamViChuyenMon,   // 20: PHAMVI_CHUYENMON
      soQdPhamVi,        // 21: SOQDPHAMVIHANHNGHE
      dvktPhanCong,      // 22: DVKTPHANCONGTH
      soQdDvkt,          // 23: SOQDDVKTPHANCONGTH
      tgDangKy,          // 24: TGDANGKYHANHNGHE
      tgLamViecNgay,     // 25: TGLAMVIECNGAY
      tgLamViecTuan,     // 26: TGLAMVIECTUAN
      csLamViecKhac,     // 27: CSLAMVIECKHAC
      qdChuyenGiaoKt,    // 28: QDCHUYENGIAOKT
      tuNgay,            // 29: TUNGAY
      denNgay,           // 30: DENNGAY
      dmGuiBh,           // 31: DMGUIBH
      ngayCheckGuiBh,    // 32: NGAYCHECKGUIBH
      status             // 33: STATUS
    ];

    dataRows.push(row);
  });

  return dataRows;
}

/**
 * Xây dựng toàn bộ Workbook Excel chuẩn VNPT HIS gồm 4 sheet
 * Dữ liệu nhân viên được điền từ dòng 4 trở đi
 */
function buildFullNhanVienWorkbook(dataRows) {
  const wb = xlsx.utils.book_new();

  // Sheet 1: Dòng 1 Header, Dòng 2 Hướng dẫn, Dòng 3 Ví dụ Ex., Dòng 4+ Dữ liệu nhân viên
  const fullRows = [
    NHAN_VIEN_HEADERS,
    ROW_2_GUIDANCE,
    ROW_3_EXAMPLE,
    ...dataRows
  ];

  const wsMain = xlsx.utils.aoa_to_sheet(fullRows);
  xlsx.utils.book_append_sheet(wb, wsMain, 'IMPORT_NHAN_VIEN');

  // Sheet 2: CHUCDANH_NN
  const wsChucDanh = xlsx.utils.aoa_to_sheet(CHUC_DANH_NN_SHEET);
  xlsx.utils.book_append_sheet(wb, wsChucDanh, 'CHUCDANH_NN');

  // Sheet 3: DMC Loại
  const wsDmcLoai = xlsx.utils.aoa_to_sheet(DMC_LOAI_SHEET);
  xlsx.utils.book_append_sheet(wb, wsDmcLoai, 'DMC Loại');

  // Sheet 4: VITRICHUYENMON
  const wsViTri = xlsx.utils.aoa_to_sheet(VI_TRI_CHUYEN_MON_SHEET);
  xlsx.utils.book_append_sheet(wb, wsViTri, 'VITRICHUYENMON');

  return wb;
}

module.exports = {
  NHAN_VIEN_HEADERS,
  ROW_2_GUIDANCE,
  ROW_3_EXAMPLE,
  CHUC_DANH_NN_SHEET,
  DMC_LOAI_SHEET,
  VI_TRI_CHUYEN_MON_SHEET,
  removeVietnameseTones,
  generateUserName,
  formatDate,
  extractBirthDateFromCccd,
  parseSheetSmart,
  convertNhanVienRows,
  buildFullNhanVienWorkbook
};
