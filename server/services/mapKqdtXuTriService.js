/**
 * Service xử lý Danh mục Map Kết quả điều trị - Xử trí (HMIS dm-map-kqdt-xutri)
 * APIs:
 * - common/dmchethong/findByMaNhom?maNhom=KETQUADIEUTRIID (Danh mục Kết quả điều trị)
 * - common/dmchethong/findByMaNhom?maNhom=XUTRI_DTRI (Danh mục Xử trí điều trị / nội trú)
 * - common/xutrikhambenh/search?filter=khongSuDung==0;maXuTriKhamBenh=="1" (Danh mục Xử trí ngoại trú)
 * - common/mapxutriketquadieutri/findAll & /save & /delete (Map Xử trí Ngoại trú)
 * - common/mapkqxtntu/findAll & /save & /delete (Map Xử trí Điều trị)
 */

const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const cauhinhService = require('./cauhinhService');

/**
 * Lấy auth headers và csytId cho trạm
 */
async function getAuthContext(station) {
  const auth = await cauhinhService.loginToHmis(station);
  
  let csytId = 1;
  try {
    if (auth.token) {
      const payloadBase64 = auth.token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      if (payload.ID_CSYT) {
        csytId = Number(payload.ID_CSYT);
      } else if (payload.DONVI_ID) {
        csytId = Number(payload.DONVI_ID);
      }
    }
  } catch (e) {
    csytId = 1;
  }

  const headers = {
    'Authorization': 'Bearer ' + auth.token,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl,
    'Content-Type': 'application/json'
  };

  return { auth, headers, csytId };
}

/**
 * Lấy toàn bộ dữ liệu danh mục và mapping của 1 trạm
 */
async function getStationData(stationId) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error(`Không tìm thấy cấu hình trạm ${stationId}`);
  }

  const { auth, headers, csytId } = await getAuthContext(station);

  // 1. Danh mục kết quả điều trị
  let listKetQuaDieuTri = [];
  try {
    const resKq = await axios.get(`${auth.gateway}common/dmchethong/findByMaNhom?maNhom=KETQUADIEUTRIID`, { headers, timeout: 12000 });
    const rawList = resKq.data?.data || resKq.data || [];
    listKetQuaDieuTri = rawList.map(item => ({
      id: Number(item.giaTri || item.ma || item.id),
      ma: String(item.ma || item.giaTri),
      ten: item.ten,
      giaTri: Number(item.giaTri || item.ma || item.id)
    }));
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy KETQUADIEUTRIID:`, err.message);
  }

  // 2. Danh mục xử trí ngoại trú
  let listXuTriNgoaiTru = [];
  try {
    const resNt = await axios.get(`${auth.gateway}common/xutrikhambenh/search?filter=khongSuDung==0;maXuTriKhamBenh=="1"&page=0&size=200&sort=id,asc`, { headers, timeout: 12000 });
    const content = resNt.data?.data?.content || resNt.data?.data || [];
    listXuTriNgoaiTru = content.map(item => ({
      id: item.id,
      ten: item.tenXuTriKhamBenh,
      ma: item.maXuTriKhamBenh
    }));
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy xử trí ngoại trú:`, err.message);
  }

  // 3. Danh mục xử trí điều trị (nội trú)
  let listXuTriDieuTri = [];
  try {
    const resDt = await axios.get(`${auth.gateway}common/dmchethong/findByMaNhom?maNhom=XUTRI_DTRI`, { headers, timeout: 12000 });
    const rawList = resDt.data?.data || resDt.data || [];
    listXuTriDieuTri = rawList.map(item => ({
      id: Number(item.giaTri || item.ma || item.id),
      ma: String(item.ma || item.giaTri),
      ten: item.ten,
      giaTri: Number(item.giaTri || item.ma || item.id)
    }));
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy XUTRI_DTRI:`, err.message);
  }

  // 4. Danh sách mapping ngoại trú hiện tại
  let mapNgoaiTruRecords = [];
  try {
    const resMapNt = await axios.get(`${auth.gateway}common/mapxutriketquadieutri/findAll`, { headers, timeout: 12000 });
    const list = resMapNt.data?.data || [];
    mapNgoaiTruRecords = list.filter(m => m.csytId == csytId && m.key?.ketquadieutriid != null && m.key?.xutrikhambenhid != null);
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy mapxutriketquadieutri:`, err.message);
  }

  // 5. Danh sách mapping điều trị hiện tại
  let mapDieuTriRecords = [];
  try {
    const resMapDt = await axios.get(`${auth.gateway}common/mapkqxtntu/findAll`, { headers, timeout: 12000 });
    const list = resMapDt.data?.data || [];
    mapDieuTriRecords = list.filter(m => m.csytId == csytId && m.key?.ketquadieutriid != null && m.key?.xutrikhambenhid != null);
  } catch (err) {
    console.warn(`[${station.code}] Lỗi lấy mapkqxtntu:`, err.message);
  }

  // 6. Xây dựng danh sách hàng hiển thị (rows)
  const rows = listKetQuaDieuTri.map(kq => {
    // Lấy danh sách ID xử trí ngoại trú đã gán
    const xuTriNgoaiTruIds = mapNgoaiTruRecords
      .filter(m => String(m.key?.ketquadieutriid) === String(kq.id))
      .map(m => Number(m.key?.xutrikhambenhid));
    const uniqueNtIds = [...new Set(xuTriNgoaiTruIds)];
    const xuTriNgoaiTruList = uniqueNtIds
      .map(id => listXuTriNgoaiTru.find(xt => Number(xt.id) === id))
      .filter(Boolean);

    // Lấy danh sách ID xử trí điều trị đã gán
    const xuTriDieuTriIds = mapDieuTriRecords
      .filter(m => String(m.key?.ketquadieutriid) === String(kq.id))
      .map(m => Number(m.key?.xutrikhambenhid));
    const uniqueDtIds = [...new Set(xuTriDieuTriIds)];
    const xuTriDieuTriList = uniqueDtIds
      .map(id => listXuTriDieuTri.find(xt => Number(xt.id) === id))
      .filter(Boolean);

    return {
      ketQuaDieuTriId: kq.id,
      ketQuaDieuTriTen: kq.ten,
      xuTriNgoaiTruIds: uniqueNtIds,
      xuTriNgoaiTruList,
      xuTriNgoaiTruText: xuTriNgoaiTruList.map(x => x.ten).join(', ') || '-',
      xuTriDieuTriIds: uniqueDtIds,
      xuTriDieuTriList,
      xuTriDieuTriText: xuTriDieuTriList.map(x => x.ten).join(', ') || '-',
      isConfigured: uniqueNtIds.length > 0 || uniqueDtIds.length > 0
    };
  });

  return {
    stationId: station.id,
    stationCode: station.code,
    stationName: station.name,
    csytId,
    listKetQuaDieuTri,
    listXuTriNgoaiTru,
    listXuTriDieuTri,
    rows,
    configuredRowsCount: rows.filter(r => r.isConfigured).length,
    rawMapNgoaiTruCount: mapNgoaiTruRecords.length,
    rawMapDieuTriCount: mapDieuTriRecords.length
  };
}

