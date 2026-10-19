const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// Hàm phân tích cú pháp CSV hỗ trợ dấu ngoặc kép và xuống dòng bên trong dấu ngoặc kép
function parseCSV(text) {
  const p = [];
  let row = [''];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i+1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (!inQuotes && c === ',') {
      row.push('');
      i++;
      continue;
    }
    if (!inQuotes && (c === '\r' || c === '\n')) {
      if (c === '\r' && next === '\n') i++;
      // Chỉ push dòng nếu không rỗng hoàn toàn
      if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
        p.push(row);
      }
      row = [''];
      i++;
      continue;
    }
    row[row.length - 1] += c;
    i++;
  }
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
    p.push(row);
  }
  return p;
}

const raw = fs.readFileSync(path.join(__dirname, 'data/vattu_bhxh_input.csv'), 'utf8');
const parsed = parseCSV(raw);

console.log('Total parsed rows:', parsed.length);
const header = parsed[0];
console.log('Header length:', header.length);

// Chuẩn hóa đúng 78 cột chuẩn HIS
const finalRows = [];
finalRows.push(header);

// Danh sách các cột dạng số trong 78 cột
const numericColIndices = new Set([
  0,  // STT
  13, // GIA_THAU
  14, // NHOM_BHXH
  15, // GIA_BAN
  16, // GIA_DICH_VU
  17, // GIA_BHYT
  18, // GIA_BHYT_QUYET_TOAN
  19, // BHYT_CHI_TRA
  28, // TYLEHUHAO
  42, // SO_LUONG
  44, // LOAI_THUOC
  45, // LOAI_THAU
  46, // HT_THAU
  53, // DMGUIBH
  60, // TLHH_CB
  61, // TLHH_BQ
  62  // THANH_TIEN_THUOC
]);

for (let r = 1; r < parsed.length; r++) {
  const row = parsed[r];
  const newRow = [];
  for (let c = 0; c < 78; c++) {
    let val = row[c] !== undefined ? row[c].trim() : '';
    
    // Nếu rỗng -> để trống (null hoặc '')
    if (val === '') {
      newRow.push('');
      continue;
    }

    // Nếu là cột số và parse được thành số hợp lệ
    if (numericColIndices.has(c)) {
      const cleaned = val.replace(/\./g, '').replace(/,/g, '.');
      const num = Number(cleaned);
      if (!isNaN(num) && cleaned !== '') {
        newRow.push(num);
      } else {
        newRow.push(val);
      }
    } else {
      newRow.push(val);
    }
  }
  finalRows.push(newRow);
}

console.log('Processed data rows:', finalRows.length - 1);

// Tạo file Excel chuẩn với Sheet "Mẫu"
const wb = xlsx.utils.book_new();
const ws = xlsx.utils.aoa_to_sheet(finalRows);

// Đặt độ rộng cột cho đẹp
const colWidths = [];
for (let c = 0; c < 78; c++) {
  let maxLen = (header[c] || '').length;
  for (let r = 1; r < Math.min(finalRows.length, 20); r++) {
    const valStr = String(finalRows[r][c] || '');
    if (valStr.length > maxLen) maxLen = valStr.length;
  }
  colWidths.push({ wch: Math.min(Math.max(maxLen + 3, 10), 45) });
}
ws['!cols'] = colWidths;

xlsx.utils.book_append_sheet(wb, ws, 'Mẫu');

// Lưu file ra các vị trí:
// 1. data/
const outPath1 = path.join(__dirname, 'data/File_Import_VTYT_VNPT_HIS_Chuan_78Cot.xlsx');
xlsx.writeFile(wb, outPath1);
console.log('Saved to:', outPath1);

// 2. client/public/ (để có thể tải trực tiếp qua trình duyệt)
const outPath2 = path.join(__dirname, 'client/public/File_Import_VTYT_VNPT_HIS_Chuan_78Cot.xlsx');
xlsx.writeFile(wb, outPath2);
console.log('Saved to:', outPath2);
