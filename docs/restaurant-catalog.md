# Shared restaurant catalog and published daily menus

## Catalog shared across branches

The Dish catalog is shared by stores with the same immutable ownerId. A legacy
store without ownerId keeps its own business key (store ID); unrelated owners are
never merged. The catalog has no date or branch selector. Select an operational
store through Overview or Stores when changing restaurant context.

The owner or a system administrator initializes the shared catalog automatically
when opening a store workspace. Existing active, non-archived branches are merged
without deleting their old catalog documents. Names are normalized to NFC,
trimmed and compared case-insensitively. Initially, the latest updated legacy
entry supplies a duplicate dish's price/status. Existing shared entries always
win on subsequent imports, so a retry or restored branch cannot overwrite an
explicit shared edit. Imported branch markers make retries safe. Archived
branches can be imported after restoration.

Owners/managers can edit the shared catalog; kitchen roles only read. A manager
needs the owner/admin to initialize once. Access is checked against live branch
membership on every operation, including revocation. A branch witness document
stores no privileges. Staff belonging to one branch may read shared dishes from
other branches of the same owner, without gaining access to those branches'
private menus, staff or events.

Paths: merchantCatalogs/{businessId}/dishes/{dishId}, with initialization metadata
and immutable imports/{storeId}; merchantCatalogAccess/{businessId}~{uid} records
the caller's currently assigned branch. New writes use the shared collection;
legacy merchants/{storeId}/catalog remains available for migration only.

## Daily publication

The shared daily editor uses an item form and table with Edit/Remove actions,
matching the branch menu above it. Pick catalog dishes or enter dishes manually.
Publish menu works before a Lunch Together date assignment exists. It writes
merchants/{storeId}/offers/{date} and nested dishes in a revision-checked
transaction; it does not claim a global customer date or change its restaurant.

Lunch Together administrators select the restaurant in Order history -> Create
meal day -> Link a restaurant. The preview prefers the published offer for that
date. If no offer exists, it falls back to the saved private branch menu for
compatibility. Creation checks the exact source revision and creates the day,
menu, immutable binding and audit events atomically.

If a customer date is already assigned to this branch, publishing updates both
the offer and customer menu atomically. Existing order prices, payments, credits,
refunds and opening/closing controls retain their original authorization.
Another branch's publication does not overwrite an assigned customer's menu.
Private branch menu edits stay private until explicitly published.

The editor rejects concurrent revisions and offers Reload. Empty private menus
are allowed; a published offer requires 1-60 valid dishes. No global unbound-day
banner or separate connect-day step is needed in the Merchant editor.

## Deployment

Publish the complete configured customer firestore.rules before using this
release. The public reference keeps PRIMARY_ADMIN_UID_HERE; preserve the
operator's configured primary UID. No composite index, environment variable,
server credential or OIDC setup is added.

## Tieng Viet

Danh muc mon dung chung cho cac co so cung ownerId; khong gop nha hang khac chu.
Lan dau, mon trung ten lay gia/trang thai tu ban cu cap nhat gan nhat. Cac lan
nhap sau giu ban da chinh trong danh muc chung va khong xoa du lieu cu.
Chu nha hang/quan tri mo workspace mot lan de khoi tao, quan ly sua mon,
nhan su bep chi xem. Moi co so van co thuc don rieng theo ngay.

Dang thuc don luu ban cong bo ngay, khong can bam ket noi ngay truoc. Quan tri
Com Nha chon nha hang va thuc don da dang khi tao ngay moi. Khi co so da duoc
chon, Dang thuc don dong bo ngay; don cu va thong tin tien duoc giu nguyen.