/**
 * Lưu cấu hình mapping cho 1 kết quả điều trị tại 1 trạm
 * @param {string} stationId
 * @param {Object} payload: { ketQuaDieuTriId, xuTriNgoaiTruIds, xuTriDieuTriIds }
 */
async function saveStationMapping(stationId, payload) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers, csytId } = await getAuthContext(station);
  const kqId = Number(payload.ketQuaDieuTriId);
  const targetNtIds = Array.isArray(payload.xuTriNgoaiTruIds) ? payload.xuTriNgoaiTruIds.map(Number) : [];
  const targetDtIds = Array.isArray(payload.xuTriDieuTriIds) ? payload.xuTriDieuTriIds.map(Number) : [];

  // Lấy dữ liệu map hiện tại của trạm
  const [resMapNt, resMapDt] = await Promise.all([
    axios.get(`${auth.gateway}common/mapxutriketquadieutri/findAll`, { headers, timeout: 12000 }).catch(() => ({ data: { data: [] } })),
    axios.get(`${auth.gateway}common/mapkqxtntu/findAll`, { headers, timeout: 12000 }).catch(() => ({ data: { data: [] } }))
  ]);

  const currentNt = (resMapNt.data?.data || []).filter(m => m.csytId == csytId && Number(m.key?.ketquadieutriid) === kqId);
  const currentDt = (resMapDt.data?.data || []).filter(m => m.csytId == csytId && Number(m.key?.ketquadieutriid) === kqId);

  const currentNtIds = currentNt.map(m => Number(m.key?.xutrikhambenhid));
  const currentDtIds = currentDt.map(m => Number(m.key?.xutrikhambenhid));

  // Ngoại trú: Thêm những ID mới
  let addedNt = 0;
  for (const id of targetNtIds) {
    if (!currentNtIds.includes(id)) {
      try {
        await axios.post(`${auth.gateway}common/mapxutriketquadieutri/save`, {
          csytId,
          key: { ketquadieutriid: kqId, xutrikhambenhid: id }
        }, { headers, timeout: 8000 });
        addedNt++;
      } catch (err) {
        console.warn(`Lỗi lưu map ngoại trú kq=${kqId}, xt=${id}:`, err.message);
      }
    }
  }

  // Ngoại trú: Xóa những ID đã bỏ chọn
  let deletedNt = 0;
  for (const m of currentNt) {
    const id = Number(m.key?.xutrikhambenhid);
    if (!targetNtIds.includes(id)) {
      try {
        await axios.post(`${auth.gateway}common/mapxutriketquadieutri/delete`, {
          csytId,
          key: { ketquadieutriid: kqId, xutrikhambenhid: id }
        }, { headers, timeout: 8000 });
        deletedNt++;
      } catch (err) {
        console.warn(`Lỗi xóa map ngoại trú kq=${kqId}, xt=${id}:`, err.message);
      }
    }
  }

  // Điều trị: Thêm những ID mới
  let addedDt = 0;
  for (const id of targetDtIds) {
    if (!currentDtIds.includes(id)) {
      try {
        await axios.post(`${auth.gateway}common/mapkqxtntu/save`, {
          csytId,
          key: { ketquadieutriid: kqId, xutrikhambenhid: id }
        }, { headers, timeout: 8000 });
        addedDt++;
      } catch (err) {
        console.warn(`Lỗi lưu map điều trị kq=${kqId}, xt=${id}:`, err.message);
      }
    }
  }

  // Điều trị: Xóa những ID đã bỏ chọn
  let deletedDt = 0;
  for (const m of currentDt) {
    const id = Number(m.key?.xutrikhambenhid);
    if (!targetDtIds.includes(id)) {
      try {
        await axios.post(`${auth.gateway}common/mapkqxtntu/delete`, {
          csytId,
          key: { ketquadieutriid: kqId, xutrikhambenhid: id }
        }, { headers, timeout: 8000 });
        deletedDt++;
      } catch (err) {
        console.warn(`Lỗi xóa map điều trị kq=${kqId}, xt=${id}:`, err.message);
      }
    }
  }

  return {
    success: true,
    ketQuaDieuTriId: kqId,
    addedNt,
    deletedNt,
    addedDt,
    deletedDt
  };
}

