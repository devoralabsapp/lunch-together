# Workspace themes / Giao diện

Choose the palette icon beside the language selector in the top bar. The original **Default** theme remains the initial choice. Available alternatives:

| Theme | Appearance |
| --- | --- |
| Command Line | Black terminal, white text, monospace type, square corners |
| Visual Studio Code | Charcoal surfaces, blue accents, monospace type |
| Excel | Green toolbar, light surfaces, spreadsheet-style table borders |
| Midnight | Navy surfaces, blue accents, rounded cards |
| Playful Retro Neo-Brutalism | Warm cream, pastel yellow/pink/blue/mint, black outlines and hard offset shadows |

The selection applies immediately and is remembered in this browser for one year using the `lunch-together-theme-v1` cookie. A new browser starts with Default. If cookies are blocked, switching still works in the current page. The server validates the theme identifier and renders the chosen theme on reload. On small screens, use the palette icon to open the same selector.

Theme changes affect presentation only. No Firestore Rules, indexes, environment variables or account changes are required. Meal images and payment QR pixels retain their original colors. Chart colors follow the selected palette.

Text sizes use a shared CSS offset: **Excel +2px**, **all other themes +1px**, including chart and wheel labels. Inherited sizes and hidden zero-size labels are left intact so nested text does not grow repeatedly. Card dimensions and page zoom are unchanged.

Excel loads [Carlito](https://github.com/google/fonts/tree/main/ofl/carlito); Command Line and Visual Studio Code load [Roboto Mono](https://github.com/google/fonts/tree/main/ofl/robotomono). Both support Vietnamese. Using webfonts instead of OS-specific Calibri/Consolas reduces Windows/macOS fallback differences. Safari automatic text resizing is normalized to 100%; browser zoom remains available. Physical apparent size can still differ with browser zoom, display scaling and font rendering. macOS has not been tested directly on a Mac in this change.

### Playful Retro Neo-Brutalism

The `retro` identifier follows the same selector, validated cookie and server-rendering mechanism. Its styles live in `app/retro-theme.css`; every selector is scoped to `html[data-theme=retro]`. Reusable `--retro-*` tokens define paper, pastels, 2px black borders, 4px hard shadows, 18px cards and pill controls. [Nunito](https://github.com/google/fonts/tree/main/ofl/nunito) supplies the rounded Vietnamese/English typography, keeping the existing +1px text offset.

The palette covers meals, orders, payments, statistics, pickup, history, profiles, administration, activity logs and restaurant shares. Food images and payment QR codes retain their original pixels. Hover and pressed effects use transforms without changing layout; reduced-motion preferences disable these motion effects. The original themes and Default selection remain available unchanged.

## Tiếng Việt

Bấm biểu tượng bảng màu cạnh bộ chọn ngôn ngữ trên thanh đầu trang để đổi giao diện. Có **Mặc định**, **Command Line**, **Visual Studio Code**, **Excel**, **Midnight** và **Playful Retro Neo-Brutalism**. Trên điện thoại, bộ chọn thu gọn thành biểu tượng bảng màu.

Theme Retro dùng nền kem ấm, các mảng vàng/hồng/xanh dương/mint, viền đen 2 px và bóng cứng lệch 4 px. Font Nunito tròn, đậm; thẻ bo góc và nút dạng viên thuốc. Hiệu ứng rê chuột/nhấn nút được giảm khi người dùng bật tùy chọn giảm chuyển động. Theme này dùng mức tăng chữ 1 px hiện có và không thay đổi chức năng của ứng dụng.

Command Line dùng nền đen, các vùng xám đậm và chữ trắng kiểu terminal. Các cảnh báo và biểu đồ vẫn giữ màu để dễ phân biệt trạng thái.

Cỡ chữ Excel tăng **2 px**, các giao diện còn lại tăng **1 px**, gồm cả nhãn biểu đồ và vòng quay. Các theme dùng chung webfont giữa Windows/macOS để hạn chế lệch font dự phòng; vẫn cho phép phóng to trình duyệt. Chưa kiểm tra trực tiếp trên máy Mac; mức zoom, thiết lập màn hình và cách làm mịn chữ vẫn có thể làm chữ trông khác nhau.

Giao diện Mặc định vẫn là lựa chọn ban đầu. Lựa chọn được ghi nhớ riêng trên trình duyệt trong một năm; trình duyệt mới bắt đầu bằng Mặc định. Nếu trình duyệt chặn cookie, bạn vẫn đổi được giao diện trong trang đang mở. Không cần cấu hình Firebase hay tài khoản thêm.
