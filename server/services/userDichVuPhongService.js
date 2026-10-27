/**
 * Service xử lý phân công Yêu Cầu Khám & Phòng Khám theo User (HMIS dm-map-nguoidung-yeucau-phongkham)
 * API Gateway: common/userdichvuphong/
 */

const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const cauhinhService = require('./cauhinhService');

/**
 * Tạo headers xác thực với cổng HMIS Gateway
 */
async function getAuthHeaders(station) {
  const auth = await cauhinhService.loginToHmis(station);
  return {
    auth,
    headers: {
      'Authorization': 'Bearer ' + auth.token,
      'region-code': auth.region,
      'Origin': auth.targetUrl.replace(/\/$/, ''),
      'Referer': auth.targetUrl,
      'Content-Type': 'application/json'
    }
  };
}

/**
 * Lấy toàn bộ dữ liệu của 1 trạm: danh sách đã map, danh sách người dùng, dịch vụ khám, phòng khám
 */
async function getStationData(stationId, query = {}) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error(`Không tìm thấy trạm y tế với ID ${stationId}`);
  }

  const { auth, headers } = await getAuthHeaders(station);
  const currentUserId = auth.userInfo?.id || auth.userId || 2;

  // 1. Lấy danh sách đã map hiện tại
  let mappings = [];
  let totalMappings = 0;
  try {
    const page = query.page || 0;
    const size = query.size || 200;
    const filter = query.filter ? encodeURIComponent(query.filter) : 'id>0';
    const url = `${auth.gateway}common/userdichvuphong/danh-muc?page=${page}&size=${size}&sort=stt,asc&filter=${filter}`;
    const res = await axios.get(url, { headers, timeout: 12000, validateStatus: () => true });
    if (res.status === 200 && res.data?.data) {
      mappings = Array.isArray(res.data.data?.content) ? res.data.data.content : (Array.isArray(res.data.data) ? res.data.data : []);
      totalMappings = res.data.data?.totalElements ?? mappings.length;
    }
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy danh sách map:`, err.message);
  }

  // 2. Lấy danh sách người dùng của trạm
  let users = [];
  try {
    const url = `${auth.gateway}common/userdichvuphong/danh-muc/nguoi-dung?page=0&size=200&sort=fullName,asc`;
    const res = await axios.get(url, { headers, timeout: 12000, validateStatus: () => true });
    if (res.status === 200 && res.data?.data) {
      users = Array.isArray(res.data.data?.content) ? res.data.data.content : (Array.isArray(res.data.data) ? res.data.data : []);
    }
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy danh sách user:`, err.message);
  }

  // 3. Lấy danh sách dịch vụ yêu cầu khám (Công khám)
  let services = [];
  try {
    const url = `${auth.gateway}common/userdichvuphong/danh-muc/dich-vu?userId=${currentUserId}&page=0&size=200&sort=daChon,desc&filter=loaiNhomDichVu==2;tenDichVu==""`;
    const res = await axios.get(url, { headers, timeout: 12000, validateStatus: () => true });
    if (res.status === 200 && res.data?.data) {
      services = Array.isArray(res.data.data?.content) ? res.data.data.content : (Array.isArray(res.data.data) ? res.data.data : []);
    }
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy danh sách dịch vụ khám:`, err.message);
  }

  // 4. Lấy danh sách phòng khám của trạm
  let rooms = [];
  try {
    const url = `${auth.gateway}common/userdichvuphong/danh-muc/phong?userId=${currentUserId}&page=0&size=200&sort=daChon,desc&filter=tenPhong==""`;
    const res = await axios.get(url, { headers, timeout: 12000, validateStatus: () => true });
    if (res.status === 200 && res.data?.data) {
      rooms = Array.isArray(res.data.data?.content) ? res.data.data.content : (Array.isArray(res.data.data) ? res.data.data : []);
    }
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy danh sách phòng khám:`, err.message);
  }

  return {
    stationId: station.id,
    stationCode: station.code,
    stationName: station.name,
    totalMappings,
    mappings,
    users,
    services,
    rooms
  };
}

/**
 * Lưu 1 bản ghi mapping người dùng - yêu cầu khám - phòng khám
 */
