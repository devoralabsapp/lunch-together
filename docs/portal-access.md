# Portal account separation / Phân loại tài khoản

Both portals share Firebase Google Authentication. Authentication establishes
identity; Firestore authorization determines which workspace that identity can use.

| Account | Customer portal | Merchant portal |
| --- | --- | --- |
| Verified Google administrator | Yes | All restaurants and application reviews |
| New Google applicant, pending/rejected | Yes until approved | Registration/status only |
| Approved, enabled merchant identity | Refused | Owned stores and assigned staff roles |
| Existing enabled legacy merchant | Refused | Existing grants; owners can add branches |
| Suspended merchant identity | Refused | Status only; operations denied |
| Anonymous guest | Guest ordering | Refused |

New verified Google Merchant sign-ins automatically create a pending application.
Only a system administrator can approve it, atomically recording an immutable review
event and an enabled merchant identity. Approval reclassifies an ordinary customer
account as Merchant; existing customer history remains stored. Pending applicants
cannot create restaurants, publish menus or read private business collections.

The existence of merchantUsers/{uid} reserves the identity for Merchant even when
disabled. A rejected applicant may edit and resubmit. Disabled approved users need
administrator restoration. Blocked/deleted accounts cannot apply or operate.
Existing explicit legacy grants remain valid without migration. Restaurant owners
may grant staff access only to already approved/admin-provisioned identities;
they cannot reclassify an arbitrary customer by entering that customer's UID.

Approved owners create multiple stores. Immutable ownerId identifies ownership;
merchantStoreUsers grants scoped manager/kitchen roles at multiple stores. An
explicit disabled store grant overrides a legacy staff grant. Ownership itself
cannot be transferred or demoted through a staff edit.

Customer admission runs before profile sync, page loading and guest transfer.
Merchant operational access is watched continuously. This is account separation,
not a device lock; customers may still order anonymously. Only verified system
administrators have the cross-portal operational exception.

Rules independently preserve financial authorization, shared customer visibility
and bank-service permissions. Merchants access shared operational days only when
bound to their store. Per-branch draft menus are independent of those bindings.

## Tiếng Việt

Đăng nhập Merchant mới chỉ mở màn đăng ký/chờ duyệt. Quản trị vào **Phê duyệt
Merchant** để duyệt, từ chối, khóa hoặc mở lại. Sau khi duyệt, tài khoản thường
chuyển sang Merchant, có thể tạo nhiều cơ sở và không vào workspace khách bằng
cùng tài khoản nữa. Tài khoản quản trị vẫn dùng cả hai portal. Lịch sử cũ được giữ.

## Deployment and verification

Publish the complete configured customer firestore.rules. Public copies retain
PRIMARY_ADMIN_UID_HERE and must not replace the configured operator value.
No new index, environment variable, service key or OIDC setup is required.
Run customer npm test and Merchant npm test/build/typecheck. Real Auth/Firestore
emulator fixtures use demo projects and fictional identities only.
