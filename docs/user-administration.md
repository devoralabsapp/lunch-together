# User profile editing and deletion

Verified, enabled customer administrators can edit a user's display/order name,
company, department, phone and job title. The Google email, provider, UID and
identity timestamps remain unchanged. Names on existing orders are preserved.
Only the primary administrator can edit another administrator's profile; an
administrator can still edit their own profile.

Deletion is allowed only for a user who has never ordered. Canceled orders count
as history, as does immutable ordering activity after a guest-order transfer.
The directory disables deletion immediately when stored orders exist; the API
independently rechecks history before making any deletion. Current accounts,
the primary administrator, enabled administrator roles and system identities are
protected. Revoke another administrator's role before deleting their unused account.

## Server workflow

The endpoint is served by the Lunch Together customer portal.
`POST /api/admin/users/delete` takes JSON `{ "uid": "TARGET_UID" }` and a Firebase
ID token in `Authorization: Bearer ...`. The server verifies the complete token
through Firebase Auth, verified Google provider and the administrator document.
It accepts no client assertions about order counts or eligibility.

1. Read the target and acquire an administrator-owned `userAccess` deletion lock
   with an update-time precondition. New orders on behalf of this UID, profile
   changes and ownership transfers in either direction are blocked while locked.
2. Page all meal days and query for any order owned by the UID, including canceled
   orders. Check the user's immutable ordering activity for transferred history.
   Any unreadable/truncated result fails closed. No new composite index is needed.
3. Using the existing restricted server identity, atomically delete the application
   profile and personal details, retain a blocked/deleted access record, and append
   a deletion log with the requesting administrator UID. Browser SDK deletion and
   forged deleted states are denied by Rules. Concurrent edits abort the commit.
4. On failure, release only the exact acquired lock version, restoring the prior
   blocked state. A changed lock is never overwritten. If a request is terminated
   before cleanup, an administrator can use the existing unblock action to cancel
   the pending lock; the old request then cannot commit against that version.

The existing `PAYMENT_FIREBASE_REFRESH_TOKEN` service configuration is reused;
no service-account key, OIDC or additional environment variable is required.
This is application account deletion. Firebase Auth identities are retained;
orders, payments, credits, audit history and merchant membership classification
are never deleted. The blocked/deleted record prevents the UID from recreating
its profile and refuses app admission. Retained merchant membership cannot turn
the removed account into a customer; the blocked state also denies Merchant access.

## Tiếng Việt

Trong **Quản trị → Quản trị người dùng**, bấm **Sửa** để cập nhật hồ sơ. Email đăng
nhập do Google quản lý; thay đổi tên không sửa các đơn đã đặt.

Chỉ người chưa từng đặt cơm mới được xóa. Có đơn đã hủy vẫn không được xóa. Máy chủ
kiểm tra lại lịch sử và khóa tranh chấp trước khi xóa hồ sơ, rồi vô hiệu hóa quyền
dùng ứng dụng. Tài khoản xác thực Firebase và lịch sử được giữ lại; không xóa đơn
hay thông tin thanh toán. Mỗi lần sửa/xóa đều được ghi nhật ký cho quản trị.

Publish the complete shared `firestore.rules` before using this release. Validate
locally with `npm test` (Auth/Firestore Emulator, fictitious identities only).
