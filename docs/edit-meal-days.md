# Edit a meal day and replace its restaurant

Administrators can use the small pencil on each **Order history** day card to edit the menu or replace the restaurant. Vietnamese remains the default language; the editor also supports English.

Saving an unchanged source updates the menu and preserves existing orders and their prices. An imported Sheets day is saved as a separate canonical web day; the original import remains unchanged.

Replacing the source requires an explicit confirmation showing the affected active order count and remaining money. This administrative operation is allowed even after the normal 15-minute reopening deadline. It locks ordering, cancels active orders, and keeps their remaining net funds for later orders. Already cancelled orders retain their previous refund/carry choice. Received, refunded, voided and transferred money remains in the original ledger; the operation does not manufacture a new payment.

Each replacement has an immutable target/menu snapshot, per-order progress and cancellation receipts. A retry continues the same operation and does not add credit twice. A confirmed bank group that has not finished settlement pauses the operation until settlement completes. While a replacement is pending, the history editor and workspace banner provide **Continue changing restaurant**.

After cancellation, the administrator client server-queries and transaction-reads the order list before replacing the binding/menu and opening a new ordering cycle. This is a trusted administrator workflow: Firestore Rules cannot aggregate an unbounded order collection. Rules enforce administrator identity, valid schemas, unchanged order ownership/prices/money during cancellation, the matching job/day lock and atomic completion. The previous fulfillment is archived exactly before its active pointer is removed. The next restaurant receives a new dispatch only after the administrator closes the new cycle.

Ordinary reopen still expires 15 minutes after the first close. Restaurant replacement is a separate, explicitly confirmed exception. Closing a day now updates only its parent status and closure fields; it does not rewrite dishes, including older inactive dish documents.

Deploy the complete configured `firestore.rules` before releasing the two portals. Public copies contain a primary-administrator placeholder and must be configured by their operator. No new index, environment variable, OIDC configuration or service-account key is required.
