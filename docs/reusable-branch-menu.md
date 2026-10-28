# Reusable branch menu

Merchant Daily menu now contains one **Branch menu / Thực đơn riêng của cơ sở**
panel. The separate Menu shared with Lunch Together panel is removed. Add/edit
rows or select shared catalog dishes, then **Publish menu / Đăng thực đơn**.
Row edits are a local draft until publication; Reload discards them.

A published menu is effective from the selected date and reused on later dates
until the next publication. There is no daily republishing or copying requirement.
Owners/managers publish; kitchen users can read. Other branches retain their own
menus. The shared restaurant catalog and all financial permissions stay unchanged.

The existing offers/{YYYY-MM-DD} records are effective-date versions. Both apps
select the latest version with date <= the requested service date, ordered by
date descending with limit 1. A future publication cannot apply to earlier dates.
This uses Standard Firestore's automatic single-field date index; no new Rules,
index, environment variable or trusted service account is required.

Before first publication the Merchant editor can load the latest saved legacy
branch menu as an unpublished draft, without publishing it automatically. Customer
day creation keeps the exact-date legacy fallback only when no published version
is effective yet. A published version always takes precedence over legacy drafts.

Customer administrators still create and link meal days through the existing flow.
The selected effective menu is copied with its revision checked atomically.
Existing customer days and order prices are historical snapshots, not a mutable
view of the branch menu. Publishing updates the selected customer's day only if
it is already assigned to this branch; it does not rewrite other existing days.
Thus changing tomorrow's menu does not alter yesterday's menu or old order prices.
An already-created future meal day also retains its snapshot until explicitly
published while selecting that date. Publication checks loaded source and target
revisions and refuses stale same-date edits; users can Reload and retry.

## Tiếng Việt

Chỉ còn một bảng Thực đơn riêng của cơ sở, có nút Đăng thực đơn ngay trong bảng.
Thực đơn đã đăng dùng hằng ngày từ ngày được chọn đến khi quản lý đăng bản mới.
Sửa/thêm/bỏ món là bản nháp; bấm Đăng thực đơn mới áp dụng. Mỗi cơ sở có thực đơn
riêng, danh mục món vẫn dùng chung trong nhà hàng. Ngày và đơn cũ giữ nguyên.
Không cần Publish Rules, thêm chỉ mục hoặc cấu hình mới cho thay đổi này.
