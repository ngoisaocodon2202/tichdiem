require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { runMigration } = require('./clean_and_seed');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '220206'
};

const targetDbName = process.env.DB_NAME || 'customer_loyalty_db';

async function setupPostgres() {
  console.log('====================================================================');
  console.log('KẾT NỐI POSTGRESQL & KHỞI TẠO CƠ SỞ DỮ LIỆU:', targetDbName);
  console.log('====================================================================');

  // Bước 1: Chạy làm sạch dữ liệu để đảm bảo seed_data.sql luôn mới nhất
  runMigration();

  // Bước 2: Kết nối vào database mặc định 'postgres' để kiểm tra/tạo database 'customer_loyalty_db'
  const adminClient = new Client({
    ...dbConfig,
    database: 'postgres',
    connectionTimeoutMillis: 5000
  });

  try {
    await adminClient.connect();
    console.log(`[OK] Đã kết nối tới PostgreSQL (${dbConfig.host}:${dbConfig.port}) với user "${dbConfig.user}".`);

    const checkRes = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDbName]
    );

    if (checkRes.rowCount === 0) {
      console.log(`[INFO] Database "${targetDbName}" chưa tồn tại. Đang tiến hành tạo mới...`);
      await adminClient.query(`CREATE DATABASE ${targetDbName} WITH ENCODING 'UTF8'`);
      console.log(`[OK] Đã tạo thành công database "${targetDbName}" (UTF-8).`);
    } else {
      console.log(`[OK] Database "${targetDbName}" đã tồn tại.`);
    }
  } catch (err) {
    console.error('\n[LỖI KẾT NỐI POSTGRESQL]');
    console.error(`Không thể kết nối tới PostgreSQL tại ${dbConfig.host}:${dbConfig.port}.`);
    console.error('Chi tiết lỗi:', err.message);
    console.error('\nHướng dẫn khắc phục:');
    console.error('1. Đảm bảo dịch vụ PostgreSQL đang chạy (Mở Services.msc -> khởi động postgresql-x64-*).');
    console.error(`2. Kiểm tra lại cấu hình Host/Port/User/Password trong file .env (Mặc định: postgres / 220206).`);
    console.error('3. File seed_data.sql (chuẩn UTF-8 with BOM) đã được tạo sẵn thành công tại thư mục gốc!');
    process.exitCode = 1;
    return;
  } finally {
    await adminClient.end().catch(() => {});
  }

  // Bước 3: Kết nối vào 'customer_loyalty_db' và thực thi file seed_data.sql
  const appClient = new Client({
    ...dbConfig,
    database: targetDbName
  });

  try {
    await appClient.connect();
    const seedSqlPath = path.join(__dirname, '..', 'seed_data.sql');
    const sqlContent = fs.readFileSync(seedSqlPath, 'utf8').replace(/^\uFEFF/, '');

    console.log('[INFO] Đang thực thi script seed_data.sql để tạo bảng & nạp dữ liệu...');
    await appClient.query(sqlContent);

    const statsRes = await appClient.query(`
      SELECT 
        COUNT(*)::int AS total_customers,
        COUNT(*) FILTER (WHERE points = 10)::int AS max_point_customers,
        ROUND(AVG(points), 2) AS avg_points
      FROM customers
    `);

    const stats = statsRes.rows[0];
    console.log('====================================================================');
    console.log('[HOÀN TẤT] ĐÃ NẠP DỮ LIỆU VÀO POSTGRESQL THÀNH CÔNG!');
    console.log(` - Tổng số khách hàng trong bảng customers : ${stats.total_customers}`);
    console.log(` - Số khách hàng đạt mốc tối đa (10 điểm)  : ${stats.max_point_customers}`);
    console.log(` - Điểm tích lũy trung bình                : ${stats.avg_points}`);
    console.log('====================================================================');
  } catch (err) {
    console.error('[LỖI KHI NẠP SEED_DATA.SQL]:', err.message);
    process.exitCode = 1;
  } finally {
    await appClient.end().catch(() => {});
  }
}

if (require.main === module) {
  setupPostgres();
}

module.exports = { setupPostgres };