async function saveMapping(stationId, payload) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers } = await getAuthHeaders(station);
  const body = {
    userId: payload.userId,
    dichVuId: payload.dichVuId,
    phongId: payload.phongId,
    isMacDinh: payload.isMacDinh !== undefined ? payload.isMacDinh : 1,
    stt: payload.stt || 1
  };
  if (payload.id) {
    body.id = payload.id;
  }

  const res = await axios.post(`${auth.gateway}common/userdichvuphong/danh-muc/luu`, body, { headers, timeout: 10000 });
  return res.data;
}

/**
 * Xóa 1 bản ghi mapping theo ID
 */
async function deleteMapping(stationId, id) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers } = await getAuthHeaders(station);
  const res = await axios.delete(`${auth.gateway}common/userdichvuphong/danh-muc/${id}`, { headers, timeout: 10000 });
  return res.data;
}

/**
 * Xóa toàn bộ mapping hiện có của 1 trạm
 */
async function clearAllStationMappings(stationId) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers } = await getAuthHeaders(station);
  
  // Lấy toàn bộ ID
  const url = `${auth.gateway}common/userdichvuphong/danh-muc?page=0&size=500&sort=stt,asc&filter=id>0`;
  const res = await axios.get(url, { headers, timeout: 15000 });
  const list = Array.isArray(res.data?.data?.content) ? res.data.data.content : (Array.isArray(res.data?.data) ? res.data.data : []);

  let deletedCount = 0;
  for (const item of list) {
    try {
      await axios.delete(`${auth.gateway}common/userdichvuphong/danh-muc/${item.id}`, { headers, timeout: 8000 });
      deletedCount++;
    } catch (e) {
      console.warn(`Lỗi xóa mapping ${item.id}:`, e.message);
    }
  }

  return {
    success: true,
    deletedCount,
    total: list.length
  };
}

/**
 * PHÂN CÔNG HÀNG LOẠT YÊU CẦU KHÁM & PHÒNG KHÁM CHO TẤT CẢ TRẠM HOẶC CÁC TRẠM ĐƯỢC CHỌN
 * @param {Object} options
 *   - stationIds: string[] | 'all'
 *   - userScope: 'all' | 'doctors_only' | number[]
 *   - serviceScope: 'all' | 'main_only' | number[]
 *   - roomScope: 'all' | 'clinic_only' | number[]
 *   - isMacDinh: number (mặc định 1)
 *   - clearBeforeAssign: boolean (mặc định false)
 */
