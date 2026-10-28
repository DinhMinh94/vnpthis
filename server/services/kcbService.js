const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const cauhinhService = require('./cauhinhService');

// In-memory cache for live station records: stationId -> { timestamp, records }
const stationRecordsCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút
const HMIS_TIMEOUT_MS = 4500; // 4.5 giây timeout mỗi trạm

/**
 * Phân tích chuỗi ngày Việt Nam 'dd/MM/yyyy' thành đối tượng Date
 */
function parseDateVi(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split(' ')[0].split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      return new Date(y, m, d);
    }
  }
  return null;
}

/**
 * Sinh chuỗi ngày theo định dạng dd/MM/yyyy
 */
function formatDateVi(date) {
  if (!date) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Lấy danh sách phòng khám thực tế từ cổng HMIS
 */
async function getPhongKhamList(stationId) {
  try {
    let station = null;
    if (stationId && stationId !== 'all') {
      station = db.getStationById(stationId, true);
    }
    if (!station) {
      const stations = db.getStations(true);
      station = stations.find(s => s.status === 'success' || (s.username && s.password)) || stations[0];
    }

    if (station && station.username && station.password) {
      try {
        const auth = await cauhinhService.loginToHmis(station);
        const headers = {
          'Authorization': 'Bearer ' + auth.token,
          'region-code': auth.region,
          'Origin': auth.targetUrl.replace(/\/$/, ''),
          'Referer': auth.targetUrl
        };

        // Lấy danh sách phòng loại type==2 (Phòng chuyên môn / phòng khám)
        const res = await axios.get(`${auth.gateway}common/organization/search?filter=type==2&sort=id,asc&page=0&size=50`, {
          headers,
          timeout: HMIS_TIMEOUT_MS,
          validateStatus: () => true
        });

        if (res.status === 200 && res.data && res.data.code === 0 && Array.isArray(res.data.data?.content)) {
          const list = res.data.data.content.map(item => ({
            id: item.id,
            maPhong: item.code || `PK${item.id}`,
            tenPhong: item.name || `Phòng khám ${item.code}`
          }));
          if (list.length > 0) return list;
        }
      } catch (err) {
        console.warn(`[KCB] Không thể lấy phòng khám live từ HMIS cho ${station.code}:`, err.message);
      }
    }
  } catch (e) {
    console.warn('[KCB] Lỗi getPhongKhamList:', e.message);
  }

  // Fallback: Tìm các phòng xuất hiện trong bản ghi đã cache
  const cachedRooms = new Map();
  for (const entry of stationRecordsCache.values()) {
    if (Array.isArray(entry.records)) {
      entry.records.forEach(r => {
        if (r.phongId && r.tenPhong && !cachedRooms.has(r.phongId)) {
          cachedRooms.set(r.phongId, { id: r.phongId, maPhong: r.maPhong, tenPhong: r.tenPhong });
        }
      });
    }
  }
  if (cachedRooms.size > 0) {
    return Array.from(cachedRooms.values());
  }

  return [
    { id: 208, maPhong: 'KB1', tenPhong: 'Phòng khám trạm y tế' },
    { id: 220, maPhong: 'KSK', tenPhong: 'Phòng khám sức khỏe' },
    { id: 1, maPhong: 'PK01', tenPhong: 'Phòng khám Đa khoa / Cấp cứu' },
    { id: 2, maPhong: 'PK02', tenPhong: 'Phòng khám Nội - Nhi' },
    { id: 3, maPhong: 'PK03', tenPhong: 'Phòng khám Y học cổ truyền' },
    { id: 4, maPhong: 'PK04', tenPhong: 'Phòng Chăm sóc SKSS - Phụ sản' }
  ];
}

/**
 * Tải danh sách ca khám thực tế của 1 trạm từ cổng HMIS
 */
async function fetchStationLiveKcbRecords(station, forceRefresh = false) {
  if (!station || !station.username || !station.password) {
    return [];
  }

  const cached = stationRecordsCache.get(station.id);
  const now = Date.now();
  if (!forceRefresh && cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.records;
  }

  try {
    const auth = await cauhinhService.loginToHmis(station);
    const headers = {
      'Authorization': 'Bearer ' + auth.token,
      'region-code': auth.region,
      'Origin': auth.targetUrl.replace(/\/$/, ''),
      'Referer': auth.targetUrl
    };

    // Lấy tối đa 500 ca khám gần nhất từ hệ thống thật
    const url = `${auth.gateway}common/kbhphongkhamdangky/search?filter=id>0&sort=ngay,desc&page=0&size=500`;
    const res = await axios.get(url, { headers, timeout: HMIS_TIMEOUT_MS, validateStatus: () => true });

    if (res.status === 200 && res.data && res.data.code === 0 && Array.isArray(res.data.data?.content)) {
      const items = res.data.data.content;
      const records = items.map((item, idx) => {
        let trangThaiId = 1;
        let trangThaiTen = 'Chờ khám';
        if (item.trangThaiStt === 9 || item.ngayKt || item.khamBenh?.ngayKetLuan) {
          trangThaiId = 3;
          trangThaiTen = 'Đã kết thúc';
        } else if (item.trangThaiStt === 4 || item.ngayBd) {
          trangThaiId = 2;
          trangThaiTen = 'Đang khám';
        }

        const benhNhan = item.khamBenh?.tiepNhan?.hoSoBenhAn?.benhNhan ||
                         item.khamBenh?.tiepNhan?.benhNhan ||
                         item.benhNhan || {};
        const namSinh = benhNhan.namSinh || (benhNhan.ngaySinh ? parseInt(benhNhan.ngaySinh.slice(-4)) : null);
        const dateParsed = parseDateVi(item.ngay);
        const ngayKham = item.ngay ? item.ngay.split(' ')[0] : (dateParsed ? formatDateVi(dateParsed) : '');
        const thangKham = dateParsed ? `${String(dateParsed.getMonth() + 1).padStart(2, '0')}/${dateParsed.getFullYear()}` : (ngayKham ? ngayKham.slice(3) : '');
        const namKham = dateParsed ? String(dateParsed.getFullYear()) : (ngayKham ? ngayKham.slice(6) : '');

        const soTheBhyt = item.khamBenh?.tiepNhan?.hoSoBenhAn?.maBhyt ||
                          item.khamBenh?.tiepNhan?.bhyt?.maSoBhyt || '';
        const isBhyt = Boolean(soTheBhyt || item.bhytDv === 1 || item.khamBenh?.tiepNhan?.bhyt);

        return {
          id: item.id || `LIVE_${station.code}_${idx}`,
          stt: idx + 1,
          stationId: station.id,
          stationCode: station.code,
          stationName: station.name,
          maBenhNhan: benhNhan.maBenhNhan || `BN${item.id}`,
          tenBenhNhan: benhNhan.tenBenhNhan || 'Bệnh nhân',
          namSinh: namSinh || 1980,
          tuoi: namSinh ? (new Date().getFullYear() - namSinh) : 40,
          gioiTinh: benhNhan.gioiTinhId === 1 ? 'Nam' : (benhNhan.gioiTinhId === 2 ? 'Nữ' : 'Khác'),
          doiTuong: isBhyt ? 'BHYT' : 'Viện phí',
          soTheBhyt: soTheBhyt,
          phongId: item.phong?.id || 0,
          maPhong: item.phong?.code || 'PK',
          tenPhong: item.phong?.name || 'Phòng khám trạm',
          bacSiKham: item.tenDieuDuong || (item.khamBenh?.bsKetThucId ? 'Bác sĩ trạm' : 'Bác sĩ điều trị'),
          thoiGianTiepNhan: item.ngay || '',
          ngayKham,
          thangKham,
          namKham,
          trangThaiId,
          trangThaiTen,
          chanDoan: item.chanDoanRaVien || item.khamBenh?.chanDoanRaVien || item.chanDoanBanDau || item.khamBenh?.chanDoanBanDau || 'Khám bệnh thông thường'
        };
      });

      // Lưu cache
      stationRecordsCache.set(station.id, {
        timestamp: now,
        records
      });

      return records;
    }
  } catch (err) {
    console.warn(`[KCB] Không thể lấy dữ liệu live từ trạm ${station.name} (${station.code}):`, err.message);
  }

  // Nếu trạm lỗi nhưng có cache cũ, trả về cache cũ
  if (cached && Array.isArray(cached.records)) {
    return cached.records;
  }

  return [];
}

/**
 * Xử lý dữ liệu Dashboard thống kê KCB cho frontend từ dữ liệu THẬT của trạm
 * @param {Object} query - { stationId, viewType, tuNgay, denNgay, phongId, trangThaiId, refresh }
 */
async function getKcbDashboardData(query = {}) {
  const {
    stationId = 'all',
    viewType = 'day', // 'day' | 'month' | 'year'
    tuNgay = '',
    denNgay = '',
    phongId = 'all',
    trangThaiId = 'all',
    refresh = 'false'
  } = query;

  const forceRefresh = refresh === 'true' || refresh === true;
  const allStations = db.getStations(true);
  let targetStations = allStations;
  if (stationId && stationId !== 'all') {
    targetStations = allStations.filter(s => s.id === stationId || s.code === stationId);
  }

  // 1. Lấy dữ liệu thực tế từ cổng HMIS
  let allRecords = [];
  let isLive = true;

  if (targetStations.length === 1) {
    // Chỉ 1 trạm: Tải trực tiếp nhanh gọn
    allRecords = await fetchStationLiveKcbRecords(targetStations[0], forceRefresh);
  } else {
    // Tất cả trạm: Tải song song theo batch (tối đa 8 trạm đồng thời)
    const stationsWithAuth = targetStations.filter(s => s.username && s.password);
    const BATCH_SIZE = 8;
    for (let i = 0; i < stationsWithAuth.length; i += BATCH_SIZE) {
      const batch = stationsWithAuth.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(st => fetchStationLiveKcbRecords(st, forceRefresh))
      );
      batchResults.forEach(recs => {
        if (Array.isArray(recs)) {
          allRecords.push(...recs);
        }
      });
    }
  }

  // 2. Lọc theo các tiêu chí (Phòng khám, Trạng thái, Ngày bắt đầu, Ngày kết thúc)
  let filtered = allRecords;

  // Lọc theo phòng khám
  if (phongId && phongId !== 'all') {
    filtered = filtered.filter(r => String(r.phongId) === String(phongId) || String(r.maPhong) === String(phongId));
  }

  // Lọc theo trạng thái khám:
  // 3: Đã kết thúc, 2: Đang khám, 1: Chờ khám
  if (trangThaiId && trangThaiId !== 'all') {
    const targetStatus = parseInt(trangThaiId, 10);
    filtered = filtered.filter(r => r.trangThaiId === targetStatus);
  }

  // Lọc theo từ ngày
  if (tuNgay) {
    const fromDate = parseDateVi(tuNgay);
    if (fromDate) {
      filtered = filtered.filter(r => {
        const rDate = parseDateVi(r.ngayKham);
        return rDate ? rDate >= fromDate : true;
      });
    }
  }

  // Lọc theo đến ngày
  if (denNgay) {
    const toDate = parseDateVi(denNgay);
    if (toDate) {
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(r => {
        const rDate = parseDateVi(r.ngayKham);
        return rDate ? rDate <= toDate : true;
      });
    }
  }

  // 3. Tính toán Summary KPI
  const total = filtered.length;
  const daKetThuc = filtered.filter(r => r.trangThaiId === 3).length;
  const dangKham = filtered.filter(r => r.trangThaiId === 2).length;
  const choKham = filtered.filter(r => r.trangThaiId === 1).length;
  const bhytCount = filtered.filter(r => r.doiTuong === 'BHYT').length;
  const vienPhiCount = total - bhytCount;

  // 4. Thống kê theo Trạng thái (Pie / Donut Chart)
  const byStatus = [
    { label: 'Đã kết thúc', value: daKetThuc, color: '#10b981', percent: total ? Math.round((daKetThuc / total) * 100) : 0 },
    { label: 'Đang khám', value: dangKham, color: '#f59e0b', percent: total ? Math.round((dangKham / total) * 100) : 0 },
    { label: 'Chờ khám', value: choKham, color: '#6366f1', percent: total ? Math.round((choKham / total) * 100) : 0 }
  ];

  // 5. Thống kê theo Phòng khám (Horizontal Bar Chart)
  const phongMap = {};
  filtered.forEach(r => {
    const key = r.tenPhong || 'Phòng khám chung';
    if (!phongMap[key]) {
      phongMap[key] = {
        tenPhong: key,
        maPhong: r.maPhong || 'PK',
        total: 0,
        daKetThuc: 0,
        dangKham: 0,
        choKham: 0
      };
    }
    phongMap[key].total++;
    if (r.trangThaiId === 3) phongMap[key].daKetThuc++;
    else if (r.trangThaiId === 2) phongMap[key].dangKham++;
    else if (r.trangThaiId === 1) phongMap[key].choKham++;
  });
  const byPhongKham = Object.values(phongMap).sort((a, b) => b.total - a.total);

  // 6. Thống kê theo Thời gian (Stacked Bar Chart: categories + series)
  const timeMap = {};
  filtered.forEach(r => {
    let key = r.ngayKham;
    if (viewType === 'month') key = r.thangKham || r.ngayKham;
    else if (viewType === 'year') key = r.namKham || r.ngayKham;

    if (!key) return;

    if (!timeMap[key]) {
      timeMap[key] = { timeLabel: key, total: 0, daKetThuc: 0, dangKham: 0, choKham: 0 };
    }
    timeMap[key].total++;
    if (r.trangThaiId === 3) timeMap[key].daKetThuc++;
    else if (r.trangThaiId === 2) timeMap[key].dangKham++;
    else if (r.trangThaiId === 1) timeMap[key].choKham++;
  });

  // Sắp xếp các mốc thời gian theo thứ tự tăng dần
  const sortedTimeKeys = Object.keys(timeMap).sort((a, b) => {
    const dateA = parseDateVi(viewType === 'month' ? `01/${a}` : (viewType === 'year' ? `01/01/${a}` : a));
    const dateB = parseDateVi(viewType === 'month' ? `01/${b}` : (viewType === 'year' ? `01/01/${b}` : b));
    return (dateA || 0) - (dateB || 0);
  }).slice(-20); // Lấy tối đa 20 mốc gần nhất

  const byTime = {
    categories: sortedTimeKeys,
    series: {
      daKetThuc: sortedTimeKeys.map(k => timeMap[k].daKetThuc),
      dangKham: sortedTimeKeys.map(k => timeMap[k].dangKham),
      choKham: sortedTimeKeys.map(k => timeMap[k].choKham)
    }
  };

  // 7. Thống kê so sánh giữa các Trạm Y tế (Station Comparison Chart)
  const stationMap = {};
  filtered.forEach(r => {
    const key = r.stationCode || r.stationName || 'Khác';
    if (!stationMap[key]) {
      stationMap[key] = {
        stationName: r.stationName,
        stationCode: r.stationCode,
        total: 0,
        daKetThuc: 0,
        dangKham: 0,
        choKham: 0
      };
    }
    stationMap[key].total++;
    if (r.trangThaiId === 3) stationMap[key].daKetThuc++;
    else if (r.trangThaiId === 2) stationMap[key].dangKham++;
    else if (r.trangThaiId === 1) stationMap[key].choKham++;
  });
  const byStation = Object.values(stationMap).sort((a, b) => b.total - a.total);

  return {
    success: true,
    isLive,
    liveStationCount: targetStations.length,
    summary: {
      total,
      daKetThuc,
      dangKham,
      choKham,
      bhytCount,
      vienPhiCount,
      bhytPercent: total ? Math.round((bhytCount / total) * 100) : 0
    },
    byStatus,
    byPhongKham,
    byTime,
    byStation,
    records: filtered.slice(0, 500), // Gửi tối đa 500 bản ghi chi tiết
    totalRecords: filtered.length
  };
}

