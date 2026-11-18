/**
 * Service Quản Lý & Điều Chỉnh Cấu Hình Menu / Button / Tab (HMIS quantri-hethong/cauhinh-menu)
 * API Gateway:
 *   - common/cauhinhchucnang/search
 *   - common/cauhinhchucnang/findByNhomId
 *   - common/cauhinhchucnang/update?id=...
 *   - common/cauhinhchucnang/create
 *   - common/cauhinhchucnang/delete?id=...
 *   - common/dmchethong/findByMaNhom?maNhom=NHOM_NGHIEPVU | LOAI_CH_MENU_BUTTON | CH_BUTTON_TYPE
 *   - common/role/findAll
 */

const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const cauhinhService = require('./cauhinhService');
const logService = require('./logService');

// Bộ nhớ đệm ngắn hạn theo trạm để lọc nhanh 2,920 chức năng menu
const stationMenuCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 phút

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
 * Phân tích ghiChu của cấu hình button thành đối tượng iconConfig
 */
function parseButtonIconConfig(ghiChu, ma, ten, trangThai) {
  const defaultObj = {
    hisIcon: '',
    hisType: 'primary',
    hisDanger: false,
    hisShortcut: '',
    giaTri: '',
    hisId: ma || '',
    hisTitle: ten || '',
    hisDisabled: !(Number(trangThai) === 1),
    listDisableTrangThai: []
  };
  if (!ghiChu || typeof ghiChu !== 'string') return defaultObj;
  try {
    const parsed = JSON.parse(ghiChu);
    if (parsed && typeof parsed === 'object') {
      return {
        hisIcon: parsed.hisIcon || '',
        hisType: parsed.hisType || 'primary',
        hisDanger: Boolean(parsed.hisDanger),
        hisShortcut: parsed.hisShortcut || '',
        giaTri: parsed.giaTri || '',
        hisId: parsed.hisId || ma || '',
        hisTitle: parsed.hisTitle || ten || '',
        hisDisabled: parsed.hisDisabled !== undefined ? Boolean(parsed.hisDisabled) : !(Number(trangThai) === 1),
        listDisableTrangThai: Array.isArray(parsed.listDisableTrangThai)
          ? parsed.listDisableTrangThai.map(x => ({
              property: String(x?.property || ''),
              value: String(x?.value ?? '')
            }))
          : []
      };
    }
  } catch (e) {}
  return defaultObj;
}

/**
 * Xây dựng danh sách phẳng có thứ tự phân cấp cha - con (tree-ordered flat list) giống hệt giao diện HMIS
 */
