const axios = require('axios');
const db = require('./db');
const cauhinhService = require('./cauhinhService');
const logService = require('./logService');

/**
 * Lấy toàn bộ dữ liệu nhân viên, tài khoản, nhóm quyền và chức danh ký số của 1 trạm
 * @param {string} stationId
 */
async function getStationNhanVienData(stationId) {
  let station = null;
  if (stationId) {
    station = db.getStationById(stationId, true);
  }
  if (!station) {
    const stations = db.getStations(true);
    station = stations.find(s => s.username && s.password && s.url && s.url.includes('hmis.vn')) || stations[0];
  }

  if (!station || !station.username || !station.password) {
    throw new Error('Chưa có thông tin tài khoản trạm y tế hợp lệ để kết nối HMIS');
  }

  const auth = await cauhinhService.loginToHmis(station);
  const headers = {
    'Authorization': `Bearer ${auth.token}`,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl
  };

  // Tải song song 4 danh mục từ cổng HMIS
  const [officersRes, rolesRes, titlesRes, usersRes] = await Promise.all([
    axios.get(`${auth.gateway}common/officer/search?filter=id!=0&page=0&size=500&sort=id,asc`, {
      headers,
      timeout: 20000,
      validateStatus: () => true
    }),
    axios.get(`${auth.gateway}common/role/search?filter=roleId!=0&page=0&size=1000&sort=roleId,desc`, {
      headers,
      timeout: 20000,
      validateStatus: () => true
    }),
    axios.get(`${auth.gateway}common/dmcsigntitle/search?filter=id!=0&page=0&size=1000&sort=id,desc`, {
      headers,
      timeout: 20000,
      validateStatus: () => true
    }),
    axios.get(`${auth.gateway}common/admuser/search?filter=id!=0&page=0&size=500&sort=id,asc`, {
      headers,
      timeout: 20000,
      validateStatus: () => true
    })
  ]);

  const officers = officersRes.data?.data?.content || [];
  const roles = rolesRes.data?.data?.content || [];
  const signTitles = titlesRes.data?.data?.content || [];
  const rawUsers = usersRes.data?.data?.content || [];

  // Ghép tài khoản vào nhân viên tương ứng
  const userMap = {};
  rawUsers.forEach(u => {
    const offId = u.officer?.id || u.officerId;
    if (offId) {
      if (!userMap[offId]) userMap[offId] = [];
      userMap[offId].push(u);
    }
  });

  // Bản đồ thứ tự nhân viên để sắp xếp tài khoản theo đúng 1:1 với danh sách nhân viên
  const officerOrderMap = new Map();
  officers.forEach((o, index) => {
    officerOrderMap.set(o.id, index);
  });

  rawUsers.sort((a, b) => {
    const offIdA = a.officer?.id || a.officerId;
    const offIdB = b.officer?.id || b.officerId;
    const orderA = offIdA && officerOrderMap.has(offIdA) ? officerOrderMap.get(offIdA) : 9999;
    const orderB = offIdB && officerOrderMap.has(offIdB) ? officerOrderMap.get(offIdB) : 9999;
    if (orderA !== orderB) return orderA - orderB;
    return (a.id || 0) - (b.id || 0);
  });

  const enrichedOfficers = officers.map(o => ({
    ...o,
    accountsCount: (userMap[o.id] || []).length,
    accounts: userMap[o.id] || []
  }));

  return {
    success: true,
    station: {
      id: station.id,
      name: station.name,
      code: station.code,
      username: station.username,
      url: station.url
    },
    officers: enrichedOfficers,
    roles,
    signTitles,
    users: rawUsers
  };
}

/**
 * Lấy thông tin chi tiết một tài khoản người dùng từ cổng HMIS (gồm roles và signTitles đầy đủ)
 * @param {string} stationId
 * @param {number|string} userId
 */
async function getUserDetail(stationId, userId) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error('Không tìm thấy trạm y tế');
  }

  const auth = await cauhinhService.loginToHmis(station);
  const headers = {
    'Authorization': `Bearer ${auth.token}`,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl
  };

  const res = await axios.get(`${auth.gateway}common/admuser/detail?id=${userId}`, {
    headers,
    timeout: 15000,
    validateStatus: () => true
  });

  if (res.status === 200 && (res.data?.code === 0 || res.data?.code === 200 || res.data?.data)) {
    return {
      success: true,
      data: res.data.data
    };
  }

  throw new Error(res.data?.message || `Lỗi lấy chi tiết tài khoản ${userId} từ HMIS`);
}

