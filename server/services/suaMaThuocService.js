const axios = require('axios');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const cauhinhService = require('./cauhinhService');

/**
 * Kiểm tra xem mã thuốc có bắt đầu bằng tiền tố cũ TH (Tân dược) hoặc VT (Vật tư) hay không
 * Bỏ qua các thuốc đã tạo sẵn mã mới (25..., 26...)
 */
function startsWithThOrVt(code) {
  if (!code) return false;
  const c = String(code).trim().toUpperCase();
  return c.startsWith('TH') || c.startsWith('VT');
}

/**
 * Trích xuất Số đăng ký từ cột SOLO (Số lô / Số kiểm soát)
 * Quy tắc: format "[Số lô] - [Số đăng ký]" => Lấy phần sau dấu '-'
 * Ví dụ: "08092026 - 220003061/PCBA-HN" => "220003061/PCBA-HN"
 */
function extractSdk(solo) {
  if (!solo) return '';
  const str = String(solo).trim();
  const idx = str.indexOf('-');
  if (idx !== -1) {
    return str.substring(idx + 1).trim();
  }
  return '';
}

/**
 * Chuẩn hóa chuỗi văn bản (bỏ dấu, thường hóa, bỏ ký tự lạ) để so sánh tên thuốc
 */
function cleanStr(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chuyển chuỗi ngày (DD/MM/YYYY, YYYY-MM-DD...) thành timestamp để sắp xếp
 */
function parseDateValue(s) {
  if (!s) return 0;
  if (typeof s === 'string' && s.includes('/')) {
    const parts = s.split(/[\/\s:]+/);
    if (parts.length >= 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      return new Date(y, m, d).getTime() || 0;
    }
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? 0 : dt.getTime();
}

/**
 * Chuyển ngày DD/MM/YYYY hoặc chuỗi thời gian thành ISO-8601 UTC
 * Bắt buộc cho HMIS backend (Java ZonedDateTime)
 */
function toIsoDate(val) {
  if (!val) return null;
  if (typeof val === 'string' && val.includes('/')) {
    const parts = val.split(/[\/\s:]+/);
    if (parts.length >= 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      const dt = new Date(Date.UTC(y, m, d, 0, 0, 0));
      return dt.toISOString();
    }
  }
  try {
    const dt = new Date(val);
    if (!isNaN(dt.getTime())) return dt.toISOString();
  } catch (e) {}
  return null;
}

/**
 * Tải toàn bộ danh mục thuốc / vật tư của trạm y tế trên cổng HMIS
 */
async function fetchCatalogForStation(stationId) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error(`Không tìm thấy cấu hình trạm với ID: ${stationId}`);
  }

  const auth = await cauhinhService.loginToHmis(station);
  const headers = {
    'Authorization': 'Bearer ' + auth.token,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl,
    'Content-Type': 'application/json'
  };

  let allHmis = [];
  let page = 0;
  const pageSize = 200;

  while (true) {
    const url = `${auth.gateway}pharmacy/dmthuoc/laydsthuoc?page=${page}&size=${pageSize}&sort=id,desc`;
    const res = await axios.get(url, { headers, timeout: 20000 });
    const content = res.data?.data?.content || [];
    allHmis = allHmis.concat(content);
    const totalPages = res.data?.data?.totalPages || 1;
    if (page >= totalPages - 1 || content.length === 0) {
      break;
    }
    page++;
  }

  return { station, auth, catalog: allHmis };
}

/**
 * Tự động nhận diện Đơn vị tính từ tên thuốc / vật tư nếu file không có cột DVT
 */