function buildTreeOrderedMenuList(rawItems, listNhom) {
  const nhomMap = new Map();
  (listNhom || []).forEach(n => {
    nhomMap.set(Number(n.giaTri), n.ten);
  });

  // Thu thập tất cả node kể cả node nằm trong subCha lồng nhau
  const itemMap = new Map();
  function collectNode(node) {
    if (!node || !node.id) return;
    if (node.subCha && typeof node.subCha === 'object') {
      collectNode(node.subCha);
    }
    if (!itemMap.has(node.id)) {
      itemMap.set(node.id, { ...node });
    } else {
      // Ưu tiên bản ghi gốc đầy đủ hơn
      itemMap.set(node.id, { ...itemMap.get(node.id), ...node });
    }
  }

  (rawItems || []).forEach(collectNode);

  const allNodes = Array.from(itemMap.values()).map(item => {
    const parentId = item.subCha?.id || null;
    const parentMa = item.subCha?.ma || '';
    const parentTen = item.subCha?.ten || '';
    const nhomId = Number(item.nhomId ?? 0);
    return {
      id: item.id,
      ma: item.ma || '',
      ten: item.ten || '',
      nhomId,
      nhomTen: nhomMap.get(nhomId) || `Nhóm ${nhomId}`,
      loai: item.loai || 'menu',
      stt: Number(item.stt ?? 0),
      trangThai: Number(item.trangThai ?? 1) === 1 ? 1 : 0,
      ghiChu: item.ghiChu ?? '',
      parentId,
      parentMa,
      parentTen,
      excludedRoles: item.excludedRoles || null,
      excludedRoleIds: item.excludedRoles
        ? String(item.excludedRoles).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n))
        : [],
      iconConfig: item.loai === 'button' ? parseButtonIconConfig(item.ghiChu, item.ma, item.ten, item.trangThai) : null,
      ngayTao: item.ngayTao || '',
      ngaySua: item.ngaySua || '',
      nguoiTao: item.nguoiTao ?? null,
      nguoiSua: item.nguoiSua ?? null,
      phienBan: item.phienBan ?? null
    };
  });

  // Group children by parentId
  const childrenByParent = new Map();
  const nodeById = new Map();
  allNodes.forEach(n => nodeById.set(n.id, n));

  const roots = [];
  allNodes.forEach(n => {
    if (n.parentId && nodeById.has(n.parentId) && n.parentId !== n.id) {
      if (!childrenByParent.has(n.parentId)) childrenByParent.set(n.parentId, []);
      childrenByParent.get(n.parentId).push(n);
    } else {
      roots.push(n);
    }
  });

  const sortFn = (a, b) => (a.nhomId - b.nhomId) || (a.stt - b.stt) || (a.id - b.id);
  roots.sort(sortFn);
  childrenByParent.forEach(list => list.sort((a, b) => (a.stt - b.stt) || (a.id - b.id)));

  const ordered = [];
  const visited = new Set();

  function traverse(node, level, ancestorIds) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    const kids = childrenByParent.get(node.id) || [];
    node.level = level;
    node.hasChildren = kids.length > 0;
    node.childrenCount = kids.length;
    node.ancestorIds = ancestorIds;
    ordered.push(node);
    kids.forEach(child => traverse(child, level + 1, [...ancestorIds, node.id]));
  }

  roots.forEach(r => traverse(r, 0, []));

  // Phòng trường hợp có chu trình khép kín chưa được duyệt
  allNodes.forEach(n => {
    if (!visited.has(n.id)) {
      n.level = 0;
      n.hasChildren = false;
      n.childrenCount = 0;
      n.ancestorIds = [];
      ordered.push(n);
    }
  });

  return ordered;
}

/**
 * Tải toàn bộ danh mục cấu hình menu (2,920+ mục) và các danh mục hệ thống của 1 trạm
 */
