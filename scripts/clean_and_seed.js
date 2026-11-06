const fs = require('fs');
const path = require('path');

const BOM = '\uFEFF';
const rawMdPath = path.join(__dirname, '..', 'data', 'raw_customers.md');
const seedSqlPath = path.join(__dirname, '..', 'seed_data.sql');
const cleanedCsvPath = path.join(__dirname, '..', 'data', 'cleaned_customers.csv');
const reportJsonPath = path.join(__dirname, '..', 'data', 'cleaning_report.json');
const localStorePath = path.join(__dirname, '..', 'data', 'local_customers_store.json');

const DEFAULT_ALL_POINTS = 5;

function cleanCustomerName(rawName) {
  if (!rawName) return { name: 'Khách hàng (Chưa rõ tên)', wasEmpty: true, hadHtmlGarbage: false };
  const hadHtmlGarbage = /&#x20;|&nbsp;/i.test(rawName);
  let cleaned = rawName
    .replace(/&#x20;/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\\~/g, '~')
    .normalize('NFC')
    .replace(/hồồng/gi, 'hồng')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return { name: 'Khách hàng (Chưa rõ tên)', wasEmpty: true, hadHtmlGarbage };
  }
  return { name: cleaned, wasEmpty: false, hadHtmlGarbage };
}

function classifyAndCleanPhone(rawPhone) {
  const digits = (rawPhone || '').replace(/\D/g, '');

  if (digits.length < 8 || /^(\d)\1+$/.test(digits)) {
    return {
      isValid: false,
      phone: null,
      rawPhone: digits,
      reason: 'SO_RAC',
      message: `Số điện thoại rác hoặc không hợp lệ (${digits})`
    };
  }

  if (digits.length === 9 && !digits.startsWith('0')) {
    return {
      isValid: true,
      phone: '0' + digits,
      rawPhone: digits,
      reason: 'ADDED_LEADING_ZERO',
      message: `Tự động thêm số 0 ở đầu: ${digits} -> 0${digits}`
    };
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return {
      isValid: true,
      phone: digits,
      rawPhone: digits,
      reason: 'VALID_10_DIGITS',
      message: null
    };
  }

  if (digits.length === 10 && !digits.startsWith('0')) {
    return {
      isValid: false,
      phone: null,
      suggestedPhone: '0' + digits.slice(0, 9),
      rawPhone: digits,
      reason: 'DU_SO_KHONG_CO_0_DAU',
      message: `Dư số (10 chữ số nhưng không bắt đầu bằng 0: ${digits}). Gợi ý kiểm tra: 0${digits.slice(0, 9)}`
    };
  }

  if (digits.length === 8) {
    return {
      isValid: false,
      phone: null,
      rawPhone: digits,
      reason: 'THIEU_SO',
      message: `Thiếu chữ số (chỉ có ${digits.length} chữ số: ${digits})`
    };
  }

  return {
    isValid: false,
    phone: null,
    rawPhone: digits,
    reason: 'KHONG_HOP_LE',
    message: `Định dạng SĐT không hợp lệ (${digits})`
  };
}

