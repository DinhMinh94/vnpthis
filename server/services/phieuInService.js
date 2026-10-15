const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const hisService = require('./hisService');
const cauhinhService = require('./cauhinhService');

const PHIEUIN_CACHE_FILE = path.join(__dirname, '../../data/phieuin_baocao_cache.json');
const CONFIG_FILE = path.join(__dirname, '../../data/phieuin_config.json');

const NHOM_BC_MAP = {
  1: 'Nhóm phiếu in',
  2: 'Nhóm báo cáo KB',
  3: 'Nhóm báo cáo dược',
  4: 'Nhóm báo cáo CLS',
  5: 'Nhóm báo cáo VP',
  6: 'Nhóm bệnh án',
  7: 'Nhóm phiếu in YTDP'
};

const NHOM_NAME_TO_ID = {
  'Nhóm phiếu in': 1,
  'Nhóm báo cáo KB': 2,
  'Nhóm báo cáo dược': 3,
  'Nhóm báo cáo CLS': 4,
  'Nhóm báo cáo VP': 5,
  'Nhóm bệnh án': 6,
  'Nhóm phiếu in YTDP': 7
};

// Cấu hình đường dẫn API mặc định chuẩn xác của cổng HMIS
let currentEndpointConfig = {
  searchPath: 'common/dmcbaocao/search',
  updatePath: 'common/dmcbaocao/update',
  groupsPath: 'common/dmchethong/findByMaNhom?maNhom=LOAIBAOCAO'
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    currentEndpointConfig = { ...currentEndpointConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (e) {}
}

function saveEndpointConfig(cfg) {
  currentEndpointConfig = { ...currentEndpointConfig, ...cfg };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentEndpointConfig, null, 2), 'utf8');
}

function getEndpointConfig() {
  return currentEndpointConfig;
}

/**
 * Đọc dữ liệu phiếu in đã lưu đệm và chuẩn hóa các trường
 */