async function executeBatchAssignAllStations(options = {}) {
  const allStations = db.getStations(true);
  let targetStations = allStations;

  if (Array.isArray(options.stationIds) && options.stationIds.length > 0 && !options.stationIds.includes('all')) {
    targetStations = allStations.filter(s => options.stationIds.includes(s.id) || options.stationIds.includes(s.code));
  }

  const shouldClearBefore = options.clearBeforeAssign || options.clearBefore || false;

  const results = [];
  let totalAssigned = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const station of targetStations) {
    const stationRes = {
      stationId: station.id,
      stationCode: station.code,
      stationName: station.name,
      status: 'pending',
      assignedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      details: []
    };

    try {
      if (!station.username || !station.password) {
        stationRes.status = 'skipped_no_credentials';
        stationRes.message = 'Chưa cấu hình tài khoản trạm';
        results.push(stationRes);
        continue;
      }

      const { auth, headers } = await getAuthHeaders(station);
      const currentUserId = auth.userInfo?.id || auth.userId || 2;

      // 1. Lấy danh sách mapping hiện tại để kiểm tra trùng lặp
      let currentMapSet = new Set();
      try {
        const resMap = await axios.get(`${auth.gateway}common/userdichvuphong/danh-muc?page=0&size=500&sort=stt,asc&filter=id>0`, { headers, timeout: 15000 });
        const existingList = Array.isArray(resMap.data?.data?.content) ? resMap.data.data.content : (Array.isArray(resMap.data?.data) ? resMap.data.data : []);
        
        // Nếu chọn xóa sạch trước khi phân công
        if (shouldClearBefore && existingList.length > 0) {
          for (const item of existingList) {
            try {
              await axios.delete(`${auth.gateway}common/userdichvuphong/danh-muc/${item.id}`, { headers, timeout: 6000 });
            } catch (delErr) {}
          }
        } else {
          // Ghi nhớ các cặp đã map: `${userId}_${dichVuId}_${phongId}`
          existingList.forEach(m => {
            currentMapSet.add(`${m.userId}_${m.dichVuId}_${m.phongId}`);
          });
        }
      } catch (e) {
        console.warn(`[${station.code}] Lỗi đọc danh sách map hiện tại:`, e.message);
      }

      // 2. Lấy danh sách người dùng
      let users = [];
      try {
        const resUsers = await axios.get(`${auth.gateway}common/userdichvuphong/danh-muc/nguoi-dung?page=0&size=200&sort=fullName,asc`, { headers, timeout: 12000 });
        users = Array.isArray(resUsers.data?.data?.content) ? resUsers.data.data.content : (Array.isArray(resUsers.data?.data) ? resUsers.data.data : []);
      } catch (e) {
        console.warn(`[${station.code}] Lỗi lấy danh sách user:`, e.message);
      }

      // Lọc danh sách người dùng theo phạm vi
      let targetUsers = users;
      if (Array.isArray(options.userScope) && options.userScope.length > 0) {
        targetUsers = users.filter(u => options.userScope.includes(u.userId));
      } else if (options.userScope === 'doctors_only') {
        // Chỉ chọn bác sĩ hoặc cán bộ khám (loại bỏ admin hệ thống)
        targetUsers = users.filter(u => {
          const uname = (u.username || '').toLowerCase();
          const fname = (u.fullName || '').toLowerCase();
          return !uname.endsWith('.admin') && !uname.endsWith('.adminbv') && !fname.includes('admin');
        });
      }

      // 3. Lấy danh sách dịch vụ yêu cầu khám
      let services = [];
      try {
        const resDv = await axios.get(`${auth.gateway}common/userdichvuphong/danh-muc/dich-vu?userId=${currentUserId}&page=0&size=200&sort=daChon,desc&filter=loaiNhomDichVu==2;tenDichVu==""`, { headers, timeout: 12000 });
        services = Array.isArray(resDv.data?.data?.content) ? resDv.data.data.content : (Array.isArray(resDv.data?.data) ? resDv.data.data : []);
      } catch (e) {
        console.warn(`[${station.code}] Lỗi lấy danh sách dịch vụ:`, e.message);
      }

      // Lọc dịch vụ theo phạm vi
      let targetServices = services;
      if (Array.isArray(options.serviceScope) && options.serviceScope.length > 0) {
        targetServices = services.filter(s => options.serviceScope.includes(s.dichVuId));
      } else if (options.serviceScope === 'main_only') {
        // Ưu tiên 1 dịch vụ khám chính duy nhất của trạm: TYT.1899 hoặc khám trạm y tế
        const main = services.find(s => {
          const code = (s.maDichVu || '').toLowerCase();
          const name = (s.tenDichVu || '').toLowerCase();
          return code === 'tyt.1899' || code.includes('tyt') || name.includes('trạm y tế');
        });
        targetServices = main ? [main] : (services.slice(0, 1));
      }

      // 4. Lấy danh sách phòng khám
      let rooms = [];
      try {
        const resPhong = await axios.get(`${auth.gateway}common/userdichvuphong/danh-muc/phong?userId=${currentUserId}&page=0&size=200&sort=daChon,desc&filter=tenPhong==""`, { headers, timeout: 12000 });
        rooms = Array.isArray(resPhong.data?.data?.content) ? resPhong.data.data.content : (Array.isArray(resPhong.data?.data) ? resPhong.data.data : []);
      } catch (e) {
        console.warn(`[${station.code}] Lỗi lấy danh sách phòng:`, e.message);
      }

      // Lọc phòng theo phạm vi
      let targetRooms = rooms;
      if (Array.isArray(options.roomScope) && options.roomScope.length > 0) {
        targetRooms = rooms.filter(p => options.roomScope.includes(p.phongId));
      } else if (options.roomScope === 'clinic_only') {
        // Ưu tiên 1 phòng khám chung duy nhất của trạm: KB1
        const mainRoom = rooms.find(p => {
          const code = (p.maPhong || '').toLowerCase();
          const name = (p.tenPhong || '').toLowerCase();
          return code === 'kb1' || (name.includes('khám') && name.includes('trạm y tế'));
        });
        targetRooms = mainRoom ? [mainRoom] : (rooms.filter(p => (p.tenPhong || '').toLowerCase().includes('khám')).slice(0, 1));
        if (targetRooms.length === 0) targetRooms = rooms.slice(0, 1);
      }

      // Nếu không có user, service hoặc room thì bỏ qua
      if (targetUsers.length === 0 || targetServices.length === 0 || targetRooms.length === 0) {
        stationRes.status = 'warning';
        stationRes.message = `Không đủ dữ liệu phân công (User: ${targetUsers.length}, DV: ${targetServices.length}, Phòng: ${targetRooms.length})`;
        results.push(stationRes);
        continue;
      }

      // 5. TIẾN HÀNH MAP TẤT CẢ TỔ HỢP USER x DICHVU x PHONG
      let sttIndex = 1;
      for (const u of targetUsers) {
        for (const s of targetServices) {
          for (const r of targetRooms) {
            const key = `${u.userId}_${s.dichVuId}_${r.phongId}`;
            
            // Nếu đã tồn tại thì bỏ qua (tránh trùng)
            if (currentMapSet.has(key)) {
              stationRes.skippedCount++;
              totalSkipped++;
              continue;
            }

            try {
              const payload = {
                userId: u.userId,
                dichVuId: s.dichVuId,
                phongId: r.phongId,
                isMacDinh: options.isMacDinh !== undefined ? options.isMacDinh : 1,
                stt: sttIndex++
              };

              const resSave = await axios.post(`${auth.gateway}common/userdichvuphong/danh-muc/luu`, payload, {
                headers,
                timeout: 8000
              });

              if (resSave.status === 200 && resSave.data?.code === 0) {
                currentMapSet.add(key);
                stationRes.assignedCount++;
                totalAssigned++;
              } else if (resSave.data?.code === 445 || (resSave.data?.message && resSave.data.message.includes('đã có cấu hình'))) {
                currentMapSet.add(key);
                stationRes.skippedCount++;
                totalSkipped++;
              } else {
                stationRes.errorCount++;
                totalErrors++;
              }
            } catch (saveErr) {
              const errData = saveErr.response?.data;
              if (errData?.code === 445 || (errData?.message && errData.message.includes('đã có cấu hình'))) {
                currentMapSet.add(key);
                stationRes.skippedCount++;
                totalSkipped++;
              } else {
                stationRes.errorCount++;
                totalErrors++;
              }
            }
          }
        }
      }

      stationRes.status = stationRes.errorCount === 0 ? 'success' : (stationRes.assignedCount > 0 ? 'partial' : 'error');
      stationRes.message = `Đã phân công ${stationRes.assignedCount} cặp, bỏ qua ${stationRes.skippedCount} (đã có), lỗi ${stationRes.errorCount}`;
      results.push(stationRes);

    } catch (stationErr) {
      stationRes.status = 'error';
      stationRes.message = stationErr.message;
      results.push(stationRes);
    }
  }

  return {
    success: true,
    totalStations: targetStations.length,
    totalAssigned,
    totalSkipped,
    totalErrors,
    results
  };
}

/**
 * Xuất danh sách mapping ra file Excel
 */
async function exportExcel(stationId) {
  const data = await getStationData(stationId);
  const rows = (data.mappings || []).map((m, idx) => ({
    'STT': idx + 1,
    'Mã Trạm': data.stationCode,
    'Tên Trạm': data.stationName,
    'Tài Khoản': m.username || '',
    'Họ Và Tên': m.fullName || '',
    'Mã Dịch Vụ Khám': m.maDichVu || '',
    'Tên Yêu Cầu Khám': m.tenDichVu || '',
    'Mã Phòng': m.maPhong || '',
    'Tên Phòng Khám': m.tenPhong || '',
    'Khoa': m.tenKhoa || '',
    'Mặc Định': m.isMacDinh === 1 ? 'Có' : 'Không'
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'CongKhamTheoUser');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getStationData,
  saveMapping,
  deleteMapping,
  clearAllStationMappings,
  executeBatchAssignAllStations,
  exportExcel
};