function autoDetectDvt(ten) {
  if (!ten) return 'Cái';
  const raw = String(ten).toLowerCase();
  const c = ' ' + cleanStr(ten) + ' ';

  // 1. Kiểm tra từ nguyên vẹn / cụm từ đặc trưng cho Vật tư & Dụng cụ y tế
  if (/\b(gang|gang tay|bao tay)\b/.test(c)) return 'Đôi';
  if (/\b(bom tiem|kim tiem|kim luon|kim canh b|kim lay thuoc|que thu|test|nhiet ke|de luoi|ong thong|sonde|catheter|canun|day tho|mat na tho)\b/.test(c)) return 'Cái';
  if (/\b(bo day truyen|day truyen|bo truyen|day noi|bo co dinh)\b/.test(c)) return 'Bộ';
  if (/\b(urgosyval|bang keo|bang dinh|bang cuon|bang thun|bong cuon|cuon)\b/.test(c)) return 'Cuộn';
  if (/\b(bong y te|bong hut nuoc|bong gam|bong tham)\b/.test(c)) return 'Cuộn';
  if (/\b(mieng dan|cao dan|gac mieng)\b/.test(c)) return 'Miếng';
  if (/\b(hop)\b/.test(c)) return 'Hộp';
  if (/\b(binh|binh khi)\b/.test(c)) return 'Bình';
  if (/\b(tui mau|tui nuoc tieu|tui dung)\b/.test(c)) return 'Túi';

  // 2. Kiểm tra các dạng thuốc đặc thù
  if (/\b(presept|effervescent|vien|nen|nang|bao phim|sui|ngam|dat)\b/.test(c)) return 'Viên';
  if (/\b(osaphine|morphin|magnesi sulfat|atropin|adrenalin|lidocain|diazepam|seduxen|furosemid|analgin|gentamycin|ong tiem|dung dich tiem|thuoc tiem)\b/.test(c) || raw.includes('ống') || raw.includes('tiêm')) return 'Ống';
  if (/\b(con|con y te|povidone|betadine|sat khuan|rua tay|dung dich|nuoc cat|siro|nuoc suc mieng|chai|lo)\b/.test(c) || raw.includes('chai') || raw.includes('lọ')) return 'Chai';
  if (/\b(tuyp|kem|mo|gel|tra mat)\b/.test(c) || raw.includes('tuýp')) return 'Tuýp';
  if (/\b(goi|hon dich|bot pha|bot uong|oresol|smecta|apigel|asigastrogit)\b/.test(c) || raw.includes('gói')) return 'Gói';
  if (/\b(vi)\b/.test(c) && !c.includes('vihankok') && !c.includes('povidone')) return 'Vỉ';

  // 3. Fallback theo từ khóa tiếng Việt có dấu
  if (raw.includes('viên')) return 'Viên';
  if (raw.includes('ống')) return 'Ống';
  if (raw.includes('chai')) return 'Chai';
  if (raw.includes('lọ')) return 'Lọ';
  if (raw.includes('tuýp')) return 'Tuýp';
  if (raw.includes('gói')) return 'Gói';
  if (raw.includes('cuộn')) return 'Cuộn';
  if (raw.includes('đôi')) return 'Đôi';
  if (raw.includes('bộ')) return 'Bộ';
  if (raw.includes('miếng')) return 'Miếng';

  return 'Cái'; // Default an toàn
}

/**
 * Header 78 cột chuẩn của file import thuốc / vật tư VNPT HIS
 */