function escapeSqlLiteral(str) {
  return str.replace(/'/g, "''");
}

function escapeCsvField(str) {
  const s = String(str ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function runMigration() {
  const rawContent = fs.readFileSync(rawMdPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = rawContent.split(/\r?\n/);

  const rawRows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    if (line.includes('**Tên Khách Hàng**') || /^\|[\s:-]*---+[\s:-]*\|/.test(line)) continue;

    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length >= 3) {
      rawRows.push({
        lineNumber: i + 1,
        rawName: cells[0],
        rawPhone: cells[1],
        rawPoints: cells[2]
      });
    }
  }

  const phoneWarnings = [];
  const emptyNameRecords = [];
  const htmlCleanedRecords = [];
  const duplicateMap = new Map();
  let validPhoneRowsCount = 0;

  for (const row of rawRows) {
    const nameResult = cleanCustomerName(row.rawName);
    const phoneResult = classifyAndCleanPhone(row.rawPhone);

    if (nameResult.wasEmpty) {
      emptyNameRecords.push({
        lineNumber: row.lineNumber,
        rawPhone: row.rawPhone,
        assignedName: nameResult.name,
        points: DEFAULT_ALL_POINTS
      });
    }
    if (nameResult.hadHtmlGarbage) {
      htmlCleanedRecords.push({
        lineNumber: row.lineNumber,
        original: row.rawName,
        cleaned: nameResult.name
      });
    }

    if (!phoneResult.isValid) {
      phoneWarnings.push({
        lineNumber: row.lineNumber,
        name: nameResult.name,
        rawPhone: row.rawPhone,
        points: DEFAULT_ALL_POINTS,
        reason: phoneResult.reason,
        message: phoneResult.message,
        suggestedPhone: phoneResult.suggestedPhone || null
      });
      continue;
    }

    validPhoneRowsCount++;

    const validRecord = {
      lineNumber: row.lineNumber,
      phone: phoneResult.phone,
      full_name: nameResult.name,
      points: DEFAULT_ALL_POINTS
    };

    // Xóa bỏ hoàn toàn các dòng trùng lặp SĐT (chỉ giữ lại 1 bản ghi duy nhất cho mỗi SĐT, ưu tiên tên có nghĩa)
    if (!duplicateMap.has(validRecord.phone)) {
      duplicateMap.set(validRecord.phone, {
        phone: validRecord.phone,
        full_name: validRecord.full_name,
        points: DEFAULT_ALL_POINTS,
        occurrences: [validRecord]
      });
    } else {
      const existing = duplicateMap.get(validRecord.phone);
      existing.occurrences.push(validRecord);
      existing.points = DEFAULT_ALL_POINTS;

      const isDefault1 = existing.full_name === 'Khách hàng (Chưa rõ tên)';
      const isDefault2 = validRecord.full_name === 'Khách hàng (Chưa rõ tên)';
      if (isDefault1 && !isDefault2) {
        existing.full_name = validRecord.full_name;
      }
    }
  }

  const duplicatesRemovedList = Array.from(duplicateMap.values()).filter(
    (item) => item.occurrences.length > 1
  );
  const uniqueCustomers = Array.from(duplicateMap.values()).map((item) => ({
    phone: item.phone,
    full_name: item.full_name,
    points: DEFAULT_ALL_POINTS
  }));

  // 1. Tạo seed_data.sql (đã xóa toàn bộ dữ liệu trùng lặp và đồng bộ 100% khách hàng = 5 điểm)
  const sqlLines = [
    '-- ============================================================================',
    '-- HỆ THỐNG QUẢN LÝ ĐIỂM TÍCH LŨY KHÁCH HÀNG (TÍCH ĐIỂM - MIN NAILS DESIGN)',
    '-- File: seed_data.sql (Encoding: UTF-8 with BOM)',
    `-- Ngày tạo tự động: ${new Date().toISOString()}`,
    `-- Tổng số khách hàng duy nhất (đã xóa bỏ hoàn toàn trùng lặp): ${uniqueCustomers.length}`,
    `-- Điểm tích lũy mặc định cho toàn bộ khách hàng: ${DEFAULT_ALL_POINTS} điểm`,
    '-- ============================================================================',
    '',
    "SET client_encoding = 'UTF8';",
    '',
    'CREATE TABLE IF NOT EXISTS customers (',
    '    id SERIAL PRIMARY KEY,',
    '    phone VARCHAR(10) UNIQUE NOT NULL CHECK (phone ~ \'^0\\d{9}$\'),',
    '    full_name VARCHAR(150) NOT NULL,',
    '    points INTEGER NOT NULL DEFAULT 5 CHECK (points >= 1 AND points <= 10),',
    '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    ');',
    '',
    'CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);',
    'CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(updated_at DESC);',
    '',
    'BEGIN;',
    ''
  ];

  for (const row of uniqueCustomers) {
    const safePhone = escapeSqlLiteral(row.phone);
    const safeName = escapeSqlLiteral(row.full_name);

    sqlLines.push(
      `INSERT INTO customers (phone, full_name, points, updated_at) VALUES ('${safePhone}', '${safeName}', ${DEFAULT_ALL_POINTS}, CURRENT_TIMESTAMP)` +
        ` ON CONFLICT (phone) DO UPDATE SET` +
        ` full_name = EXCLUDED.full_name,` +
        ` points = ${DEFAULT_ALL_POINTS},` +
        ` updated_at = CURRENT_TIMESTAMP;`
    );
  }

  sqlLines.push('');
  sqlLines.push('COMMIT;');
  sqlLines.push('');

  const fullSqlContent = BOM + sqlLines.join('\r\n');
  fs.writeFileSync(seedSqlPath, fullSqlContent, 'utf8');

  // 2. Tạo cleaned_customers.csv (UTF-8 BOM)
  const csvLines = ['phone,full_name,points'];
  for (const c of uniqueCustomers) {
    csvLines.push(
      `${escapeCsvField(c.phone)},${escapeCsvField(c.full_name)},${escapeCsvField(c.points)}`
    );
  }
  fs.writeFileSync(cleanedCsvPath, BOM + csvLines.join('\r\n'), 'utf8');

  // 3. Lưu report JSON và cập nhật trực tiếp local_customers_store.json (tất cả = 5 điểm, không trùng)
  const reportObj = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRawRows: rawRows.length,
      validPhoneRows: validPhoneRowsCount,
      uniqueCustomersCount: uniqueCustomers.length,
      duplicatePhonesRemovedCount: duplicatesRemovedList.length,
      phoneWarningsCount: phoneWarnings.length,
      emptyNameRecordsCount: emptyNameRecords.length,
      htmlCleanedRecordsCount: htmlCleanedRecords.length,
      allUsersPoints: DEFAULT_ALL_POINTS
    },
    phoneWarnings,
    uniqueCustomers
  };
  fs.writeFileSync(reportJsonPath, BOM + JSON.stringify(reportObj, null, 2), 'utf8');

  const nowIso = new Date().toISOString();
  const seededStore = uniqueCustomers.map((c, idx) => ({
    id: idx + 1,
    phone: c.phone,
    full_name: c.full_name,
    points: DEFAULT_ALL_POINTS,
    updated_at: nowIso
  }));
  fs.writeFileSync(localStorePath, BOM + JSON.stringify(seededStore, null, 2), 'utf8');

  console.log('=== ĐÃ XÓA TRÙNG LẶP & ĐẶT TOÀN BỘ KHÁCH HÀNG = 5 ĐIỂM ===');
  console.log(JSON.stringify(reportObj.summary, null, 2));
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration, cleanCustomerName, classifyAndCleanPhone };
