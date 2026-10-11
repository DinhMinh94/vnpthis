const axios = require('axios');
const db = require('./db');
const cryptoService = require('./cryptoService');
const config = require('../config/config');

/**
 * Xác định Gateway API cho các hệ thống HMIS / VNPT HIS L4
 */
function resolveHmisGateway(targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const hostname = urlObj.hostname;

    const apiHosts = {
      'ytcs.hmis.vn': 'https://ytcs-gw.hmis.vn/api/',
      'quangtri.hmis.vn': 'https://quangtri-gw.hmis.vn/api/'
    };

    if (apiHosts[hostname]) {
      return apiHosts[hostname];
    }

    if (hostname.endsWith('.hmis.vn')) {
      const sub = hostname.split('.')[0];
      return `https://${sub}-gw.hmis.vn/api/`;
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Kiểm tra kết nối và xác thực tài khoản 1 trạm y tế
 */
async function testStationConnection(stationId) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error('Không tìm thấy trạm y tế');
  }

  const settings = db.getSettings();
  const startTime = Date.now();

  // Đánh dấu trạm đang kiểm tra
  db.updateStationStatus(stationId, 'testing', 'Đang xác thực tài khoản...');

  try {
    const targetUrl = station.url || settings.defaultHisUrl;

    if (!station.username || !station.password) {
      const errorMsg = 'Thiếu tên đăng nhập hoặc mật khẩu';
      db.updateStationStatus(stationId, 'failed', errorMsg, 0);
      return { success: false, message: errorMsg, responseTime: 0 };
    }

    // KIỂM TRA HỆ THỐNG HMIS THỰC TẾ (ytcs.hmis.vn / *.hmis.vn)
    const hmisGateway = resolveHmisGateway(targetUrl);
    if (hmisGateway) {
      const loginUrl = `${hmisGateway}authen/public/login`;
      const timeout = (settings.timeoutSeconds || 15) * 1000;

      // Thử đăng nhập qua region2 trước, nếu lỗi region thì thử region1
      const regionsToTry = ['region2', 'region1'];
      let loginData = null;
      let lastErrMsg = '';

      for (const reg of regionsToTry) {
        try {
          const res = await axios.post(
            loginUrl,
            {
              username: station.username,
              password: station.password
            },
            {
              timeout,
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'region-code': reg,
                'Origin': targetUrl.replace(/\/$/, ''),
                'Referer': targetUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              },
              validateStatus: () => true
            }
          );

          if (res.status === 200 && res.data && res.data.code === 200 && res.data.data?.accessToken) {
            loginData = { ...res.data.data, usedRegion: reg };
            break;
          } else {
            lastErrMsg = res.data?.message || `HTTP ${res.status}`;
            if (!res.data?.message?.includes('Region code')) {
              // Nếu không phải lỗi do region mà là do sai mật khẩu thì không cần thử tiếp
              break;
            }
          }
        } catch (postErr) {
          lastErrMsg = postErr.message;
        }
      }

      const responseTime = Date.now() - startTime;

      if (loginData && loginData.accessToken) {
        // Đăng nhập thành công! Lấy thêm thông tin chi tiết tên Cơ sở y tế & Cán bộ
        let facilityName = '';
        let officerName = '';

        try {
          const infoRes = await axios.get(`${hmisGateway}authen/admuser/info`, {
            timeout: 5000,
            headers: {
              'Authorization': `Bearer ${loginData.accessToken}`,
              'region-code': loginData.usedRegion,
              'Origin': targetUrl.replace(/\/$/, ''),
              'Referer': targetUrl
            }
          });

          if (infoRes.data?.data) {
            facilityName = infoRes.data.data.company?.name || '';
            officerName = infoRes.data.data.fullName || infoRes.data.data.officer?.officerName || '';

            // Tự động cập nhật tên Trạm Y Tế chính xác nếu người dùng chưa đặt tên cụ thể
            if (facilityName && (!station.name || station.name.startsWith('Trạm Y tế mới') || station.name === 'Trạm Y tế')) {
              db.updateStation(stationId, {
                name: facilityName,
                code: infoRes.data.data.company?.code || station.code,
                district: infoRes.data.data.company?.address || station.district
              });
            }
          }
        } catch (infoErr) {
          console.warn('Lỗi lấy info user HMIS:', infoErr.message);
        }

        const successMsg = facilityName
          ? `Đăng nhập thành công! ${facilityName} (${officerName ? 'Cán bộ: ' + officerName : 'Mã: ' + station.username})`
          : `Đăng nhập thành công cổng HMIS (${responseTime}ms). Token hợp lệ.`;

        db.updateStationStatus(stationId, 'success', successMsg, responseTime);
        return { success: true, message: successMsg, responseTime, facilityName, officerName };
      } else {
        const failMsg = `Đăng nhập thất bại: ${lastErrMsg || 'Sai tên đăng nhập hoặc mật khẩu'}`;
        db.updateStationStatus(stationId, 'failed', failMsg, responseTime);
        return { success: false, message: failMsg, responseTime };
      }
    }

    // NẾU LÀ CÁC CỔNG HIS KHÁC VÀ ĐANG BẬT MÔ PHỎNG
    if (settings.simulationMode) {
      await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));
      const responseTime = Date.now() - startTime;

      if (station.password.length < 4) {
        const errorMsg = 'Mật khẩu quá ngắn hoặc sai định dạng';
        db.updateStationStatus(stationId, 'failed', errorMsg, responseTime);
        return { success: false, message: errorMsg, responseTime };
      }

      const successMsg = `[Mô phỏng] Đăng nhập thành công (${responseTime}ms). Tài khoản hợp lệ.`;
      db.updateStationStatus(stationId, 'success', successMsg, responseTime);
      return { success: true, message: successMsg, responseTime };
    }

    // CỔNG HIS THÔNG THƯỜNG (KIỂM TRA HTTP REACHABILITY)
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      const errorMsg = 'URL Portal HIS không hợp lệ (cần bắt đầu bằng http:// hoặc https://)';
      db.updateStationStatus(stationId, 'failed', errorMsg, 0);
      return { success: false, message: errorMsg, responseTime: 0 };
    }

    const timeout = (settings.timeoutSeconds || 10) * 1000;
    const response = await axios.get(targetUrl, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      validateStatus: () => true
    });

    const responseTime = Date.now() - startTime;

    if (response.status >= 200 && response.status < 400) {
      const msg = `Kết nối thành công cổng HIS (HTTP ${response.status}, ${responseTime}ms)`;
      db.updateStationStatus(stationId, 'success', msg, responseTime);
      return { success: true, message: msg, responseTime, statusCode: response.status };
    } else {
      const msg = `Cổng HIS phản hồi mã HTTP ${response.status}`;
      db.updateStationStatus(stationId, 'failed', msg, responseTime);
      return { success: false, message: msg, responseTime, statusCode: response.status };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    let errorMsg = 'Lỗi kết nối: ';
    if (error.code === 'ECONNABORTED') {
      errorMsg += `Hết thời gian chờ (${settings.timeoutSeconds || 10}s)`;
    } else if (error.code === 'ENOTFOUND') {
      errorMsg += 'Không tìm thấy tên miền máy chủ';
    } else if (error.code === 'ECONNREFUSED') {
      errorMsg += 'Máy chủ từ chối kết nối';
    } else {
      errorMsg += error.message || 'Lỗi mạng không xác định';
    }

    db.updateStationStatus(stationId, 'failed', errorMsg, responseTime);
    return { success: false, message: errorMsg, responseTime };
  }
}

/**
 * Kiểm tra kết nối hàng loạt cho nhiều trạm với giới hạn đồng thời (Concurrency Limit)
 */
async function testBatchStations(stationIds) {
  const ids = stationIds && stationIds.length > 0 
    ? stationIds 
    : db.getStations().map(s => s.id);

  const results = [];
  const limit = config.MAX_CONCURRENT_TESTS || 5;

  for (let i = 0; i < ids.length; i += limit) {
    const chunk = ids.slice(i, i + limit);
    const chunkPromises = chunk.map(async (id) => {
      try {
        const res = await testStationConnection(id);
        return { id, ...res };
      } catch (err) {
        return { id, success: false, message: err.message };
      }
    });
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
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
  testStationConnection,
  testBatchStations,
  resolveHmisGateway
};