/**
 * Xóa toàn bộ mapping của 1 kết quả điều trị tại 1 trạm
 */
async function deleteStationMapping(stationId, ketQuaDieuTriId) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers, csytId } = await getAuthContext(station);
  const kqId = Number(ketQuaDieuTriId);

  const [resMapNt, resMapDt] = await Promise.all([
    axios.get(`${auth.gateway}common/mapxutriketquadieutri/findAll`, { headers, timeout: 12000 }).catch(() => ({ data: { data: [] } })),
    axios.get(`${auth.gateway}common/mapkqxtntu/findAll`, { headers, timeout: 12000 }).catch(() => ({ data: { data: [] } }))
  ]);

  const currentNt = (resMapNt.data?.data || []).filter(m => m.csytId == csytId && Number(m.key?.ketquadieutriid) === kqId);
  const currentDt = (resMapDt.data?.data || []).filter(m => m.csytId == csytId && Number(m.key?.ketquadieutriid) === kqId);

  let deletedCount = 0;
  for (const m of currentNt) {
    try {
      await axios.post(`${auth.gateway}common/mapxutriketquadieutri/delete`, {
        csytId,
        key: { ketquadieutriid: kqId, xutrikhambenhid: Number(m.key?.xutrikhambenhid) }
      }, { headers, timeout: 8000 });
      deletedCount++;
    } catch (e) {}
  }

  for (const m of currentDt) {
    try {
      await axios.post(`${auth.gateway}common/mapkqxtntu/delete`, {
        csytId,
        key: { ketquadieutriid: kqId, xutrikhambenhid: Number(m.key?.xutrikhambenhid) }
      }, { headers, timeout: 8000 });
      deletedCount++;
    } catch (e) {}
  }

  return { success: true, deletedCount };
}

/**
 * PHÂN CÔNG / THÊM XỬ TRÍ CHO TẤT CẢ CÁC TRẠM ĐÃ CẤU HÌNH
 * @param {Object} options
 *   - stationIds: string[] | 'all'
 *   - ketQuaDieuTriIds: number[]
 *   - xuTriNgoaiTruIds: number[]
 *   - xuTriDieuTriIds: number[]
 *   - mode: 'append' (mặc định - thêm vào cấu hình có sẵn) | 'replace' (ghi đè)
 */
