# Store directory, navigation and linked meal days

Merchant desktop navigation is in the left sidebar. On narrow screens it becomes
a horizontal navigation strip. Restaurant and meal date selectors are adjacent;
changing restaurant retains the selected date. The Stores section is a directory,
not a dated workspace, so it has no date selector or unbound-day notice.

## Stores

Approved owners and system administrators add stores. Store owners/managers may
edit details within their permissions. Only owners/system administrators archive
or restore stores. Delete is deliberately recoverable: it sets archived=true and
active=false, retaining the document, menu, events, historical orders and immutable
meal-day bindings. Archived stores are excluded from operational selectors and
new customer-day choices. Use Archived in Stores to restore a store. Other tenant
mutations still require active membership and an active store; account suspension
also blocks restoration. Existing stores without archived remain compatible.

## Branch menus

The branch daily menu uses the same item form/table pattern as the dish catalog.
Add or edit a dish and save it immediately; remove a dish from this branch/date.
All operations use revision-checked transactions. An empty private branch menu is
valid, while a published customer menu still needs 1–60 valid dishes. Catalog and
private daily menus are independent. Existing customer menus are published through
the existing shared editor; editing a branch draft does not rewrite old orders.

## Create a day in Lunch Together

In Order history → Create meal day, administrators choose either Enter manually
or Link a restaurant. Manual entry retains the existing flow. The linked option
lists active, non-archived restaurants and previews their saved branch menu for
the chosen date. The restaurant must prepare that dated menu first.

Saving the linked option atomically creates the customer meal day, copies the
current branch menu, records its immutable restaurant/date binding and appends
both business and customer audit events. An existing day or binding is refused;
concurrent creation cannot overwrite another submission. Inactive stores and empty
menus are rejected before any partial day is created. Later shared-menu publication
still follows existing merchant role and cutoff rules.

Publish the complete configured customer firestore.rules before operational use.
No new index, environment variable, private key or OIDC setup is needed. Public
Rules retain PRIMARY_ADMIN_UID_HERE. Tests use fictitious demo Emulator data only.

## Tiếng Việt

Merchant chuyển menu desktop sang bên trái; bộ chọn nhà hàng nằm cạnh ngày.
Tab Cửa hàng có danh sách thêm/sửa/xóa và mục Đã lưu trữ để khôi phục. Xóa giữ
lịch sử thay vì xóa vĩnh viễn. Thực đơn cơ sở hiển thị dạng bảng như Danh mục món.
Ở Cơm Nhà, Lịch sử đặt cơm → Tạo ngày mới có Nhập thủ công hoặc Liên kết nhà hàng.
Nhà hàng cần lưu thực đơn cơ sở cho đúng ngày trước khi quản trị tạo ngày liên kết.
