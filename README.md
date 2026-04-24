# Mini Arcade PWA

App PWA gồm nhiều mini game, có thêm cờ tướng 2 người chơi trên cùng máy. Các mini game có nhập tên người chơi và bảng điểm. Khi chạy local hoặc deploy tĩnh không có Functions, điểm sẽ lưu bằng `localStorage`. Khi deploy đúng trên Netlify, bảng điểm online dùng Netlify Functions + Netlify Blobs.

Phần cờ tướng dùng `xiangqi.js` để kiểm tra luật đi, nước hợp lệ, chiếu và chiếu bí. License của thư viện nằm ở `vendor/xiangqi.LICENSE.txt`.

## Chạy thử local

```powershell
cd C:\Users\beo\Documents\Codex\2026-04-24\c-ch-l-m-1-app
node server.mjs
```

Mở:

```text
http://localhost:4173
```

## Deploy lên Netlify có bảng điểm online

Cách nên dùng là đưa thư mục này lên GitHub rồi import project trong Netlify.

Netlify sẽ đọc `netlify.toml`:

- Publish directory: `.`
- Functions directory: `netlify/functions`

Netlify cũng sẽ cài dependency trong `package.json`, gồm `@netlify/blobs`.

Sau khi deploy, mở link HTTPS Netlify trên iPhone bằng Safari:

1. Bấm Share.
2. Chọn Add to Home Screen.
3. Bấm Add.

## Lưu ý

Bảng điểm này phù hợp app vui/mini game đơn giản. Vì điểm được gửi từ trình duyệt, chưa có chống gian lận nâng cao.