/**
 * Cập nhật phân công chức danh và nhóm người dùng cho 1 tài khoản trên cổng HMIS
 * @param {string} stationId
 * @param {number|string} userId
 * @param {Object} updateData
 * @param {string} [specificPart] - 'all' | 'roles' | 'titles'
 */
async function updateUserPhanCong(stationId, userId, updateData = {}, specificPart = 'all') {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error('Không tìm thấy trạm y tế');
  }

  const auth = await cauhinhService.loginToHmis(station);
  const headers = {
    'Authorization': `Bearer ${auth.token}`,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl,
    'Content-Type': 'application/json'
  };

  // 1. Lấy chi tiết cũ để lưu log và bảo toàn dữ liệu
  let oldDetail = null;
  try {
    const detailRes = await axios.get(`${auth.gateway}common/admuser/detail?id=${userId}`, {
      headers,
      timeout: 10000,
      validateStatus: () => true
    });
    if (detailRes.status === 200 && detailRes.data?.data) {
      oldDetail = detailRes.data.data;
    }
  } catch (e) {}

  const base = oldDetail || {};
  const mergeMode = updateData.mergeMode !== undefined ? Boolean(updateData.mergeMode) : true;
  const part = specificPart || updateData.specificPart || 'all';

  const existingRoleIds = (base.nhomNguoiDungs || []).map(r => Number(r.roleId || r.id)).filter(Boolean);
  const existingTitleIds = (base.signTitles || []).map(t => Number(t.id)).filter(Boolean);

  // 2. Xác định danh sách Nhóm người dùng (Bảo vệ không bị mất nếu không điền)
  let roleIds;
  if (part === 'titles') {
    // Chỉ cập nhật chức danh ký số, giữ nguyên 100% nhóm người dùng cũ
    roleIds = existingRoleIds;
  } else {
    const inputRoleIds = Array.isArray(updateData.roleIds)
      ? updateData.roleIds.map(Number).filter(Boolean)
      : [];
    if (inputRoleIds.length === 0) {
      // Không chọn / không điền nhóm người dùng -> Giữ nguyên toàn bộ nhóm đã phân trước đó
      roleIds = existingRoleIds;
    } else if (mergeMode) {
      // Hợp nhất nhóm mới với nhóm cũ đã phân (không làm mất cái đã phân)
      roleIds = Array.from(new Set([...existingRoleIds, ...inputRoleIds]));
    } else {
      roleIds = inputRoleIds;
    }
  }

  // 3. Xác định danh sách Chức danh ký số (Bảo vệ không bị mất nếu không điền)
  let signTitleIds;
  if (part === 'roles') {
    // Chỉ cập nhật nhóm người dùng, giữ nguyên 100% chức danh ký số cũ
    signTitleIds = existingTitleIds;
  } else {
    const inputTitleIds = Array.isArray(updateData.signTitleIds)
      ? updateData.signTitleIds.map(Number).filter(Boolean)
      : [];
    if (inputTitleIds.length === 0) {
      // Không chọn / không điền chức danh ký số -> Giữ nguyên toàn bộ chức danh đã phân trước đó
      signTitleIds = existingTitleIds;
    } else if (mergeMode) {
      // Hợp nhất chức danh mới với chức danh cũ đã phân (không làm mất cái đã phân)
      signTitleIds = Array.from(new Set([...existingTitleIds, ...inputTitleIds]));
    } else {
      signTitleIds = inputTitleIds;
    }
  }

  const payload = {
    id: Number(userId),
    username: updateData.username || base.username,
    userPwd: (updateData.userPwd && updateData.userPwd.trim()) ? updateData.userPwd.trim() : '',
    officer: { id: updateData.officerId || base.officer?.id },
    fullName: updateData.fullName || base.fullName || base.officer?.officerName || '',
    userLevel: (part === 'all' && updateData.userLevel !== undefined) ? Number(updateData.userLevel) : (base.userLevel ?? 4),
    userType: (part === 'all' && updateData.userType !== undefined) ? Number(updateData.userType) : (base.userType ?? 0),
    status: (part === 'all' && updateData.status !== undefined) ? (updateData.status ? 1 : 0) : (base.status ?? 1),
    callOnl: (part === 'all' && updateData.callOnl !== undefined) ? (updateData.callOnl ? 1 : 0) : (base.callOnl ?? 0),
    auth2FA: (part === 'all' && updateData.auth2FA !== undefined) ? (updateData.auth2FA ? 1 : 0) : (base.auth2FA ?? 0),
    type2fa: updateData.type2fa || base.type2fa || null,
    company: { id: updateData.companyId || base.company?.id || 1 },
    nhomNguoiDungs: roleIds.map(rId => ({ roleId: Number(rId) })),
    signTitles: signTitleIds.map(tId => ({ id: Number(tId) })),
    adminRegion: 0
  };

  const updateRes = await axios.put(`${auth.gateway}common/admuser/capnhat?id=${userId}`, payload, {
    headers,
    timeout: 20000,
    validateStatus: () => true
  });

  if (updateRes.status === 200 && (updateRes.data?.code === 0 || updateRes.data?.code === 200 || updateRes.data?.data)) {
    // Ghi log hệ thống
    const oldRolesStr = (oldDetail?.nhomNguoiDungs || []).map(r => r.roleName || r.roleCode || r.roleId).join(', ') || 'Chưa có';
    const oldTitlesStr = (oldDetail?.signTitles || []).map(t => t.titleName || t.titleCode || t.id).join(', ') || 'Chưa có';
    const newRolesCount = roleIds.length;
    const newTitlesCount = signTitleIds.length;

    try {
      logService.logAction({
        actionType: 'phancong_nhanvien',
        actionTitle: `Phân công tài khoản ${payload.username} (${station.name})`,
        summary: `Đã cập nhật phân công cho tài khoản ${payload.username}: ${newRolesCount} nhóm quyền, ${newTitlesCount} chức danh ký số`,
        sourceType: 'user_action',
        totalStations: 1,
        successCount: 1,
        failedCount: 0,
        oldValue: `Nhóm quyền cũ: [${oldRolesStr}] | Chức danh cũ: [${oldTitlesStr}]`,
        newValue: `Nhóm quyền mới: [${roleIds.join(', ')}] | Chức danh mới: [${signTitleIds.join(', ')}]`,
        details: [
          {
            stationId: station.id,
            stationCode: station.code,
            stationName: station.name,
            username: payload.username,
            officerName: payload.fullName,
            status: 'success',
            message: updateRes.data?.message || 'Cập nhật thành công!'
          }
        ]
      });
    } catch (errLog) {
      console.warn('Lỗi ghi log phân công:', errLog.message);
    }

    return {
      success: true,
      message: updateRes.data?.message || 'Cập nhật phân công thành công!',
      data: updateRes.data?.data,
      user: payload,
      finalRoleIds: roleIds,
      finalSignTitleIds: signTitleIds
    };
  }

  throw new Error(updateRes.data?.message || `Lỗi cập nhật người dùng HTTP ${updateRes.status}`);
}

