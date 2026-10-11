const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('./db');

/**
 * Tạo file Excel mẫu chuẩn cấu hình Trạm Y Tế
 */
function generateTemplateBuffer() {
  const sampleData = [
    {
      'Tên Trạm Y Tế': 'Trạm Y tế Xã An Bình',
      'Mã CSKCB': '01001',
      'Quận/Huyện': 'Huyện Long An',
      'URL Portal HIS': 'https://his-longan.vnpt.vn',
      'Tên đăng nhập': 'tyt_anbinh',
      'Mật khẩu': 'Password@123',
      'Ghi chú': 'Trạm trung tâm'
    },
    {
      'Tên Trạm Y Tế': 'Trạm Y tế Xã Bình Minh',
      'Mã CSKCB': '01002',
      'Quận/Huyện': 'Huyện Long An',
      'URL Portal HIS': 'https://his-longan.vnpt.vn',
      'Tên đăng nhập': 'tyt_binhminh',
      'Mật khẩu': 'Password@123',
      'Ghi chú': ''
    },
    {
      'Tên Trạm Y Tế': 'Trạm Y tế Xã Cẩm Giang',
      'Mã CSKCB': '01003',
      'Quận/Huyện': 'Huyện Long An',
      'URL Portal HIS': 'https://his-longan.vnpt.vn',
      'Tên đăng nhập': 'tyt_camgiang',
      'Mật khẩu': 'Password@123',
      'Ghi chú': ''
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);

  // Đặt độ rộng các cột cho đẹp mắt
  worksheet['!cols'] = [
    { wch: 30 }, // Tên Trạm
    { wch: 15 }, // Mã CSKCB
    { wch: 20 }, // Quận Huyện
    { wch: 35 }, // URL
    { wch: 20 }, // Username
    { wch: 20 }, // Password
    { wch: 25 }  // Ghi chú
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'CauHinhTramYTe');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Đọc file Excel người dùng tải lên và chuẩn hóa thành danh sách cấu hình
 */
function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet);

  const stations = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const rowIdx = index + 2; // Dòng 1 là Header, bắt đầu dữ liệu từ dòng 2

    // Hỗ trợ cả tên cột tiếng Việt có dấu, không dấu hoặc tiếng Anh
    const name = row['Tên Trạm Y Tế'] || row['Ten Tram Y Te'] || row['Tên Trạm'] || row['Station Name'] || row['name'];
    const code = String(row['Mã CSKCB'] || row['Ma CSKCB'] || row['Mã trạm'] || row['code'] || '').trim();
    const district = row['Quận/Huyện'] || row['Quan/Huyen'] || row['Huyện'] || row['district'] || '';
    const url = row['URL Portal HIS'] || row['URL HIS'] || row['URL'] || row['url'] || '';
    const username = String(row['Tên đăng nhập'] || row['Ten dang nhap'] || row['Username'] || row['username'] || '').trim();
    const password = String(row['Mật khẩu'] || row['Mat khau'] || row['Password'] || row['password'] || '').trim();
    const notes = row['Ghi chú'] || row['Ghi chu'] || row['notes'] || '';

    if (!name && !username && !code) {
      // Bỏ qua dòng trống
      return;
    }

    if (!name) {
      errors.push(`Dòng ${rowIdx}: Thiếu tên trạm y tế`);
      return;
    }
    if (!username) {
      errors.push(`Dòng ${rowIdx} (${name}): Thiếu tên đăng nhập`);
      return;
    }

    stations.push({
      name: String(name).trim(),
      code: code || `AUTO_${Date.now().toString().slice(-4)}_${index}`,
      district: String(district).trim(),
      url: String(url).trim(),
      username,
      password,
      notes: String(notes).trim(),
      active: true
    });
  });

  return { stations, errors };
}

/**
 * Xuất danh sách trạm y tế hiện tại ra file Excel
 */
function exportStationsToExcelBuffer() {
  const stations = db.getStations(true); // Giải mã mật khẩu để người quản trị có file đầy đủ

  const exportData = stations.map((s, index) => ({
    'STT': index + 1,
    'Tên Trạm Y Tế': s.name,
    'Mã CSKCB': s.code,
    'Quận/Huyện': s.district || '',
    'URL Portal HIS': s.url || '',
    'Tên đăng nhập': s.username,
    'Mật khẩu': s.password,
    'Trạng thái': s.status === 'success' ? 'Đã kết nối' : s.status === 'failed' ? 'Lỗi' : 'Chưa kiểm tra',
    'Kiểm tra lần cuối': s.lastTested ? new Date(s.lastTested).toLocaleString('vi-VN') : '',
    'Thông báo kết nối': s.lastTestedMessage || '',
    'Hoạt động': s.active ? 'Bật' : 'Tắt',
    'Ghi chú': s.notes || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  worksheet['!cols'] = [
    { wch: 6 },  // STT
    { wch: 30 }, // Tên Trạm
    { wch: 14 }, // Mã CSKCB
    { wch: 18 }, // Quận Huyện
    { wch: 35 }, // URL
    { wch: 18 }, // Username
    { wch: 18 }, // Password
    { wch: 15 }, // Trạng thái
    { wch: 22 }, // Kiểm tra lần cuối
    { wch: 30 }, // Thông báo kết nối
    { wch: 12 }, // Hoạt động
    { wch: 25 }  // Ghi chú
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DanhSachTramYTe');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  generateTemplateBuffer,
  parseExcelBuffer,
  exportStationsToExcelBuffer
};
