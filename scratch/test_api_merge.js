const fs = require('fs');
const http = require('http');

const kk = fs.readFileSync('C:/Users/MINHND_DBN/.gemini/antigravity/brain/d3ee825a-66de-4a75-b563-73a7e20ad0ed/.user_uploaded/media_1793868116238_f9a1d42e.xlsx');
const xnt = fs.readFileSync('C:/Users/MINHND_DBN/.gemini/antigravity/brain/d3ee825a-66de-4a75-b563-73a7e20ad0ed/.user_uploaded/media_1793868124383_0832f77a.xlsx');

const boundary = '----WebKitFormBoundaryXYZ' + Date.now();

const part1 = Buffer.from(
  '--' + boundary + '\r\n' +
  'Content-Disposition: form-data; name="fileKiemKe"; filename="bbKiemke.xlsx"\r\n' +
  'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
);
const part2 = Buffer.from(
  '\r\n--' + boundary + '\r\n' +
  'Content-Disposition: form-data; name="fileXNT"; filename="Bao_cao_XNT.xlsx"\r\n' +
  'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
);
const partEnd = Buffer.from('\r\n--' + boundary + '--\r\n');

const body = Buffer.concat([part1, kk, part2, xnt, partEnd]);

const req = http.request('http://localhost:5000/api/tondau-thuoc/merge-files', {
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': body.length
  }
}, (res) => {
  let responseText = '';
  res.on('data', chunk => responseText += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(responseText);
      console.log('STATUS:', res.statusCode);
      console.log('SUCCESS:', data.success);
      console.log('TOTAL_ROWS:', data.totalRows);
      console.log('SUMMARY:', data.summary);
      console.log('SAMPLE_ROW_1:', data.previewRows[0]);
    } catch (e) {
      console.log('RAW RESPONSE:', responseText);
    }
  });
});

req.on('error', err => {
  console.error('Request error:', err);
});

req.write(body);
req.end();
