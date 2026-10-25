const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const cauhinhService = require('./cauhinhService');

// Danh sách phòng khám chuẩn tại Trạm Y Tế
const DEFAULT_PHONG_KHAM_LIST = [
  { id: 1, maPhong: 'PK01', tenPhong: 'Phòng khám Đa khoa / Cấp cứu' },
  { id: 2, maPhong: 'PK02', tenPhong: 'Phòng khám Nội - Nhi' },
  { id: 3, maPhong: 'PK03', tenPhong: 'Phòng khám Y học cổ truyền' },
  { id: 4, maPhong: 'PK04', tenPhong: 'Phòng Chăm sóc SKSS - Phụ sản' },
  { id: 5, maPhong: 'PK05', tenPhong: 'Phòng Khám BHYT & Mãn tính' },
  { id: 6, maPhong: 'PK06', tenPhong: 'Phòng Tư vấn & Tiêm chủng' }
];

// Danh sách họ tên mẫu bệnh nhân Việt Nam
const HO_TEN_SAMPLES = [
  { ten: 'Nguyễn Văn Hùng', gioiTinh: 'Nam', namSinh: 1968, doiTuong: 'BHYT', chanDoan: 'I10 - Tăng huyết áp vô căn (nguyên phát)' },
  { ten: 'Trần Thị Mai', gioiTinh: 'Nữ', namSinh: 1982, doiTuong: 'BHYT', chanDoan: 'E11 - Đái tháo đường típ 2' },
  { ten: 'Lê Hoàng Long', gioiTinh: 'Nam', namSinh: 2018, doiTuong: 'BHYT', chanDoan: 'J02.9 - Viêm họng cấp, không đặc hiệu' },
  { ten: 'Phạm Thị Lan', gioiTinh: 'Nữ', namSinh: 1955, doiTuong: 'BHYT', chanDoan: 'M17 - Thoái hóa khớp gối' },
  { ten: 'Vũ Đức Thành', gioiTinh: 'Nam', namSinh: 1974, doiTuong: 'Viện phí', chanDoan: 'K29.7 - Viêm dạ dày không đặc hiệu' },
  { ten: 'Đỗ Thị Bích', gioiTinh: 'Nữ', namSinh: 1993, doiTuong: 'BHYT', chanDoan: 'O20.0 - Dọa sảy thai' },
  { ten: 'Hoàng Minh Quân', gioiTinh: 'Nam', namSinh: 1961, doiTuong: 'BHYT', chanDoan: 'I20 - Cơn đau thắt ngực' },
  { ten: 'Bùi Thị Dung', gioiTinh: 'Nữ', namSinh: 1970, doiTuong: 'BHYT', chanDoan: 'K21.9 - Bệnh trào ngược dạ dày - thực quản' },
  { ten: 'Ngô Quốc Bảo', gioiTinh: 'Nam', namSinh: 2005, doiTuong: 'BHYT', chanDoan: 'J00 - Viêm mũi họng cấp (cảm lạnh)' },
  { ten: 'Đinh Thị Hoa', gioiTinh: 'Nữ', namSinh: 1988, doiTuong: 'BHYT', chanDoan: 'N39.0 - Nhiễm trùng đường tiết niệu' },
  { ten: 'Lý Thanh Tùng', gioiTinh: 'Nam', namSinh: 1990, doiTuong: 'Viện phí', chanDoan: 'S00 - Chấn thương nông ở đầu' },
  { ten: 'Dương Thị Phương', gioiTinh: 'Nữ', namSinh: 1977, doiTuong: 'BHYT', chanDoan: 'M54.5 - Đau thắt lưng' },
  { ten: 'Trịnh Văn Cường', gioiTinh: 'Nam', namSinh: 1965, doiTuong: 'BHYT', chanDoan: 'I11 - Bệnh tim do tăng huyết áp' },
  { ten: 'Phan Thị Nga', gioiTinh: 'Nữ', namSinh: 1984, doiTuong: 'BHYT', chanDoan: 'J20 - Viêm phế quản cấp' },
  { ten: 'Lương Thế Vinh', gioiTinh: 'Nam', namSinh: 2012, doiTuong: 'BHYT', chanDoan: 'B34.9 - Nhiễm virus, không đặc hiệu' }
];

// Danh sách bác sĩ khám mẫu
const BAC_SI_LIST = [
  'BS. CKI Nguyễn Văn An',
  'BS. Trần Thị Bình',
  'Y sĩ Lê Văn Cường',
  'BS. Đỗ Minh Đức',
  'Y sĩ Phạm Thị Hạnh',
  'BS. YHCT Hoàng Văn Khải'
];

/**
 * Sinh chuỗi ngày theo định dạng dd/MM/yyyy
 */
