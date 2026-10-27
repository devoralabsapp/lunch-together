# Restaurant notes / Ghi chú gửi nhà hàng

PDF, JPG and shared restaurant pages show one total per dish and unit price. Each distinct preparation note states its serving count. When only some servings have a note, the remaining unnoted count is displayed explicitly.

Example: eight servings, only one with a special request:

```text
Sample chicken rice                         8 servings
1 serving: Less rice, no spring onions
7 servings without notes
```

Counts represent servings, not people: an order for three servings with a note contributes three to that note. Identical notes are combined; different prices stay on separate rows. Canceled orders are excluded by the existing summary builder. Quantities, totals and stored snapshot format remain unchanged. Existing version-one links can use the same presentation without a database migration.

Long note lists continue across PDF/JPG pages with the dish name repeated and quantities/prices printed only once. Names, emails, user IDs and payment status are not added to the restaurant output.

## Tiếng Việt

Ví dụ 8 suất cơm gà, chỉ 1 suất có ghi chú: dòng món vẫn ghi **8 suất**, bên dưới ghi **“1 suất: Ít cơm, không hành”** và **“7 suất không có ghi chú”**. Số lượng được cộng theo suất, không theo số người đặt. Ghi chú giống nhau được gộp; khác đơn giá vẫn tách dòng. Bản PDF, JPG và link chia sẻ cùng dùng cách trình bày này.

Nếu danh sách ghi chú dài, bản xuất tự sang trang và nhắc lại tên món, không cộng lặp số lượng hoặc tiền. Không thay đổi dữ liệu đơn, thanh toán hoặc cấu trúc link đã lưu.
