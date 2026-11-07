require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db/database');

const BOM = '\uFEFF';
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Ngăn chặn lỗi 304 Not Modified trên Vercel (do Vercel cố định mtime năm 2018 cho file tĩnh)
app.use((req, res, next) => {
  delete req.headers['if-modified-since'];
  delete req.headers['if-none-match'];
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    maxAge: 0
  })
);

// Đảm bảo Database được khởi tạo tự động cho cả Local & Vercel Serverless và không bị cache API
app.use('/api', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    await db.initDatabase();
    next();
  } catch (err) {
    next(err);
  }
});

// Phục vụ trực tiếp logo làm favicon.ico mặc định cho mọi trình duyệt
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logo.jpg'));
});

// 1. Lấy thống kê tổng quan & trạng thái kết nối PostgreSQL
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1b. Lấy thống kê Lượng Khách Hôm Nay & Lịch Sử Khách Mới Theo Ngày
app.get('/api/daily-stats', async (req, res) => {
  try {
    const [dailyStats, stats] = await Promise.all([db.getDailyStats(), db.getStats()]);
    res.json({
      success: true,
      data: dailyStats,
      total_customers: stats.total_customers
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Tra cứu nhanh khách hàng theo Số điện thoại (10 chữ số, bắt đầu bằng số 0)
app.get('/api/customers/lookup/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').trim();
    if (!db.validatePhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0 (VD: 0792271022).'
      });
    }

    const customer = await db.findByPhone(phone);
    if (customer) {
      return res.json({
        success: true,
        found: true,
        customer
      });
    }

    return res.json({
      success: true,
      found: false,
      phone,
      message: 'Số điện thoại chưa có trong hệ thống. Tạo mới khách hàng ngay!'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Danh sách & tìm kiếm khách hàng
app.get('/api/customers', async (req, res) => {
  try {
    const { search = '', pointsFilter = 'all', limit = 30, offset = 0 } = req.query;
    const result = await db.listCustomers({ search, pointsFilter, limit, offset });
    res.json({
      success: true,
      total: result.total,
      items: result.items
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Thêm mới khách hàng & tích điểm (Trường hợp 2)
app.post('/api/customers', async (req, res) => {
  try {
    const { phone, full_name, points = 1 } = req.body;
    const created = await db.createCustomer({ phone, full_name, points });
    const [stats, dailyStats] = await Promise.all([db.getStats(), db.getDailyStats()]);
    res.status(201).json({
      success: true,
      message: `Đã lưu "${created.full_name}" (${created.points}/10 điểm)!`,
      customer: created,
      stats,
      dailyStats
    });
  } catch (err) {
    const status = err.code === 'DUPLICATE_PHONE' ? 409 : 400;
    res.status(status).json({
      success: false,
      message: err.message
    });
  }
});

// 5. Cập nhật điểm tích lũy & tên khách hàng (Trường hợp 1)
app.put('/api/customers/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').trim();
    const { full_name, points } = req.body;
    let updated;
    try {
      updated = await db.updateCustomer(phone, { full_name, points });
    } catch (updateErr) {
      if (updateErr.code === 'NOT_FOUND') {
        await db.syncClientRecords({
          customers: [{ phone, full_name, points, updated_at: new Date().toISOString() }]
        });
        updated = await db.findByPhone(phone);
      } else {
        throw updateErr;
      }
    }
    const [stats, dailyStats] = await Promise.all([db.getStats(), db.getDailyStats()]);
    res.json({
      success: true,
      message: `Đã lưu "${updated.full_name}" (${updated.points}/10 điểm)!`,
      customer: updated,
      stats,
      dailyStats
    });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({
      success: false,
      message: err.message
    });
  }
});

// 5b. Đồng bộ dữ liệu khách hàng & lịch sử ngày (Đảm bảo không mất dữ liệu khi reload trên Serverless & đồng bộ giữa mọi thiết bị)
app.post('/api/sync', async (req, res) => {
  try {
    const { customers = [], dailyLogs = [] } = req.body || {};
    const { stats, dailyStats, overrides } = await db.syncClientRecords({
      customers,
      dailyLogs
    });
    res.json({
      success: true,
      stats,
      dailyStats,
      overrides: overrides || [],
      total_customers: stats.total_customers
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Xem báo cáo làm sạch dữ liệu & danh sách cảnh báo SĐT lỗi
app.get('/api/cleaning-report', (req, res) => {
  try {
    const reportPath = path.join(__dirname, 'data', 'cleaning_report.json');
    const content = fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(content);
    res.json({
      success: true,
      report: {
        generatedAt: parsed.generatedAt,
        summary: parsed.summary,
        phoneWarnings: parsed.phoneWarnings,
        duplicatesList: parsed.duplicatesList,
        pointsAdjustments: parsed.pointsAdjustments,
        emptyNameRecords: parsed.emptyNameRecords
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Xuất file CSV chuẩn UTF-8 with BOM (mở trực tiếp trên Excel không lỗi font tiếng Việt)
app.get('/api/export/csv', async (req, res) => {
  try {
    const rows = await db.getAllForExport();
    const escapeCsv = (val) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvLines = [
      'ID,Số Điện Thoại,Tên Khách Hàng,Điểm Tích Lũy,Cập Nhật Lúc',
      ...rows.map((r) =>
        [
          r.id,
          escapeCsv(r.phone),
          escapeCsv(r.full_name),
          r.points,
          escapeCsv(r.updated_at ? new Date(r.updated_at).toLocaleString('vi-VN') : '')
        ].join(',')
      )
    ];

    const csvContent = BOM + csvLines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="khach_hang_tich_diem_utf8_bom.csv"'
    );
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Tải file seed_data.sql chuẩn UTF-8 with BOM
app.get('/api/export/sql', (req, res) => {
  try {
    const sqlPath = path.join(__dirname, 'seed_data.sql');
    const content = fs.readFileSync(sqlPath, 'utf8');
    const withBom = content.startsWith(BOM) ? content : BOM + content;
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="seed_data.sql"');
    res.send(withBom);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

async function startServer() {
  await db.initDatabase();
  app.listen(PORT, () => {
    console.log('====================================================================');
    console.log(`🌸 Web App Hệ Thống Quản Lý Điểm Tích Lũy Khách Hàng đã sẵn sàng!`);
    console.log(`👉 Truy cập ngay tại: http://localhost:${PORT}`);
    console.log('====================================================================');
  });
}

if (!process.env.VERCEL) {
  startServer();
}

module.exports = app;