async function getStationMenuData(stationId, options = {}) {
  const station = db.getStationById(stationId, true);
  if (!station) {
    throw new Error(`Không tìm thấy trạm y tế với ID ${stationId}`);
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const cached = stationMenuCache.get(station.id);
  if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const { auth, headers } = await getAuthHeaders(station);

  const [menuRes, nhomRes, loaiRes, typeRes, roleRes] = await Promise.all([
    axios.get(`${auth.gateway}common/cauhinhchucnang/search?filter=id!=0&page=0&size=4000&sort=nhomId,asc`, {
      headers, timeout: 25000, validateStatus: () => true
    }),
    axios.get(`${auth.gateway}common/dmchethong/findByMaNhom?maNhom=NHOM_NGHIEPVU`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/dmchethong/findByMaNhom?maNhom=LOAI_CH_MENU_BUTTON`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/dmchethong/findByMaNhom?maNhom=CH_BUTTON_TYPE`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} })),
    axios.get(`${auth.gateway}common/role/findAll`, {
      headers, timeout: 12000, validateStatus: () => true
    }).catch(() => ({ data: {} }))
  ]);

  if (menuRes.status !== 200 || !menuRes.data?.data) {
    throw new Error(menuRes.data?.message || `Lỗi tải cấu hình menu từ HMIS (HTTP ${menuRes.status})`);
  }

  const rawItems = Array.isArray(menuRes.data?.data?.content) ? menuRes.data.data.content : [];

  const listNhom = (Array.isArray(nhomRes.data?.data) ? nhomRes.data.data : []).map(x => ({
    giaTri: !Number.isNaN(parseInt(x.giaTri, 10)) ? parseInt(x.giaTri, 10) : x.giaTri,
    ma: x.ma || '',
    ten: (x.ten || '').trim()
  })).sort((a, b) => Number(a.giaTri) - Number(b.giaTri));

  const listLoai = (Array.isArray(loaiRes.data?.data) ? loaiRes.data.data : []).map(x => ({
    giaTri: x.giaTri,
    ma: x.ma || '',
    ten: (x.ten || '').trim()
  }));

  const listButtonType = (Array.isArray(typeRes.data?.data) ? typeRes.data.data : []).map(x => ({
    giaTri: x.giaTri,
    ma: x.ma || '',
    ten: (x.ten || '').trim()
  }));

  const listRoles = (Array.isArray(roleRes.data?.data) ? roleRes.data.data : []).map(r => ({
    roleId: r.roleId,
    roleCode: r.roleCode || '',
    roleName: r.roleName || ''
  }));

  const items = buildTreeOrderedMenuList(rawItems, listNhom);

  const activeCount = items.filter(i => i.trangThai === 1).length;
  const lockedCount = items.length - activeCount;

  const result = {
    stationId: station.id,
    stationCode: station.code,
    stationName: station.name,
    totalItems: items.length,
    activeCount,
    lockedCount,
    items,
    listNhom,
    listLoai: listLoai.length > 0 ? listLoai : [
      { giaTri: 'menu', ten: 'Cấu hình menu' },
      { giaTri: 'button', ten: 'Cấu hình button' },
      { giaTri: 'tab', ten: 'Cấu hình tab' }
    ],
    listButtonType: listButtonType.length > 0 ? listButtonType : [
      { giaTri: 'primary', ten: 'Loại button: primary' },
      { giaTri: 'default', ten: 'Loại button: default' },
      { giaTri: 'dashed', ten: 'Loại button: dashed' },
      { giaTri: 'text', ten: 'Loại button: text' },
      { giaTri: 'link', ten: 'Loại button: link' },
      { giaTri: 'his-primary', ten: 'Loại button: HIS primary' },
      { giaTri: 'success', ten: 'Loại button: success' },
      { giaTri: 'warning', ten: 'Loại button: warning' }
    ],
    listRoles
  };

  stationMenuCache.set(station.id, { timestamp: Date.now(), data: result });
  return result;
}

/**
 * Chuẩn hóa chuỗi ghiChu trước khi gửi lên HMIS theo đúng chuẩn onSetValueBeforeSubmit()
 */
function buildGhiChuString(loai, ma, ten, trangThai, rawGhiChu, iconConfig, existingGhiChu) {
  if (loai === 'menu') {
    return rawGhiChu != null ? String(rawGhiChu) : '';
  }

  if (loai === 'button') {
    let baseObj = {};
    if (existingGhiChu && typeof existingGhiChu === 'string') {
      try {
        const parsed = JSON.parse(existingGhiChu);
        if (parsed && typeof parsed === 'object') baseObj = { ...parsed };
      } catch (e) {}
    }
    const cfg = iconConfig || {};
    const out = { ...baseObj };
    if (cfg.hisIcon !== undefined) {
      if (cfg.hisIcon) out.hisIcon = cfg.hisIcon;
      else delete out.hisIcon;
    }
    if (cfg.hisType) out.hisType = cfg.hisType;
    else if (!out.hisType) out.hisType = 'primary';

    if (cfg.hisDanger !== undefined) {
      if (cfg.hisDanger) out.hisDanger = true;
      else delete out.hisDanger;
    }
    if (cfg.hisShortcut !== undefined) {
      if (cfg.hisShortcut) out.hisShortcut = cfg.hisShortcut;
      else delete out.hisShortcut;
    }
    if (cfg.giaTri !== undefined) {
      if (cfg.giaTri) out.giaTri = cfg.giaTri;
      else delete out.giaTri;
    }
    out.hisId = ma;
    out.hisTitle = ten;
    out.hisDisabled = !(Number(trangThai) === 1);
    if (Array.isArray(cfg.listDisableTrangThai)) {
      out.listDisableTrangThai = cfg.listDisableTrangThai
        .filter(x => x && String(x.property || '').trim() !== '')
        .map(x => ({ property: String(x.property).trim(), value: String(x.value ?? '') }));
    } else if (!Array.isArray(out.listDisableTrangThai)) {
      out.listDisableTrangThai = [];
    }
    return JSON.stringify(out);
  }

  // loai === 'tab' hoặc loại khác: kiểm tra JSON hợp lệ nếu có nội dung
  const trimmed = String(rawGhiChu ?? '').trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch (err) {
    throw new Error(`Nội dung Cấu hình (JSON) không hợp lệ: ${err.message}`);
  }
}

