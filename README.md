# Mini Arcade PWA

App PWA gồm nhiều mini game, có thêm cờ tướng 2 người chơi trên cùng máy. Các mini game có nhập tên người chơi và bảng điểm. Khi chạy local hoặc deploy tĩnh không có Functions, điểm sẽ lưu bằng `localStorage`. Khi deploy đúng trên Netlify, bảng điểm online dùng Netlify Functions + Netlify Blobs.

Phần cờ tướng dùng `xiangqi.js` để kiểm tra luật đi, nước hợp lệ, chiếu và chiếu bí. License của thư viện nằm ở `vendor/xiangqi.LICENSE.txt`.

## Cờ tướng online 1v1

Sau khi deploy lên Netlify, cờ tướng có thêm chế độ Online 1v1:

1. Người chơi A mở game Cờ tướng.
2. Chọn Online 1v1.
3. Nhập tên và bấm Tạo phòng.
4. Gửi mã phòng cho người chơi B.
5. Người chơi B mở cùng link app, vào Cờ tướng, chọn Online 1v1, nhập tên và mã phòng.
6. Đỏ đi trước, hai máy sẽ tự đồng bộ sau vài giây.

Chế độ online dùng `netlify/functions/rooms.mjs` và Netlify Blobs. Nếu chạy bằng `node server.mjs`, online sẽ báo cần deploy Netlify hoặc dùng `netlify dev`.

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
