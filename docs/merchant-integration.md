# Merchant companion / Ứng dụng nhà hàng

[Lunch Together Merchant](https://github.com/devoralabsapp/lunch-together-merchant) shares this application's Firebase Authentication and Firestore Standard database. Publish the complete current Rules and add the merchant hostname to Firebase Auth authorized domains before using it.

Existing customer administrators provision restaurants and immutable `merchantDays/{dayId}` assignments. Each day has one restaurant. Owners/managers publish menus into the existing day/dish schema; kitchen staff cannot edit menus or customer finances. Orders are the same documents rather than replicated copies. Customer refresh remains up to 30 seconds, or manual refresh; merchant orders and customer preparation statuses use live listeners.

The customer UI shows restaurant acknowledgment, cooking, readiness and delivery. Changed operational instructions trigger a warning until the restaurant accepts again. The shared SHA-256 fingerprint includes order ID, dish, quantity, price, note and cancellation, excluding payment changes and timestamps. It is an operational signal, not a lock or financial attestation.

New merchant management/catalog/activity permissions are scoped to the assigned restaurant. Existing authenticated shared order visibility and all financial checks remain intact. Old days without restaurant bindings keep working. No new composite index is required.

## Tiếng Việt

Quản trị Cơm Nhà đăng nhập ứng dụng merchant, tạo nhà hàng, cấp chủ/quản lý/nhà bếp bằng UID Google và liên kết ngày. Liên kết ngày được giữ cố định để bảo toàn lịch sử. Nhà hàng chỉ đăng thực đơn cho ngày đã gắn, không tự mở lại ngày đã chốt. Khách tiếp tục đặt/sửa/hủy theo quyền cũ.

Trạng thái bếp và ghi chú giao hàng hiện trên Cơm Nhà. Khi khách thay đổi yêu cầu chuẩn bị, hai phía báo cần xác nhận danh sách mới; thay đổi thanh toán đơn thuần không làm bếp phải xác nhận lại. Quyền xác nhận tiền, hoàn và số dư vẫn thuộc hệ thống thanh toán hiện có.
