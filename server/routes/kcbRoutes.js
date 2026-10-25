const express = require('express');
const router = express.Router();
const kcbService = require('../services/kcbService');

/**
 * Lấy dữ liệu thống kê & biểu đồ khám chữa bệnh
 */
router.get('/thong-ke', async (req, res) => {
  try {
    const data = await kcbService.getKcbDashboardData(req.query);
    res.json({
      success: true,
      data: data,
      ...data
    });
  } catch (err) {
    console.error('Lỗi lấy thống kê KCB:', err);
    res.status(500).json({
      success: false,
      message: 'Lỗi lấy dữ liệu thống kê khám chữa bệnh: ' + err.message
    });
  }
});

/**
 * Lấy danh sách phòng khám của trạm
 */
router.get('/phong-kham', async (req, res) => {
  try {
    const list = await kcbService.getPhongKhamList(req.query.stationId);
    res.json({
      success: true,
      data: list
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * Xuất file Excel báo cáo thống kê khám chữa bệnh
 */
router.get('/export-excel', async (req, res) => {
  try {
    const buffer = await kcbService.exportKcbExcel(req.query);
    const fileName = `BaoCao_ThongKe_KhamBenh_HMIS_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Lỗi xuất Excel KCB:', err);
    res.status(500).json({
      success: false,
      message: 'Không thể xuất file Excel: ' + err.message
    });
  }
});

module.exports = router;