/**
 * Xuất file Excel báo cáo thống kê khám chữa bệnh từ dữ liệu thật
 */
async function exportKcbExcel(query = {}) {
  const data = await getKcbDashboardData({ ...query, refresh: false });
  const records = data.records || [];

  // Sheet 1: Danh sách chi tiết bệnh nhân
  const detailRows = records.map((r, idx) => ({
    'STT': idx + 1,
    'Trạm Y Tế': r.stationName,
    'Mã Trạm': r.stationCode,
    'Mã Bệnh Nhân': r.maBenhNhan,
    'Họ và Tên': r.tenBenhNhan,
    'Năm Sinh': r.namSinh,
    'Tuổi': r.tuoi,
    'Giới Tính': r.gioiTinh,
    'Đối Tượng': r.doiTuong,
    'Số Thẻ BHYT': r.soTheBhyt || '',
    'Phòng Khám': r.tenPhong,
    'Bác Sĩ Khám': r.bacSiKham,
    'Thời Gian Tiếp Nhận': r.thoiGianTiepNhan,
    'Trạng Thái': r.trangThaiTen,
    'Chẩn Đoán / Xử Trí': r.chanDoan
  }));

  // Sheet 2: Thống kê theo phòng khám
  const phongRows = (data.byPhongKham || []).map((p, idx) => ({
    'STT': idx + 1,
    'Tên Phòng Khám': p.tenPhong,
    'Mã Phòng': p.maPhong,
    'Tổng Số Lượt Khám': p.total,
    'Đã Kết Thúc': p.daKetThuc,
    'Đang Khám': p.dangKham,
    'Chờ Khám': p.choKham
  }));

  // Sheet 3: Thống kê theo trạm y tế
  const stationRows = (data.byStation || []).map((s, idx) => ({
    'STT': idx + 1,
    'Trạm Y Tế': s.stationName,
    'Mã Trạm': s.stationCode,
    'Tổng Số Lượt Khám': s.total,
    'Đã Kết Thúc': s.daKetThuc,
    'Đang Khám': s.dangKham,
    'Chờ Khám': s.choKham
  }));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(detailRows);
  const ws2 = XLSX.utils.json_to_sheet(phongRows);
  const ws3 = XLSX.utils.json_to_sheet(stationRows);

  XLSX.utils.book_append_sheet(wb, ws1, 'Danh Sách Khám Bệnh');
  XLSX.utils.book_append_sheet(wb, ws2, 'Thống Kê Theo Phòng');
  XLSX.utils.book_append_sheet(wb, ws3, 'Thống Kê Theo Trạm');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buf;
}

/**
 * Làm ấm bộ nhớ đệm chạy ngầm khi khởi động server
 */
function warmUpCache() {
  setTimeout(async () => {
    try {
      console.log('[KCB] Đang làm ấm cache dữ liệu KCB từ các trạm...');
      await getKcbDashboardData({ stationId: 'all' });
      console.log(`[KCB] Đã làm ấm cache xong (${stationRecordsCache.size} trạm đã lưu cache).`);
    } catch (e) {
      console.warn('[KCB] Lỗi làm ấm cache:', e.message);
    }
  }, 3000);
}

// Kích hoạt làm ấm cache ngầm
warmUpCache();

module.exports = {
  getPhongKhamList,
  getKcbDashboardData,
  exportKcbExcel
};
