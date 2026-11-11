# Quy Tắc Phát Triển & An Toàn Hệ Thống Thật (HMIS / Production APIs)

## 1. Kiểm tra kỹ lưỡng API trước khi triển khai chức năng
- Phân tích chi tiết request, headers, query parameters, payload schema và kiểu dữ liệu thực tế (đặc biệt các trường ngày giờ ISO/ZonedDateTime, định dạng số, mã định danh quan hệ).
- Kiểm chứng hành vi của API trước khi viết mã chính thức để nắm rõ các phản hồi thành công và mã lỗi nghiệp vụ (HTTP 422, 500).

## 2. Tránh thêm mới / ghi đè dữ liệu trực tiếp vào hệ thống thật
- Tuyệt đối không tùy tiện gọi API tạo mới hoặc sửa đổi hàng loạt bản ghi danh mục (thuốc, vật tư, nhân viên, cấu hình trạm) trực tiếp lên cơ sở dữ liệu live khi chưa kiểm chứng 100% ràng buộc toàn vẹn.
- Tránh nguy cơ tạo dữ liệu rác, trùng mã danh mục hoặc gây lỗi khóa hệ thống (đặc biệt khi hệ thống thật chặn thao tác xóa hoặc rollback).

## 3. Ưu tiên giải pháp xuất file nạp chuẩn (Native Import Flow)
- Đối với các nghiệp vụ bổ sung dữ liệu danh mục, ưu tiên sinh file Excel/CSV chuẩn theo đúng định dạng mẫu của VNPT HIS (như file mẫu 78 cột) để người dùng tải về và nạp qua chức năng Import chính thức của phần mềm.
- Cách tiếp cận này đảm bảo toàn bộ dữ liệu đi qua bộ lọc kiểm tra tính hợp lệ (validation engine) của chính cổng HMIS.