/**
 * Phân công hàng loạt chức danh và nhóm người dùng cho nhiều trạm hoặc nhiều tài khoản
 * @param {Object} batchParams
 * @param {Array<string>} batchParams.stationIds
 * @param {Array<number>} batchParams.roleIdsToAdd
 * @param {Array<number>} batchParams.signTitleIdsToAdd
 * @param {string} [batchParams.officerFilter] - 'all' | 'bac_si' | 'dieu_duong' | 'cu_the'
 * @param {Array<number>} [batchParams.specificUserIds]
 */
async function batchAssignNhanVien(batchParams) {
  const {
    stationIds,
    roleIdsToAdd = [],
    signTitleIdsToAdd = [],
    officerFilter = 'all',
    specificUserIds = []
  } = batchParams;

  if (!Array.isArray(stationIds) || stationIds.length === 0) {
    throw new Error('Vui lòng chọn ít nhất 1 trạm y tế');
  }

  const results = [];
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const sId of stationIds) {
    const station = db.getStationById(sId, true);
    if (!station || !station.username || !station.password) continue;

    try {
      const auth = await cauhinhService.loginToHmis(station);
      const headers = {
        'Authorization': `Bearer ${auth.token}`,
        'region-code': auth.region,
        'Origin': auth.targetUrl.replace(/\/$/, ''),
        'Referer': auth.targetUrl,
        'Content-Type': 'application/json'
      };

      // 1. Tải danh sách user của trạm
      const userRes = await axios.get(`${auth.gateway}common/admuser/search?filter=id!=0&page=0&size=500&sort=id,desc`, {
        headers,
        timeout: 15000,
        validateStatus: () => true
      });
      const users = userRes.data?.data?.content || [];

      // 2. Lọc danh sách user cần áp dụng
      let targetUsers = users;
      if (specificUserIds.length > 0) {
        targetUsers = users.filter(u => specificUserIds.includes(u.id));
      } else if (officerFilter === 'bac_si') {
        targetUsers = users.filter(u => {
          const typeName = (u.officer?.officerType?.name || '').toLowerCase();
          return typeName.includes('bác') || typeName.includes('bac');
        });
      } else if (officerFilter === 'dieu_duong') {
        targetUsers = users.filter(u => {
          const typeName = (u.officer?.officerType?.name || '').toLowerCase();
          return typeName.includes('dưỡng') || typeName.includes('duong') || typeName.includes('y sĩ');
        });
      }

      for (const u of targetUsers) {
        try {
          // Lấy detail hiện tại
          const detailRes = await axios.get(`${auth.gateway}common/admuser/detail?id=${u.id}`, {
            headers,
            timeout: 10000,
            validateStatus: () => true
          });
          const detail = detailRes.data?.data || u;

          // Hợp nhất Role
          const currentRoleIds = (detail.nhomNguoiDungs || []).map(r => Number(r.roleId)).filter(Boolean);
          const finalRoleIds = [...new Set([...currentRoleIds, ...roleIdsToAdd.map(Number)])];

          // Hợp nhất SignTitles
          const currentTitleIds = (detail.signTitles || []).map(t => Number(t.id)).filter(Boolean);
          const finalTitleIds = [...new Set([...currentTitleIds, ...signTitleIdsToAdd.map(Number)])];

          const payload = {
            id: u.id,
            username: u.username,
            userPwd: '',
            officer: { id: detail.officer?.id || u.officer?.id },
            fullName: detail.fullName || u.fullName || u.officer?.officerName || '',
            userLevel: detail.userLevel ?? 4,
            userType: detail.userType ?? 0,
            status: detail.status ?? 1,
            callOnl: detail.callOnl ?? 0,
            auth2FA: detail.auth2FA ?? 0,
            type2fa: detail.type2fa || null,
            company: { id: detail.company?.id || 1 },
            nhomNguoiDungs: finalRoleIds.map(rId => ({ roleId: rId })),
            signTitles: finalTitleIds.map(tId => ({ id: tId })),
            adminRegion: 0
          };

          const putRes = await axios.put(`${auth.gateway}common/admuser/capnhat?id=${u.id}`, payload, {
            headers,
            timeout: 15000,
            validateStatus: () => true
          });

          if (putRes.status === 200 && (putRes.data?.code === 0 || putRes.data?.code === 200 || putRes.data?.data)) {
            totalUpdated++;
            results.push({
              stationName: station.name,
              stationCode: station.code,
              username: u.username,
              status: 'success',
              rolesCount: finalRoleIds.length,
              titlesCount: finalTitleIds.length
            });
          } else {
            totalErrors++;
            results.push({
              stationName: station.name,
              stationCode: station.code,
              username: u.username,
              status: 'failed',
              error: putRes.data?.message || `HTTP ${putRes.status}`
            });
          }
        } catch (errUser) {
          totalErrors++;
          results.push({
            stationName: station.name,
            stationCode: station.code,
            username: u.username,
            status: 'failed',
            error: errUser.message
          });
        }
      }
    } catch (errStation) {
      totalErrors++;
      results.push({
        stationName: station.name,
        stationCode: station.code,
        status: 'failed',
        error: errStation.message
      });
    }
  }

  // Ghi log hệ thống
  try {
    logService.logAction({
      actionType: 'phancong_nhanvien_batch',
      actionTitle: `Phân công hàng loạt cho ${stationIds.length} trạm (${totalUpdated} tài khoản thành công)`,
      summary: `Đã phân công ${roleIdsToAdd.length} nhóm quyền và ${signTitleIdsToAdd.length} chức danh ký số cho ${totalUpdated} tài khoản trên ${stationIds.length} trạm`,
      sourceType: 'user_action',
      totalStations: stationIds.length,
      successCount: totalUpdated,
      failedCount: totalErrors,
      oldValue: 'Phân công cũ',
      newValue: `Gán thêm nhóm: [${roleIdsToAdd.join(', ')}] | Gán thêm chức danh: [${signTitleIdsToAdd.join(', ')}]`,
      details: results
    });
  } catch (errLog) {
    console.warn('Lỗi ghi log phân công hàng loạt:', errLog.message);
  }

  return {
    success: true,
    totalUpdated,
    totalErrors,
    details: results
  };
}