const HIS_TARGET_HEADER = [
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

// Đọc dữ liệu tham chiếu Nước SX từ Biên bản kiểm kê nếu có
const bbkkRefPath = path.join(__dirname, '../../data/bbkk_reference.json');
let bbkkRef = {};
if (fs.existsSync(bbkkRefPath)) {
  try {
    bbkkRef = JSON.parse(fs.readFileSync(bbkkRefPath, 'utf8'));
  } catch (e) {}
}

function lookupNuocSx(item) {
  // 1. Trực tiếp từ object nếu có sẵn
  const direct = String(item.nuocSx || item.NUOC_SX || item.nuoc_sx || item.NUOCSANXUAT || '').trim();
  if (direct) return direct;

  // 2. Tra cứu từ BBKK reference map theo mã hoặc tên
  const ma = String(item.maMoiFile || item.ma || '').trim().toLowerCase();
  const ten = String(item.tenFile || item.ten || '').trim().toLowerCase();

  const cleanMa = ma.replace(/^2[56]\./, '');
  for (const k of [ma, cleanMa, '25.' + cleanMa, '26.' + cleanMa]) {
    if (bbkkRef[k]?.nuocSx) return bbkkRef[k].nuocSx;
  }

  if (bbkkRef[ten]?.nuocSx) return bbkkRef[ten].nuocSx;
  for (const [k, v] of Object.entries(bbkkRef)) {
    if (v.nuocSx && (ten.includes(k) || k.includes(ten))) {
      return v.nuocSx;
    }
  }

  // 3. Mặc định
  return 'Việt Nam';
}

/**
 * Xuất file Excel chuẩn import thuốc VNPT HIS (78 cột) cho những thuốc chưa có trong danh mục:
 * Theo đúng yêu cầu:
 * - STT
 * - Tên thuốc (TEN_THUOC)
 * - Mã thuốc (MA_THUOC)
 * - Đơn giá (GIA_THAU, GIA_BAN, GIA_DICH_VU, GIA_BHYT)
 * - Số đăng ký (SO_DANG_KY)
 * - Đơn vị tính (DON_VI_TINH)
 * - Nước sản xuất (NUOC_SX) lấy từ Biên bản kiểm kê
 * - Nguồn chi trả (NGUONCT = 1)
 * - Thầu ghép (THAUGHEP = MA_THUOC)
 * - Còn các cột khác để trống
 */
function exportChuaCoTrongDmExcel(items) {
  let unadded = (items || []).filter(x => x.status === 'KHONG_TIM_THAY' || x.status === 'CHUA_TIM_THAY');
  if (unadded.length === 0 && Array.isArray(items) && items.length > 0) {
    unadded = items;
  }

  // Deduplicate theo mã mới hoặc tên để tránh trùng lặp
  const uniqueList = [];
  const seen = new Set();
  for (const it of unadded) {
    const key = String(it.maMoiFile || it.ma || it.tenFile || it.ten || '').trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      uniqueList.push(it);
    }
  }

  const resultRows = [HIS_TARGET_HEADER];
  const nguonCtCol = HIS_TARGET_HEADER.indexOf('NGUONCT');
  const thauGhepCol = HIS_TARGET_HEADER.indexOf('THAUGHEP');
  const nuocSxCol = HIS_TARGET_HEADER.indexOf('NUOC_SX');

  uniqueList.forEach((it, idx) => {
    const row = new Array(HIS_TARGET_HEADER.length).fill('');
    const stt = idx + 1;
    const maThuoc = String(it.maMoiFile || it.ma || '').trim();
    const tenThuoc = String(it.tenFile || it.ten || '').trim();
    const donViTinh = String(it.dvt || autoDetectDvt(tenThuoc) || 'Cái').trim();
    const donGia = Number(it.giaFile !== undefined ? it.giaFile : (it.gia || it.gianhap || 0)) || 0;
    const soDangKy = String(it.sdkFile || extractSdk(it.solo) || '').trim();
    const nuocSx = lookupNuocSx(it);

    row[0] = stt;                    // STT (col 0)
    row[5] = maThuoc;               // MA_THUOC (col 5)
    row[6] = tenThuoc;              // TEN_THUOC (col 6)
    row[8] = donViTinh;             // DON_VI_TINH (col 8)
    if (nuocSxCol !== -1) {
      row[nuocSxCol] = nuocSx;      // NUOC_SX (col 12) từ Biên bản kiểm kê
    } else {
      row[12] = nuocSx;
    }
    row[13] = donGia || '';          // GIA_THAU (col 13)
    row[15] = donGia || '';          // GIA_BAN (col 15)
    row[16] = donGia || '';          // GIA_DICH_VU (col 16)
    row[17] = donGia || '';          // GIA_BHYT (col 17)
    row[22] = soDangKy;             // SO_DANG_KY (col 22)
    if (nguonCtCol !== -1) {
      row[nguonCtCol] = 1;          // NGUONCT (col 33) = 1 (Tự động để là 1 theo yêu cầu)
    } else {
      row[33] = 1;
    }
    if (thauGhepCol !== -1) {
      row[thauGhepCol] = maThuoc;   // THAUGHEP (col 35) lấy theo MA_THUOC theo yêu cầu
    } else {
      row[35] = maThuoc;
    }
    // Tất cả các cột khác để trống theo yêu cầu

    resultRows.push(row);
  });

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(resultRows);
  xlsx.utils.book_append_sheet(wb, ws, 'Mẫu');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return {
    buffer,
    count: uniqueList.length
  };
}

/**
 * So sánh, đối soát danh sách thuốc từ File Tồn Đầu với Danh Mục HMIS
 */
