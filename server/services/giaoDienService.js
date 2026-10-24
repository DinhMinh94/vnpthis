const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const cauhinhService = require('./cauhinhService');
const logService = require('./logService');

const CAUHINH_GIAODIEN_CACHE_FILE = path.join(__dirname, '../../data/cauhinh_giaodien_cache.json');

/**
 * Đọc danh sách cấu hình giao diện từ cache
 */
function getCachedGiaoDien() {
  if (fs.existsSync(CAUHINH_GIAODIEN_CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(CAUHINH_GIAODIEN_CACHE_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (e) {
      console.error('Lỗi đọc cache cấu hình giao diện:', e.message);
    }
  }
  return [];
}

/**
 * Lưu danh sách cấu hình giao diện vào cache file
 */
function saveCachedGiaoDien(list) {
  try {
    fs.writeFileSync(CAUHINH_GIAODIEN_CACHE_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Lỗi lưu cache cấu hình giao diện:', e.message);
  }
}

/**
 * Làm mới danh sách cấu hình giao diện (125 màn hình) từ cổng HMIS
 */
async function refreshGiaoDienFromHmis(stationId = null) {
  let station = null;
  if (stationId) {
    station = db.getStationById(stationId, true);
  }
  if (!station) {
    const stations = db.getStations(true);
    station = stations.find(s => s.username && s.password && s.url && s.url.includes('hmis.vn')) || stations[0];
  }

  if (!station || !station.username || !station.password) {
    throw new Error('Chưa có tài khoản trạm y tế hợp lệ để kết nối lấy cấu hình giao diện');
  }

  const auth = await cauhinhService.loginToHmis(station);
  const searchUrl = `${auth.gateway}common/htcauhinh/search?filter=id%3E0;nhomChId==2&sort=maCauHinh,asc&page=0&size=300`;

  const res = await axios.get(searchUrl, {
    timeout: 20000,
    headers: {
      'Authorization': `Bearer ${auth.token}`,
      'region-code': auth.region,
      'Origin': auth.targetUrl.replace(/\/$/, ''),
      'Referer': auth.targetUrl
    }
  });

  if (res.status !== 200 || !res.data?.data?.content) {
    throw new Error('Lỗi lấy danh sách cấu hình giao diện từ HMIS: ' + (res.data?.message || res.statusText));
  }

  const list = res.data.data.content;
  saveCachedGiaoDien(list);

  return {
    count: list.length,
    list
  };
}

/**
 * Tự động chuẩn hóa và bảo vệ layout form trước khi gửi HMIS
 * - BẮT BUỘC: Checkbox phải có titleColSpan = 0 để tránh HMIS render 2 lần nhãn làm vỡ giao diện
 * - Kiểu multiSelect: defaultValue phải là mảng []
 */
function sanitizeGiaoDienLayout(rawGiaTri) {
  if (!rawGiaTri) return rawGiaTri;
  let parsed = rawGiaTri;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      return rawGiaTri;
    }
  }
  if (!Array.isArray(parsed)) return rawGiaTri;

  const sanitized = parsed.map(row => {
    if (!Array.isArray(row)) return row;
    return row.map(col => {
      if (!col || typeof col !== 'object') return col;
      const clone = { ...col };

      // 1. Trường kiểu checkbox trong HMIS BẮT BUỘC titleColSpan = 0
      // Nếu titleColSpan > 0, HMIS sẽ render 1 cột nhãn riêng và 1 nhãn của chính checkbox -> vỡ giao diện
      if (clone.type === 'checkbox') {
        clone.titleColSpan = 0;
        if (typeof clone.defaultValue === 'string') {
          clone.defaultValue = clone.defaultValue === 'true' || clone.defaultValue === '1';
        } else if (clone.defaultValue === undefined || clone.defaultValue === null) {
          clone.defaultValue = false;
        }
      }

      // 2. Kiểu multiSelect trong HMIS defaultValue phải là array
      if (clone.type === 'multiSelect') {
        if (!Array.isArray(clone.defaultValue)) {
          clone.defaultValue = [];
        }
      }

      return clone;
    });
  });

  return JSON.stringify(sanitized);
}

/**
 * Cập nhật cấu hình giao diện cho danh sách trạm (các trạm đã tích hoặc tất cả các trạm)
 */
async function updateGiaoDienForStations({ stationIds = [], targetScope = 'selected', maCauHinh, updateData = {} }) {
  if (!maCauHinh) {
    throw new Error('Thiếu mã cấu hình giao diện (maCauHinh)');
  }

  let targetStations = [];
  if (targetScope === 'all') {
    targetStations = db.getStations(true).filter(s => s.username && s.password);
  } else {
    targetStations = (stationIds || []).map(id => db.getStationById(id, true)).filter(s => s && s.username && s.password);
  }

  if (targetStations.length === 0) {
    throw new Error('Không có trạm y tế nào được chọn để áp dụng cấu hình');
  }

  const results = [];
  const oldValuesByStation = {};

  for (const station of targetStations) {
    const startTime = Date.now();
    try {
      const auth = await cauhinhService.loginToHmis(station);

      // 1. Tìm bản ghi cấu hình theo mã trên trạm này
      let searchUrl = `${auth.gateway}common/htcauhinh/search?filter=maCauHinh==%22${encodeURIComponent(maCauHinh)}%22;nhomChId==2&sort=id,desc&page=0&size=1`;
      let searchRes = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        }
      });

      let item = searchRes.data?.data?.content?.[0];
      if (!item) {
        // Thử tìm theo filter like
        const fallbackUrl = `${auth.gateway}common/htcauhinh/search?filter=maCauHinh==*${encodeURIComponent(maCauHinh)}*;nhomChId==2&sort=id,desc&page=0&size=1`;
        const fbRes = await axios.get(fallbackUrl, {
          timeout: 10000,
          headers: {
            'Authorization': `Bearer ${auth.token}`,
            'region-code': auth.region,
            'Origin': auth.targetUrl.replace(/\/$/, ''),
            'Referer': auth.targetUrl
          }
        });
        item = fbRes.data?.data?.content?.[0];
      }

      if (!item) {
        throw new Error(`Không tìm thấy cấu hình "${maCauHinh}" trên trạm này`);
      }

      // Lưu lại giá trị cũ
      oldValuesByStation[station.id] = {
        tenCauHinh: item.tenCauHinh,
        trangThai: item.trangThai,
        moTa: item.moTa,
        ghiChu: item.ghiChu,
        giaTriThietLap: item.giaTriThietLap
      };

      // 2. Cập nhật các trường
      if (updateData.tenCauHinh !== undefined) item.tenCauHinh = updateData.tenCauHinh;
      if (updateData.moTa !== undefined) item.moTa = updateData.moTa;
      if (updateData.ghiChu !== undefined) item.ghiChu = updateData.ghiChu;
      if (updateData.trangThai !== undefined) {
        item.trangThai = (updateData.trangThai === 1 || updateData.trangThai === true || updateData.trangThai === '1') ? 1 : 0;
      }
      if (updateData.giaTriThietLap !== undefined) {
        item.giaTriThietLap = sanitizeGiaoDienLayout(updateData.giaTriThietLap);
      }

      // 3. Gửi lệnh cập nhật PUT
      const updateUrl = `${auth.gateway}common/htcauhinh/update?id=${item.id}`;
      const updateRes = await axios.put(updateUrl, item, {
        timeout: 12000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        }
      });

      if (updateRes.status === 200 && (updateRes.data?.code === 0 || updateRes.data?.code === 200)) {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          code: station.code,
          success: true,
          message: updateRes.data?.message || 'Cập nhật thành công',
          duration: Date.now() - startTime
        });
      } else {
        throw new Error(updateRes.data?.message || 'Lỗi cập nhật từ máy chủ HMIS');
      }
    } catch (err) {
      results.push({
        id: station.id,
        name: station.name,
        username: station.username,
        code: station.code,
        success: false,
        message: err.message,
        duration: Date.now() - startTime
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  // Cập nhật lại trong cache local nếu có
  const cache = getCachedGiaoDien();
  const cachedIdx = cache.findIndex(x => x.maCauHinh === maCauHinh);
  if (cachedIdx !== -1) {
    if (updateData.tenCauHinh !== undefined) cache[cachedIdx].tenCauHinh = updateData.tenCauHinh;
    if (updateData.moTa !== undefined) cache[cachedIdx].moTa = updateData.moTa;
    if (updateData.ghiChu !== undefined) cache[cachedIdx].ghiChu = updateData.ghiChu;
    if (updateData.trangThai !== undefined) {
      cache[cachedIdx].trangThai = (updateData.trangThai === 1 || updateData.trangThai === true || updateData.trangThai === '1') ? 1 : 0;
    }
    if (updateData.giaTriThietLap !== undefined) {
      cache[cachedIdx].giaTriThietLap = sanitizeGiaoDienLayout(updateData.giaTriThietLap);
    }
    saveCachedGiaoDien(cache);
  }

  // Ghi nhật ký hệ thống
  try {
    logService.addLog({
      actionType: 'cauhinh_giaodien',
      actionTitle: `Cấu hình giao diện: ${maCauHinh}`,
      summary: `Đã cập nhật cấu hình giao diện "${updateData.tenCauHinh || maCauHinh}" cho ${successCount}/${targetStations.length} trạm (${targetScope === 'all' ? 'Tất cả trạm' : 'Các trạm đã tích'})`,
      details: {
        maCauHinh,
        tenCauHinh: updateData.tenCauHinh,
        trangThai: updateData.trangThai,
        targetScope,
        targetStations: targetStations.map(s => ({ id: s.id, name: s.name, username: s.username })),
        results
      },
      targetStations: targetStations.map(s => ({ id: s.id, name: s.name, username: s.username })),
      successCount,
      failedCount,
      results
    });
  } catch (logErr) {
    console.error('Lỗi ghi log cấu hình giao diện:', logErr.message);
  }

  return {
    success: true,
    total: targetStations.length,
    successCount,
    failedCount,
    results
  };
}

module.exports = {
  getCachedGiaoDien,
  saveCachedGiaoDien,
  refreshGiaoDienFromHmis,
  updateGiaoDienForStations
};
