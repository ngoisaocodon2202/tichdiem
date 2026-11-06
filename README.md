# 🌸 Hệ Thống Quản Lý Điểm Tích Lũy Khách Hàng (Customer Loyalty System)

Ứng dụng Web Full-stack quản lý và tích điểm khách hàng với giao diện **Pink Glassmorphism** hiện đại, tối ưu hóa Mobile-First, chống rớt dòng tuyệt đối, kèm bộ công cụ tự động làm sạch và chuyển đổi dữ liệu từ bảng Markdown/Google Sheets sang **PostgreSQL** (chuẩn mã hóa **UTF-8 with BOM**).

---

## 📁 Cấu Trúc Thư Mục Dự Án

```text
tichdiem/
├── data/
│   ├── raw_customers.md          # Dữ liệu gốc 781 dòng từ bảng Markdown
│   ├── cleaned_customers.csv     # File CSV đã làm sạch (UTF-8 with BOM) mở trực tiếp bằng Excel
│   ├── cleaning_warnings.log     # Log chi tiết các SĐT lỗi, trùng lặp, chuẩn hóa điểm & tên
│   └── cleaning_report.json      # Báo cáo JSON phục vụ hiển thị trực tiếp trên Web App
├── db/
│   └── database.js               # Kết nối PostgreSQL (Pool) & các hàm truy vấn chuẩn ràng buộc
├── public/
│   ├── index.html                # Giao diện chính (Tra cứu SĐT, Card tích điểm, Form tạo mới)
│   ├── styles.css                # Thiết kế Pink Theme + Glassmorphism + Anti-Text-Wrapping
│   └── app.js                    # Logic Frontend, kiểm tra SĐT thực tế & hiệu ứng Micro-interactions
├── scripts/
│   ├── clean_and_seed.js         # Script làm sạch dữ liệu & sinh file seed_data.sql (UTF-8 BOM)
│   └── setup_postgres.js         # Script tự động tạo DB customer_loyalty_db & nạp seed_data.sql
├── seed_data.sql                 # File SQL chuẩn hóa toàn bộ khách hàng (UTF-8 with BOM)
├── seed.sql                      # Bản sao của seed_data.sql để tiện chạy lệnh ngắn
├── server.js                     # Máy chủ Express.js cung cấp RESTful API & xuất CSV/SQL
├── .env                          # Cấu hình kết nối PostgreSQL (localhost:5432, postgres / 220206)
└── package.json                  # Khai báo thư viện và các lệnh npm scripts
```

---

## 🧹 Tóm Tắt Kết Quả Làm Sạch Dữ Liệu (`clean_and_seed.js`)

Từ **781 dòng dữ liệu gốc** trong bảng Markdown:
1. **Chuẩn hóa Số điện thoại (`^0\d{9}$`):**
   - Tự động thêm số `0` ở đầu cho **773 dòng** SĐT 9 chữ số bị mất số `0` trên Google Sheets (ví dụ: `792271022` -> `0792271022`).
   - Tách riêng **8 dòng** SĐT bị dư số (`3560840154`, `9484300495`), thiếu số (`35550422`, `38749640`, `39543129`) hoặc số rác (`304`, `570`, `2222222222`) vào `data/cleaning_warnings.log` và comment cuối file `seed_data.sql` để không làm lỗi ràng buộc `CHECK (phone ~ '^0\d{9}$')`.
2. **Xử lý trùng lặp SĐT (`ON CONFLICT (phone) DO UPDATE`):**
   - Phát hiện và gộp **22 số điện thoại trùng lặp** (từ 773 dòng hợp lệ gộp thành **749 khách hàng duy nhất**), giữ lại mức điểm cao nhất (`GREATEST`) và tự động nối tên khách hàng nếu khác nhau (ví dụ: `0792271022` -> `"Thao Tien Tran / Chị Thảo"`, `0939469475` -> `"Chế Thị Thu Thảo / chế thảo"`).
3. **Chuẩn hóa Điểm tích lũy (`1 <= points <= 10`):**
   - Tự động đưa về trần **10 điểm** đối với khách hàng vượt mức (`Hồng điệp`: `15 -> 10`, `Tường duy`: `11 -> 10`).
   - Tự động đưa về sàn **1 điểm** đối với khách hàng có điểm `0` hoặc bị trống (`Trúc Quỳnh`, `Gia như`, `Chị thương`, `Chị trang`, `Chị hằng xe Hồng`, `Thanh Uyên`, `Ngô triệu Vy vy ( bông bụp )`, `Hương`).
4. **Chuẩn hóa Tên khách hàng (`full_name`):**
   - Xóa sạch ký tự HTML rác `&#x20;` trên **118 dòng** và chuẩn hóa bảng mã Unicode tiếng Việt dựng sẵn (NFC).
   - Tự động gán `"Khách hàng (Chưa rõ tên)"` cho các dòng bị bỏ trống tên (`0327017780`, `0914941802`; riêng `0933652501` và `0976016077` có bản ghi trùng kèm tên thật nên đã tự động lấy tên `"Chị Bình"` và `"C Hà"`).

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy Chi Tiết

### Bước 1: Cài đặt thư viện Node.js
Mở Terminal (PowerShell hoặc Command Prompt) tại thư mục dự án:
```bash
npm install
```

### Bước 2: Chạy script làm sạch dữ liệu & tạo `seed_data.sql` (Chuẩn UTF-8 with BOM)
```bash
npm run clean
```

### Bước 3: Khởi tạo Database PostgreSQL & Nạp dữ liệu

#### Cách A — Tự động hoàn toàn bằng Node.js (Khuyên dùng, không cần cài biến môi trường `psql`):
Chỉ cần dịch vụ PostgreSQL đang chạy ở `localhost:5432` (User: `postgres` | Password: `220206`), chạy lệnh:
```bash
npm run db:setup
```
Lệnh này sẽ tự động kiểm tra, tạo mới database `customer_loyalty_db` (nếu chưa có), tạo bảng `customers` và nạp toàn bộ `seed_data.sql`.

#### Cách B — Chạy trực tiếp bằng công cụ `psql` trên Terminal:
```powershell
# Đặt mật khẩu phiên làm việc và bảng mã UTF-8
$env:PGPASSWORD="220206"
$env:PGCLIENTENCODING="UTF8"

# 1. Tạo database customer_loyalty_db
psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE customer_loyalty_db WITH ENCODING 'UTF8';"

# 2. Nạp toàn bộ cấu trúc bảng và dữ liệu từ seed_data.sql
psql -h localhost -p 5432 -U postgres -d customer_loyalty_db -f seed_data.sql
```

### Bước 4: Khởi chạy Web App
```bash
npm start
```
Mở trình duyệt và truy cập: **http://localhost:3000**

