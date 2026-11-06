require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool, Client } = require('pg');
const { runMigration } = require('../scripts/clean_and_seed');

const BOM = '\uFEFF';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const dbConfig = connectionString
  ? {
      connectionString,
      ssl: { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '220206',
      database: process.env.DB_NAME || 'customer_loyalty_db'
    };

let pool = null;
let isPostgresConnected = false;
let isInitialized = false;
let initPromise = null;
let lastPgError = null;

// Local persistent store path (used if PostgreSQL service is offline)
const bundledStorePath = path.join(__dirname, '..', 'data', 'local_customers_store.json');
const bundledDailyStorePath = path.join(__dirname, '..', 'data', 'daily_history_store.json');
const localStorePath = process.env.VERCEL
  ? path.join('/tmp', 'local_customers_store.json')
  : bundledStorePath;
const dailyHistoryStorePath = process.env.VERCEL
  ? path.join('/tmp', 'daily_history_store.json')
  : bundledDailyStorePath;
const reportJsonPath = path.join(__dirname, '..', 'data', 'cleaning_report.json');
let localCustomers = [];
let localDailyLogs = [];

function getVietnamDateKey(dateObj = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dateObj);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function formatDateKeyVN(dateKey) {
  const [y, m, d] = String(dateKey || '').split('-');
  if (!y || !m || !d) return String(dateKey || '');
  return `${d}/${m}/${y}`;
}

function loadDailyHistoryStore() {
  const sourcePath = fs.existsSync(dailyHistoryStorePath)
    ? dailyHistoryStorePath
    : bundledDailyStorePath;
  if (fs.existsSync(sourcePath)) {
    try {
      const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        localDailyLogs = parsed;
        return;
      }
    } catch (e) {
      // Fallback to empty array
    }
  }
  localDailyLogs = [];
  saveDailyHistoryStore();
}

function saveDailyHistoryStore() {
  try {
    fs.writeFileSync(dailyHistoryStorePath, JSON.stringify(localDailyLogs, null, 2), 'utf8');
    syncSeedSqlFiles();
  } catch (e) {
    // Ignore on read-only environments
  }
}

function escapeSql(str) {
  return String(str || '').replace(/'/g, "''");
}

function syncSeedSqlFiles() {
  if (!Array.isArray(localCustomers) || localCustomers.length === 0) return;
  try {
    const lines = [
      '-- ============================================================================',
      '-- HỆ THỐNG QUẢN LÝ ĐIỂM TÍCH LŨY KHÁCH HÀNG (POSTGRESQL UTF-8 WITH BOM)',
      `-- Tự động đồng bộ lúc: ${new Date().toISOString()}`,
      `-- Tổng số khách hàng: ${localCustomers.length}`,
      `-- Tổng bản ghi lịch sử khách mới theo ngày: ${localDailyLogs.length}`,
      '-- ============================================================================',
      '',
      "SET client_encoding = 'UTF8';",
      '',
      'CREATE TABLE IF NOT EXISTS customers (',
      '    id SERIAL PRIMARY KEY,',
      "    phone VARCHAR(10) UNIQUE NOT NULL CHECK (phone ~ '^0\\d{9}$'),",
      '    full_name VARCHAR(150) NOT NULL,',
      '    points INTEGER NOT NULL DEFAULT 1 CHECK (points >= 1 AND points <= 10),',
      '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      ');',
      '',
      'CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);',
      'CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at DESC);',
      '',
      'CREATE TABLE IF NOT EXISTS daily_customer_logs (',
      '    id SERIAL PRIMARY KEY,',
      '    date_key VARCHAR(10) NOT NULL,',
      '    phone VARCHAR(10) UNIQUE NOT NULL,',
      '    full_name VARCHAR(150) NOT NULL,',
      '    points INTEGER NOT NULL DEFAULT 1,',
      '    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      ');',
      '',
      'CREATE INDEX IF NOT EXISTS idx_daily_logs_date_key ON daily_customer_logs(date_key DESC);',
      '',
      'BEGIN;',
      ''
    ];

    for (const c of localCustomers) {
      lines.push(
        `INSERT INTO customers (phone, full_name, points, updated_at) VALUES ('${escapeSql(
          c.phone
        )}', '${escapeSql(c.full_name)}', ${c.points}, CURRENT_TIMESTAMP)` +
          ` ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name, points = EXCLUDED.points, updated_at = CURRENT_TIMESTAMP;`
      );
    }

    if (localDailyLogs.length > 0) {
      lines.push('');
      for (const log of localDailyLogs) {
        lines.push(
          `INSERT INTO daily_customer_logs (date_key, phone, full_name, points, created_at) VALUES ('${escapeSql(
            log.date_key
          )}', '${escapeSql(log.phone)}', '${escapeSql(log.full_name)}', ${
            log.points
          }, CURRENT_TIMESTAMP)` +
            ` ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name, points = EXCLUDED.points;`
        );
      }
    }

    lines.push('', 'COMMIT;', '');
    const sqlContent = BOM + lines.join('\r\n');
    if (!process.env.VERCEL) {
      fs.writeFileSync(path.join(__dirname, '..', 'seed_data.sql'), sqlContent, 'utf8');
    }
  } catch (e) {
    // Ignore SQL sync errors
  }
}

