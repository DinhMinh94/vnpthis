const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/config');
const stationRoutes = require('./routes/stationRoutes');
const settingRoutes = require('./routes/settingRoutes');
const thuocRoutes = require('./routes/thuocRoutes');
const nhanVienRoutes = require('./routes/nhanVienRoutes');
const phieuInRoutes = require('./routes/phieuInRoutes');
const chucDanhRoutes = require('./routes/chucDanhRoutes');

const app = express();

// Middlewares
app.use(cors());
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  if (req.url === '/' || req.url.endsWith('.html') || req.url.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/stations', stationRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/thuoc', thuocRoutes);
app.use('/api/nhanvien', nhanVienRoutes);
app.use('/api/phieuin', phieuInRoutes);
app.use('/api/chucdanh', chucDanhRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'VNPT HMIS 4.0 Multi-Station Manager Tool',
    version: '1.0.0'
  });
});

// Serve frontend static build nếu có
const clientBuildPath = path.join(__dirname, '../client/dist');
const clientPublicPath = path.join(__dirname, '../client/public');

if (require('fs').existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else if (require('fs').existsSync(clientPublicPath)) {
  app.use(express.static(clientPublicPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientPublicPath, 'index.html'));
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Lỗi hệ thống:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Lỗi máy chủ nội bộ'
  });
});

app.listen(config.PORT, () => {
  console.log(`====================================================`);
  console.log(`  VNPT HMIS 4.0 - HỆ THỐNG QUẢN LÝ CẤU HÌNH TRẠM Y TẾ `);
  console.log(`  Máy chủ đang chạy tại: http://localhost:${config.PORT} `);
  console.log(`====================================================`);
});