async function batchAddXuTriAllStations(options = {}) {
  const allStations = db.getStations(true);
  let targetStations = allStations;

  if (Array.isArray(options.stationIds) && options.stationIds.length > 0 && !options.stationIds.includes('all')) {
    targetStations = allStations.filter(s => options.stationIds.includes(s.id) || options.stationIds.includes(s.code));
  }

  const kqIds = Array.isArray(options.ketQuaDieuTriIds) ? options.ketQuaDieuTriIds.map(Number) : [];
  const targetNtIds = Array.isArray(options.xuTriNgoaiTruIds) ? options.xuTriNgoaiTruIds.map(Number) : [];
  const targetDtIds = Array.isArray(options.xuTriDieuTriIds) ? options.xuTriDieuTriIds.map(Number) : [];
  const mode = options.mode || 'append';

  if (kqIds.length === 0) {
    throw new Error('Vui lòng chọn ít nhất 1 kết quả điều trị cần phân công xử trí');
  }

  if (targetNtIds.length === 0 && targetDtIds.length === 0) {
    throw new Error('Vui lòng chọn ít nhất 1 xử trí ngoại trú hoặc xử trí điều trị');
  }

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
      message: ''
    };

    if (!station.username || !station.password) {
      stationRes.status = 'skipped';
      stationRes.message = 'Chưa cấu hình tài khoản trạm';
      results.push(stationRes);
      continue;
    }

    try {
      const { auth, headers, csytId } = await getAuthContext(station);

      // Đọc các mapping hiện có của trạm
      const [resMapNt, resMapDt] = await Promise.all([
        axios.get(`${auth.gateway}common/mapxutriketquadieutri/findAll`, { headers, timeout: 12000 }).catch(() => ({ data: { data: [] } })),
        axios.get(`${auth.gateway}common/mapkqxtntu/findAll`, { headers, timeout: 12000 }).catch(() => ({ data: { data: [] } }))
      ]);

      const currentNtList = (resMapNt.data?.data || []).filter(m => m.csytId == csytId);
      const currentDtList = (resMapDt.data?.data || []).filter(m => m.csytId == csytId);

      // Set key để kiểm tra tồn tại nhanh: `${ketquadieutriid}_${xutrikhambenhid}`
      const existingNtKeys = new Set(currentNtList.map(m => `${m.key?.ketquadieutriid}_${m.key?.xutrikhambenhid}`));
      const existingDtKeys = new Set(currentDtList.map(m => `${m.key?.ketquadieutriid}_${m.key?.xutrikhambenhid}`));

      for (const kqId of kqIds) {
        // 1. Ngoại trú
        for (const ntId of targetNtIds) {
          const key = `${kqId}_${ntId}`;
          if (existingNtKeys.has(key)) {
            stationRes.skippedCount++;
            totalSkipped++;
            continue;
          }

          try {
            const res = await axios.post(`${auth.gateway}common/mapxutriketquadieutri/save`, {
              csytId,
              key: { ketquadieutriid: kqId, xutrikhambenhid: ntId }
            }, { headers, timeout: 8000 });

            if (res.data?.code === 0) {
              existingNtKeys.add(key);
              stationRes.assignedCount++;
              totalAssigned++;
            } else {
              stationRes.errorCount++;
              totalErrors++;
            }
          } catch (saveErr) {
            stationRes.errorCount++;
            totalErrors++;
          }
        }

        // 2. Điều trị
        for (const dtId of targetDtIds) {
          const key = `${kqId}_${dtId}`;
          if (existingDtKeys.has(key)) {
            stationRes.skippedCount++;
            totalSkipped++;
            continue;
          }

          try {
            const res = await axios.post(`${auth.gateway}common/mapkqxtntu/save`, {
              csytId,
              key: { ketquadieutriid: kqId, xutrikhambenhid: dtId }
            }, { headers, timeout: 8000 });

            if (res.data?.code === 0) {
              existingDtKeys.add(key);
              stationRes.assignedCount++;
              totalAssigned++;
            } else {
              stationRes.errorCount++;
              totalErrors++;
            }
          } catch (saveErr) {
            stationRes.errorCount++;
            totalErrors++;
          }
        }
      }

      stationRes.status = stationRes.errorCount === 0 ? 'success' : (stationRes.assignedCount > 0 ? 'partial' : 'error');
      stationRes.message = `Đã thêm ${stationRes.assignedCount} xử trí, bỏ qua ${stationRes.skippedCount} (đã có), lỗi ${stationRes.errorCount}`;
      results.push(stationRes);

    } catch (err) {
      stationRes.status = 'error';
      stationRes.message = err.message;
      stationRes.errorCount++;
      totalErrors++;
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
 * Xuất dữ liệu cấu hình map ra file Excel
 */
async function exportExcel(stationId) {
  const data = await getStationData(stationId);
  const rows = (data.rows || []).map((r, idx) => ({
    'STT': idx + 1,
    'Mã Kết Quả ĐT': r.ketQuaDieuTriId,
    'Kết Quả Điều Trị': r.ketQuaDieuTriTen,
    'Xử Trí Ngoại Trú': r.xuTriNgoaiTruText,
    'Xử Trí Điều Trị': r.xuTriDieuTriText,
    'Trạng Thái': r.isConfigured ? 'Đã map' : 'Chưa map'
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Map_KQDT_XuTri');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getStationData,
  saveStationMapping,
  deleteStationMapping,
  batchAddXuTriAllStations,
  exportExcel
};
