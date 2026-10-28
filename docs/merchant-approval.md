# Merchant approval and multiple branches

Vietnamese and Playful Retro Neo-Brutalism remain the defaults. The language
selector also offers English. Six independent themes are available: Classic,
Command Line (black/gray), Visual Studio Code, Excel, Midnight and Retro. Theme
choice uses a validated cookie and server-rendered root attribute; changing a
theme does not switch stores or reset a menu draft. Language choice is retained
in the browser; currency stays VND and operational dates use Vietnam time.

## Onboarding and administration

1. A new verified Google user signs into Merchant. The app creates a pending
   application and shows only the registration/status screen. Applicants can
   update their business name, contact phone and introduction, and resubmit a
   declined application. They cannot read private restaurant data or create stores.
2. An existing Lunch Together administrator signs into Merchant and selects
   **Merchant approvals / Phê duyệt Merchant** in the top bar. Review pending
   applications, approve or decline them, and provide feedback. The same panel
   suspends or restores previously approved accounts. Lists process batches of
   up to 200 requests per status and refresh as requests are handled.
3. Approval atomically writes the review, immutable audit event and enabled
   `merchantUsers/{uid}` identity marker. New markers have `accountOnly: true`;
   they are not a restaurant assignment. Existing legacy assignments are retained.
4. The approved user can immediately create multiple stores/branches. Each has
   an immutable owner UID, separate details, catalog, dated menus, staff and events.

Only system administrators review applications. A verified email alone grants no
operational access. Existing explicit legacy grants continue working. Pending
customer accounts can still use Lunch Together; approval reserves the account
for Merchant. Root markers are retained after suspension or application-account
deletion, so revoked access cannot fall back to the customer portal. System
administrators retain their explicit cross-portal exception. Account blocks apply
to merchant operations as well.

## Multiple stores and staff

Owners discover stores with `ownerId == current UID`. Staff assignments are stored
in `merchantStoreUsers/{merchantId}~{uid}` and discovered with a UID equality query;
owners query the same collection by merchant ID. One approved person can have
different roles at multiple branches. Only store owners/system admins manage
staff, and ordinary owners cannot grant owner roles or edit their own grants.
Store ownership remains immutable. A disabled explicit grant overrides an old
legacy staff membership; the actual store owner cannot be removed by a staff grant.

The root `merchantUsers` collection remains the compatibility and identity layer.
Legacy one-store grants still work. New staff assignments use the per-store
collection. Staff must first receive approval or an existing explicit system-admin
grant. No other restaurant's data is visible merely because an account is approved.

## Branch menus and Lunch Together synchronization

`merchants/{id}/menus/{YYYY-MM-DD}` stores date, menu count and update metadata;
its dishes subcollection uses the same validated name hash/price schema as the
customer application. Different branches can save different menus on the same
date. Concurrent saves verify the expected revision before committing.

The **Branch daily menu / Thực đơn riêng của cơ sở** editor works independently
of customer meal-day assignment. Existing **Menu shared with Lunch Together**
still publishes only for an administrator-bound `merchantDays/{dayId}`. Use
**Use branch menu / Dùng thực đơn cơ sở** to load the saved branch menu into that
shared editor. Existing order prices, cutoff rules, payments and refunds remain
unchanged. The existing customer system still assigns one restaurant per meal day.

## Deployment and verification

Publish the complete shared Rules from the operator's configured customer repo.
Public `integration/firestore.rules` deliberately retains the primary-admin UID
placeholder. Queries use existing single-field indexes; no new composite index,
environment variable, service-account key or OIDC configuration is required.

Run `npm test`, `npm run build` and `npm run typecheck` here. The customer repo's
`npm test` additionally validates approval, multi-store boundaries, legacy grants,
customer account separation and the existing financial suite against Emulator.
Use fictitious local-emulator users for browser testing, never production records.

## Tiếng Việt

Người mới đăng nhập Google sẽ ở màn **Chờ quản trị phê duyệt**. Quản trị vào
**Phê duyệt Merchant** để duyệt, từ chối, khóa hoặc mở lại. Sau khi được duyệt,
người dùng có thể thêm nhiều cửa hàng/cơ sở, mỗi nơi có món, thực đơn và nhân sự
riêng. Một nhân sự có thể làm ở nhiều cơ sở với các vai trò khác nhau.

Thực đơn cơ sở có thể lưu độc lập. Để nhận đơn từ Cơm Nhà, quản trị vẫn liên kết
ngày đặt cơm với cơ sở phù hợp; nhà hàng chọn thực đơn cơ sở và đăng vào ngày đã
liên kết. Giữ nguyên dữ liệu và quyền thanh toán của Cơm Nhà.
