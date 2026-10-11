const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const cryptoService = require('./cryptoService');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(config.DATA_DIR)) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

// 15 Trạm Y Tế mẫu để người dùng dễ dàng thử nghiệm ngay
const SAMPLE_STATIONS = [
  { id: 'tyt_01', name: 'Trạm Y tế Xã An Bình', code: '01001', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_anbinh', password: 'Password@123', status: 'untested', active: true, notes: 'Trạm khu vực trung tâm' },
  { id: 'tyt_02', name: 'Trạm Y tế Xã Bình Minh', code: '01002', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_binhminh', password: 'Password@123', status: 'untested', active: true, notes: 'Có khám BHYT liên xã' },
  { id: 'tyt_03', name: 'Trạm Y tế Xã Cẩm Giang', code: '01003', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_camgiang', password: 'Password@123', status: 'untested', active: true, notes: 'Phụ trách tiêm chủng mở rộng' },
  { id: 'tyt_04', name: 'Trạm Y tế Xã Dân Chủ', code: '01004', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_danchu', password: 'Password@123', status: 'untested', active: true, notes: 'Đã triển khai hồ sơ điện tử' },
  { id: 'tyt_05', name: 'Trạm Y tế Xã Đông Hòa', code: '01005', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_donghoa', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_06', name: 'Trạm Y tế Xã Gia Lộc', code: '01006', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_gialoc', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_07', name: 'Trạm Y tế Xã Hải Đường', code: '01007', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_haiduong', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_08', name: 'Trạm Y tế Xã Hồng Phong', code: '01008', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_hongphong', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_09', name: 'Trạm Y tế Xã Khánh An', code: '01009', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_khanhan', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_10', name: 'Trạm Y tế Xã Liên Hiệp', code: '01010', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_lienhiep', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_11', name: 'Trạm Y tế Xã Minh Hưng', code: '01011', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_minhhung', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_12', name: 'Trạm Y tế Xã Nam Sơn', code: '01012', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_namson', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_13', name: 'Trạm Y tế Xã Phú Lâm', code: '01013', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_phulam', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_14', name: 'Trạm Y tế Xã Quảng Cương', code: '01014', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_quangcuong', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_15', name: 'Trạm Y tế Xã Sơn Hải', code: '01015', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_sonhai', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_16', name: 'Trạm Y tế Xã Thạnh Lộc', code: '01016', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_thanhloc', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_17', name: 'Trạm Y tế Xã Tân Tiến', code: '01017', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_tantien', password: 'Password@123', status: 'untested', active: true, notes: '' },
  { id: 'tyt_18', name: 'Trạm Y tế Xã Vĩnh Hòa', code: '01018', district: 'Huyện Long An', url: 'https://his-longan.vnpt.vn', username: 'tyt_vinhhoa', password: 'Password@123', status: 'untested', active: true, notes: '' }
];

const DEFAULT_SETTINGS = {
  centerName: 'Trung tâm Y tế Huyện',
  defaultHisUrl: 'https://his-portal.vnpt.vn',
  simulationMode: true, // Chế độ mô phỏng kiểm tra khi chưa nối mạng VNPT HIS WAN
  autoCheckIntervalMinutes: 0, // 0 = tắt
  timeoutSeconds: 10
};

// Ghi file nguyên tử (atomic write) để tránh hỏng dữ liệu khi mất điện/tắt đột ngột
function atomicWriteFileSync(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function initDb() {
  if (!fs.existsSync(config.SETTINGS_FILE)) {
    atomicWriteFileSync(config.SETTINGS_FILE, DEFAULT_SETTINGS);
  }
  if (!fs.existsSync(config.DB_FILE)) {
    // Mã hóa mật khẩu các trạm mẫu
    const encryptedSamples = SAMPLE_STATIONS.map(s => ({
      ...s,
      password: cryptoService.encrypt(s.password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    atomicWriteFileSync(config.DB_FILE, encryptedSamples);
  }
}

initDb();

function getSettings() {
  try {
    if (!fs.existsSync(config.SETTINGS_FILE)) return DEFAULT_SETTINGS;
    const content = fs.readFileSync(config.SETTINGS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Lỗi đọc settings:', error);
    return DEFAULT_SETTINGS;
  }
}

function updateSettings(newSettings) {
  const current = getSettings();
  const updated = { ...current, ...newSettings };
  atomicWriteFileSync(config.SETTINGS_FILE, updated);
  return updated;
}

function getRawStations() {
  try {
    if (!fs.existsSync(config.DB_FILE)) return [];
    const content = fs.readFileSync(config.DB_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Lỗi đọc DB:', error);
    return [];
  }
}

/**
 * Lấy danh sách trạm (có tùy chọn giải mã mật khẩu)
 */
function getStations(includeDecryptedPassword = false) {
  const raw = getRawStations();
  return raw.map(station => {
    const s = { ...station };
    if (includeDecryptedPassword) {
      s.password = cryptoService.decrypt(s.password);
    } else {
      // Che mật khẩu cho an toàn khi hiển thị thông thường
      s.passwordMasked = s.password ? '••••••••' : '';
    }
    return s;
  });
}

function getStationById(id, includeDecryptedPassword = true) {
  const stations = getStations(includeDecryptedPassword);
  return stations.find(s => s.id === id) || null;
}

function saveStations(stations) {
  atomicWriteFileSync(config.DB_FILE, stations);
}

function addStation(stationData) {
  const stations = getRawStations();
  const id = stationData.id || `tyt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newStation = {
    ...stationData,
    id,
    password: cryptoService.encrypt(stationData.password || ''),
    status: stationData.status || 'untested',
    active: stationData.active !== undefined ? stationData.active : true,
    lastTested: null,
    lastTestedMessage: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  stations.push(newStation);
  saveStations(stations);
  return newStation;
}

/**
 * Thêm hoặc cập nhật hàng loạt 15 - 20 trạm cùng lúc
 */
function batchUpsertStations(stationsList) {
  const existing = getRawStations();
  const existingMap = new Map(existing.map(s => [s.id, s]));
  const codeMap = new Map(existing.map(s => [s.code, s]));

  const added = [];
  const updated = [];

  for (const item of stationsList) {
    let target = null;
    if (item.id && existingMap.has(item.id)) {
      target = existingMap.get(item.id);
    } else if (item.code && codeMap.has(item.code)) {
      target = codeMap.get(item.code);
    }

    if (target) {
      // Cập nhật
      target.name = item.name || target.name;
      target.code = item.code || target.code;
      target.district = item.district !== undefined ? item.district : target.district;
      target.url = item.url || target.url;
      target.username = item.username || target.username;
      if (item.password) {
        target.password = cryptoService.encrypt(item.password);
      }
      target.notes = item.notes !== undefined ? item.notes : target.notes;
      target.active = item.active !== undefined ? item.active : target.active;
      target.updatedAt = new Date().toISOString();
      updated.push(target);
    } else {
      // Thêm mới
      const id = item.id || `tyt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newStation = {
        id,
        name: item.name || `Trạm Y tế mới ${id}`,
        code: item.code || `00000`,
        district: item.district || '',
        url: item.url || getSettings().defaultHisUrl,
        username: item.username || '',
        password: cryptoService.encrypt(item.password || ''),
        status: 'untested',
        active: item.active !== undefined ? item.active : true,
        notes: item.notes || '',
        lastTested: null,
        lastTestedMessage: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      existing.push(newStation);
      existingMap.set(id, newStation);
      if (newStation.code) codeMap.set(newStation.code, newStation);
      added.push(newStation);
    }
  }

  saveStations(existing);
  return { addedCount: added.length, updatedCount: updated.length, total: existing.length };
}

function updateStation(id, updateData) {
  const stations = getRawStations();
  const index = stations.findIndex(s => s.id === id);
  if (index === -1) return null;

  const current = stations[index];
  const updated = {
    ...current,
    ...updateData,
    updatedAt: new Date().toISOString()
  };

  if (updateData.password) {
    updated.password = cryptoService.encrypt(updateData.password);
  } else {
    updated.password = current.password;
  }

  stations[index] = updated;
  saveStations(stations);
  return updated;
}

function updateStationStatus(id, status, message = '', responseTimeMs = null) {
  const stations = getRawStations();
  const station = stations.find(s => s.id === id);
  if (!station) return null;

  station.status = status; // 'success' | 'failed' | 'testing' | 'untested'
  station.lastTested = new Date().toISOString();
  station.lastTestedMessage = message;
  if (responseTimeMs !== null) {
    station.lastResponseTime = responseTimeMs;
  }
  saveStations(stations);
  return station;
}

function deleteStation(id) {
  let stations = getRawStations();
  const beforeCount = stations.length;
  stations = stations.filter(s => s.id !== id);
  saveStations(stations);
  return stations.length < beforeCount;
}

function deleteBatchStations(ids) {
  const idSet = new Set(ids);
  let stations = getRawStations();
  const beforeCount = stations.length;
  stations = stations.filter(s => !idSet.has(s.id));
  saveStations(stations);
  return beforeCount - stations.length;
}

function clearAllStations() {
  const stations = getRawStations();
  const count = stations.length;
  saveStations([]);
  return count;
}

module.exports = {
  getStations,
  getStationById,
  addStation,
  batchUpsertStations,
  updateStation,
  updateStationStatus,
  deleteStation,
  deleteBatchStations,
  clearAllStations,
  getSettings,
  updateSettings
};