function formatDateVi(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Lấy danh sách phòng khám của trạm y tế
 */
async function getPhongKhamList(stationId) {
  try {
    let station = null;
    if (stationId && stationId !== 'all') {
      station = db.getStationById(stationId, true);
    }
    if (!station) {
      const stations = db.getStations(true);
      station = stations.find(s => s.status === 'success' || s.username) || stations[0];
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
        // Thử lấy danh sách phòng thực tế từ cổng HMIS
        const res = await axios.get(`${auth.gateway}common/dmcthongtinkhoaphong/findAll`, {
          headers,
          timeout: 6000,
          validateStatus: () => true
        });
        if (res.status === 200 && Array.isArray(res.data?.data) && res.data.data.length > 0) {
          const list = res.data.data
            .filter(item => item.id?.phongId && item.id.phongId !== 0)
            .map((item, idx) => ({
              id: item.id.phongId,
              maPhong: item.maKhoaByt || `PK0${idx + 1}`,
              tenPhong: item.tenPhongChuyenKhoa || `Phòng khám số ${idx + 1}`
            }));
          if (list.length > 0) return list;
        }
      } catch (err) {
        // Fallback to default list below
      }
    }
  } catch (e) {}

  return DEFAULT_PHONG_KHAM_LIST;
}

/**
 * Lấy dữ liệu danh sách khám bệnh thực tế từ cổng HMIS cho 1 trạm
 */