/**
 * So sánh bản ghi cũ và bản ghi mới để báo cáo chi tiết các trường thay đổi khi Test Thử (Dry-Run)
 */
function computeMenuDiff(existingItem, candidatePayload) {
  const diffs = [];
  if (Number(existingItem.trangThai) !== Number(candidatePayload.trangThai)) {
    diffs.push(`Trạng thái: ${Number(existingItem.trangThai) === 1 ? 'Kích hoạt (1)' : 'Khóa (0)'} ➔ ${Number(candidatePayload.trangThai) === 1 ? 'Kích hoạt (1)' : 'Khóa (0)'}`);
  }
  if (String(existingItem.ten || '') !== String(candidatePayload.ten || '')) {
    diffs.push(`Tên: "${existingItem.ten || ''}" ➔ "${candidatePayload.ten || ''}"`);
  }
  if (String(existingItem.ma || '') !== String(candidatePayload.ma || '')) {
    diffs.push(`Mã: "${existingItem.ma || ''}" ➔ "${candidatePayload.ma || ''}"`);
  }
  if (Number(existingItem.stt ?? 0) !== Number(candidatePayload.stt ?? 0)) {
    diffs.push(`STT: ${existingItem.stt ?? 0} ➔ ${candidatePayload.stt ?? 0}`);
  }
  if (String(existingItem.loai || '') !== String(candidatePayload.loai || '')) {
    diffs.push(`Loại: "${existingItem.loai || ''}" ➔ "${candidatePayload.loai || ''}"`);
  }
  const oldParentId = existingItem.subCha?.id || existingItem.parentId || null;
  const newParentId = candidatePayload.subCha?.id || null;
  if (Number(oldParentId || 0) !== Number(newParentId || 0)) {
    diffs.push(`Cấu hình cha ID: ${oldParentId || 'Gốc'} ➔ ${newParentId || 'Gốc'}`);
  }
  const oldRoles = String(existingItem.excludedRoles || '').trim();
  const newRoles = String(candidatePayload.excludedRoles || '').trim();
  if (oldRoles !== newRoles) {
    diffs.push(`Nhóm không sử dụng: "${oldRoles || 'Không'}" ➔ "${newRoles || 'Không'}"`);
  }
  const oldGhiChu = String(existingItem.ghiChu ?? '').trim();
  const newGhiChu = String(candidatePayload.ghiChu ?? '').trim();
  if (oldGhiChu !== newGhiChu) {
    diffs.push(`Ghi chú / Icon / JSON: Thay đổi`);
  }
  return diffs;
}

/**
 * TEST THỬ (DRY-RUN) HOẶC CẬP NHẬT THẬT CẤU HÌNH MENU CHO 1 TRẠM / CÁC TRẠM ĐÃ CHỌN / ALL 43 TRẠM
 * Đảm bảo an toàn tuyệt đối cho hệ thống thật:
 *   - Khi dryRun = true: Chỉ đọc và đối chiếu trên từng trạm, KHÔNG gọi PUT/POST/DELETE.
 *   - Khi dryRun = false: Chỉ cập nhật đúng các trạm có thay đổi thực sự, lưu đầy đủ snapshot cũ để có thể khôi phục.
 */
