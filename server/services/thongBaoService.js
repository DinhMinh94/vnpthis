const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const hisService = require('./hisService');
const cauhinhService = require('./cauhinhService');
const logService = require('./logService');

const THONGBAO_CACHE_FILE = path.join(__dirname, '../../data/thongbao_cache.json');

const LOAI_THONG_BAO_LIST = [
  { value: 1, label: 'Quan trọng', color: 'rose', bg: 'bg-rose-50 text-rose-700 border-rose-200' },
  { value: 2, label: 'Hệ thống', color: 'blue', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 3, label: 'Hướng dẫn', color: 'emerald', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 4, label: 'Tin tức', color: 'purple', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 5, label: 'Đào tạo', color: 'amber', bg: 'bg-amber-50 text-amber-700 border-amber-200' }
];

const UU_TIEN_LIST = [
  { value: 0, label: 'Bình thường' },
  { value: 1, label: 'Khẩn' }
];

const TRANG_THAI_LIST = [
  { value: 1, label: 'Hiển thị' },
  { value: 2, label: 'Ngừng hiển thị' }
];

/**
 * Lấy danh sách thông báo đã lưu đệm
 */
function getCachedThongBao() {
  if (fs.existsSync(THONGBAO_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(THONGBAO_CACHE_FILE, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Lấy danh mục các tùy chọn cấu hình thông báo
 */
function getOptions() {
  return {
    loaiThongBao: LOAI_THONG_BAO_LIST,
    uuTien: UU_TIEN_LIST,
    trangThai: TRANG_THAI_LIST
  };
}

/**
 * Định dạng ngày giờ hiện tại dạng DD/MM/YYYY HH:mm:ss
 */
function formatCurrentDateTime() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Lấy danh sách thông báo từ cổng HMIS của 1 trạm y tế
 */
async function fetchThongBaoFromHmis(stationId = null) {
  let station = null;
  if (stationId) {
    station = db.getStationById(stationId, true);
  }
  if (!station) {
    const stations = db.getStations(true);
    station = stations.find(s => s.username && s.password && s.url && s.url.includes('hmis.vn')) || stations[0];
  }

  if (!station || !station.username || !station.password) {
    throw new Error('Chưa có thông tin trạm y tế hợp lệ để kết nối tới cổng HMIS');
  }

  const auth = await cauhinhService.loginToHmis(station);
  const searchUrl = `${auth.gateway}common/thongbao/search?filter=id%3E0&page=0&size=100&sort=id,desc`;

  const res = await axios.get(searchUrl, {
    timeout: 15000,
    headers: {
      'Authorization': `Bearer ${auth.token}`,
      'region-code': auth.region,
      'Origin': auth.targetUrl.replace(/\/$/, ''),
      'Referer': auth.targetUrl
    },
    validateStatus: () => true
  });

  if (res.status === 200 && (res.data?.code === 0 || res.data?.code === 200 || res.data?.data)) {
    const rawList = res.data?.data?.content || res.data?.data || [];
    const normalizedList = rawList.map(item => {
      const loai = LOAI_THONG_BAO_LIST.find(l => l.value === Number(item.loaiThongBao));
      return {
        ...item,
        loaiThongBaoLabel: loai ? loai.label : 'Khác',
        loaiThongBaoColor: loai ? loai.color : 'slate',
        loaiThongBaoBg: loai ? loai.bg : 'bg-slate-50 text-slate-700 border-slate-200',
        uuTienLabel: item.uuTien === 1 ? 'Khẩn' : 'Bình thường',
        trangThaiLabel: item.trangThai === 1 ? 'Hiển thị' : 'Ngừng hiển thị'
      };
    });

    fs.writeFileSync(THONGBAO_CACHE_FILE, JSON.stringify(normalizedList, null, 2), 'utf8');

    return {
      success: true,
      total: normalizedList.length,
      list: normalizedList,
      stationName: station.name
    };
  }

  throw new Error('Lỗi lấy danh sách thông báo từ cổng HMIS: ' + (res.data?.message || res.statusText));
}

/**
 * Phát / Cập nhật thông báo hệ thống hàng loạt đến danh sách trạm y tế được chọn
 */
async function broadcastThongBaoToStations(stationIds, thongBaoData) {
  if (!stationIds || stationIds.length === 0) {
    throw new Error('Vui lòng chọn ít nhất 1 trạm y tế để phát thông báo');
  }
  if (!thongBaoData.tieuDe || !thongBaoData.tieuDe.trim()) {
    throw new Error('Vui lòng nhập tiêu đề thông báo');
  }
  if (!thongBaoData.noiDung || !thongBaoData.noiDung.trim()) {
    throw new Error('Vui lòng nhập nội dung thông báo');
  }

  const stations = stationIds.map(id => db.getStationById(id, true)).filter(Boolean);
  const results = [];
  const ngayDang = thongBaoData.ngayDang && thongBaoData.ngayDang.trim() ? thongBaoData.ngayDang.trim() : formatCurrentDateTime();

  for (const station of stations) {
    const startTime = Date.now();
    try {
      const auth = await cauhinhService.loginToHmis(station);

      // 1. Tìm xem trên trạm đó đã có thông báo cùng tiêu đề chưa
      const searchUrl = `${auth.gateway}common/thongbao/search?filter=id%3E0&page=0&size=50&sort=id,desc`;
      const searchRes = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        },
        validateStatus: () => true
      });

      let existingItem = null;
      if (searchRes.status === 200 && searchRes.data?.data?.content) {
        const list = searchRes.data.data.content;
        existingItem = list.find(item => item.tieuDe && item.tieuDe.trim().toLowerCase() === thongBaoData.tieuDe.trim().toLowerCase());
      }

      const payload = {
        loaiThongBao: Number(thongBaoData.loaiThongBao) || 1,
        tieuDe: String(thongBaoData.tieuDe).trim(),
        noiDung: String(thongBaoData.noiDung).trim(),
        ngayDang: ngayDang,
        uuTien: Number(thongBaoData.uuTien) || 0,
        trangThai: Number(thongBaoData.trangThai) || 1,
        ghiChu: thongBaoData.ghiChu ? String(thongBaoData.ghiChu).trim() : 'Đồng bộ từ Tool Quản Lý'
      };

      let action = 'create';
      let targetUrl = `${auth.gateway}common/thongbao/create`;
      let res;

      if (existingItem && existingItem.id) {
        action = 'update';
        targetUrl = `${auth.gateway}common/thongbao/update?id=${existingItem.id}`;
        payload.id = existingItem.id;
        res = await axios.put(targetUrl, payload, {
          timeout: 15000,
          headers: {
            'Authorization': `Bearer ${auth.token}`,
            'region-code': auth.region,
            'Origin': auth.targetUrl.replace(/\/$/, ''),
            'Referer': auth.targetUrl,
            'Content-Type': 'application/json'
          },
          validateStatus: () => true
        });
      } else {
        res = await axios.post(targetUrl, payload, {
          timeout: 15000,
          headers: {
            'Authorization': `Bearer ${auth.token}`,
            'region-code': auth.region,
            'Origin': auth.targetUrl.replace(/\/$/, ''),
            'Referer': auth.targetUrl,
            'Content-Type': 'application/json'
          },
          validateStatus: () => true
        });
      }

      if (res.status === 200 && (res.data?.code === 0 || res.data?.code === 200 || res.data?.data)) {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: true,
          action: action === 'update' ? 'Cập nhật' : 'Tạo mới',
          message: action === 'update' ? 'Đã cập nhật thông báo thành công' : 'Đã phát thông báo mới thành công',
          timeMs: Date.now() - startTime
        });
      } else {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: false,
          message: res.data?.message || `Lỗi cổng HMIS (${res.status})`,
          timeMs: Date.now() - startTime
        });
      }
    } catch (err) {
      results.push({
        id: station.id,
        name: station.name,
        username: station.username,
        success: false,
        message: err.response?.data?.message || err.message,
        timeMs: Date.now() - startTime
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  // Ghi nhật ký hệ thống
  logService.addLog({
    action: 'ĐỒNG BỘ THÔNG BÁO HMIS HÀNG LOẠT',
    target: `Tiêu đề: "${thongBaoData.tieuDe}" (${successCount}/${results.length} trạm thành công)`,
    status: failedCount === 0 ? 'SUCCESS' : (successCount > 0 ? 'WARNING' : 'ERROR'),
    details: `Phát thông báo loại ${thongBaoData.loaiThongBao}, ưu tiên: ${thongBaoData.uuTien === 1 ? 'Khẩn' : 'Bình thường'}. Trạng thái: ${thongBaoData.trangThai === 1 ? 'Hiển thị' : 'Ngừng hiển thị'}.`,
    results
  });

  // Tự động làm mới cache bằng dữ liệu mới gửi
  const currentCache = getCachedThongBao();
  const cacheIdx = currentCache.findIndex(c => c.tieuDe && c.tieuDe.trim().toLowerCase() === thongBaoData.tieuDe.trim().toLowerCase());
  const loai = LOAI_THONG_BAO_LIST.find(l => l.value === Number(thongBaoData.loaiThongBao));

  const savedItem = {
    id: cacheIdx >= 0 ? currentCache[cacheIdx].id : Date.now(),
    loaiThongBao: Number(thongBaoData.loaiThongBao) || 1,
    loaiThongBaoLabel: loai ? loai.label : 'Khác',
    loaiThongBaoColor: loai ? loai.color : 'slate',
    loaiThongBaoBg: loai ? loai.bg : 'bg-slate-50 text-slate-700 border-slate-200',
    tieuDe: thongBaoData.tieuDe.trim(),
    noiDung: thongBaoData.noiDung.trim(),
    ngayDang: ngayDang,
    uuTien: Number(thongBaoData.uuTien) || 0,
    uuTienLabel: Number(thongBaoData.uuTien) === 1 ? 'Khẩn' : 'Bình thường',
    trangThai: Number(thongBaoData.trangThai) || 1,
    trangThaiLabel: Number(thongBaoData.trangThai) === 1 ? 'Hiển thị' : 'Ngừng hiển thị',
    ghiChu: thongBaoData.ghiChu || ''
  };

  if (cacheIdx >= 0) {
    currentCache[cacheIdx] = { ...currentCache[cacheIdx], ...savedItem };
  } else {
    currentCache.unshift(savedItem);
  }
  fs.writeFileSync(THONGBAO_CACHE_FILE, JSON.stringify(currentCache, null, 2), 'utf8');

  return {
    success: true,
    total: results.length,
    successCount,
    failedCount,
    results,
    updatedItem: savedItem,
    message: `Đã phát thông báo thành công cho ${successCount}/${results.length} trạm y tế!`
  };
}

/**
 * Xóa thông báo hàng loạt trên danh sách các trạm y tế
 */
async function deleteThongBaoForStations(stationIds, tieuDe) {
  if (!stationIds || stationIds.length === 0) {
    throw new Error('Vui lòng chọn ít nhất 1 trạm y tế để xóa thông báo');
  }
  if (!tieuDe || !tieuDe.trim()) {
    throw new Error('Vui lòng chỉ định tiêu đề thông báo cần xóa');
  }

  const stations = stationIds.map(id => db.getStationById(id, true)).filter(Boolean);
  const results = [];

  for (const station of stations) {
    const startTime = Date.now();
    try {
      const auth = await cauhinhService.loginToHmis(station);

      // Tìm thông báo theo tiêu đề trên trạm
      const searchUrl = `${auth.gateway}common/thongbao/search?filter=id%3E0&page=0&size=50&sort=id,desc`;
      const searchRes = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        },
        validateStatus: () => true
      });

      let targetItem = null;
      if (searchRes.status === 200 && searchRes.data?.data?.content) {
        targetItem = searchRes.data.data.content.find(item => item.tieuDe && item.tieuDe.trim().toLowerCase() === tieuDe.trim().toLowerCase());
      }

      if (!targetItem) {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: true,
          message: 'Không tìm thấy thông báo này trên trạm (đã được dọn sạch trước đó)',
          timeMs: Date.now() - startTime
        });
        continue;
      }

      // Xóa thông báo DELETE common/thongbao/delete?id=...
      const delUrl = `${auth.gateway}common/thongbao/delete?id=${targetItem.id}`;
      const delRes = await axios.delete(delUrl, {
        timeout: 15000,
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        },
        validateStatus: () => true
      });

      if (delRes.status === 200 && (delRes.data?.code === 0 || delRes.data?.code === 200)) {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: true,
          message: 'Đã xóa thông báo khỏi trạm thành công',
          timeMs: Date.now() - startTime
        });
      } else {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: false,
          message: delRes.data?.message || `Lỗi xóa thông báo (${delRes.status})`,
          timeMs: Date.now() - startTime
        });
      }
    } catch (err) {
      results.push({
        id: station.id,
        name: station.name,
        username: station.username,
        success: false,
        message: err.response?.data?.message || err.message,
        timeMs: Date.now() - startTime
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  // Cập nhật lại cache cục bộ
  let currentCache = getCachedThongBao();
  currentCache = currentCache.filter(c => !(c.tieuDe && c.tieuDe.trim().toLowerCase() === tieuDe.trim().toLowerCase()));
  fs.writeFileSync(THONGBAO_CACHE_FILE, JSON.stringify(currentCache, null, 2), 'utf8');

  // Ghi log hệ thống
  logService.addLog({
    action: 'XÓA THÔNG BÁO HMIS HÀNG LOẠT',
    target: `Tiêu đề: "${tieuDe}" (${successCount}/${results.length} trạm thành công)`,
    status: failedCount === 0 ? 'SUCCESS' : (successCount > 0 ? 'WARNING' : 'ERROR'),
    details: `Đã thực hiện gỡ bỏ thông báo trên các trạm được chọn.`,
    results
  });

  return {
    success: true,
    total: results.length,
    successCount,
    failedCount,
    results,
    message: `Đã xóa thông báo trên ${successCount}/${results.length} trạm y tế!`
  };
}

module.exports = {
  getCachedThongBao,
  getOptions,
  formatCurrentDateTime,
  fetchThongBaoFromHmis,
  broadcastThongBaoToStations,
  deleteThongBaoForStations,
  LOAI_THONG_BAO_LIST,
  UU_TIEN_LIST,
  TRANG_THAI_LIST
};