function compareInventoryWithCatalog(rows, catalog) {
  let exactMatches = 0;
  let secondaryMatches = 0;
  let notFound = 0;

  const comparisonItems = [];
  const uniqueUpdatesMap = new Map();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sdk = extractSdk(r.SOLO);
    const cleanTen = cleanStr(r.TEN);
    const rGia = Number(r.GIANHAP) || Number(r.GIABAN) || 0;
    const rDvt = r.DVT || r.dvt || r.DON_VI_TINH || r.donViTinh || autoDetectDvt(r.TEN) || 'Cái';
    const rNuocSx = String(r.NUOC_SX || r.nuocSx || r.NUOCSANXUAT || r.nuoc_sx || '').trim();

    // 1. Khớp ưu tiên 1: Tên + Giá + Số ĐK
    let candidates = catalog.filter(h => {
      const hTen = cleanStr(h.ten);
      const hGia = Number(h.giaNhap) || Number(h.giaBan) || 0;
      const hSdk = String(h.soDangKy || '').trim().toLowerCase();
      const sdkClean = sdk.toLowerCase();

      const nameMatch = hTen === cleanTen || hTen.includes(cleanTen) || cleanTen.includes(hTen);
      const priceMatch = Math.abs(hGia - rGia) < 1;
      const sdkMatch = sdk ? (hSdk === sdkClean) : false;

      return nameMatch && priceMatch && sdkMatch;
    });

    let matchConfidence = 'EXACT'; // Tên + Giá + Số ĐK
    if (candidates.length === 0 && sdk) {
      // 2. Khớp ưu tiên 2: Tên + Số ĐK (bỏ qua giá)
      candidates = catalog.filter(h => {
        const hTen = cleanStr(h.ten);
        const hSdk = String(h.soDangKy || '').trim().toLowerCase();
        return (hTen === cleanTen || hTen.includes(cleanTen) || cleanTen.includes(hTen)) && hSdk === sdk.toLowerCase();
      });
      if (candidates.length > 0) matchConfidence = 'TEN_SDK';
    }

    if (candidates.length === 0) {
      // 3. Khớp ưu tiên 3: Tên + Đơn giá
      candidates = catalog.filter(h => {
        const hTen = cleanStr(h.ten);
        const hGia = Number(h.giaNhap) || Number(h.giaBan) || 0;
        return (hTen === cleanTen || hTen.includes(cleanTen) || cleanTen.includes(hTen)) && Math.abs(hGia - rGia) < 1;
      });
      if (candidates.length > 0) matchConfidence = 'TEN_GIA';
    }

    if (candidates.length > 0) {
      // Sắp xếp lấy Ngày QĐ mới nhất
      candidates.sort((a, b) => {
        const timeA = parseDateValue(a.ngayQdThau) || parseDateValue(a.namCungUng) || parseDateValue(a.tuNgay);
        const timeB = parseDateValue(b.ngayQdThau) || parseDateValue(b.namCungUng) || parseDateValue(b.tuNgay);
        return timeB - timeA;
      });

      if (matchConfidence === 'EXACT') exactMatches++;
      else secondaryMatches++;

      const maMoi = String(r.MA || '').trim();

      // 1. Kiểm tra xem trong DM trạm đã có thuốc nào trùng sẵn mã mới r.MA chưa
      const alreadyMatched = candidates.find(c => {
        const ma = String(c.ma || c.maThuoc || c.maThuocBv || '').trim().toLowerCase();
        return ma === maMoi.toLowerCase();
      });

      let best = null;
      let status = '';
      let isSameCode = false;

      if (alreadyMatched) {
        // Đã có bản ghi mang đúng mã mới trùng khớp
        best = alreadyMatched;
        isSameCode = true;
        status = 'DA_TRUNG_MA';
      } else {
        // Chỉ lấy các thuốc có mã cũ bắt đầu bằng TH hoặc VT để sửa mã
        // Bỏ qua các thuốc đã được tạo sẵn mã mới (25..., 26...)
        const oldCodeCandidates = candidates.filter(c => {
          const ma = String(c.ma || c.maThuoc || c.maThuocBv || '').trim();
          return startsWithThOrVt(ma);
        });

        if (oldCodeCandidates.length > 0) {
          // Có thuốc mã cũ TH hoặc VT cần sửa mã
          best = oldCodeCandidates[0];
          isSameCode = false;
          status = 'CAN_SUA_MA';
        } else {
          // Các bản ghi đều đã có mã mới khác TH/VT ➔ Bỏ qua không sửa
          best = candidates[0];
          isSameCode = true;
          status = 'DA_TRUNG_MA';
        }
      }

      const maCu = best.ma || best.maThuoc || best.maThuocBv || '';

      const item = {
        stt: i + 1,
        rowId: `row_${i}_${best.id}`,
        hmisId: best.id,
        tenFile: r.TEN || '',
        tenHmis: best.ten || '',
        dvt: rDvt || best.tenDonViTinh || 'Cái',
        solo: r.SOLO || '',
        handung: r.HANDUNG || '',
        sdkFile: sdk,
        sdkHmis: best.soDangKy || '',
        giaFile: rGia,
        giaHmis: Number(best.giaNhap) || Number(best.giaBan) || 0,
        maCuHmis: maCu,
        maMoiFile: maMoi,
        nuocSx: rNuocSx,
        isSameCode,
        status,
        matchConfidence, // EXACT, TEN_SDK, TEN_GIA
        qdThau: best.qdThau || '',
        ngayQd: best.ngayQdThau || best.namCungUng || '',
        selected: (status === 'CAN_SUA_MA')
      };

      comparisonItems.push(item);

      // Lưu vào danh sách Unique thuốc HMIS cần cập nhật (chỉ thuốc TH, VT)
      if (status === 'CAN_SUA_MA' && best.id) {
        if (!uniqueUpdatesMap.has(best.id)) {
          uniqueUpdatesMap.set(best.id, {
            hmisId: best.id,
            tenHmis: best.ten,
            maCu,
            maMoi,
            qdThau: best.qdThau || '',
            ngayQd: best.ngayQdThau || best.namCungUng || '',
            soDangKy: best.soDangKy || '',
            giaNhap: best.giaNhap || 0,
            affectRows: [i + 1]
          });
        } else {
          uniqueUpdatesMap.get(best.id).affectRows.push(i + 1);
        }
      }
    } else {
      notFound++;
      comparisonItems.push({
        stt: i + 1,
        rowId: `row_${i}_none`,
        hmisId: null,
        tenFile: r.TEN || '',
        tenHmis: '(Chưa có trong DM trạm)',
        dvt: rDvt,
        solo: r.SOLO || '',
        handung: r.HANDUNG || '',
        sdkFile: sdk,
        sdkHmis: '',
        giaFile: rGia,
        giaHmis: 0,
        maCuHmis: '---',
        maMoiFile: String(r.MA || '').trim(),
        nuocSx: rNuocSx,
        isSameCode: false,
        status: 'KHONG_TIM_THAY',
        matchConfidence: 'NOT_FOUND',
        qdThau: '',
        ngayQd: '',
        selected: false
      });
    }
  }

  const uniqueUpdates = Array.from(uniqueUpdatesMap.values());

  const summary = {
    totalRows: rows.length,
    exactMatches,
    secondaryMatches,
    notFound,
    needUpdateCount: comparisonItems.filter(x => x.status === 'CAN_SUA_MA').length,
    sameCodeCount: comparisonItems.filter(x => x.status === 'DA_TRUNG_MA').length,
    uniqueHmisNeedUpdate: uniqueUpdates.length
  };

  return { summary, items: comparisonItems, uniqueUpdates };
}

