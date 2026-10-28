# Portal account separation / Phân loại tài khoản

Both portals share Firebase Google Authentication. Google identity authentication
is shared, but admission to the wrong portal is refused and that portal's local
session is signed out before loading its workspace. This does not create separate
Firebase projects or revoke sessions on other devices.

| Account | Customer portal | Merchant portal |
| --- | --- | --- |
| Verified Google admin, `admins/{uid}.enabled == true` | Yes | Yes |
| Google account without `merchantUsers/{uid}` | Yes | Refused |
| Enabled merchant, unblocked account, active restaurant | Refused | Assigned restaurant |
| Disabled merchant membership | Refused | Refused |
| Anonymous guest | Guest ordering | Refused |

Membership existence reserves the Google UID for Merchant even when disabled.
Existing memberships take effect without migrating profiles, orders, money or
email addresses. Existing staff-management permissions govern assignment; regular
users cannot enroll themselves, reassign or delete their membership. Only a system
administrator can switch an account with an existing customer profile to Merchant;
restaurant owners can onboard new UIDs without customer profiles. Assigning an
existing customer to a restaurant switches portal admission while retaining their
historical data. Use different Google accounts for different non-admin roles.

Customer admission runs before profile sync, page loading and guest transfer.
An existing Google account is checked in a separate in-memory authentication
session before creating a transfer ticket or changing the guest session. Both
portals watch account privilege changes and sign out locally after losing access.
Merchant users see a refusal message and can copy their UID for provisioning.

Rules independently deny merchants customer profiles/settings, financial access
and customer order mutations. Active staff retain shared operational day/menu/
order reads only for dates bound to their restaurant. Customer shared order
visibility, anonymous ordering and dedicated bank-service authorization continue.

## Tiếng Việt

Tài khoản thường chỉ dùng một portal. Có hồ sơ nhân sự nhà hàng thì dùng Merchant;
không có hồ sơ nhân sự thì dùng Cơm Nhà. Chỉ quản trị Google đã xác minh được dùng
cả hai. Khóa nhân sự không tự chuyển họ sang khách hàng. Cấp quyền nhà hàng cho
tài khoản khách hiện có sẽ chuyển quyền vào portal sang Merchant, giữ dữ liệu cũ.
Khách vẫn có thể đặt cơm ẩn danh; đây là giới hạn tài khoản, không khóa thiết bị.

## Deployment and tests

Run `npm test` for Rules, customer admission and existing financial regressions.
Publish the entire current shared `firestore.rules` before enabling these portal
versions. No index, environment variable, service key or OIDC setup is added.
Preserve the public administrator placeholder when syncing public source.

The merchant repository includes a real Auth/Firestore emulator admission test.
Load shared Rules for `demo-merchant-portal-admission`, set both emulator host
variables to loopback addresses, then run its test suite. Fixtures are fictional.
