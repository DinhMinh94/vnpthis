const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const hisService = require('./hisService');
const cauhinhService = require('./cauhinhService');

const CHUCDANH_CACHE_FILE = path.join(__dirname, '../../data/chucdanh_kyso_cache.json');
const CONFIG_FILE = path.join(__dirname, '../../data/chucdanh_config.json');

// Cấu hình đường dẫn endpoint API mặc định của cổng HMIS cho chức danh ký số
let currentEndpointConfig = {
  searchPath: 'common/dmcsigntitle/search',
  createPath: 'common/dmcsigntitle/create',
  updatePath: 'common/dmcsigntitle/update',
  deletePath: 'common/dmcsigntitle/delete'
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
 * Đọc dữ liệu chức danh ký số từ file cache
 */
function getCachedChucDanh() {
  if (fs.existsSync(CHUCDANH_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHUCDANH_CACHE_FILE, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Lấy danh sách chức danh ký số trực tiếp từ cổng HMIS của 1 trạm
 */
async function fetchChucDanhFromHmis(stationId = null) {
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
  const searchPath = currentEndpointConfig.searchPath;

  let url = `${auth.gateway}${searchPath}`;
  if (!url.includes('?')) {
    url += '?filter=id!=0&page=0&size=500&sort=id,desc';
  } else {
    if (!url.includes('size=')) url += '&size=500';
    if (!url.includes('sort=')) url += '&sort=id,desc';
    if (!url.includes('filter=')) url += '&filter=id!=0';
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
    fs.writeFileSync(CHUCDANH_CACHE_FILE, JSON.stringify(rawList, null, 2), 'utf8');
    return {
      success: true,
      total: rawList.length,
      list: rawList
    };
  }

  throw new Error(res.data?.message || `Lỗi phản hồi HTTP ${res.status} từ HMIS: ${url}`);
}

/**
 * Thêm chức danh ký số mới cho danh sách các trạm y tế (hỗ trợ tự động cập nhật nếu đã tồn tại)
 * @param {Array<string>} stationIds - Danh sách ID trạm cần thêm
 * @param {Object} titleData - { titleCode, titleName, description }
 * @param {boolean} updateIfExists - Nếu mã đã có trên trạm thì tự động cập nhật tên & mô tả
 */
async function createChucDanhForStations(stationIds, titleData, updateIfExists = true) {
  if (!titleData || !titleData.titleCode || !titleData.titleName) {
    throw new Error('Mã chức danh và Tên chức danh là bắt buộc');
  }

  const code = String(titleData.titleCode).trim();
  const name = String(titleData.titleName).trim();
  const desc = titleData.description !== undefined && titleData.description !== null ? String(titleData.description).trim() : null;

  const stations = stationIds.map(id => db.getStationById(id, true)).filter(Boolean);
  const results = [];

  for (const station of stations) {
    const startTime = Date.now();
    try {
      const auth = await cauhinhService.loginToHmis(station);

      // 1. Kiểm tra xem mã chức danh đã có trên trạm này hay chưa
      const searchUrl = `${auth.gateway}${currentEndpointConfig.searchPath}?filter=titleCode==*${encodeURIComponent(code)}*&page=0&size=5&sort=id,desc`;
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
        existingItem = searchRes.data.data.content.find(item => item.titleCode === code);
      }

      if (existingItem) {
        if (!updateIfExists) {
          results.push({
            id: station.id,
            name: station.name,
            username: station.username,
            success: true,
            isExisting: true,
            message: `Mã "${code}" đã tồn tại trên trạm này`,
            duration: Date.now() - startTime
          });
          continue;
        }

        // Đã có -> Cập nhật tên và mô tả
        const updateUrl = `${auth.gateway}${currentEndpointConfig.updatePath}?id=${existingItem.id}`;
        const updatePayload = {
          id: existingItem.id,
          titleCode: code,
          titleName: name,
          description: desc
        };

        const updateRes = await axios.put(updateUrl, updatePayload, {
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
          results.push({
            id: station.id,
            name: station.name,
            username: station.username,
            success: true,
            isUpdated: true,
            message: `Đã cập nhật chức danh "${code} - ${name}" thành công`,
            duration: Date.now() - startTime
          });
        } else {
          throw new Error(updateRes.data?.message || `Lỗi cập nhật HTTP ${updateRes.status}`);
        }
      } else {
        // Chưa có -> Gọi POST /api/common/dmcsigntitle/create
        const createUrl = `${auth.gateway}${currentEndpointConfig.createPath}`;
        const createPayload = {
          titleCode: code,
          titleName: name,
          description: desc
        };

        const createRes = await axios.post(createUrl, createPayload, {
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

        if (createRes.status === 200 && (createRes.data?.code === 0 || createRes.data?.code === 200 || createRes.data?.data)) {
          results.push({
            id: station.id,
            name: station.name,
            username: station.username,
            success: true,
            isCreated: true,
            message: `Đã thêm mới chức danh "${code} - ${name}" thành công`,
            duration: Date.now() - startTime
          });
        } else {
          throw new Error(createRes.data?.message || `Lỗi thêm mới HTTP ${createRes.status}`);
        }
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

  // Tự động thêm vào file cache cục bộ nếu thêm thành công ít nhất 1 trạm
  try {
    const cached = getCachedChucDanh();
    if (!cached.some(c => c.titleCode === code)) {
      cached.unshift({
        id: Date.now(),
        titleCode: code,
        titleName: name,
        description: desc,
        ngayTao: new Date().toLocaleString('vi-VN')
      });
      fs.writeFileSync(CHUCDANH_CACHE_FILE, JSON.stringify(cached, null, 2), 'utf8');
    }
  } catch (e) {}

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  // Ghi log hệ thống lưu lại đã sửa những gì và thời gian nào
  try {
    const logService = require('./logService');
    logService.addLog({
      actionType: 'chucdanh_kyso',
      actionTitle: 'Thêm / Cập nhật chức danh ký số',
      summary: `Đồng bộ chức danh ký số [${code}] "${name}" cho ${results.length} trạm`,
      details: {
        titleCode: code,
        titleName: name,
        description: desc,
        updateIfExists
      },
      total: results.length,
      successCount,
      failedCount,
      results
    });
  } catch (logErr) {
    console.error('Lỗi ghi log chức danh:', logErr.message);
  }

  return {
    total: results.length,
    successCount,
    failedCount,
    results
  };
}

/**
 * Xóa một chức danh ký số khỏi danh sách trạm y tế
 * @param {Array<string>} stationIds - Danh sách ID trạm
 * @param {string} titleCode - Mã chức danh cần xóa
 */
async function deleteChucDanhForStations(stationIds, titleCode) {
  if (!titleCode) throw new Error('Vui lòng cung cấp mã chức danh cần xóa');
  const code = String(titleCode).trim();

  const stations = stationIds.map(id => db.getStationById(id, true)).filter(Boolean);
  const results = [];

  for (const station of stations) {
    const startTime = Date.now();
    try {
      const auth = await cauhinhService.loginToHmis(station);

      // Tìm ID bản ghi trên trạm
      const searchUrl = `${auth.gateway}${currentEndpointConfig.searchPath}?filter=titleCode==*${encodeURIComponent(code)}*&page=0&size=5`;
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
        targetItem = searchRes.data.data.content.find(item => item.titleCode === code);
      }

      if (!targetItem) {
        results.push({
          id: station.id,
          name: station.name,
          username: station.username,
          success: true,
          message: `Không tìm thấy mã "${code}" trên trạm (đã sạch)`,
          duration: Date.now() - startTime
        });
        continue;
      }

      // Gửi DELETE
      const deleteUrl = `${auth.gateway}${currentEndpointConfig.deletePath}?id=${targetItem.id}`;
      const delRes = await axios.delete(deleteUrl, {
        timeout: 10000,
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
          message: `Đã xóa mã "${code}" thành công`,
          duration: Date.now() - startTime
        });
      } else {
        throw new Error(delRes.data?.message || `Lỗi xóa HTTP ${delRes.status}`);
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
  const failedCount = results.filter(r => !r.success).length;

  try {
    const logService = require('./logService');
    logService.addLog({
      actionType: 'chucdanh_kyso',
      actionTitle: 'Xóa chức danh ký số',
      summary: `Xóa mã chức danh ký số [${code}] trên ${results.length} trạm`,
      details: {
        titleCode: code
      },
      total: results.length,
      successCount,
      failedCount,
      results
    });
  } catch (e) {}

  return {
    total: results.length,
    successCount,
    failedCount,
    results
  };
}

module.exports = {
  getCachedChucDanh,
  fetchChucDanhFromHmis,
  createChucDanhForStations,
  deleteChucDanhForStations,
  getEndpointConfig,
  saveEndpointConfig
};