/**
 * Chuẩn hóa payload lưu thuốc theo đúng cấu trúc form Angular HMIS (luuThuocVatTu)
 * Tránh để các trường boolean/number là null gây lỗi NullPointerException trong bảng duclogthuocvattu ở lần sửa tiếp theo.
 */
function buildHmisDrugSavePayload(d, hmisId, newMa, companyId = 1) {
  const finalMa = newMa || d.ma;
  return {
    thuocVatTuId: hmisId,
    maThuoc: finalMa,
    maNhom: d.maNhom,
    thuocVatTuIdCha: d.thuocVatTuIdCha || null,
    ten: d.ten,
    tenKhoaHoc: d.tenKhoaHoc || d.ten,
    tenVtytThuongMai: d.tenVtytThuongMai || '',
    hoatChat: d.hoatChat || '',
    maHoatChat: d.maHoatChat || '',
    nongDo: d.nongDo || '',
    lieuLuong: d.lieuLuong || '',
    donViTinhId: d.donViTinhId || null,
    dongGoi: d.dongGoi || '',
    thuocKhangSinh: d.thuocKhangSinh ? 1 : 0,
    keTrungHoatChat: d.keTrungHoatChat ? 1 : 0,
    duongDungId: d.duongDungId || null,
    soLuongNgay: Number(d.soLuongNgay) || 0,
    thuocTanDuoc: d.thuocTanDuoc ? 1 : 0,
    loai: d.loai || 0,
    atc: d.atc || '',
    viThuocYhct: d.viThuocYhct ? 1 : 0,
    chePhamYhct: d.chePhamYhct ? 1 : 0,
    hangSanXuatId: d.hangSanXuatId || 0,
    nuocSanXuatId: d.nuocSanXuatId || 0,
    nhaCungCapId: d.nhaCungCapId || 0,
    goiThau: d.goiThau || '',
    namCungUng: d.namCungUng || '',
    benhVienApThau: d.benhVienApThau || '',
    maThau: d.maThau || 0,
    maNhomThau: d.maNhomThau || '',
    sttDauThau: d.sttDauThau || '',
    huongDanSuDung: d.huongDanSuDung || '',
    canhBaoHsd: Number(d.canhBaoHsd) || 0,
    khongNhapMoi: d.khongNhapMoi ? 1 : 0,
    khongInHamLuong: d.khongInHamLuong ? 1 : 0,
    giaNhap: Number(d.giaNhap) || 0,
    vatNhap: Number(d.vatNhap) || 0,
    choLanhDaoDuyet: d.choLanhDaoDuyet ?? null,
    giaBan: Number(d.giaBan) || 0,
    vatBan: Number(d.vatBan) || 0,
    soLo: d.soLo || '',
    tyLeHuHao: Number(d.tyLeHuHao) || 0,
    soDangKy: d.soDangKy || '',
    chuy: d.chuy || '',
    nhomQuyCheId: Number(d.nhomQuyCheId) || 0,
    nhomQuanLyId: Number(d.nhomQuanLyId) || 0,
    nhomBaoCaoId: Number(d.nhomBaoCaoId) || 0,
    nhomNghienCuuId: Number(d.nhomNghienCuuId) || 0,
    nhomDuocLyId: Number(d.nhomDuocLyId) || 0,
    nhomAbcVenId: Number(d.nhomAbcVenId) || 0,
    nhomTieuDuocLyId: Number(d.nhomTieuDuocLyId) || 0,
    nguonChuongTrinhId: d.nguonChuongTrinhId || null,
    khoanMucId: d.khoanMucId || null,
    nhomMabhytId: d.nhomMabhytId || 10,
    nhomTkBaoCao: d.nhomTkBaoCao || '',
    khongChuyenDoiTuongHaoPhi: d.khongChuyenDoiTuongHaoPhi ? 1 : 0,
    giaVienPhi: Number(d.giaVienPhi) || 0,
    giaBhyt: Number(d.giaBhyt) || 0,
    giaNuocNgoai: Number(d.giaNuocNgoai) || 0,
    giaTranBhyt: Number(d.giaTranBhyt) || 0,
    ngayCapNhat: '',
    nguoiCapNhat: 0,
    ngayThucHien: '',
    nguoiThucHien: '',
    giaNhanDan: Number(d.giaNhanDan) || 0,
    tyLeLoiNhuan: Number(d.tyLeLoiNhuan) || 0,
    tyLeLoiNhuanNhanDan: Number(d.tyLeLoiNhuanNhanDan) || 0,
    tyLeLoiNhuanBhyt: Number(d.tyLeLoiNhuanBhyt) || 0,
    tyLeLoiNhuanNuocNgoai: Number(d.tyLeLoiNhuanNuocNgoai) || 0,
    tyLeBhyt: Number(d.tyLeBhyt) || 0,
    bhytTt: Number(d.bhytTt) || 0,
    csytId: companyId,
    kieu: d.kieu ?? 1,
    khoa: d.khoa ? 1 : 0,
    maByt: d.maByt || '',
    dvLamTron: Number(d.dvLamTron) || 0,
    canhBaoSoLuong: Number(d.canhBaoSoLuong) || 0,
    soLanSuDung: Number(d.soLanSuDung) || 0,
    donViTinhIdQd: d.donViTinhIdQd || null,
    thuocPhongXa: d.thuocPhongXa ? 1 : 0,
    duocPhepKeLe: d.duocPhepKeLe ? 1 : 0,
    soGoiThau: d.soGoiThau || '',
    sttThuoc: d.sttThuoc || '',
    soNgayTtBaoHiem: Number(d.soNgayTtBaoHiem) || 0,
    soNgaySdkHangSinh: Number(d.soNgaySdkHangSinh) || 0,
    danhSttDungThuoc: d.danhSttDungThuoc ? 1 : 0,
    thuocNhieuHoatChat: d.thuocNhieuHoatChat ? 1 : 0,
    nhomDieuTriId: Number(d.nhomDieuTriId) || 0,
    thuocKeDon: d.thuocKeDon ? 1 : 0,
    ycsdKhangSinh: null,
    tienChatGnht: d.tienChatGnht ? 1 : 0,
    tuoiMin: Number(d.tuoiMin) || 0,
    tuoiMax: Number(d.tuoiMax) || 0,
    ngayHlBhyt: d.ngayHlBhyt ? toIsoDate(d.ngayHlBhyt) : null,
    tyLeBhytCu: Number(d.tyLeBhytCu) || 0,
    barCode: d.barCode || '',
    stt05: d.stt05 || '',
    khongTinhXnt: d.khongTinhXnt ? 1 : 0,
    thangSoBanLe: Number(d.thangSoBanLe) || 0,
    qlTheoTuiMau: d.qlTheoTuiMau ? 1 : 0,
    bietDuoc: d.bietDuoc || '',
    thuocDieuTriLao: d.thuocDieuTriLao ? 1 : 0,
    thuocCorticoid: d.thuocCorticoid ? 1 : 0,
    duocDuyetLe: d.duocDuyetLe ? 1 : 0,
    luonChuyenDoiTuongHaoPhi: d.luonChuyenDoiTuongHaoPhi ? 1 : 0,
    slThau: Number(d.slThau) || 0,
    thauGhep: d.thauGhep || '',
    loaiThau: Number(d.loaiThau) || 0,
    tonToiThieu: Number(d.tonToiThieu) || 0,
    slKeTheoDot: Number(d.slKeTheoDot) || 0,
    slKeTheoNgay: Number(d.slKeTheoNgay) || 0,
    maThuocBv: finalMa,
    soGiayPhep: d.soGiayPhep || '',
    thuocDacBiet: d.thuocDacBiet ? 1 : 0,
    tenAtc: 'string',
    dvtUuTien: d.dvtUuTien || null,
    lyDoKhoaThuoc: d.lyDoKhoaThuoc || '',
    giaChenh: Number(d.giaChenh) || 0,
    thuocChuyenKhoaTamThan: d.thuocChuyenKhoaTamThan ? 1 : 0,
    tonToiDa: Number(d.tonToiDa) || 0,
    khongThanhToanNgoaiTru: d.khongThanhToanNgoaiTru ? 1 : 0,
    tuoiThangMin: Number(d.tuoiThangMin) || 0,
    tuoiThangMax: Number(d.tuoiThangMax) || 0,
    thanhToanHaoPhi: d.thanhToanHaoPhi ? 1 : 0,
    tangNguyCo: d.tangNguyCo ? 1 : 0,
    chiPhiTuiMau: d.chiPhiTuiMau ? 1 : 0,
    khiYtet: d.khiYtet ? 1 : 0,
    molnupiravir: d.molnupiravir ? 1 : 0,
    maHieuSp: d.maHieuSp || '',
    ghepMaxMl: null,
    ppCheBien: d.ppCheBien || '',
    maPpCheBien: d.maPpCheBien || '',
    ma4750: d.ma4750 || '',
    ngayKetThucHd: d.ngayKetThucHd ? toIsoDate(d.ngayKetThucHd) : '',
    teme: d.teme ? 1 : 0,
    vitamin: d.vitamin ? 1 : 0,
    theTich: Number(d.theTich) || null,
    capNhatGiaKho: 0,
    tyLeHaoHutCheBien: 0,
    nguongCB: 0,
    tyLeQuyDoi: '',
    maMoiThau: d.maMoiThau || '',
    dangBaoChe: d.dangBaoChe || '',
    dmGuiBH: d.dmGuiBH ? 1 : 0,
    ngayCheckGuiBH: d.ngayCheckGuiBH ? toIsoDate(d.ngayCheckGuiBH) : null,
    htThau: Number(d.htThau) || 0,
    tuNgay: d.tuNgay ? toIsoDate(d.tuNgay) : null,
    denNgay: d.denNgay ? toIsoDate(d.denNgay) : null,
    maCsKcbThuoc: d.maCsKcbThuoc || '',
    maCsKcbTbyt: d.maCsKcbTbyt || d.maCsKcbThuoc || '',
    dmNsxCdd: d.dmNsxCdd || '',
    lieuBqPx: d.lieuBqPx || '',
    tlThucteBqPx: d.tlThucteBqPx || '',
    thanhTienThuoc: d.thanhTienThuoc || '',
    soLuuHanh: d.soLuuHanh || '',
    dmThucteCdd: d.dmThucteCdd || '',
    tinhNangKt: d.tinhNangKt || '',
    ttLieuDung: d.ttLieuDung || '',
    chiDinh: d.chiDinh || '',
    chongChiDinh: d.chongChiDinh || '',
    thuocDocCapCuu: d.thuocDocCapCuu ? 1 : 0,
    slDauKyTmp: d.slDauKyTmp ? 1 : 0
  };
}

