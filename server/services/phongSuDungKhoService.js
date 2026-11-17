/**
 * Service quản lý cấu hình: Phòng Ban Sử Dụng Kho Vật Tư (HMIS dm-chung/phong-su-dung-kho-vtu)
 * API Gateway: pharmacy/dmcauhinhkho
 */

const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const cauhinhService = require('./cauhinhService');
const logService = require('./logService');

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
 * Lấy toàn bộ dữ liệu cấu hình Phòng sử dụng kho vật tư và các danh mục tra cứu của 1 trạm
 */
async function getStationData(stationId) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error(`Không tìm thấy trạm y tế với ID ${stationId}`);
  }

  const { auth, headers } = await getAuthHeaders(station);

  // Tải song song danh sách cấu hình kho và các danh mục lookup
  const [
    cfgRes,
    lkcbRes,
    lkdRes,
    lkduocRes,
    khoRes,
    dtRes,
    tuyenRes,
    usersRes
  ] = await Promise.all([
    axios.get(`${auth.gateway}pharmacy/dmcauhinhkho/search?filter=id!=0&page=0&size=500&sort=id,asc`, {
      headers, timeout: 15000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/dmchethong/search?sort=giaTri,desc&page=0&size=100&filter=${encodeURIComponent('maNhom=in=(LOAITIEPNHANID,LOAITIEPNHANID_EXTENS)')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/dmchethong/search?sort=giaTri,asc&page=0&size=100&filter=${encodeURIComponent('maNhom==LOAI_KE_DON')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/dmchethong/search?sort=giaTri,asc&page=0&size=100&filter=${encodeURIComponent('maNhom==LOAI_KE_DON_DUOC')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}pharmacy/kho/search?sort=id,desc&page=0&size=200&filter=${encodeURIComponent('(tenKho==**,maKho==**);trangThai==1')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/doituongbenhnhan/search?page=0&size=100&sort=id,asc&filter=${encodeURIComponent('id>0;khongSuDung==0')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/loaibhyt/search?page=0&size=100&sort=id,asc&filter=${encodeURIComponent('id>0')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/admuser/search?page=0&size=200&sort=id,asc&filter=${encodeURIComponent('id>0;status==1')}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} }))
  ]);

  const rawRows = Array.isArray(cfgRes.data?.data?.content) ? cfgRes.data.data.content : [];
  const listKho = Array.isArray(khoRes.data?.data?.content) ? khoRes.data.data.content : [];
  const rawUsers = Array.isArray(usersRes.data?.data?.content) ? usersRes.data.data.content : [];

  // Xác định companyId (csytId) của trạm (thường là 1)
  const companyId =
    listKho[0]?.csytId ||
    rawRows[0]?.kho?.csytId ||
    rawUsers[0]?.company?.id ||
    rawUsers[0]?.officer?.companyId ||
    1;

  const [khoaRes, allPhongRes] = await Promise.all([
    axios.get(`${auth.gateway}common/organization/khoa?companyId=${companyId}`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/organization/layDanhSachKhoaPhongTheoCap?rootId=${companyId}&orgLevel=5`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} }))
  ]);

  const listLoaiKCB = (Array.isArray(lkcbRes.data?.data?.content) ? lkcbRes.data.data.content : []).map(x => ({
    id: parseInt(x.giaTri, 10),
    giaTri: parseInt(x.giaTri, 10),
    ma: x.ma || '',
    ten: (x.ten || '').trim()
  }));

  const listLoaiKeDon = (Array.isArray(lkdRes.data?.data?.content) ? lkdRes.data.data.content : []).map(x => ({
    id: parseInt(x.giaTri, 10),
    giaTri: parseInt(x.giaTri, 10),
    ma: x.ma || '',
    ten: (x.ten || '').trim()
  }));

  const listLoaiKeDuoc = (Array.isArray(lkduocRes.data?.data?.content) ? lkduocRes.data.data.content : []).map(x => ({
    id: parseInt(x.giaTri, 10),
    giaTri: parseInt(x.giaTri, 10),
    ma: x.ma || '',
    ten: (x.ten || '').trim()
  }));

  const listKhoa = (Array.isArray(khoaRes.data?.data) ? khoaRes.data.data : []).map(k => ({
    id: k.id,
    code: k.code || '',
    name: k.name || ''
  }));

  const rawAllPhong = Array.isArray(allPhongRes.data?.data) ? allPhongRes.data.data : [];
  const listPhong = rawAllPhong
    .filter(p => String(p.level) === '5')
    .map(p => ({
      id: p.id,
      code: p.code || '',
      name: p.name || '',
      parentId: p.parentId || null
    }));

  const rawDoiTuong = Array.isArray(dtRes.data?.data?.content) ? dtRes.data.data.content : [];
  const listDoiTuong = [
    { id: -1, tenDtbn: 'Tất cả' },
    ...rawDoiTuong.map(d => ({ id: d.id, tenDtbn: d.tenDtbn || d.ten || '' }))
  ];

  const rawTuyen = Array.isArray(tuyenRes.data?.data?.content)
    ? tuyenRes.data.data.content
    : (Array.isArray(tuyenRes.data?.data) ? tuyenRes.data.data : []);
  const listTuyen = [
    { id: -1, tenloaibhyt: 'Tất cả' },
    ...rawTuyen.map(t => ({ id: t.id, maloaibhyt: t.maloaibhyt || '', tenloaibhyt: t.tenloaibhyt || '' }))
  ];

  const listNhanVien = rawUsers.map(u => ({
    id: u.id,
    username: u.username || '',
    officerName: u.officer?.officerName || u.fullName || u.username || '',
    khoaId: u.officer?.khoa?.id || null
  }));

  // Ánh xạ dữ liệu hiển thị cho từng dòng trong bảng giống hệt giao diện HMIS
  const rows = rawRows.map(r => {
    const loaiKcbObj = listLoaiKCB.find(x => x.giaTri === r.loaiKcbId);
    const loaiKePool = r.loaiKcbId === 9 ? listLoaiKeDuoc : listLoaiKeDon;
    const loaiKeObj = loaiKePool.find(x => x.giaTri === r.loaiKeId);
    const khoaObj = listKhoa.find(k => k.id === r.khoaId);
    const phongObj = (r.phongId && r.phongId !== -1) ? listPhong.find(p => p.id === r.phongId) : null;
    const dtObj = (r.doiTuongBenhNhanId != null && r.doiTuongBenhNhanId !== -1)
      ? listDoiTuong.find(d => d.id === r.doiTuongBenhNhanId)
      : { id: -1, tenDtbn: 'Tất cả' };
    const tuyenObj = (r.bhytLoaiId != null && r.bhytLoaiId !== -1)
      ? listTuyen.find(t => t.id === r.bhytLoaiId)
      : { id: -1, tenloaibhyt: 'Tất cả' };
    const nvObj = (r.nhanVienId && r.nhanVienId !== -1)
      ? listNhanVien.find(nv => nv.id === r.nhanVienId)
      : null;

    return {
      id: r.id,
      loaiKcbId: r.loaiKcbId,
      loaiKcbTen: loaiKcbObj ? loaiKcbObj.ten : `Loại KCB (${r.loaiKcbId})`,
      loaiKeId: r.loaiKeId,
      loaiKeTen: loaiKeObj ? loaiKeObj.ten : `Loại kê (${r.loaiKeId})`,
      khoId: r.kho?.id || null,
      maKho: r.kho?.maKho || '',
      tenKho: r.kho?.tenKho || '',
      khoaId: r.khoaId ?? null,
      khoaTen: khoaObj ? khoaObj.name : '',
      phongId: r.phongId ?? -1,
      phongTen: phongObj ? phongObj.name : '',
      doiTuongBenhNhanId: r.doiTuongBenhNhanId ?? null,
      doiTuongTen: dtObj ? dtObj.tenDtbn : 'Tất cả',
      bhytLoaiId: r.bhytLoaiId ?? null,
      tuyenTen: tuyenObj ? tuyenObj.tenloaibhyt : 'Tất cả',
      nhanVienId: r.nhanVienId ?? -1,
      nhanVienTen: nvObj ? nvObj.officerName : '',
      stt: r.stt ?? '',
      trangThai: r.trangThai ?? 1,
      ngayTao: r.ngayTao || '',
      ngaySua: r.ngaySua || ''
    };
  });

  return {
    stationId: station.id,
    stationCode: station.code,
    stationName: station.name,
    companyId,
    totalRows: rows.length,
    rows,
    listLoaiKCB,
    listLoaiKeDon,
    listLoaiKeDuoc,
    listKho: listKho.map(k => ({
      id: k.id,
      maKho: k.maKho || '',
      tenKho: k.tenKho || '',
      loaiKho: k.loaiKho,
      khoaId: k.khoaId
    })),
    listKhoa,
    listPhong,
    listDoiTuong,
    listTuyen,
    listNhanVien
  };
}

/**
 * Lấy danh sách phòng theo Khoa của 1 trạm (API common/organization/phong?khoaId=...)
 */
async function getPhongByKhoa(stationId, khoaId) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);
  if (!khoaId) return [];

  const { auth, headers } = await getAuthHeaders(station);
  const res = await axios.get(`${auth.gateway}common/organization/phong?khoaId=${encodeURIComponent(khoaId)}`, {
    headers,
    timeout: 10000,
    validateStatus: () => true
  });
  if (res.status === 200 && Array.isArray(res.data?.data)) {
    return res.data.data.map(p => ({
      id: p.id,
      code: p.code || '',
      name: p.name || ''
    }));
  }
  return [];
}

/**
 * Thêm mới cấu hình phòng ban sử dụng kho vật tư trên 1 trạm
 * Chuẩn API HMIS: POST pharmacy/dmcauhinhkho/createList?lstPhong=...
 */
async function createStationConfig(stationId, payload) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers } = await getAuthHeaders(station);

  const loaiKcbId = parseInt(payload.loaiKcbId, 10);
  const loaiKeId = parseInt(payload.loaiKeId, 10);
  if (Number.isNaN(loaiKcbId) || Number.isNaN(loaiKeId)) {
    throw new Error('Vui lòng chọn đầy đủ Loại KCB và Loại kê');
  }

  // Danh sách phòng (nếu không chọn phòng thì gửi lstPhong=-1 giống hệt HMIS)
  const rawPhongIds = Array.isArray(payload.phongIds)
    ? payload.phongIds.filter(x => x !== null && x !== undefined && x !== '' && Number(x) !== -1).map(x => parseInt(x, 10))
    : (payload.phongId && Number(payload.phongId) !== -1 ? [parseInt(payload.phongId, 10)] : []);

  const lstPhongQuery = rawPhongIds.length > 0
    ? rawPhongIds.map(pid => `lstPhong=${pid}`).join('&')
    : 'lstPhong=-1';

  const baseBody = {
    loaiKcbId,
    loaiKeId,
    kho: null,
    khoaId: payload.khoaId ? parseInt(payload.khoaId, 10) : null,
    phongId: rawPhongIds.length > 0 ? rawPhongIds[0] : -1,
    doiTuongBenhNhanId: (payload.doiTuongBenhNhanId != null && payload.doiTuongBenhNhanId !== '' && Number(payload.doiTuongBenhNhanId) !== -1)
      ? parseInt(payload.doiTuongBenhNhanId, 10)
      : null,
    bhytLoaiId: (payload.bhytLoaiId != null && payload.bhytLoaiId !== '' && Number(payload.bhytLoaiId) !== -1)
      ? parseInt(payload.bhytLoaiId, 10)
      : null,
    nhanVienId: (payload.nhanVienId != null && payload.nhanVienId !== '' && Number(payload.nhanVienId) !== -1)
      ? parseInt(payload.nhanVienId, 10)
      : -1
  };

  const rawKhoIds = Array.isArray(payload.khoIds)
    ? payload.khoIds.filter(x => x !== null && x !== undefined && x !== '').map(x => parseInt(x, 10))
    : (payload.khoId ? [parseInt(payload.khoId, 10)] : []);

  const bodies = rawKhoIds.length > 0
    ? rawKhoIds.map(kid => ({ ...baseBody, kho: { id: kid } }))
    : [{ ...baseBody, kho: null }];

  const responses = [];
  for (const body of bodies) {
    const url = `${auth.gateway}pharmacy/dmcauhinhkho/createList?${lstPhongQuery}`;
    const res = await axios.post(url, body, { headers, timeout: 12000, validateStatus: () => true });
    if (res.status !== 200 || (res.data?.code !== 0 && res.data?.code !== 200)) {
      throw new Error(res.data?.message || `Lỗi HMIS HTTP ${res.status}`);
    }
    responses.push(res.data);
  }

  try {
    logService.addLog({
      actionType: 'phong_su_dung_kho',
      actionTitle: 'Thêm cấu hình Phòng ban sử dụng kho vật tư',
      summary: `[${station.code}] ${station.name}: Đã lưu cấu hình phòng sử dụng kho (Loại KCB=${loaiKcbId}, Loại kê=${loaiKeId}, Số kho=${rawKhoIds.length || 1})`,
      details: { stationId: station.id, stationCode: station.code, payload },
      total: 1,
      successCount: 1,
      failedCount: 0,
      results: [{ id: station.id, name: station.name, success: true, message: 'Lưu thành công' }]
    });
  } catch (e) {}

  return {
    success: true,
    createdCount: responses.length,
    responses
  };
}

/**
 * Cập nhật STT order cho 1 bản ghi cấu hình kho
 * Chuẩn API HMIS: POST pharmacy/dmcauhinhkho/update_stt?stt=... với body là ID bản ghi
 */
async function updateStationStt(stationId, id, stt) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers } = await getAuthHeaders(station);
  const sttVal = stt !== null && stt !== undefined ? String(stt).trim() : '';
  const url = `${auth.gateway}pharmacy/dmcauhinhkho/update_stt?stt=${encodeURIComponent(sttVal)}`;

  const res = await axios.post(url, JSON.stringify(Number(id)), {
    headers,
    timeout: 10000,
    validateStatus: () => true
  });

  if (res.status !== 200 || (res.data?.code !== 0 && res.data?.code !== 200)) {
    throw new Error(res.data?.message || `Không thể cập nhật STT (HTTP ${res.status})`);
  }

  return res.data;
}

/**
 * Xóa 1 dòng cấu hình phòng sử dụng kho vật tư
 * Chuẩn API HMIS: DELETE pharmacy/dmcauhinhkho/delete?id=...
 */
async function deleteStationConfig(stationId, id) {
  const station = db.getStationById(stationId, true);
  if (!station) throw new Error(`Không tìm thấy trạm ${stationId}`);

  const { auth, headers } = await getAuthHeaders(station);
  const url = `${auth.gateway}pharmacy/dmcauhinhkho/delete?id=${encodeURIComponent(id)}`;
  const res = await axios.delete(url, { headers, timeout: 10000, validateStatus: () => true });

  if (res.status !== 200 || (res.data?.code !== 0 && res.data?.code !== 200)) {
    throw new Error(res.data?.message || `Không thể xóa cấu hình kho (HTTP ${res.status})`);
  }

  try {
    logService.addLog({
      actionType: 'phong_su_dung_kho',
      actionTitle: 'Xóa cấu hình Phòng ban sử dụng kho vật tư',
      summary: `[${station.code}] ${station.name}: Đã xóa dòng cấu hình kho ID=${id}`,
      details: { stationId: station.id, id },
      total: 1,
      successCount: 1,
      failedCount: 0,
      results: [{ id: station.id, name: station.name, success: true, message: `Đã xóa ID=${id}` }]
    });
  } catch (e) {}

  return res.data;
}

/**
 * Đồng bộ / Thêm cấu hình phòng sử dụng kho vật tư hàng loạt cho nhiều trạm (hoặc ALL 43 trạm)
 * Tự động ánh xạ Kho theo maKho/tenKho và Khoa/Phòng theo code/name trên từng trạm, bỏ qua bản ghi đã tồn tại
 */
async function batchCreateForStations(options = {}) {
  const allStations = db.getStations(true);
  let targetStations = allStations;

  if (Array.isArray(options.stationIds) && options.stationIds.length > 0 && !options.stationIds.includes('all')) {
    targetStations = allStations.filter(s => options.stationIds.includes(s.id) || options.stationIds.includes(s.code));
  }

  const loaiKcbId = parseInt(options.loaiKcbId, 10);
  const loaiKeId = parseInt(options.loaiKeId, 10);
  const targetMaKho = (options.maKho || '').trim().toLowerCase();
  const targetTenKho = (options.tenKho || '').trim().toLowerCase();
  const targetKhoaCode = (options.khoaCode || '').trim().toLowerCase();
  const targetKhoaName = (options.khoaName || '').trim().toLowerCase();
  const targetPhongName = (options.phongName || '').trim().toLowerCase();
  const doiTuongBenhNhanId = (options.doiTuongBenhNhanId != null && options.doiTuongBenhNhanId !== '' && Number(options.doiTuongBenhNhanId) !== -1)
    ? parseInt(options.doiTuongBenhNhanId, 10)
    : null;
  const bhytLoaiId = (options.bhytLoaiId != null && options.bhytLoaiId !== '' && Number(options.bhytLoaiId) !== -1)
    ? parseInt(options.bhytLoaiId, 10)
    : null;
  const skipDuplicates = options.skipDuplicates !== false;

  const results = [];
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const station of targetStations) {
    const startTime = Date.now();
    try {
      const stData = await getStationData(station.id);

      // 1. Tìm kho tương ứng trên trạm (theo maKho, tenKho, hoặc mặc định kho khám bệnh KKB)
      let matchedKho = null;
      if (targetMaKho || targetTenKho) {
        matchedKho = stData.listKho.find(k =>
          (targetMaKho && String(k.maKho || '').trim().toLowerCase() === targetMaKho) ||
          (targetTenKho && String(k.tenKho || '').trim().toLowerCase() === targetTenKho)
        );
      }
      if (!matchedKho && options.khoId) {
        matchedKho = stData.listKho.find(k => k.id === Number(options.khoId));
      }
      if (!matchedKho && !options.allowNullKho) {
        matchedKho = stData.listKho.find(k => String(k.maKho || '').toUpperCase() === 'KKB') || stData.listKho[0];
      }

      // 2. Tìm khoa tương ứng trên trạm (nếu có chọn khoa)
      let matchedKhoaId = null;
      if (targetKhoaCode || targetKhoaName || options.khoaId) {
        const kObj = stData.listKhoa.find(k =>
          (targetKhoaCode && String(k.code || '').trim().toLowerCase() === targetKhoaCode) ||
          (targetKhoaName && String(k.name || '').trim().toLowerCase() === targetKhoaName) ||
          (options.khoaId && k.id === Number(options.khoaId))
        );
        if (kObj) matchedKhoaId = kObj.id;
      }

      // 3. Tìm phòng tương ứng trên trạm (nếu có chọn phòng)
      let matchedPhongId = -1;
      if (targetPhongName || (options.phongId && Number(options.phongId) !== -1)) {
        const pObj = stData.listPhong.find(p =>
          (targetPhongName && String(p.name || '').trim().toLowerCase() === targetPhongName) ||
          (options.phongId && p.id === Number(options.phongId))
        );
        if (pObj) matchedPhongId = pObj.id;
      }

      // 4. Kiểm tra trùng lặp trên trạm để an toàn tuyệt đối
      const exists = stData.rows.some(r =>
        r.loaiKcbId === loaiKcbId &&
        r.loaiKeId === loaiKeId &&
        (r.khoId || null) === (matchedKho?.id || null) &&
        (r.khoaId || null) === (matchedKhoaId || null) &&
        (r.phongId || -1) === (matchedPhongId || -1) &&
        (r.doiTuongBenhNhanId || null) === doiTuongBenhNhanId &&
        (r.bhytLoaiId || null) === bhytLoaiId
      );

      if (exists && skipDuplicates) {
        totalSkipped++;
        results.push({
          stationId: station.id,
          stationCode: station.code,
          stationName: station.name,
          success: true,
          added: 0,
          skipped: 1,
          message: 'Đã có sẵn cấu hình này trên trạm (bỏ qua)',
          duration: Date.now() - startTime
        });
        continue;
      }

      await createStationConfig(station.id, {
        loaiKcbId,
        loaiKeId,
        khoIds: matchedKho ? [matchedKho.id] : [],
        khoaId: matchedKhoaId,
        phongIds: matchedPhongId !== -1 ? [matchedPhongId] : [],
        doiTuongBenhNhanId,
        bhytLoaiId
      });

      totalAdded++;
      results.push({
        stationId: station.id,
        stationCode: station.code,
        stationName: station.name,
        success: true,
        added: 1,
        skipped: 0,
        message: `Đã thêm cấu hình với kho [${matchedKho ? matchedKho.tenKho : 'Không chọn kho'}]`,
        duration: Date.now() - startTime
      });
    } catch (err) {
      totalErrors++;
      results.push({
        stationId: station.id,
        stationCode: station.code,
        stationName: station.name,
        success: false,
        added: 0,
        skipped: 0,
        message: err.message,
        duration: Date.now() - startTime
      });
    }
  }

  return {
    totalStations: targetStations.length,
    totalAdded,
    totalSkipped,
    totalErrors,
    results
  };
}

/**
 * Xuất file Excel danh sách phòng ban sử dụng kho vật tư của 1 trạm
 */
async function exportExcel(stationId) {
  const data = await getStationData(stationId);
  const sheetRows = data.rows.map((r, idx) => ({
    'STT': idx + 1,
    'Mã CSKCB': data.stationCode,
    'Tên Trạm Y Tế': data.stationName,
    'Loại khám chữa bệnh': r.loaiKcbTen,
    'Loại kê': r.loaiKeTen,
    'Mã Kho': r.maKho,
    'Kho': r.tenKho,
    'Phòng': r.phongTen,
    'Khoa': r.khoaTen,
    'Đối tượng': r.doiTuongTen,
    'Tuyến': r.tuyenTen,
    'Nhân viên': r.nhanVienTen,
    'Stt order': r.stt ?? ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows.length > 0 ? sheetRows : [{ 'Thông báo': 'Chưa có dữ liệu cấu hình kho' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'PhongSuDungKho');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getStationData,
  getPhongByKhoa,
  createStationConfig,
  updateStationStt,
  deleteStationConfig,
  batchCreateForStations,
  exportExcel
};