async function executeMenuUpdateForStations(options = {}) {
  const dryRun = options.dryRun !== false; // Mặc định là true (Test thử an toàn) nếu không truyền false
  const updateMode = options.updateMode || 'full'; // 'full' | 'status_only'
  const itemInput = options.item || {};

  const targetNhomId = parseInt(itemInput.nhomId, 10);
  const targetMa = String(itemInput.ma || '').trim();
  const targetTen = String(itemInput.ten || '').trim();
  const targetLoai = String(itemInput.loai || 'menu').trim();

  if (!targetMa || !targetTen || Number.isNaN(targetNhomId)) {
    throw new Error('Thiếu thông tin bắt buộc: Mã cấu hình, Tên cấu hình hoặc Nhóm cấu hình');
  }

  // Kiểm tra cú pháp JSON / ghiChu ngay từ đầu trước khi quét qua các trạm
  buildGhiChuString(
    targetLoai,
    targetMa,
    targetTen,
    itemInput.trangThai,
    itemInput.ghiChu,
    itemInput.iconConfig,
    itemInput.ghiChu
  );

  const allStations = db.getStations(true);
  let targetStations = allStations;
  if (Array.isArray(options.stationIds) && options.stationIds.length > 0 && !options.stationIds.includes('all')) {
    targetStations = allStations.filter(s => options.stationIds.includes(s.id) || options.stationIds.includes(s.code));
  }

  const results = [];
  let willUpdateCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (const station of targetStations) {
    const startTime = Date.now();
    try {
      const { auth, headers } = await getAuthHeaders(station);

      // Tìm các cấu hình menu thuộc nhóm nhomId trên trạm này
      const searchUrl = `${auth.gateway}common/cauhinhchucnang/search?filter=${encodeURIComponent(`nhomId==${targetNhomId}`)}&page=0&size=1500&sort=id,asc`;
      const searchRes = await axios.get(searchUrl, { headers, timeout: 15000, validateStatus: () => true });

      if (searchRes.status !== 200 || !Array.isArray(searchRes.data?.data?.content)) {
        throw new Error(searchRes.data?.message || `Không thể truy vấn menu trên trạm (HTTP ${searchRes.status})`);
      }

      const groupItems = searchRes.data.data.content;

      // Tìm bản ghi khớp chính xác trên trạm này:
      // Ưu tiên 1: Khớp cả id và ma (nếu trạm có cùng ID gốc)
      // Ưu tiên 2: Khớp ma + loai + mã cấu hình cha (subCha.ma)
      // Ưu tiên 3: Khớp ma + loai
      const sourceId = itemInput.id ? Number(itemInput.id) : null;
      const sourceParentMa = String(itemInput.parentMa || '').trim();
      const origMa = String(itemInput.originalMa || targetMa).trim();

      let matched = null;
      if (sourceId) {
        matched = groupItems.find(x => Number(x.id) === sourceId && String(x.ma || '').trim() === origMa);
      }
      if (!matched && sourceParentMa) {
        matched = groupItems.find(x =>
          String(x.ma || '').trim() === origMa &&
          String(x.loai || '') === targetLoai &&
          String(x.subCha?.ma || '').trim() === sourceParentMa
        );
      }
      if (!matched) {
        matched = groupItems.find(x =>
          String(x.ma || '').trim() === origMa &&
          String(x.loai || '') === targetLoai
        ) || groupItems.find(x => String(x.ma || '').trim() === origMa);
      }

      if (!matched) {
        notFoundCount++;
        results.push({
          stationId: station.id,
          stationCode: station.code,
          stationName: station.name,
          status: 'NOT_FOUND',
          success: true,
          message: `Không tìm thấy menu mã "${origMa}" trong nhóm ${targetNhomId} trên trạm này (bỏ qua an toàn)`,
          diffs: [],
          duration: Date.now() - startTime
        });
        continue;
      }

      // Xác định subCha trên trạm này
      let resolvedSubCha = matched.subCha ? { id: matched.subCha.id } : null;
      if (updateMode !== 'status_only' && itemInput.parentChanged) {
        if (!itemInput.parentId && !sourceParentMa) {
          resolvedSubCha = null;
        } else if (sourceParentMa) {
          const parentOnStation = groupItems.find(x => String(x.ma || '').trim() === sourceParentMa);
          if (parentOnStation) {
            resolvedSubCha = { id: parentOnStation.id };
          }
        } else if (itemInput.parentId) {
          resolvedSubCha = { id: Number(itemInput.parentId) };
        }
      }

      // Chuẩn bị bản ghi cập nhật trên trạm này
      const newTrangThai = Number(itemInput.trangThai) === 1 ? 1 : 0;
      const newTen = updateMode === 'status_only' ? matched.ten : targetTen;
      const newMa = updateMode === 'status_only' ? matched.ma : targetMa;
      const newLoai = updateMode === 'status_only' ? matched.loai : targetLoai;
      const newStt = updateMode === 'status_only' ? Number(matched.stt ?? 0) : Number(itemInput.stt ?? matched.stt ?? 0);

      let newExcludedRoles = matched.excludedRoles ?? null;
      if (updateMode !== 'status_only' && itemInput.excludedRoles !== undefined) {
        newExcludedRoles = itemInput.excludedRoles ? String(itemInput.excludedRoles).trim() || null : null;
      }

      const newGhiChu = updateMode === 'status_only'
        ? (matched.loai === 'button'
            ? buildGhiChuString('button', matched.ma, matched.ten, newTrangThai, matched.ghiChu, parseButtonIconConfig(matched.ghiChu, matched.ma, matched.ten, newTrangThai), matched.ghiChu)
            : (matched.ghiChu ?? ''))
        : buildGhiChuString(newLoai, newMa, newTen, newTrangThai, itemInput.ghiChu, itemInput.iconConfig, matched.ghiChu);

      const updatePayload = {
        ...matched,
        id: matched.id,
        ma: newMa,
        ten: newTen,
        nhomId: targetNhomId,
        loai: newLoai,
        stt: newStt,
        trangThai: newTrangThai,
        subCha: resolvedSubCha,
        ghiChu: newGhiChu,
        excludedRoles: newExcludedRoles
      };

      const diffs = computeMenuDiff(matched, updatePayload);

      if (diffs.length === 0) {
        unchangedCount++;
        results.push({
          stationId: station.id,
          stationCode: station.code,
          stationName: station.name,
          matchedId: matched.id,
          status: 'UNCHANGED',
          success: true,
          message: 'Đã giống cấu hình mới 100% (không cần ghi đè)',
          diffs: [],
          oldState: {
            id: matched.id,
            ma: matched.ma,
            ten: matched.ten,
            trangThai: matched.trangThai,
            stt: matched.stt
          },
          duration: Date.now() - startTime
        });
        continue;
      }

      if (dryRun) {
        willUpdateCount++;
        results.push({
          stationId: station.id,
          stationCode: station.code,
          stationName: station.name,
          matchedId: matched.id,
          status: 'WILL_UPDATE',
          success: true,
          message: `[TEST THỬ OK] Sẵn sàng cập nhật (${diffs.join(' | ')})`,
          diffs,
          oldState: {
            id: matched.id,
            ma: matched.ma,
            ten: matched.ten,
            trangThai: matched.trangThai,
            stt: matched.stt,
            ghiChu: matched.ghiChu,
            excludedRoles: matched.excludedRoles
          },
          newState: {
            id: updatePayload.id,
            ma: updatePayload.ma,
            ten: updatePayload.ten,
            trangThai: updatePayload.trangThai,
            stt: updatePayload.stt,
            ghiChu: updatePayload.ghiChu,
            excludedRoles: updatePayload.excludedRoles
          },
          duration: Date.now() - startTime
        });
      } else {
        // CHẠY THẬT: Gửi lệnh PUT cập nhật bản ghi
        const putUrl = `${auth.gateway}common/cauhinhchucnang/update?id=${matched.id}`;
        const putRes = await axios.put(putUrl, updatePayload, { headers, timeout: 12000, validateStatus: () => true });

        if (putRes.status === 200 && (putRes.data?.code === 0 || putRes.data?.code === 200)) {
          updatedCount++;
          stationMenuCache.delete(station.id); // Xóa cache của trạm vừa sửa
          results.push({
            stationId: station.id,
            stationCode: station.code,
            stationName: station.name,
            matchedId: matched.id,
            status: 'UPDATED',
            success: true,
            message: `Đã cập nhật thành công (${diffs.join(' | ')})`,
            diffs,
            oldSnapshot: matched,
            duration: Date.now() - startTime
          });
        } else {
          throw new Error(putRes.data?.message || `Lỗi PUT cập nhật menu (HTTP ${putRes.status})`);
        }
      }
    } catch (err) {
      errorCount++;
      results.push({
        stationId: station.id,
        stationCode: station.code,
        stationName: station.name,
        status: 'ERROR',
        success: false,
        message: err.message,
        diffs: [],
        duration: Date.now() - startTime
      });
    }
  }

  // Ghi nhật ký hệ thống khi chạy thật
  if (!dryRun) {
    try {
      logService.addLog({
        actionType: 'cauhinh_menu',
        actionTitle: 'Điều chỉnh cấu hình Menu / Button HMIS',
        summary: `Cập nhật menu [${targetMa} - ${targetTen}] (Nhóm ${targetNhomId}): Thành công ${updatedCount}/${targetStations.length} trạm (Không đổi: ${unchangedCount}, Lỗi: ${errorCount})`,
        details: {
          nhomId: targetNhomId,
          ma: targetMa,
          ten: targetTen,
          loai: targetLoai,
          trangThai: itemInput.trangThai,
          updateMode
        },
        total: targetStations.length,
        successCount: updatedCount + unchangedCount,
        failedCount: errorCount,
        results: results.map(r => ({
          id: r.stationId,
          name: `[${r.stationCode}] ${r.stationName}`,
          success: r.success,
          message: r.message,
          duration: r.duration
        }))
      });
    } catch (e) {}
  }

  return {
    dryRun,
    updateMode,
    totalStations: targetStations.length,
    willUpdateCount,
    updatedCount,
    unchangedCount,
    notFoundCount,
    errorCount,
    results
  };
}

