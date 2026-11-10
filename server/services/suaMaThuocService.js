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
        solo: r.SOLO || '',
        handung: r.HANDUNG || '',
        sdkFile: sdk,
        sdkHmis: best.soDangKy || '',
        giaFile: rGia,
        giaHmis: Number(best.giaNhap) || Number(best.giaBan) || 0,
        maCuHmis: maCu,
        maMoiFile: maMoi,
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
        solo: r.SOLO || '',
        handung: r.HANDUNG || '',
        sdkFile: sdk,
        sdkHmis: '',
        giaFile: rGia,
        giaHmis: 0,
        maCuHmis: '---',
        maMoiFile: String(r.MA || '').trim(),
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

  // 1. Lấy chi tiết hiện tại của thuốc
  const detailUrl = `${auth.gateway}pharmacy/dmthuoc/layctthuoctheoid?thuocVatTuId=${hmisId}&csytId=${companyId}`;
  const detailRes = await axios.get(detailUrl, { headers, timeout: 15000 });
  const detail = detailRes.data?.data;
  if (!detail) {
    throw new Error(`Không lấy được thông tin chi tiết thuốc ID ${hmisId}`);
  }

  // 2. Chuẩn bị payload sửa mã
  const payload = { ...detail };
  payload.thuocVatTuId = hmisId;
  payload.ma = newMa;
  payload.maThuoc = newMa;
  payload.maThuocBv = newMa;

  // 3. Chuẩn hóa trường ngày sang ISO string
  const dateKeys = ['tuNgay', 'denNgay', 'ngayCheckGuiBH', 'ngayHlBhyt', 'ngayKetThucHd'];
  for (const k of dateKeys) {
    if (payload[k]) {
      payload[k] = toIsoDate(payload[k]);
    }
  }
  payload.ngayCapNhat = null;
  payload.ngayThucHien = null;

  // 4. Gửi lưu lên cổng HMIS
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
  batchUpdateDrugsOnHmis
};