/**
 * Cập nhật mã thuốc cho 1 thuốc trên HMIS
 */
async function updateSingleDrugOnHmis(auth, hmisId, newMa) {
  const companyId = auth.userInfo?.company?.id || 1;
  const headers = {
    'Authorization': 'Bearer ' + auth.token,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl,
    'Content-Type': 'application/json'
  };

  // 0. Dọn các bản ghi log lỗi (tenAtc === null do bản cũ ghi thiếu trường mặc định) nếu có
  try {
    const logSearchUrl = `${auth.gateway}pharmacy/duclogthuocvattu/search?page=0&size=50&sort=id,asc&filter=thuocVatTuId==${hmisId}`;
    const logRes = await axios.get(logSearchUrl, { headers, timeout: 10000 });
    const logs = logRes.data?.data?.content || [];
    for (const l of logs) {
      if (l.tenAtc === null && l.ghiChu !== 'INSERT') {
        await axios.delete(`${auth.gateway}pharmacy/duclogthuocvattu/delete?id=${l.id}`, { headers, timeout: 10000 });
      }
    }
  } catch (e) {
    // Bỏ qua nếu không có log lỗi
  }

  // 1. Lấy chi tiết hiện tại của thuốc
  const detailUrl = `${auth.gateway}pharmacy/dmthuoc/layctthuoctheoid?thuocVatTuId=${hmisId}&csytId=${companyId}`;
  const detailRes = await axios.get(detailUrl, { headers, timeout: 15000 });
  const detail = detailRes.data?.data;
  if (!detail) {
    throw new Error(`Không lấy được thông tin chi tiết thuốc ID ${hmisId}`);
  }

  // 2. Chuẩn bị payload sửa mã theo đúng chuẩn Angular UI của HMIS
  const payload = buildHmisDrugSavePayload(detail, hmisId, newMa, companyId);

  // 3. Gửi lưu lên cổng HMIS
  const saveUrl = `${auth.gateway}pharmacy/dmthuoc/luuthongtinthuocvattu`;
  const saveRes = await axios.post(saveUrl, payload, { headers, timeout: 20000 });
  
  if (saveRes.data && (saveRes.data.code === 0 || saveRes.status === 200)) {
    return { success: true, hmisId, newMa, message: saveRes.data.message || 'Cập nhật thành công' };
  } else {
    throw new Error(saveRes.data?.message || `Lỗi cập nhật thuốc ${hmisId}`);
  }
}