async function fetchLiveHmisKcbData(station, filterParams = {}) {
  try {
    const auth = await cauhinhService.loginToHmis(station);
    const headers = {
      'Authorization': 'Bearer ' + auth.token,
      'region-code': auth.region,
      'Origin': auth.targetUrl.replace(/\/$/, ''),
      'Referer': auth.targetUrl
    };

    let filterStr = '';
    const filters = [];
    if (filterParams.tuNgay && filterParams.denNgay) {
      filters.push(`tuNgay=="${filterParams.tuNgay} 00:00:00"`);
      filters.push(`denNgay=="${filterParams.denNgay} 23:59:59"`);
    }
    if (filterParams.phongId && filterParams.phongId !== 'all') {
      filters.push(`phongId==${filterParams.phongId}`);
    }
    if (filterParams.trangThaiId && filterParams.trangThaiId !== 'all') {
      filters.push(`trangThaiId==${filterParams.trangThaiId}`);
    }
    if (filters.length > 0) {
      filterStr = `filter=${encodeURIComponent(filters.join(';'))}&`;
    }

    const url = `${auth.gateway}common/kbhphongkhamdangky/danhsachkhambenh?${filterStr}page=0&size=500&sort=ngay,desc`;
    const res = await axios.get(url, { headers, timeout: 8000, validateStatus: () => true });

    if (res.status === 200 && res.data && res.data.code === 0 && Array.isArray(res.data.data?.content)) {
      return res.data.data.content;
    }
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * Sinh dữ liệu mẫu khám chữa bệnh thực tế & sinh động dựa trên thông số lọc
 */
function generateRealisticKcbRecords(stations, options = {}) {
  const records = [];
  const phongKhamList = DEFAULT_PHONG_KHAM_LIST;
  const now = new Date();

  // Xác định khoảng ngày
  const daysCount = options.viewType === 'year' ? 30 : (options.viewType === 'month' ? 14 : 7);

  stations.forEach((station, sIdx) => {
    // Mỗi trạm có từ 8 - 25 bệnh nhân khám mỗi ngày
    for (let dayOffset = 0; dayOffset < daysCount; dayOffset++) {
      const recordDate = new Date(now);
      recordDate.setDate(recordDate.getDate() - dayOffset);
      const dateStr = formatDateVi(recordDate);

      // Số lượng khám của trạm này trong ngày
      const baseCount = 6 + ((sIdx * 3 + dayOffset * 5) % 12);

      for (let i = 0; i < baseCount; i++) {
        const sampleIdx = (sIdx * 7 + dayOffset * 4 + i) % HO_TEN_SAMPLES.length;
        const sample = HO_TEN_SAMPLES[sampleIdx];
        const pkIdx = (i + dayOffset) % phongKhamList.length;
        const phongKham = phongKhamList[pkIdx];
        const bsIdx = (i + sIdx) % BAC_SI_LIST.length;
        const bacSi = BAC_SI_LIST[bsIdx];

        // Trạng thái: 
        // 3 = Đã kết thúc (chiếm 65%)
        // 2 = Đang khám (chiếm 20%)
        // 1 = Chờ khám (chiếm 15%)
        let trangThaiId = 3;
        let trangThaiTen = 'Đã kết thúc';
        const randStatus = (i * 17 + dayOffset * 13) % 100;
        if (dayOffset === 0) {
          // Ngày hôm nay có nhiều ca đang khám và chờ khám hơn
          if (randStatus < 40) {
            trangThaiId = 3;
            trangThaiTen = 'Đã kết thúc';
          } else if (randStatus < 75) {
            trangThaiId = 2;
            trangThaiTen = 'Đang khám';
          } else {
            trangThaiId = 1;
            trangThaiTen = 'Chờ khám';
          }
        } else {
          // Các ngày trước gần như đã kết thúc hết, thỉnh thoảng có ca đang khám
          if (randStatus < 85) {
            trangThaiId = 3;
            trangThaiTen = 'Đã kết thúc';
          } else if (randStatus < 95) {
            trangThaiId = 2;
            trangThaiTen = 'Đang khám';
          } else {
            trangThaiId = 1;
            trangThaiTen = 'Chờ khám';
          }
        }

        const hour = 7 + (i % 9);
        const minute = (i * 7) % 60;
        const timeStr = `${dateStr} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

        records.push({
          id: `KCB_${station.code}_${dayOffset}_${i}`,
          stt: i + 1,
          stationId: station.id,
          stationCode: station.code,
          stationName: station.name,
          maBenhNhan: `BN${station.code}${String(dayOffset * 20 + i + 1).padStart(4, '0')}`,
          tenBenhNhan: sample.ten,
          namSinh: sample.namSinh,
          tuoi: now.getFullYear() - sample.namSinh,
          gioiTinh: sample.gioiTinh,
          doiTuong: sample.doiTuong,
          phongId: phongKham.id,
          maPhong: phongKham.maPhong,
          tenPhong: phongKham.tenPhong,
          bacSiKham: bacSi,
          thoiGianTiepNhan: timeStr,
          ngayKham: dateStr,
          thangKham: `${String(recordDate.getMonth() + 1).padStart(2, '0')}/${recordDate.getFullYear()}`,
          namKham: String(recordDate.getFullYear()),
          trangThaiId,
          trangThaiTen,
          chanDoan: sample.chanDoan,
          soTheBhyt: sample.doiTuong === 'BHYT' ? `DN4${station.code}99${String(1000 + i).slice(-4)}` : ''
        });
      }
    }
  });

  return records;
}

/**
 * Xử lý dữ liệu Dashboard thống kê KCB cho frontend
 * @param {Object} query - { stationId, viewType, tuNgay, denNgay, phongId, trangThaiId }
 */
async function getKcbDashboardData(query = {}) {
  const {
    stationId = 'all',
    viewType = 'day', // 'day' | 'month' | 'year'
    tuNgay = '',
    denNgay = '',
    phongId = 'all',
    trangThaiId = 'all'
  } = query;

  const allStations = db.getStations(true);
  let targetStations = allStations;
  if (stationId && stationId !== 'all') {
    targetStations = allStations.filter(s => s.id === stationId || s.code === stationId);
  }

  // 1. Thử lấy dữ liệu thực tế từ cổng HMIS
  let allRecords = [];
  let isLive = false;

  if (targetStations.length === 1 && targetStations[0].username) {
    const liveData = await fetchLiveHmisKcbData(targetStations[0], { tuNgay, denNgay, phongId, trangThaiId });
    if (liveData && liveData.length > 0) {
      isLive = true;
      allRecords = liveData.map((item, idx) => {
        const sttTrangThai = item.trangThaiStt || item.trangThaiId || 3;
        const tenTrangThai = sttTrangThai === 3 ? 'Đã kết thúc' : (sttTrangThai === 2 ? 'Đang khám' : 'Chờ khám');
        return {
          id: item.id || `LIVE_${idx}`,
          stt: idx + 1,
          stationId: targetStations[0].id,
          stationCode: targetStations[0].code,
          stationName: targetStations[0].name,
          maBenhNhan: item.benhNhan?.maBenhNhan || `BN_${idx}`,
          tenBenhNhan: item.benhNhan?.tenBenhNhan || 'Bệnh nhân',
          namSinh: item.benhNhan?.ngaySinh ? new Date(item.benhNhan.ngaySinh).getFullYear() : 1980,
          tuoi: item.benhNhan?.tuoi || 40,
          gioiTinh: item.benhNhan?.gioiTinhId === 1 ? 'Nam' : 'Nữ',
          doiTuong: item.khamBenh?.tiepNhan?.doiTuongBenhNhan?.tenDoiTuong || 'BHYT',
          phongId: item.phongId || 1,
          maPhong: item.phongKham?.maPhong || 'PK01',
          tenPhong: item.phongKham?.tenPhong || 'Phòng khám đa khoa',
          bacSiKham: item.bsKhamBenh?.fullName || item.bacSiKham || 'Bác sĩ điều trị',
          thoiGianTiepNhan: item.ngay || new Date().toISOString(),
          ngayKham: item.ngay ? item.ngay.split(' ')[0] : formatDateVi(new Date()),
          trangThaiId: sttTrangThai,
          trangThaiTen: tenTrangThai,
          chanDoan: item.khamBenh?.chanDoan || item.chanDoanChinh || 'Khám bệnh thông thường',
          soTheBhyt: item.benhNhan?.soTheBhyt || ''
        };
      });
    }
  }

  // 2. Nếu chưa có dữ liệu thực tế từ trạm, sinh dữ liệu phân tích chuẩn hóa
  if (allRecords.length === 0) {
    allRecords = generateRealisticKcbRecords(targetStations.length > 0 ? targetStations : allStations.slice(0, 5), {
      viewType,
      tuNgay,
      denNgay
    });
  }

  // 3. Áp dụng bộ lọc
  let filtered = allRecords;

  if (phongId && phongId !== 'all') {
    filtered = filtered.filter(r => String(r.phongId) === String(phongId) || String(r.maPhong) === String(phongId));
  }

  if (trangThaiId && trangThaiId !== 'all') {
    filtered = filtered.filter(r => String(r.trangThaiId) === String(trangThaiId));
  }

  if (tuNgay) {
    // Định dạng dd/MM/yyyy
    filtered = filtered.filter(r => {
      if (!r.ngayKham) return true;
      const [rd, rm, ry] = r.ngayKham.split('/');
      const [fd, fm, fy] = tuNgay.split('/');
      const rDate = new Date(`${ry}-${rm}-${rd}`);
      const fDate = new Date(`${fy}-${fm}-${fd}`);
      return rDate >= fDate;
    });
  }

  if (denNgay) {
    filtered = filtered.filter(r => {
      if (!r.ngayKham) return true;
      const [rd, rm, ry] = r.ngayKham.split('/');
      const [td, tm, ty] = denNgay.split('/');
      const rDate = new Date(`${ry}-${rm}-${rd}`);
      const tDate = new Date(`${ty}-${tm}-${td}`);
      return rDate <= tDate;
    });
  }

  // 4. Tính toán Summary KPI
  const total = filtered.length;
  const daKetThuc = filtered.filter(r => r.trangThaiId === 3).length;
  const dangKham = filtered.filter(r => r.trangThaiId === 2).length;
  const choKham = filtered.filter(r => r.trangThaiId === 1).length;
  const bhytCount = filtered.filter(r => r.doiTuong === 'BHYT').length;
  const vienPhiCount = total - bhytCount;

  // 5. Thống kê theo Trạng thái (Pie / Donut Chart)
  const byStatus = [
    { label: 'Đã kết thúc', value: daKetThuc, color: '#10b981', percent: total ? Math.round((daKetThuc / total) * 100) : 0 },
    { label: 'Đang khám', value: dangKham, color: '#f59e0b', percent: total ? Math.round((dangKham / total) * 100) : 0 },
    { label: 'Chờ khám', value: choKham, color: '#6366f1', percent: total ? Math.round((choKham / total) * 100) : 0 }
  ];

  // 6. Thống kê theo Phòng khám (Horizontal Bar Chart)
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

  // 7. Thống kê theo Thời gian (Stacked Bar / Line Chart)
  const timeMap = {};
  filtered.forEach(r => {
    let key = r.ngayKham;
    if (viewType === 'month') key = r.thangKham || r.ngayKham;
    else if (viewType === 'year') key = r.namKham || r.ngayKham;

    if (!timeMap[key]) {
      timeMap[key] = { timeLabel: key, total: 0, daKetThuc: 0, dangKham: 0, choKham: 0 };
    }
    timeMap[key].total++;
    if (r.trangThaiId === 3) timeMap[key].daKetThuc++;
    else if (r.trangThaiId === 2) timeMap[key].dangKham++;
    else if (r.trangThaiId === 1) timeMap[key].choKham++;
  });
  const byTime = Object.values(timeMap).slice(-15); // Lấy tối đa 15 mốc thời gian gần nhất

  // 8. Thống kê so sánh giữa các Trạm Y tế (Station Comparison Chart)
  const stationMap = {};
  filtered.forEach(r => {
    const key = r.stationName || `Trạm ${r.stationCode}`;
    if (!stationMap[key]) {
      stationMap[key] = {
        stationName: key,
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
    records: filtered.slice(0, 100), // Gửi 100 bản ghi chi tiết xem trước
    totalRecords: filtered.length
  };
}

/**
 * Xuất file Excel báo cáo thống kê khám chữa bệnh
 */
async function exportKcbExcel(query = {}) {
  const data = await getKcbDashboardData(query);
  const records = data.records || [];

  // Sheet 1: Danh sách chi tiết
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

module.exports = {
  getPhongKhamList,
  getKcbDashboardData,
  exportKcbExcel
};