/**
 * Xuất file Excel toàn bộ danh sách cấu hình menu của 1 trạm
 */
async function exportStationMenuExcel(stationId, nhomIdFilter = null) {
  const data = await getStationMenuData(stationId);
  let list = data.items || [];
  if (nhomIdFilter != null && nhomIdFilter !== '' && nhomIdFilter !== 'all') {
    list = list.filter(i => Number(i.nhomId) === Number(nhomIdFilter));
  }

  const rows = list.map((item, idx) => ({
    'STT': idx + 1,
    'ID': item.id,
    'Cấp độ': item.level,
    'Mã cấu hình': item.ma,
    'Tên cấu hình': '  '.repeat(item.level || 0) + item.ten,
    'Mã Nhóm': item.nhomId,
    'Tên Nhóm': item.nhomTen,
    'Loại': item.loai,
    'Mã Cha': item.parentMa || '',
    'Tên Cha': item.parentTen || '',
    'Thứ tự (STT)': item.stt,
    'Trạng thái': item.trangThai === 1 ? 'Kích hoạt (1)' : 'Khóa (0)',
    'Nhóm quyền loại trừ': item.excludedRoles || '',
    'Ghi chú / Cấu hình JSON': item.ghiChu || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ 'Thông báo': 'Không có dữ liệu' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'CauHinhMenu');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getStationMenuData,
  executeMenuUpdateForStations,
  exportStationMenuExcel
};