function validatePhone(phone) {
  return /^0\d{9}$/.test(String(phone || '').trim());
}

function validatePoints(points) {
  const num = Number(points);
  return Number.isInteger(num) && num >= 1 && num <= 10;
}

function sanitizeName(name) {
  const cleaned = String(name || '')
    .replace(/&#x20;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 150);
}

function loadLocalStore() {
  const sourcePath = fs.existsSync(localStorePath) ? localStorePath : bundledStorePath;
  if (fs.existsSync(sourcePath)) {
    try {
      const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
      localCustomers = JSON.parse(raw);
      if (Array.isArray(localCustomers) && localCustomers.length > 0) {
        return;
      }
    } catch (e) {
      // Fallback to reportJsonPath
    }
  }

  if (!fs.existsSync(reportJsonPath) && !process.env.VERCEL) {
    runMigration();
  }
  if (fs.existsSync(reportJsonPath)) {
    const reportRaw = fs.readFileSync(reportJsonPath, 'utf8').replace(/^\uFEFF/, '');
    const report = JSON.parse(reportRaw);
    const now = new Date().toISOString();
    localCustomers = (report.uniqueCustomers || []).map((c, index) => ({
      id: index + 1,
      phone: c.phone,
      full_name: c.full_name,
      points: c.points,
      updated_at: now
    }));
    saveLocalStore();
  }
}

function saveLocalStore() {
  try {
    fs.writeFileSync(localStorePath, JSON.stringify(localCustomers, null, 2), 'utf8');
    syncSeedSqlFiles();
  } catch (e) {
    // Ignore on read-only environments
  }
}

async function syncLocalDataToPostgres(client) {
  if (Array.isArray(localCustomers) && localCustomers.length > 0) {
    for (const c of localCustomers) {
      await client.query(
        `INSERT INTO customers (phone, full_name, points, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (phone) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             points = EXCLUDED.points`,
        [c.phone, c.full_name, c.points]
      );
    }
  }
  if (Array.isArray(localDailyLogs) && localDailyLogs.length > 0) {
    for (const log of localDailyLogs) {
      await client.query(
        `INSERT INTO daily_customer_logs (date_key, phone, full_name, points, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (phone) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             points = EXCLUDED.points`,
        [log.date_key, log.phone, log.full_name, log.points]
      );
    }
  }
}

function ensureLocalPostgresEngineStarted() {
  const pgCtlPath = path.join(__dirname, '..', 'pgsql', 'bin', 'pg_ctl.exe');
  const pgDataDir = path.join(__dirname, '..', 'pgsql_data');
  const pgLogFile = path.join(__dirname, '..', 'pgsql_server.log');

  if (!fs.existsSync(pgCtlPath) || !fs.existsSync(path.join(pgDataDir, 'PG_VERSION'))) {
    return;
  }

  try {
    execFileSync(pgCtlPath, ['-D', pgDataDir, 'status'], { stdio: 'ignore' });
  } catch (statusErr) {
    try {
      console.log('[PostgreSQL] Đang tự động khởi động dịch vụ PostgreSQL tại cổng 5432...');
      execFileSync(
        pgCtlPath,
        ['-D', pgDataDir, '-l', pgLogFile, '-o', `-p ${dbConfig.port}`, 'start'],
        { stdio: 'ignore' }
      );
    } catch (startErr) {
      // Ignore if already starting
    }
  }
}

async function initDatabase() {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (
      !process.env.VERCEL &&
      (!fs.existsSync(path.join(__dirname, '..', 'seed_data.sql')) ||
        !fs.existsSync(reportJsonPath))
    ) {
      runMigration();
    }
    loadLocalStore();
    loadDailyHistoryStore();

    if (process.env.VERCEL && !connectionString) {
      isPostgresConnected = false;
      isInitialized = true;
      return;
    }

    if (!process.env.VERCEL && !connectionString) {
      ensureLocalPostgresEngineStarted();
    }

    try {
      if (!connectionString) {
        // 1. Thử kết nối vào database 'postgres' để tự động tạo 'customer_loyalty_db' nếu chưa có
        const adminClient = new Client({
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.user,
          password: dbConfig.password,
          database: 'postgres',
          connectionTimeoutMillis: 3000
        });
        await adminClient.connect();
        const checkDb = await adminClient.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [dbConfig.database]
        );
        if (checkDb.rowCount === 0) {
          await adminClient.query(`CREATE DATABASE ${dbConfig.database} WITH ENCODING 'UTF8'`);
          console.log(`[PostgreSQL] Đã tự động tạo database "${dbConfig.database}".`);
        }
        await adminClient.end();
      }

      // 2. Khởi tạo Pool kết nối tới PostgreSQL
      pool = new Pool({
        ...dbConfig,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 4000
      });

      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(10) UNIQUE NOT NULL CHECK (phone ~ '^0\\d{9}$'),
            full_name VARCHAR(150) NOT NULL,
            points INTEGER NOT NULL DEFAULT 1 CHECK (points >= 1 AND points <= 10),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
          CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at DESC);

          CREATE TABLE IF NOT EXISTS daily_customer_logs (
            id SERIAL PRIMARY KEY,
            date_key VARCHAR(10) NOT NULL,
            phone VARCHAR(10) UNIQUE NOT NULL,
            full_name VARCHAR(150) NOT NULL,
            points INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_daily_logs_date_key ON daily_customer_logs(date_key DESC);
        `);

        const countRes = await client.query('SELECT COUNT(*)::int AS cnt FROM customers');
        if (countRes.rows[0].cnt === 0) {
          console.log(
            '[PostgreSQL] Bảng customers đang trống, tự động nạp dữ liệu từ seed_data.sql...'
          );
          const seedSql = fs
            .readFileSync(path.join(__dirname, '..', 'seed_data.sql'), 'utf8')
            .replace(/^\uFEFF/, '');
          await client.query(seedSql);
          console.log(
            '[PostgreSQL] Đã nạp toàn bộ dữ liệu khách hàng từ seed_data.sql thành công!'
          );
        }
        await syncLocalDataToPostgres(client);
        isPostgresConnected = true;
        lastPgError = null;
        console.log('[PostgreSQL] Kết nối & đồng bộ thành công!');
      } finally {
        client.release();
      }
    } catch (err) {
      isPostgresConnected = false;
      lastPgError = err.message;
      console.warn(`[CẢNH BÁO] Chưa kết nối được PostgreSQL (${err.message}).`);
    } finally {
      isInitialized = true;
    }
  })();

  return initPromise;
}

async function getStats() {
  const daily = await getDailyStats();
  if (isPostgresConnected && pool) {
    const res = await pool.query(`
      SELECT
        COUNT(*)::int AS total_customers,
        COUNT(*) FILTER (WHERE points = 10)::int AS max_point_customers,
        COUNT(*) FILTER (WHERE points >= 8)::int AS vip_customers,
        COALESCE(ROUND(AVG(points), 1), 0)::float AS avg_points
      FROM customers
    `);
    return {
      mode: 'postgresql',
      connected: true,
      dbInfo: `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
      ...res.rows[0],
      today_new_customers: daily.todayCount,
      today_date_display: daily.todayDateDisplay
    };
  }

  const total_customers = localCustomers.length;
  const max_point_customers = localCustomers.filter((c) => c.points === 10).length;
  const vip_customers = localCustomers.filter((c) => c.points >= 8).length;
  const avg_points =
    total_customers > 0
      ? Number(
          (localCustomers.reduce((acc, c) => acc + c.points, 0) / total_customers).toFixed(1)
        )
      : 0;

  return {
    mode: 'local_seeded',
    connected: false,
    lastError: lastPgError,
    dbInfo: `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
    total_customers,
    max_point_customers,
    vip_customers,
    avg_points,
    today_new_customers: daily.todayCount,
    today_date_display: daily.todayDateDisplay
  };
}

async function getDailyStats() {
  const todayDateKey = getVietnamDateKey();
  const todayDateDisplay = formatDateKeyVN(todayDateKey);

  let logs = [];
  if (isPostgresConnected && pool) {
    const res = await pool.query(
      `SELECT id, date_key, phone, full_name, points, created_at
       FROM daily_customer_logs
       ORDER BY created_at DESC, id DESC`
    );
    logs = res.rows;
  } else {
    logs = [...localDailyLogs].sort((a, b) => {
      const tDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (tDiff !== 0) return tDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }

  const groupedMap = new Map();
  // Luôn khởi tạo ngày hôm nay ở đầu danh sách (nếu sang ngày mới tự động bắt đầu từ 0)
  groupedMap.set(todayDateKey, []);

  for (const item of logs) {
    const dKey = item.date_key || getVietnamDateKey(new Date(item.created_at));
    if (!groupedMap.has(dKey)) {
      groupedMap.set(dKey, []);
    }
    groupedMap.get(dKey).push({
      phone: item.phone,
      full_name: item.full_name,
      points: item.points,
      created_at: item.created_at,
      date_key: dKey
    });
  }

  const sortedDateKeys = Array.from(groupedMap.keys()).sort((a, b) => b.localeCompare(a));
  const historyByDate = sortedDateKeys.map((dKey) => {
    const customers = groupedMap.get(dKey) || [];
    return {
      date_key: dKey,
      date_display: formatDateKeyVN(dKey),
      is_today: dKey === todayDateKey,
      count: customers.length,
      customers
    };
  });

  const todayCustomers = groupedMap.get(todayDateKey) || [];

  return {
    todayDateKey,
    todayDateDisplay,
    todayCount: todayCustomers.length,
    todayCustomers,
    historyByDate
  };
}

async function findByPhone(phone) {
  const cleanPhone = String(phone || '').trim();
  if (!validatePhone(cleanPhone)) {
    throw new Error('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.');
  }

  if (isPostgresConnected && pool) {
    const res = await pool.query(
      'SELECT id, phone, full_name, points, updated_at FROM customers WHERE phone = $1 LIMIT 1',
      [cleanPhone]
    );
    return res.rows[0] || null;
  }

  return localCustomers.find((c) => c.phone === cleanPhone) || null;
}

async function createCustomer({ phone, full_name, points = 1 }) {
  const cleanPhone = String(phone || '').trim();
  const cleanName = sanitizeName(full_name);
  const parsedPoints = parseInt(points, 10);

  if (!validatePhone(cleanPhone)) {
    throw new Error('Số điện thoại không hợp lệ (bắt buộc đúng 10 số, bắt đầu bằng 0).');
  }
  if (!cleanName) {
    throw new Error('Vui lòng nhập Tên khách hàng.');
  }
  if (!validatePoints(parsedPoints)) {
    throw new Error('Điểm tích lũy phải nằm trong khoảng từ 1 đến 10.');
  }

  const nowIso = new Date().toISOString();
  const todayDateKey = getVietnamDateKey(new Date(nowIso));

  if (isPostgresConnected && pool) {
    const existing = await findByPhone(cleanPhone);
    if (existing) {
      const err = new Error('Số điện thoại này đã tồn tại trong hệ thống.');
      err.code = 'DUPLICATE_PHONE';
      throw err;
    }

    const res = await pool.query(
      `INSERT INTO customers (phone, full_name, points, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       RETURNING id, phone, full_name, points, updated_at`,
      [cleanPhone, cleanName, parsedPoints]
    );

    await pool.query(
      `INSERT INTO daily_customer_logs (date_key, phone, full_name, points, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (phone) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           points = EXCLUDED.points`,
      [todayDateKey, cleanPhone, cleanName, parsedPoints]
    );

    // Đồng bộ lưu cả vào file local store & seed_data.sql để an toàn dữ liệu
    if (!localCustomers.some((item) => item.phone === cleanPhone)) {
      localCustomers.unshift(res.rows[0]);
      saveLocalStore();
    }
    if (!localDailyLogs.some((item) => item.phone === cleanPhone)) {
      localDailyLogs.unshift({
        id: localDailyLogs.length + 1,
        date_key: todayDateKey,
        phone: cleanPhone,
        full_name: cleanName,
        points: parsedPoints,
        created_at: nowIso
      });
      saveDailyHistoryStore();
    }

    return res.rows[0];
  }

  if (localCustomers.some((c) => c.phone === cleanPhone)) {
    const err = new Error('Số điện thoại này đã tồn tại trong hệ thống.');
    err.code = 'DUPLICATE_PHONE';
    throw err;
  }

  const nextId =
    localCustomers.reduce((maxId, item) => Math.max(maxId, item.id || 0), 0) + 1;
  const newRecord = {
    id: nextId,
    phone: cleanPhone,
    full_name: cleanName,
    points: parsedPoints,
    updated_at: nowIso
  };
  localCustomers.unshift(newRecord);
  saveLocalStore();

  // Ghi nhận +1 khách hàng mới trong ngày hôm nay
  const nextLogId =
    localDailyLogs.reduce((maxId, item) => Math.max(maxId, item.id || 0), 0) + 1;
  localDailyLogs.unshift({
    id: nextLogId,
    date_key: todayDateKey,
    phone: cleanPhone,
    full_name: cleanName,
    points: parsedPoints,
    created_at: nowIso
  });
  saveDailyHistoryStore();

  return newRecord;
}

async function updateCustomer(phone, { full_name, points }) {
  const cleanPhone = String(phone || '').trim();
  const cleanName = sanitizeName(full_name);
  const parsedPoints = parseInt(points, 10);

  if (!validatePhone(cleanPhone)) {
    throw new Error('Số điện thoại không hợp lệ.');
  }
  if (!cleanName) {
    throw new Error('Tên khách hàng không được để trống.');
  }
  if (!validatePoints(parsedPoints)) {
    throw new Error('Điểm tích lũy chỉ cho phép từ 1 đến 10.');
  }

  if (isPostgresConnected && pool) {
    const res = await pool.query(
      `UPDATE customers
       SET full_name = $1,
           points = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE phone = $3
       RETURNING id, phone, full_name, points, updated_at`,
      [cleanName, parsedPoints, cleanPhone]
    );
    if (res.rowCount === 0) {
      const err = new Error('Không tìm thấy khách hàng với số điện thoại này.');
      err.code = 'NOT_FOUND';
      throw err;
    }

    await pool.query(
      `UPDATE daily_customer_logs
       SET full_name = $1, points = $2
       WHERE phone = $3`,
      [cleanName, parsedPoints, cleanPhone]
    );

    const localIdx = localCustomers.findIndex((item) => item.phone === cleanPhone);
    if (localIdx !== -1) {
      localCustomers[localIdx].full_name = cleanName;
      localCustomers[localIdx].points = parsedPoints;
      localCustomers[localIdx].updated_at = res.rows[0].updated_at;
      saveLocalStore();
    }

    const logIdx = localDailyLogs.findIndex((item) => item.phone === cleanPhone);
    if (logIdx !== -1) {
      localDailyLogs[logIdx].full_name = cleanName;
      localDailyLogs[logIdx].points = parsedPoints;
      saveDailyHistoryStore();
    }

    return res.rows[0];
  }

  const idx = localCustomers.findIndex((c) => c.phone === cleanPhone);
  if (idx === -1) {
    const err = new Error('Không tìm thấy khách hàng với số điện thoại này.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  localCustomers[idx] = {
    ...localCustomers[idx],
    full_name: cleanName,
    points: parsedPoints,
    updated_at: new Date().toISOString()
  };
  saveLocalStore();

  const logIdx = localDailyLogs.findIndex((item) => item.phone === cleanPhone);
  if (logIdx !== -1) {
    localDailyLogs[logIdx].full_name = cleanName;
    localDailyLogs[logIdx].points = parsedPoints;
    saveDailyHistoryStore();
  }

  return localCustomers[idx];
}

async function listCustomers({ search = '', pointsFilter = 'all', limit = 1000, offset = 0 }) {
  const q = String(search || '').trim();
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 1), 2000);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  if (isPostgresConnected && pool) {
    const conditions = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(phone ILIKE $${params.length} OR full_name ILIKE $${params.length})`);
    }
    if (pointsFilter === 'max') {
      conditions.push('points = 10');
    } else if (pointsFilter === 'vip') {
      conditions.push('points >= 8');
    } else if (pointsFilter === 'unnamed') {
      conditions.push(`full_name = 'Khách hàng (Chưa rõ tên)'`);
    } else if (/^\d+$/.test(String(pointsFilter))) {
      params.push(parseInt(pointsFilter, 10));
      conditions.push(`points = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM customers ${whereClause}`,
      params
    );

    params.push(parsedLimit, parsedOffset);
    const dataRes = await pool.query(
      `SELECT id, phone, full_name, points, updated_at
       FROM customers
       ${whereClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      total: countRes.rows[0].total,
      items: dataRes.rows
    };
  }

  let filtered = [...localCustomers];
  if (q) {
    const qLower = q.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.phone.includes(qLower) ||
        c.full_name.toLowerCase().includes(qLower)
    );
  }
  if (pointsFilter === 'max') {
    filtered = filtered.filter((c) => c.points === 10);
  } else if (pointsFilter === 'vip') {
    filtered = filtered.filter((c) => c.points >= 8);
  } else if (pointsFilter === 'unnamed') {
    filtered = filtered.filter((c) => c.full_name === 'Khách hàng (Chưa rõ tên)');
  } else if (/^\d+$/.test(String(pointsFilter))) {
    const pt = parseInt(pointsFilter, 10);
    filtered = filtered.filter((c) => c.points === pt);
  }

  filtered.sort((a, b) => {
    const timeDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.id || 0) - (a.id || 0);
  });

  return {
    total: filtered.length,
    items: filtered.slice(parsedOffset, parsedOffset + parsedLimit)
  };
}

async function getAllForExport() {
  if (isPostgresConnected && pool) {
    const res = await pool.query(
      'SELECT id, phone, full_name, points, updated_at FROM customers ORDER BY points DESC, updated_at DESC'
    );
    return res.rows;
  }
  return [...localCustomers].sort((a, b) => b.points - a.points);
}

async function syncClientRecords({ customers = [], dailyLogs = [] }) {
  let changedCustomers = false;
  let changedLogs = false;

  if (Array.isArray(customers)) {
    for (const item of customers) {
      if (!item || !validatePhone(item.phone)) continue;
      const cleanPhone = String(item.phone).trim();
      const cleanName = sanitizeName(item.full_name);
      const parsedPoints = parseInt(item.points, 10);
      if (!cleanName || !validatePoints(parsedPoints)) continue;
      const updatedIso = item.updated_at || new Date().toISOString();

      if (isPostgresConnected && pool) {
        await pool.query(
          `INSERT INTO customers (phone, full_name, points, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (phone) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               points = EXCLUDED.points,
               updated_at = EXCLUDED.updated_at`,
          [cleanPhone, cleanName, parsedPoints, updatedIso]
        );
      }

      const idx = localCustomers.findIndex((c) => c.phone === cleanPhone);
      if (idx === -1) {
        const nextId =
          localCustomers.reduce((maxId, c) => Math.max(maxId, c.id || 0), 0) + 1;
        localCustomers.unshift({
          id: nextId,
          phone: cleanPhone,
          full_name: cleanName,
          points: parsedPoints,
          updated_at: updatedIso
        });
        changedCustomers = true;
      } else {
        const existing = localCustomers[idx];
        if (existing.full_name !== cleanName || existing.points !== parsedPoints) {
          localCustomers[idx] = {
            ...existing,
            full_name: cleanName,
            points: parsedPoints,
            updated_at: updatedIso
          };
          changedCustomers = true;
        }
      }
    }
  }

  if (Array.isArray(dailyLogs)) {
    for (const log of dailyLogs) {
      if (!log || !validatePhone(log.phone)) continue;
      const cleanPhone = String(log.phone).trim();
      const cleanName = sanitizeName(log.full_name);
      const parsedPoints = parseInt(log.points, 10);
      if (!cleanName || !validatePoints(parsedPoints)) continue;
      const dateKey = log.date_key || getVietnamDateKey();
      const createdIso = log.created_at || new Date().toISOString();

      if (isPostgresConnected && pool) {
        await pool.query(
          `INSERT INTO daily_customer_logs (date_key, phone, full_name, points, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (phone) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               points = EXCLUDED.points`,
          [dateKey, cleanPhone, cleanName, parsedPoints, createdIso]
        );
      }

      const logIdx = localDailyLogs.findIndex((l) => l.phone === cleanPhone);
      if (logIdx === -1) {
        const nextLogId =
          localDailyLogs.reduce((maxId, l) => Math.max(maxId, l.id || 0), 0) + 1;
        localDailyLogs.unshift({
          id: nextLogId,
          date_key: dateKey,
          phone: cleanPhone,
          full_name: cleanName,
          points: parsedPoints,
          created_at: createdIso
        });
        changedLogs = true;
      } else {
        const existingLog = localDailyLogs[logIdx];
        if (existingLog.full_name !== cleanName || existingLog.points !== parsedPoints) {
          localDailyLogs[logIdx] = {
            ...existingLog,
            full_name: cleanName,
            points: parsedPoints
          };
          changedLogs = true;
        }
      }
    }
  }

  if (changedCustomers) saveLocalStore();
  if (changedLogs) saveDailyHistoryStore();

  const [stats, dailyStats] = await Promise.all([getStats(), getDailyStats()]);
  return { stats, dailyStats };
}

module.exports = {
  initDatabase,
  getStats,
  getDailyStats,
  findByPhone,
  createCustomer,
  updateCustomer,
  listCustomers,
  getAllForExport,
  syncClientRecords,
  validatePhone,
  validatePoints
};