/**
 * Cập nhật hàng loạt mã thuốc trên HMIS
 */
async function batchUpdateDrugsOnHmis(stationId, updateList) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error(`Không tìm thấy cấu hình trạm ID: ${stationId}`);
  }

  const auth = await cauhinhService.loginToHmis(station);
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < updateList.length; i++) {
    const item = updateList[i];
    try {
      const res = await updateSingleDrugOnHmis(auth, item.hmisId, item.newMa);
      results.push({
        hmisId: item.hmisId,
        newMa: item.newMa,
        oldMa: item.oldMa || '',
        ten: item.ten || '',
        success: true,
        message: res.message
      });
      successCount++;
    } catch (err) {
      console.error(`Lỗi cập nhật thuốc ID ${item.hmisId}:`, err.message);
      results.push({
        hmisId: item.hmisId,
        newMa: item.newMa,
        oldMa: item.oldMa || '',
        ten: item.ten || '',
        success: false,
        error: err.response?.data?.message || err.message
      });
      failCount++;
    }
  }

  return {
    station: { id: station.id, ten: station.tenTram || station.ten, maTram: station.maTram },
    total: updateList.length,
    successCount,
    failCount,
    results
  };
}

module.exports = {
  startsWithThOrVt,
  extractSdk,
  cleanStr,
  parseDateValue,
  toIsoDate,
  fetchCatalogForStation,
  compareInventoryWithCatalog,
  updateSingleDrugOnHmis,
  batchUpdateDrugsOnHmis,
  autoDetectDvt,
  HIS_TARGET_HEADER,
  exportChuaCoTrongDmExcel
};
