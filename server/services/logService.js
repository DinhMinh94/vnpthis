const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const config = require('../config/config');

const LOGS_FILE = path.join(config.DATA_DIR, 'system_logs.json');
const MAX_LOGS = 1000;

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(config.DATA_DIR)) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

/**
 * Ghi file an toàn (atomic write) để tránh lỗi ghi file dở dang
 */
function atomicWriteFileSync(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * Định dạng thời gian theo chuẩn Việt Nam DD/MM/YYYY HH:mm:ss
 */
function formatVietnameseDate(dateObj = new Date()) {
  const d = new Date(dateObj);
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Đọc tất cả logs từ file
 */
function readLogs() {
  if (!fs.existsSync(LOGS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(LOGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Lỗi đọc file log hệ thống:', err.message);
    return [];
  }
}

/**
 * Thêm 1 bản ghi log mới
 * @param {Object} logData
 * @param {string} logData.actionType - 'cauhinh_thamso' | 'phieuin_baocao' | 'chucdanh_kyso' | 'batch_url' | 'other'
 * @param {string} logData.actionTitle - Tiêu đề thao tác (VD: Sửa tham số cấu hình nhanh)
 * @param {string} logData.summary - Tóm tắt nội dung thay đổi
 * @param {Object} logData.details - Chi tiết tham số/cấu hình đã sửa
 * @param {number} logData.total - Tổng số trạm áp dụng
 * @param {number} logData.successCount - Số trạm thành công
 * @param {number} logData.failedCount - Số trạm thất bại
 * @param {Array} logData.results - Danh sách kết quả chi tiết từng trạm
 */
function addLog({
  actionType = 'cauhinh_thamso',
  actionTitle = 'Sửa cấu hình hàng loạt',
  summary = '',
  details = {},
  total = 0,
  successCount = 0,
  failedCount = 0,
  results = []
}) {
  try {
    const logs = readLogs();
    const now = new Date();

    const stationNames = Array.isArray(results)
      ? results.map(r => r.name || r.id).filter(Boolean)
      : [];

    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now.toISOString(),
      formattedTime: formatVietnameseDate(now),
      actionType,
      actionTitle,
      summary: summary || `${actionTitle} cho ${total} trạm`,
      details: details || {},
      total: Number(total) || (results ? results.length : 0),
      successCount: Number(successCount) || 0,
      failedCount: Number(failedCount) || 0,
      stationNames: stationNames.slice(0, 50),
      results: Array.isArray(results) ? results : []
    };

    // Đưa log mới lên đầu danh sách
    logs.unshift(newLog);

    // Giới hạn số lượng log lưu trữ để tối ưu dung lượng
    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS;
    }

    atomicWriteFileSync(LOGS_FILE, logs);
    return newLog;
  } catch (err) {
    console.error('Lỗi lưu log hệ thống:', err.message);
    return null;
  }
}

/**
 * Lấy danh sách log có hỗ trợ lọc và tìm kiếm
 */
function getLogs({ actionType, search, limit = 100, page = 1 } = {}) {
  let logs = readLogs();

  if (actionType && actionType !== 'all') {
    logs = logs.filter(l => l.actionType === actionType);
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    logs = logs.filter(l => {
      const titleMatch = l.actionTitle && l.actionTitle.toLowerCase().includes(q);
      const summaryMatch = l.summary && l.summary.toLowerCase().includes(q);
      const timeMatch = l.formattedTime && l.formattedTime.toLowerCase().includes(q);
      const detailsMatch = l.details && JSON.stringify(l.details).toLowerCase().includes(q);
      const stationsMatch = l.stationNames && l.stationNames.some(name => name.toLowerCase().includes(q));
      return titleMatch || summaryMatch || timeMatch || detailsMatch || stationsMatch;
    });
  }

  const total = logs.length;
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.max(1, parseInt(limit) || 100);
  const start = (p - 1) * l;
  const pagedLogs = logs.slice(start, start + l);

  return {
    total,
    page: p,
    limit: l,
    data: pagedLogs
  };
}

/**
 * Xóa 1 bản ghi log theo ID
 */
function deleteLog(id) {
  const logs = readLogs();
  const nextLogs = logs.filter(l => l.id !== id);
  if (nextLogs.length !== logs.length) {
    atomicWriteFileSync(LOGS_FILE, nextLogs);
    return true;
  }
  return false;
}

/**
 * Xóa toàn bộ logs
 */
function clearLogs() {
  atomicWriteFileSync(LOGS_FILE, []);
  return true;
}

/**
 * Xuất toàn bộ nhật ký hệ thống ra file Excel Buffer
 */
function exportLogsToExcelBuffer() {
  const logs = readLogs();
  const rows = [];

  logs.forEach((item, index) => {
    const details = item.details || {};
    const successRate = item.total > 0
      ? `${item.successCount}/${item.total} (${Math.round((item.successCount / item.total) * 100)}%)`
      : '0/0';

    rows.push({
      'STT': index + 1,
      'Thời gian': item.formattedTime,
      'Loại thao tác': item.actionTitle || item.actionType,
      'Tóm tắt thay đổi': item.summary || '',
      'Mã cấu hình': details.maCauHinh || details.maBaoCao || details.titleCode || '',
      'Tên cấu hình / Tiêu đề': details.tenCauHinh || details.ten || details.titleName || '',
      'Khóa tham số (Key)': details.paramKey || '',
      'Giá trị cũ (trước khi sửa)': details.oldValue !== undefined && details.oldValue !== null ? details.oldValue : '',
      'Giá trị thiết lập mới': details.newValue !== undefined ? details.newValue : (details.trangThai || ''),
      'Mô tả tham số': details.paramName || details.ghiChu || '',
      'Tổng số trạm': item.total,
      'Thành công': item.successCount,
      'Thất bại': item.failedCount,
      'Tỷ lệ thành công': successRate,
      'Danh sách trạm áp dụng': (item.stationNames || []).join('; ')
    });
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },  // STT
    { wch: 20 }, // Thời gian
    { wch: 25 }, // Loại thao tác
    { wch: 45 }, // Tóm tắt thay đổi
    { wch: 18 }, // Mã cấu hình
    { wch: 28 }, // Tên cấu hình
    { wch: 22 }, // Khóa tham số
    { wch: 24 }, // Giá trị cũ
    { wch: 24 }, // Giá trị mới
    { wch: 35 }, // Mô tả tham số
    { wch: 12 }, // Tổng số trạm
    { wch: 12 }, // Thành công
    { wch: 10 }, // Thất bại
    { wch: 18 }, // Tỷ lệ
    { wch: 50 }  // Danh sách trạm
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'NhatKyCauHinh');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  addLog,
  getLogs,
  deleteLog,
  clearLogs,
  exportLogsToExcelBuffer,
  formatVietnameseDate
};
