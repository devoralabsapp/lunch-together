# Restaurant-wide staff

The Team tab shows one deduplicated staff list for branches sharing the same
immutable ownerId, with legacy storeId fallback. It has no branch/date selectors.
Select the restaurant context through Overview or Stores when operating more than
one business. Unrelated owners' staff never mix.

Existing per-store and legacy grants are displayed together without changing
their permissions. Their rows are marked Legacy branch access. Saving a person
here creates a restaurant-wide grant, applying to current and future branches.
Explicit restaurant grants, including disabled grants, take precedence over
legacy branch grants. The immutable business owner stays an owner. Account
suspension and administrator approval remain authoritative across every branch.

Owners and system administrators manage staff; only system administrators assign
or change another restaurant-wide owner role. Self changes and changes to the immutable owner
are refused. Block/reopen actions are reversible. Editing a role preserves the
current blocked state. No customer payment authority or cross-portal access is
added. Existing archive/restore authorization is unchanged.

## UID/email

Enter a Firebase Auth UID or Google email. The person must first sign in to
Merchant and receive administrator approval. An approved sign-in records a
minimal verified-email directory entry at SHA-256(lowercase(email)); it contains
only uid, email and updatedAt. A non-admin owner first records the exact requested hash and source branch in a self-owned merchantEmailLookups document. That one-hash authorization expires after two minutes and rechecks current ownership. Lookups use an exact document get; listing and
deletion are forbidden. A user can register only their own verified token email.
An administrator may backfill a missing entry only from the immutable application
email of an enabled Merchant identity. Case and surrounding spaces are normalized.

If an older identity has no directory entry, ask them to sign in again or use
their UID. There is no new server credential, email invitation, or account
creation by the restaurant. A wrong/unapproved email cannot create a membership.

## Model and queries

merchantTeamUsers/{businessId}~{uid}: businessId,uid,sourceStoreId,email,role,
enabled,createdAt,updatedAt,updatedBy. Business/UID and creation time are immutable;
email must match the verified directory or be empty for UID-only entry. Only
owners/admins write; managers and kitchen users cannot manage staff.

Queries are businessId==selected business for its staff list, uid==current user
for their own grants, and ownerId==business to discover branches. Legacy lists
retain existing merchantId filters. These are single-field indexes. The client
uses server timestamps and transactions, with a member.update activity event.
Existing store membership data is retained; no bulk privilege migration occurs.

Publish the complete configured customer firestore.rules before deploying this
release. Public references preserve PRIMARY_ADMIN_UID_HERE. No new composite
index, environment variable, OIDC, private key, or Admin SDK is needed.

## Tiếng Việt

Tab Nhân sự dùng chung cho các cơ sở cùng chủ nhà hàng, không có ô chọn cơ sở
hoặc ngày. Thêm bằng UID/email Google đã được duyệt. Quyền cũ được giữ nguyên
cho đến khi lưu lại ở đây; quyền mới áp dụng toàn nhà hàng, kể cả cơ sở mới.
Khóa chung chặn cả quyền cũ theo cơ sở. Chỉnh vai trò không tự mở người đang khóa.
Nếu chưa tìm được email, nhờ người đó đăng nhập Merchant lại hoặc nhập UID.