function getCachedPhieuIn() {
  if (fs.existsSync(PHIEUIN_CACHE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(PHIEUIN_CACHE_FILE, 'utf8'));
      return raw.map(item => ({
        ...item,
        templateCode: item.tempCode || item.templateCode || '',
        nhomBaoCao: NHOM_BC_MAP[item.nhomBcCha] || item.nhomBaoCao || 'Nhóm phiếu in'
      }));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Lấy danh sách phiếu in / báo cáo từ cổng HMIS của 1 trạm
 */
async function fetchPhieuInFromHmis(stationId = null, customSearchPath = null) {
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
  const searchPath = customSearchPath || currentEndpointConfig.searchPath;

  // Xây dựng URL tìm kiếm
  let url = `${auth.gateway}${searchPath}`;
  if (!url.includes('?')) {
    url += '?filter=id%3E0&page=0&size=500&sort=id,desc';
  } else {
    if (!url.includes('size=')) url += '&size=500';
    if (!url.includes('sort=')) url += '&sort=id,desc';
    if (!url.includes('filter=')) url += '&filter=id%3E0';
  }

  const res = await axios.get(url, {
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
    const normalizedList = rawList.map(item => ({
      ...item,
      templateCode: item.tempCode || item.templateCode || '',
      nhomBaoCao: NHOM_BC_MAP[item.nhomBcCha] || item.nhomBaoCao || 'Nhóm phiếu in'
    }));

    fs.writeFileSync(PHIEUIN_CACHE_FILE, JSON.stringify(normalizedList, null, 2), 'utf8');
    return {
      success: true,
      total: normalizedList.length,
      list: normalizedList
    };
  }

  throw new Error(res.data?.message || `Lỗi phản hồi HTTP ${res.status} từ HMIS: ${url}`);
}

/**
 * Cập nhật cấu hình 1 phiếu in báo cáo cho danh sách các trạm được chọn
 * @param {Array<string>} stationIds - Danh sách ID trạm cần áp dụng
 * @param {Object} reportData - Dữ liệu phiếu in cần cập nhật (ten, maBaoCao, tempCode, service, trangThai, v.v.)
 */
async function updatePhieuInForStations(stationIds, reportData) {
  const stations = stationIds.map(id => db.getStationById(id, true)).filter(Boolean);
  const results = [];

  for (const station of stations) {
    const startTime = Date.now();
    try {
      const auth = await cauhinhService.loginToHmis(station);

      // 1. Tìm bản ghi phiếu in tương ứng trên trạm đó theo maBaoCao
      const searchPath = currentEndpointConfig.searchPath;
      const searchUrl = `${auth.gateway}${searchPath}?filter=maBaoCao==*${encodeURIComponent(reportData.maBaoCao)}*&page=0&size=5&sort=id,desc`;

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
        targetItem = searchRes.data.data.content.find(item => item.maBaoCao === reportData.maBaoCao) || searchRes.data.data.content[0];
      }

      if (!targetItem && reportData.id) {
        targetItem = { id: reportData.id };
      }

      if (!targetItem) {
        throw new Error(`Không tìm thấy mẫu phiếu in "${reportData.maBaoCao}" trên trạm này`);
      }

      // Xác định nhomBcCha nếu người dùng chọn tên nhóm
      let nhomBcCha = targetItem.nhomBcCha;
      if (reportData.nhomBcCha !== undefined) {
        nhomBcCha = Number(reportData.nhomBcCha);
      } else if (reportData.nhomBaoCao && NHOM_NAME_TO_ID[reportData.nhomBaoCao]) {
        nhomBcCha = NHOM_NAME_TO_ID[reportData.nhomBaoCao];
      }

      // 2. Ghép dữ liệu cập nhật
      const payload = {
        ...targetItem,
        ten: reportData.ten !== undefined ? reportData.ten : targetItem.ten,
        maBaoCao: reportData.maBaoCao !== undefined ? reportData.maBaoCao : targetItem.maBaoCao,
        tempCode: reportData.tempCode || reportData.templateCode || targetItem.tempCode,
        service: reportData.service !== undefined ? reportData.service : targetItem.service,
        formId: reportData.formId !== undefined ? Number(reportData.formId) : targetItem.formId,
        nhomBcCha: nhomBcCha !== undefined ? Number(nhomBcCha) : 1,
        soNgayXemBc: reportData.soNgayXemBc !== undefined ? Number(reportData.soNgayXemBc) : targetItem.soNgayXemBc,
        ghiChu: reportData.ghiChu !== undefined ? reportData.ghiChu : targetItem.ghiChu,
        trangThai: reportData.trangThai !== undefined ? Number(reportData.trangThai) : targetItem.trangThai,
        renderType: reportData.renderType !== undefined ? reportData.renderType : targetItem.renderType,
        id: targetItem.id
      };

      // 3. Gửi lệnh cập nhật PUT common/dmcbaocao/update?id=...
      let updateUrl = `${auth.gateway}${currentEndpointConfig.updatePath}`;
      if (updateUrl.includes(':id')) {
        updateUrl = updateUrl.replace(':id', targetItem.id);
      } else if (!updateUrl.includes('?id=')) {
        updateUrl += `?id=${targetItem.id}`;
      }

      const updateRes = await axios.put(updateUrl, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        },
        validateStatus: () => true
      });

      if (updateRes.status === 200 && (updateRes.data?.code === 0 || updateRes.data?.code === 200)) {
        const statusText = payload.trangThai === 1 ? 'BẬT' : 'TẮT';
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: true,
          message: `Đã lưu thành công (${statusText})`,
          duration: Date.now() - startTime
        });
      } else {
        throw new Error(updateRes.data?.message || `Lỗi phản hồi HTTP ${updateRes.status}`);
      }
    } catch (err) {
      results.push({
        id: station.id,
        name: station.name,
        username: station.username,
        success: false,
        message: err.message,
        duration: Date.now() - startTime
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  return {
    total: results.length,
    successCount,
    failedCount,
    results
  };
}

module.exports = {
  getCachedPhieuIn,
  fetchPhieuInFromHmis,
  updatePhieuInForStations,
  saveEndpointConfig,
  getEndpointConfig,
  NHOM_BC_MAP,
  NHOM_NAME_TO_ID
};
