---
name: sua-ma-thuoc-hmis
description: >-
  Quy trình chuẩn và các quy tắc an toàn khi sửa mã thuốc, cập nhật thông tin
  danh mục thuốc/vật tư trên cổng VNPT HMIS (API pharmacy/dmthuoc/luuthongtinthuocvattu)
  hoặc khắc phục lỗi HTTP 500 ("Lỗi kết nối đến máy chủ!") khi bấm Sửa -> Lưu (F4)
  trên giao diện HMIS. Sử dụng skill này bất cứ khi nào cần sửa mã thuốc, đối soát
  thuốc, sửa lỗi lưu danh mục thuốc/vật tư, hoặc xử lý thuốc có thầu ghép lỗi (như ;;;2026).
---

# Skill: Sửa Mã Thuốc & Cập Nhật Danh Mục Thuốc An Toàn Trên VNPT HMIS

## 1. Nguyên Tắc Bắt Buộc Để Không Gây Lỗi Khi Sửa Thuốc Về Sau

Trên cổng VNPT HMIS, endpoint `POST pharmacy/dmthuoc/luuthongtinthuocvattu` có một đặc thù rất nguy hiểm ở backend Java:

- Khi lưu thuốc lần đầu từ bản ghi mới nạp Excel (nơi hơn 60 cột cờ/số đang là `null` trong DB), **tuyệt đối không được gửi nguyên object `{ ...detail }` lấy từ `layctthuoctheoid`**.
- Nếu gửi `{ ...detail }` chứa các trường `null` (đặc biệt `tenAtc: null`, `thuocKhangSinh: null`, `khoa: null`, v.v.):
  1. Lần gọi API đầu tiên vẫn trả về `200 OK`, nhưng backend ghi 1 bản ghi lịch sử vào bảng `pharmacy/duclogthuocvattu` với `tenAtc = null` và các cờ số = `null`.
  2. Từ **lần sửa thứ 2 trở đi** (kể cả khi người dùng bấm **Sửa -> Lưu (F4)** trên giao diện web HMIS), backend đọc lại bản ghi lịch sử bị `null` này và văng `NullPointerException` (`HTTP 500 - "Lỗi kết nối đến máy chủ!"`).

### Các Quy Tắc Vàng Bắt Buộc Khi Gọi `luuthongtinthuocvattu`

1. **Luôn chuẩn hóa payload theo đúng cấu trúc `ra` của Angular UI** (`buildHmisDrugSavePayload` trong `server/services/suaMaThuocService.js`):
   - Ép toàn bộ các cờ boolean/số về `0` hoặc `1` (không để `null`).
   - Ép các trường chuỗi rỗng về `""` (không để `null`).
   - Luôn gán `tenAtc: 'string'`, `nguoiCapNhat: 0`, `ngayCapNhat: ''`, `ngayThucHien: ''`, `nguoiThucHien: ''`.
   - Chuyển các trường ngày (`tuNgay`, `denNgay`, `ngayCheckGuiBH`, `ngayHlBhyt`, `ngayKetThucHd`) từ `dd/MM/yyyy` sang chuẩn ISO-8601 (`toIsoDate`).
   - Cập nhật đồng bộ cả `maThuoc` và `maThuocBv` bằng mã mới.
2. **Luôn dọn sạch bản ghi log lỗi trong `pharmacy/duclogthuocvattu` trước khi lưu**:
   - Trước khi gọi `POST pharmacy/dmthuoc/luuthongtinthuocvattu`, truy vấn:
     `GET pharmacy/duclogthuocvattu/search?page=0&size=50&sort=id,asc&filter=thuocVatTuId==<hmisId>`
   - Xóa mọi bản ghi log có `tenAtc === null` (bao gồm cả log `UPDATE` lẫn log `INSERT` tạo từ API cũ) bằng:
     `DELETE pharmacy/duclogthuocvattu/delete?id=<logId>`
3. **Bắt buộc kiểm chứng lưu liên tiếp 2 lần (Double-Save Verification)**:
   - Sau khi sửa hoặc khôi phục thuốc mẫu, luôn kiểm thử gọi `luuthongtinthuocvattu` **2 lần liên tiếp** để chắc chắn cả lần 1 và lần 2 đều trả về `200 OK (code: 0, message: "Success")`. Nếu lần 2 thành công thì giao diện web HMIS chắc chắn bấm **Sửa -> Lưu (F4)** được mãi mãi.

---

## 2. Quy Trình Sửa Mã Thuốc Chuẩn (Codebase)

Khi viết code hoặc gọi hàm sửa mã thuốc trong dự án, luôn sử dụng hàm đã chuẩn hóa trong `server/services/suaMaThuocService.js`:

- `buildHmisDrugSavePayload(detail, hmisId, newMa, companyId)`
- `updateSingleDrugOnHmis(auth, hmisId, newMa)`
- `batchUpdateDrugsOnHmis(stationId, updateList)`

---

## 3. Quy Trình Khắc Phục Thuốc Bị Lỗi Sửa (HTTP 500) Hoặc Thầu Ghép Lỗi (`;;;2026`)

Sử dụng script hỗ trợ đi kèm: [repair_station_drugs.js](./scripts/repair_station_drugs.js)

### Bước 1: Quét kiểm tra (Dry-Run — không ghi dữ liệu)
```powershell
# Kiểm tra riêng 1 trạm (ví dụ trạm 11098 hoặc 11158)
node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --station 11098 --dry-run

# Kiểm tra các thuốc có thầu ghép lỗi (;;;2026) trên 1 trạm
node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --station 11158 --thau-ghep ";;;2026" --dry-run

# Quét toàn bộ 43 trạm
node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --all --dry-run
```

### Bước 2: Chạy sửa & kiểm chứng 2 lần (`--verify`)
```powershell
# Sửa tất cả thuốc bị lỗi log null trên trạm 11098 và kiểm thử lưu 2 lần
node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --station 11098 --verify

# Sửa các thuốc có thầu ghép ;;;2026 trên trạm 11158 và kiểm thử lưu 2 lần
node .agents/skills/sua-ma-thuoc-hmis/scripts/repair_station_drugs.js --station 11158 --thau-ghep ";;;2026" --verify
```

---

## 4. Lưu Ý Khi Sửa Trên Giao Diện Web HMIS

Ngay cả khi backend đã trả về `200 OK`, giao diện Angular HMIS vẫn kiểm tra các trường bắt buộc có dấu `*` trước khi gửi request. Nếu thuốc được tạo từ nguồn cũ bị thiếu:
- **Hãng sản xuất** (`hangSanXuatId`), **Đơn vị tính** (`donViTinhId`), **Đường dùng** (`duongDungId` đối với thuốc), **Nhóm TK** (`khoanMucId`), **Thầu ghép** (`thauGhep`).
- Với nhóm BHXH = `10` (Thuốc): bắt buộc có **Tên BHYT/Tên khoa học** (`tenKhoaHoc`), **Mã BYT** (`maByt`), **Số đăng ký** (`soDangKy`).
-> Cần điền/chọn đủ các trường có dấu `*` trên form trước khi bấm **Lưu (F4)**.
