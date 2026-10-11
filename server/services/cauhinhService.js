const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const axios = require('axios');
const db = require('./db');
const hisService = require('./hisService');

const CAUHINH_JSON_PATH = path.join(__dirname, '../../cauhinh_nghiepvu_full.json');
const CAUHINH_EXCEL_PATH = path.join(__dirname, '../../CauHinh_NghiepVu_HMIS.xlsx');

/**
 * Đọc danh sách cấu hình nghiệp vụ từ file JSON đã lưu
 */
function getCachedCauHinh() {
  if (fs.existsSync(CAUHINH_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(CAUHINH_JSON_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Xuất dữ liệu cấu hình ra file Excel CauHinh_NghiepVu_HMIS.xlsx
 */
function saveCauHinhToExcel(list) {
  const rows = [];
  list.forEach((item) => {
    let thietLapObj = {};
    let macDinhObj = {};

    try {
      if (item.giaTriThietLap) {
        thietLapObj = typeof item.giaTriThietLap === 'string' ? JSON.parse(item.giaTriThietLap) : item.giaTriThietLap;
      }
    } catch (e) {}

    try {
      if (item.giaTriMacDinh) {
        macDinhObj = typeof item.giaTriMacDinh === 'string' ? JSON.parse(item.giaTriMacDinh) : item.giaTriMacDinh;
      }
    } catch (e) {}

    const keys = Object.keys(thietLapObj);

    if (keys.length === 0) {
      rows.push({
        'STT': rows.length + 1,
        'ID': item.id,
        'Mã cấu hình': item.maCauHinh,
        'Tên cấu hình': item.tenCauHinh,
        'Khóa tham số (Key)': '',
        'Giá trị thiết lập': '',
        'Giá trị mặc định': '',
        'Mô tả tham số': item.moTa || '',
        'Trạng thái': item.trangThai === 1 ? 'Bật' : 'Tắt',
        'Ngày sửa': item.ngaySua || item.ngayTao || ''
      });
    } else {
      keys.forEach((k) => {
        const tl = thietLapObj[k] || {};
        const md = macDinhObj[k] || {};

        const val = typeof tl.giatri === 'object' ? JSON.stringify(tl.giatri) : (tl.giatri !== undefined ? tl.giatri : '');
        const defaultVal = typeof md.giatri === 'object' ? JSON.stringify(md.giatri) : (md.giatri !== undefined ? md.giatri : '');
        const desc = tl.mota || md.mota || item.moTa || '';

        rows.push({
          'STT': rows.length + 1,
          'ID': item.id,
          'Mã cấu hình': item.maCauHinh,
          'Tên cấu hình': item.tenCauHinh,
          'Khóa tham số (Key)': k,
          'Giá trị thiết lập': val,
          'Giá trị mặc định': defaultVal,
          'Mô tả tham số': desc,
          'Trạng thái': item.trangThai === 1 ? 'Bật' : 'Tắt',
          'Ngày sửa': item.ngaySua || item.ngayTao || ''
        });
      });
    }
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 8 },
    { wch: 30 },
    { wch: 35 },
    { wch: 25 },
    { wch: 25 },
    { wch: 25 },
    { wch: 50 },
    { wch: 12 },
    { wch: 20 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CauHinhNghiepVu');
  XLSX.writeFile(wb, CAUHINH_EXCEL_PATH);
  return rows.length;
}

/**
 * Đăng nhập vào HMIS để lấy accessToken
 */
async function loginToHmis(station) {
  const targetUrl = station.url || db.getSettings().defaultHisUrl;
  const gateway = hisService.resolveHmisGateway(targetUrl) || 'https://ytcs-gw.hmis.vn/api/';
  const loginUrl = `${gateway}authen/public/login`;

  const regionsToTry = ['region2', 'region1'];
  for (const reg of regionsToTry) {
    try {
      const res = await axios.post(
        loginUrl,
        { username: station.username, password: station.password },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'region-code': reg,
            'Origin': targetUrl.replace(/\/$/, ''),
            'Referer': targetUrl,
            'User-Agent': 'Mozilla/5.0'
          },
          validateStatus: () => true
        }
      );

      if (res.status === 200 && res.data?.code === 200 && res.data?.data?.accessToken) {
        return {
          token: res.data.data.accessToken,
          region: reg,
          gateway,
          targetUrl
        };
      }
    } catch (e) {}
  }

  throw new Error('Đăng nhập thất bại vào cổng HMIS');
}

/**
 * Làm mới toàn bộ 160 cấu hình nghiệp vụ từ HMIS và lưu file Excel
 */
async function refreshCauHinhFromHmis(stationId = null) {
  let station = null;
  if (stationId) {
    station = db.getStationById(stationId, true);
  }
  if (!station) {
    // Tìm trạm đầu tiên có tài khoản HMIS
    const stations = db.getStations(true);
    station = stations.find(s => s.username && s.password && s.url && s.url.includes('hmis.vn')) || stations[0];
  }

  if (!station || !station.username || !station.password) {
    throw new Error('Chưa có tài khoản trạm y tế hợp lệ để kết nối lấy cấu hình');
  }

  const auth = await loginToHmis(station);
  const searchUrl = `${auth.gateway}common/htcauhinh/search?filter=id%3E0;nhomChId==1&sort=id,desc&page=0&size=300`;

  const res = await axios.get(searchUrl, {
    timeout: 15000,
    headers: {
      'Authorization': `Bearer ${auth.token}`,
      'region-code': auth.region,
      'Origin': auth.targetUrl.replace(/\/$/, ''),
      'Referer': auth.targetUrl
    }
  });

  if (res.status !== 200 || !res.data?.data?.content) {
    throw new Error('Lỗi lấy danh sách cấu hình từ cổng HMIS: ' + (res.data?.message || res.statusText));
  }

  const list = res.data.data.content;

  // Ghi JSON
  fs.writeFileSync(CAUHINH_JSON_PATH, JSON.stringify(list, null, 2), 'utf8');

  // Ghi Excel
  const paramCount = saveCauHinhToExcel(list);

  return {
    count: list.length,
    paramCount,
    list
  };
}

/**
 * Cập nhật 1 tham số cấu hình cho danh sách các trạm được chọn
 */
async function updateParamForStations(stationIds, maCauHinh, paramKey, paramValue) {
  const stations = stationIds.map(id => db.getStationById(id, true)).filter(Boolean);
  const results = [];

  for (const station of stations) {
    const startTime = Date.now();
    try {
      const auth = await loginToHmis(station);

      // 1. Tìm bản ghi cấu hình theo mã
      const searchUrl = `${auth.gateway}common/htcauhinh/search?filter=maCauHinh==*${encodeURIComponent(maCauHinh)}*&sort=id,desc&page=0&size=1`;
      const searchRes = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${auth.token}`,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        }
      });

      const item = searchRes.data?.data?.content?.[0];
      if (!item) {
        throw new Error(`Không tìm thấy cấu hình "${maCauHinh}" trên trạm này`);
      }

      // 2. Cập nhật tham số trong giaTriThietLap
      let thietLap = {};
      try {
        thietLap = typeof item.giaTriThietLap === 'string' ? JSON.parse(item.giaTriThietLap) : item.giaTriThietLap;
      } catch (e) {
        thietLap = {};
      }

      if (thietLap[paramKey]) {
        thietLap[paramKey].giatri = String(paramValue);
      } else {
        thietLap[paramKey] = { giatri: String(paramValue), mota: '' };
      }

      item.giaTriThietLap = JSON.stringify(thietLap);

      // 3. Gửi lệnh cập nhật PUT
      const updateUrl = `${auth.gateway}common/htcauhinh/update?id=${item.id}`;
      const updateRes = await axios.put(updateUrl, item, {
        timeout: 10000,
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
          success: true,
          message: `Đã cập nhật ${paramKey} = "${paramValue}"`,
          duration: Date.now() - startTime
        });
      } else {
        throw new Error(updateRes.data?.message || 'Lỗi phản hồi từ server HMIS');
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
  getCachedCauHinh,
  refreshCauHinhFromHmis,
  updateParamForStations
};
