# VNPT HIS Multi-Station Hub - Quản Lý & Cấu Hình Trạm Y Tế

Hệ thống Web Tool chuyên biệt hỗ trợ quản trị viên, cán bộ CNTT Trung tâm Y tế thiết lập và quản lý cấu hình tập trung cho **15 đến 20 trạm y tế (TYT)** cùng lúc, với mỗi trạm sở hữu tài khoản và mật khẩu VNPT HIS riêng biệt.

---

## 🌟 Tính Năng Nổi Bật

### 1. Cấu hình nhanh cho nhiều trạm cùng lúc (Bulk Fast Setup)
- **Bảng nhập nhanh (Grid Editor)**: Giao diện bảng 20 dòng trực quan như Excel, hỗ trợ:
  - Tự động điền URL HIS mặc định cho toàn bộ danh sách.
  - Tự động sinh mã CSKCB theo thứ tự (01001, 01002...).
  - Nút nạp sẵn mẫu 20 Trạm Y Tế để trải nghiệm tức thì.
- **Dán danh sách văn bản (Quick Text Paste)**: Dán dữ liệu theo dòng định dạng:
  `Tên trạm | Mã CSKCB | Username | Password | URL HIS` hoặc copy trực tiếp nhiều dòng từ file Excel/Google Sheets vào.

### 2. Quản lý & Đồng bộ Excel (Excel Import / Export)
- **Tải file Excel mẫu (`.xlsx`)**: Tải về file mẫu đã định dạng sẵn các cột chuẩn y tế.
- **Nhập từ Excel**: Tải file Excel danh sách 15-20 trạm lên, hệ thống tự động nhận diện và nạp dữ liệu.
- **Xuất ra Excel**: 1-click xuất toàn bộ cấu hình, trạng thái kết nối, mã trạm và mật khẩu ra file Excel báo cáo.

### 3. Kiểm tra kết nối & Tự động hóa đăng nhập (Connectivity Engine)
- **Kiểm tra hàng loạt (Batch Test)**: Bấm 1 nút để kiểm tra trạng thái đăng nhập của toàn bộ 15-20 trạm song song an toàn (có giới hạn đồng thời để không quá tải mạng).
- **Đo lường độ trễ (Latency ms)**: Hiển thị thời gian phản hồi của từng trạm.
- **2 Chế độ hoạt động**:
  - **Chế độ Mô phỏng (Simulation Mode)**: Tiện lợi khi thử nghiệm trên máy cá nhân chưa cắm mạng chuyên dùng VNPT WAN / VPN.
  - **Chế độ Kết nối thật (Live HIS)**: Gửi request trực tiếp đến cổng Portal VNPT HIS của tỉnh/huyện để kiểm tra trạng thái hoạt động thực tế.

### 4. Thao tác hàng loạt (Bulk Actions)
- Chọn checkbox nhiều trạm:
  - Kiểm tra kết nối các trạm được chọn.
  - Đổi đường dẫn URL Portal HIS chung cho các trạm được chọn.
  - Xóa hàng loạt trạm không còn sử dụng.

### 5. Bảo mật cao (Security & Privacy)
- Toàn bộ mật khẩu của các trạm y tế được mã hóa an toàn bằng thuật toán **AES-256-CBC** trước khi lưu vào CSDL.
- Giao diện có chế độ che mật khẩu (`••••••••`) và nút bật/tắt xem hoặc sao chép 1-click.
- Lưu trữ CSDL cục bộ tại thư mục `data/stations.json` với cơ chế ghi nguyên tử (Atomic write), chống hỏng dữ liệu khi mất điện.
- Hỗ trợ **100% Offline** (toàn bộ thư viện giao diện đã được tích hợp sẵn, không phụ thuộc internet).

---

## 🚀 Hướng Dẫn Khởi Chạy

### Cách 1: Click đúp chuột (Nhanh nhất trên Windows)
- Bấm đúp vào file `start.bat` trong thư mục này. Trình duyệt web sẽ tự động mở tại địa chỉ:
  👉 **http://localhost:5000**

### Cách 2: Chạy bằng lệnh Terminal
```bash
# Khởi động server
npm start
```
Truy cập trình duyệt: **http://localhost:5000**

---

## 📂 Cấu Trúc Dự Án

```
minh/
├── client/
│   └── public/
│       ├── index.html       # Giao diện Web SPA chính (Vue 3 + Tailwind + Lucide)
│       └── vendor/          # Thư viện offline (Vue, Axios, Tailwind, Lucide)
├── server/
│   ├── config/              # Cấu hình cổng port, khóa mã hóa AES
│   ├── routes/
│   │   ├── stationRoutes.js # API CRUD trạm, batch setup, import/export excel, test
│   │   └── settingRoutes.js # API cấu hình đơn vị & chế độ mô phỏng
│   ├── services/
│   │   ├── cryptoService.js # Mã hóa & giải mã mật khẩu AES-256
│   │   ├── db.js            # Quản lý CSDL JSON nguyên tử
│   │   ├── excelService.js  # Xử lý đọc & tạo file Excel (.xlsx)
│   │   └── hisService.js    # Engine kết nối & kiểm tra tài khoản VNPT HIS
│   └── index.js             # Entrypoint khởi động Express Server
├── data/                    # Thư mục lưu trữ CSDL (tự sinh)
├── package.json             # Cấu hình thư viện Node.js
├── start.bat                # Phím tắt khởi chạy 1-click trên Windows
└── README.md                # Tài liệu hướng dẫn sử dụng
```