/**
 * Cập nhật phân công (vai trò, chức danh, quyền truy cập...) đồng thời cho nhiều tài khoản đã tích
 * @param {string} stationId
 * @param {Array<number|string>} userIds
 * @param {Object} updateData
 * @param {string} [specificPart] - 'all' | 'roles' | 'titles'
 */
async function updateMultipleUsersPhanCong(stationId, userIds, updateData = {}, specificPart = 'all') {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error('Không tìm thấy trạm y tế');
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error('Không có tài khoản nào được chọn để cập nhật');
  }

  const auth = await cauhinhService.loginToHmis(station);
  const headers = {
    'Authorization': `Bearer ${auth.token}`,
    'region-code': auth.region,
    'Origin': auth.targetUrl.replace(/\/$/, ''),
    'Referer': auth.targetUrl,
    'Content-Type': 'application/json'
  };

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const uId of userIds) {
    const numUserId = Number(uId);
    try {
      // 1. Lấy chi tiết user hiện tại để bảo toàn thông tin gốc của user đó
      let userDetail = null;
      try {
        const detailRes = await axios.get(`${auth.gateway}common/admuser/detail?id=${numUserId}`, {
          headers,
          timeout: 10000,
          validateStatus: () => true
        });
        if (detailRes.status === 200 && detailRes.data?.data) {
          userDetail = detailRes.data.data;
        }
      } catch (e) {}

      const base = userDetail || {};
      const mergeMode = updateData.mergeMode !== undefined ? Boolean(updateData.mergeMode) : true;

      const existingRoleIds = (base.nhomNguoiDungs || []).map(r => Number(r.roleId || r.id)).filter(Boolean);
      const existingTitleIds = (base.signTitles || []).map(t => Number(t.id)).filter(Boolean);

      // 2. Xác định danh sách Nhóm người dùng (Bảo vệ không bị mất nếu không điền)
      let finalRoleIds;
      if (specificPart === 'titles') {
        // Giữ nguyên roles của chính user này
        finalRoleIds = existingRoleIds;
      } else {
        const inputRoleIds = Array.isArray(updateData.roleIds)
          ? updateData.roleIds.map(Number).filter(Boolean)
          : [];
        if (inputRoleIds.length === 0) {
          // Không điền / không chọn nhóm người dùng -> Giữ nguyên 100% nhóm đã phân của user này
          finalRoleIds = existingRoleIds;
        } else if (mergeMode) {
          // Gán thêm nhóm mới, giữ lại tất cả nhóm đã phân trước đó
          finalRoleIds = Array.from(new Set([...existingRoleIds, ...inputRoleIds]));
        } else {
          finalRoleIds = inputRoleIds;
        }
      }

      // 3. Xác định danh sách Chức danh ký số (Bảo vệ không bị mất nếu không điền)
      let finalSignTitleIds;
      if (specificPart === 'roles') {
        // Giữ nguyên chức danh ký số của chính user này
        finalSignTitleIds = existingTitleIds;
      } else {
        const inputTitleIds = Array.isArray(updateData.signTitleIds)
          ? updateData.signTitleIds.map(Number).filter(Boolean)
          : [];
        if (inputTitleIds.length === 0) {
          // Không điền / không chọn chức danh ký số -> Giữ nguyên 100% chức danh đã phân của user này
          finalSignTitleIds = existingTitleIds;
        } else if (mergeMode) {
          // Gán thêm chức danh mới, giữ lại tất cả chức danh đã phân trước đó
          finalSignTitleIds = Array.from(new Set([...existingTitleIds, ...inputTitleIds]));
        } else {
          finalSignTitleIds = inputTitleIds;
        }
      }

      const payload = {
        id: numUserId,
        username: base.username || updateData.username,
        userPwd: (updateData.userPwd && updateData.userPwd.trim()) ? updateData.userPwd.trim() : '',
        officer: { id: base.officer?.id || updateData.officerId },
        fullName: base.fullName || base.officer?.officerName || updateData.fullName || '',
        userLevel: (specificPart === 'all' && updateData.userLevel !== undefined)
          ? Number(updateData.userLevel)
          : (base.userLevel ?? 4),
        userType: (specificPart === 'all' && updateData.userType !== undefined)
          ? Number(updateData.userType)
          : (base.userType ?? 0),
        status: (specificPart === 'all' && updateData.status !== undefined)
          ? (updateData.status ? 1 : 0)
          : (base.status ?? 1),
        callOnl: (specificPart === 'all' && updateData.callOnl !== undefined)
          ? (updateData.callOnl ? 1 : 0)
          : (base.callOnl ?? 0),
        auth2FA: (specificPart === 'all' && updateData.auth2FA !== undefined)
          ? (updateData.auth2FA ? 1 : 0)
          : (base.auth2FA ?? 0),
        type2fa: base.type2fa || updateData.type2fa || null,
        company: { id: base.company?.id || updateData.companyId || 1 },
        nhomNguoiDungs: finalRoleIds.map(rId => ({ roleId: Number(rId) })),
        signTitles: finalSignTitleIds.map(tId => ({ id: Number(tId) })),
        adminRegion: 0
      };

      const updateRes = await axios.put(`${auth.gateway}common/admuser/capnhat?id=${numUserId}`, payload, {
        headers,
        timeout: 20000,
        validateStatus: () => true
      });

      if (updateRes.status === 200 && (updateRes.data?.code === 0 || updateRes.data?.code === 200 || updateRes.data?.data)) {
        successCount++;
        results.push({
          userId: numUserId,
          username: payload.username,
          status: 'success',
          user: payload,
          finalRoleIds,
          finalSignTitleIds
        });
      } else {
        failCount++;
        results.push({
          userId: numUserId,
          username: payload.username,
          status: 'failed',
          error: updateRes.data?.message || `HTTP ${updateRes.status}`
        });
      }
    } catch (errUser) {
      failCount++;
      results.push({
        userId: numUserId,
        status: 'failed',
        error: errUser.message
      });
    }
  }

  // Ghi log hệ thống
  const partTitle = specificPart === 'roles'
    ? 'Nhóm người dùng'
    : (specificPart === 'titles' ? 'Chức danh ký số' : 'Thông tin phân công');
  try {
    logService.logAction({
      actionType: 'phancong_nhanvien_multiple',
      actionTitle: `Cập nhật ${partTitle} cho ${userIds.length} tài khoản (${station.name})`,
      summary: `Đã cập nhật ${partTitle} cho ${successCount}/${userIds.length} tài khoản thành công tại trạm ${station.name}`,
      sourceType: 'user_action',
      totalStations: 1,
      successCount,
      failedCount: failCount,
      newValue: `Nhóm quyền: [${(updateData.roleIds || []).join(', ')}] | Chức danh: [${(updateData.signTitleIds || []).join(', ')}]`,
      details: results
    });
  } catch (errLog) {
    console.warn('Lỗi ghi log cập nhật nhiều tài khoản:', errLog.message);
  }

  return {
    success: successCount > 0,
    total: userIds.length,
    successCount,
    failCount,
    results
  };
}

module.exports = {
  getStationNhanVienData,
  getUserDetail,
  updateUserPhanCong,
  updateMultipleUsersPhanCong,
  batchAssignNhanVien
};
