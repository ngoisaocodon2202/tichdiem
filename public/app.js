let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

document.addEventListener('DOMContentLoaded', () => {
  // Register & Force-Update Service Worker for PWA ("Tích Điểm")
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js?v=20261107_2')
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {});
  }

  // PWA Add to Home Screen Logic
  const btnAddToHomeScreen = document.getElementById('btnAddToHomeScreen');
  const a2hsModalBackdrop = document.getElementById('a2hsModalBackdrop');
  const btnCloseA2hsModal = document.getElementById('btnCloseA2hsModal');

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showToast('Đã thêm "Tích Điểm" ra màn hình chính thành công!');
  });

  if (btnAddToHomeScreen) {
    btnAddToHomeScreen.addEventListener('click', async () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

      if (isStandalone) {
        showToast('App "Tích Điểm" đã ở ngoài màn hình chính!');
        return;
      }

      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('Đang thêm "Tích Điểm" vào màn hình chính...');
        }
        deferredInstallPrompt = null;
      } else if (a2hsModalBackdrop) {
        a2hsModalBackdrop.classList.add('open');
      }
    });
  }

  if (btnCloseA2hsModal && a2hsModalBackdrop) {
    btnCloseA2hsModal.addEventListener('click', () => {
      a2hsModalBackdrop.classList.remove('open');
    });
    a2hsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === a2hsModalBackdrop) {
        a2hsModalBackdrop.classList.remove('open');
      }
    });
  }

  // DOM Elements
  const phoneLookupInput = document.getElementById('phoneLookupInput');
  const phoneCharCounter = document.getElementById('phoneCharCounter');
  const clearPhoneBtn = document.getElementById('clearPhoneBtn');
  const lookupForm = document.getElementById('lookupForm');
  const phoneValidationMsg = document.getElementById('phoneValidationMsg');

  // Panels
  const existingCustomerPanel = document.getElementById('existingCustomerPanel');
  const newCustomerPanel = document.getElementById('newCustomerPanel');

  // Existing Customer Elements
  const existingCustomerNameInput = document.getElementById('existingCustomerNameInput');
  const existingCustomerPhoneText = document.getElementById('existingCustomerPhoneText');
  const existingCustomerUpdatedText = document.getElementById('existingCustomerUpdatedText');
  const existingPointsBig = document.getElementById('existingPointsBig');
  const existingScoreStatusText = document.getElementById('existingScoreStatusText');
  const existingProgressBadge = document.getElementById('existingProgressBadge');
  const existingProgressBar = document.getElementById('existingProgressBar');
  const existingHeartsGrid = document.getElementById('existingHeartsGrid');
  const btnMinusExisting = document.getElementById('btnMinusExisting');
  const btnPlusExisting = document.getElementById('btnPlusExisting');
  const btnUpdateCustomer = document.getElementById('btnUpdateCustomer');

  // New Customer Elements
  const createCustomerForm = document.getElementById('createCustomerForm');
  const newCustomerPhoneInput = document.getElementById('newCustomerPhoneInput');
  const newCustomerNameInput = document.getElementById('newCustomerNameInput');
  const newPointsBadge = document.getElementById('newPointsBadge');
  const newPointsStrip = document.getElementById('newPointsStrip');
  const btnMinusNew = document.getElementById('btnMinusNew');
  const btnPlusNew = document.getElementById('btnPlusNew');
  const btnSaveNewCustomer = document.getElementById('btnSaveNewCustomer');

  // State
  let currentCustomer = null;
  let currentPoints = 5;
  let newCustomerPoints = 1;

  const PHONE_REGEX = /^0\d{9}$/;
  const BASE_SEED_COUNT = 749;
  const SAVED_CUSTOMERS_KEY = 'tichdiem_saved_customers_v1';
  const SAVED_DAILY_LOGS_KEY = 'tichdiem_daily_logs_v1';

  function getSavedCustomersMap() {
    try {
      const raw = localStorage.getItem(SAVED_CUSTOMERS_KEY);
      return raw ? JSON.parse(raw) || {} : {};
    } catch (e) {
      return {};
    }
  }

  function setSavedCustomersMap(mapObj) {
    try {
      localStorage.setItem(SAVED_CUSTOMERS_KEY, JSON.stringify(mapObj));
    } catch (e) {
      // Ignore storage quota errors
    }
  }

  function getSavedDailyLogs() {
    try {
      const raw = localStorage.getItem(SAVED_DAILY_LOGS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function setSavedDailyLogs(logsArr) {
    try {
      localStorage.setItem(SAVED_DAILY_LOGS_KEY, JSON.stringify(logsArr));
    } catch (e) {
      // Ignore storage quota errors
    }
  }

  function persistCustomerLocally(customer, isNewCreation = false) {
    if (!customer || !customer.phone) return;
    const map = getSavedCustomersMap();
    const existing = map[customer.phone];
    map[customer.phone] = {
      id: customer.id || (existing && existing.id) || Date.now(),
      phone: customer.phone,
      full_name: customer.full_name,
      points: Number(customer.points) || 1,
      updated_at: customer.updated_at || new Date().toISOString(),
      is_new: isNewCreation || Boolean(existing && existing.is_new)
    };
    setSavedCustomersMap(map);

    const logs = getSavedDailyLogs();
    const logIdx = logs.findIndex((l) => l.phone === customer.phone);
    if (isNewCreation && logIdx === -1) {
      logs.unshift({
        date_key: getLocalVietnamDateKey(),
        phone: customer.phone,
        full_name: customer.full_name,
        points: Number(customer.points) || 1,
        created_at: customer.updated_at || new Date().toISOString()
      });
      setSavedDailyLogs(logs);
    } else if (logIdx !== -1) {
      logs[logIdx].full_name = customer.full_name;
      logs[logIdx].points = Number(customer.points) || 1;
      setSavedDailyLogs(logs);
    }
  }

  async function syncSavedRecordsToServer() {
    const map = getSavedCustomersMap();
    const customers = Object.values(map);
    const dailyLogs = getSavedDailyLogs();

    // Đảm bảo mọi khách hàng tạo mới (is_new: true) trong máy đều có mặt trong dailyLogs khi đẩy lên Cloud
    for (const cust of customers) {
      if (cust && cust.phone && cust.is_new) {
        if (!dailyLogs.some((l) => l && l.phone === cust.phone)) {
          const dKey = cust.updated_at
            ? getLocalVietnamDateKey(new Date(cust.updated_at))
            : getLocalVietnamDateKey();
          dailyLogs.unshift({
            date_key: dKey,
            phone: cust.phone,
            full_name: cust.full_name,
            points: Number(cust.points) || 1,
            created_at: cust.updated_at || new Date().toISOString()
          });
        }
      }
    }

    try {
      const res = await fetch(`/api/sync?_t=${Date.now()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        cache: 'no-store',
        body: JSON.stringify({ customers, dailyLogs })
      });
      const data = await res.json();
      if (data && data.success) {
        if (Array.isArray(data.overrides) && data.overrides.length > 0) {
          const updatedMap = getSavedCustomersMap();
          for (const item of data.overrides) {
            if (item && item.phone) {
              const prev = updatedMap[item.phone];
              updatedMap[item.phone] = {
                id: item.id || (prev && prev.id) || Date.now(),
                phone: item.phone,
                full_name: item.full_name,
                points: Number(item.points) || 1,
                updated_at: item.updated_at || (prev && prev.updated_at) || new Date().toISOString(),
                is_new: Boolean(prev && prev.is_new)
              };
            }
          }
          setSavedCustomersMap(updatedMap);
        }
        if (data.dailyStats && Array.isArray(data.dailyStats.historyByDate)) {
          const mergedLogs = getSavedDailyLogs();
          const logMap = new Map(mergedLogs.map((l) => [l.phone, l]));
          for (const day of data.dailyStats.historyByDate) {
            if (Array.isArray(day.customers)) {
              for (const c of day.customers) {
                if (c && c.phone) {
                  logMap.set(c.phone, {
                    date_key: c.date_key || day.date_key,
                    phone: c.phone,
                    full_name: c.full_name,
                    points: Number(c.points) || 1,
                    created_at: c.created_at || new Date().toISOString()
                  });
                }
              }
            }
          }
          setSavedDailyLogs(Array.from(logMap.values()));
        }
        return data;
      }
    } catch (e) {
      // Ignore network error
    }
    return null;
  }

  function showToast(message, isError = false) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : ''}`;
    toast.innerHTML = `
      <span>${isError ? '⚠️' : '🌸'}</span>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updatePhoneValidationUI(value, showIncompleteError = false) {
    phoneCharCounter.textContent = `${value.length}/10`;
    clearPhoneBtn.classList.toggle('visible', value.length > 0);

    phoneLookupInput.classList.remove('input-error', 'input-valid');
    phoneValidationMsg.classList.remove('error', 'success');

    if (value.length === 0) {
      phoneValidationMsg.innerHTML =
        '<span>💡 Nhập đủ 10 số bắt đầu bằng 0 để tự động tra cứu.</span>';
      return false;
    }

    if (!value.startsWith('0')) {
      phoneLookupInput.classList.add('input-error');
      phoneValidationMsg.classList.add('error');
      phoneValidationMsg.innerHTML =
        '<span>⚠️ SĐT bắt buộc bắt đầu bằng số 0 (VD: 0792271022).</span>';
      return false;
    }

    if (value.length < 10) {
      if (showIncompleteError) {
        phoneLookupInput.classList.add('input-error');
        phoneValidationMsg.classList.add('error');
        phoneValidationMsg.innerHTML = `<span>⚠️ Chưa đủ 10 số (Hiện tại: ${value.length}/10 số).</span>`;
      } else {
        phoneValidationMsg.innerHTML = `<span>⌨️ Đang nhập ${value.length}/10 số (Còn thiếu ${10 - value.length} số)...</span>`;
      }
      return false;
    }

    if (PHONE_REGEX.test(value)) {
      phoneLookupInput.classList.add('input-valid');
      phoneValidationMsg.classList.add('success');
      phoneValidationMsg.innerHTML = '<span>✅ SĐT hợp lệ (10 số chuẩn).</span>';
      return true;
    }

    return false;
  }

  phoneLookupInput.addEventListener('input', (e) => {
    const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
    if (e.target.value !== cleaned) {
      e.target.value = cleaned;
    }
    const isValid = updatePhoneValidationUI(cleaned, false);
    if (isValid) {
      performPhoneLookup(cleaned);
    } else {
      existingCustomerPanel.classList.remove('active');
      newCustomerPanel.classList.remove('active');
    }
  });

  clearPhoneBtn.addEventListener('click', () => {
    phoneLookupInput.value = '';
    updatePhoneValidationUI('', false);
    existingCustomerPanel.classList.remove('active');
    newCustomerPanel.classList.remove('active');
    phoneLookupInput.focus();
  });

  lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cleaned = phoneLookupInput.value.replace(/\D/g, '').slice(0, 10);
    phoneLookupInput.value = cleaned;
    const isValid = updatePhoneValidationUI(cleaned, true);
    if (isValid) {
      performPhoneLookup(cleaned);
    }
  });

  async function performPhoneLookup(phone) {
    const savedMap = getSavedCustomersMap();
    const localSaved = savedMap[phone] || null;

    try {
      const res = await fetch(`/api/customers/lookup/${encodeURIComponent(phone)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (localSaved) {
          renderExistingCustomerCard(localSaved);
          return;
        }
        showToast(data.message || 'Lỗi khi tra cứu SĐT.', true);
        return;
      }

      if (localSaved) {
        renderExistingCustomerCard(localSaved);
        syncSavedRecordsToServer();
        return;
      }

      if (data.found && data.customer) {
        renderExistingCustomerCard(data.customer);
      } else {
        renderNewCustomerForm(phone);
      }
    } catch (err) {
      if (localSaved) {
        renderExistingCustomerCard(localSaved);
        return;
      }
      showToast('Không thể kết nối máy chủ.', true);
    }
  }

  function renderExistingCustomerCard(customer) {
    currentCustomer = customer;
    currentPoints = Math.min(Math.max(parseInt(customer.points, 10) || 5, 1), 10);

    newCustomerPanel.classList.remove('active');
    existingCustomerPanel.classList.remove('active');
    void existingCustomerPanel.offsetWidth;
    existingCustomerPanel.classList.add('active');

    existingCustomerNameInput.value = customer.full_name;
    existingCustomerPhoneText.textContent = customer.phone;
    existingCustomerUpdatedText.textContent = customer.updated_at
      ? `Cập nhật: ${new Date(customer.updated_at).toLocaleString('vi-VN')}`
      : '';

    updateExistingPointsUI(currentPoints);
  }

  function getPointRewardLabel(points) {
    const pt = Number(points) || 1;
    if (pt >= 1 && pt <= 3) return 'Giảm 10%';
    if (pt === 4) return 'Giảm 15%';
    if (pt === 5 || pt === 6) return 'Giảm 10%';
    if (pt === 7) return 'Giảm 20%';
    if (pt === 8 || pt === 9) return 'Giảm 10%';
    if (pt === 10) return 'Tặng Sơn gel';
    return 'Giảm 10%';
  }

  function updateExistingPointsUI(points) {
    currentPoints = Math.min(Math.max(points, 1), 10);
    existingPointsBig.textContent = currentPoints;

    const pct = currentPoints * 10;
    const rewardText = getPointRewardLabel(currentPoints);
    existingProgressBadge.textContent = `${currentPoints}/10 • ${rewardText}`;
    existingProgressBar.style.width = `${pct}%`;

    existingScoreStatusText.textContent = `🎁 ${rewardText}`;

    btnMinusExisting.disabled = currentPoints <= 1;
    btnPlusExisting.disabled = currentPoints >= 10;

    existingHeartsGrid.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const isFilled = i <= currentPoints;
      const slotReward = getPointRewardLabel(i);
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = `heart-slot ${isFilled ? 'filled' : ''}`;
      slot.title = `Mức ${i}: ${slotReward}`;
      slot.innerHTML = `
        <span class="point-stamp-wrap">
          <img src="/point-icon.png?v=3" alt="${slotReward}" class="point-stamp-img" />
        </span>
        <span class="slot-num ${i === 10 ? 'slot-num-gift' : ''}">${slotReward}</span>
      `;
      slot.addEventListener('click', () => {
        updateExistingPointsUI(i);
      });
      existingHeartsGrid.appendChild(slot);
    }
  }

  btnMinusExisting.addEventListener('click', () => {
    if (currentPoints > 1) updateExistingPointsUI(currentPoints - 1);
  });

  btnPlusExisting.addEventListener('click', () => {
    if (currentPoints < 10) updateExistingPointsUI(currentPoints + 1);
  });

  btnUpdateCustomer.addEventListener('click', async () => {
    if (!currentCustomer) return;
    const newName = existingCustomerNameInput.value.trim();
    if (!newName) {
      showToast('Tên khách hàng không được để trống!', true);
      existingCustomerNameInput.focus();
      return;
    }

    btnUpdateCustomer.disabled = true;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(currentCustomer.phone)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: newName,
          points: currentPoints
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || 'Cập nhật thất bại.', true);
        return;
      }

      currentCustomer = data.customer;
      persistCustomerLocally(data.customer, false);
      syncSavedRecordsToServer().catch(() => {});
      renderExistingCustomerCard(data.customer);
      showToast(data.message || 'Đã cập nhật điểm thành công!');
      if (data.dailyStats) {
        applyDailyStatsData(data.dailyStats, data.stats ? data.stats.total_customers : null);
      } else {
        loadDailyStats();
      }
      if (customerListPanel && customerListPanel.classList.contains('active')) {
        loadCustomerList();
      }
    } catch (err) {
      showToast('Lỗi kết nối khi cập nhật điểm.', true);
    } finally {
      btnUpdateCustomer.disabled = false;
    }
  });

  function renderNewCustomerForm(phone) {
    currentCustomer = null;
    existingCustomerPanel.classList.remove('active');
    newCustomerPanel.classList.remove('active');
    void newCustomerPanel.offsetWidth;
    newCustomerPanel.classList.add('active');

    newCustomerPhoneInput.value = phone;
    newCustomerNameInput.value = '';
    updateNewCustomerPointsUI(1);
    setTimeout(() => newCustomerNameInput.focus(), 80);
  }

  function updateNewCustomerPointsUI(points) {
    newCustomerPoints = Math.min(Math.max(points, 1), 10);
    const rewardText = getPointRewardLabel(newCustomerPoints);
    newPointsBadge.textContent = `${newCustomerPoints}/10 • ${rewardText}`;
    btnMinusNew.disabled = newCustomerPoints <= 1;
    btnPlusNew.disabled = newCustomerPoints >= 10;

    newPointsStrip.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const isFilled = i <= newCustomerPoints;
      const slotReward = getPointRewardLabel(i);
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `heart-slot ${isFilled ? 'filled' : ''}`;
      pill.title = `Mức ${i}: ${slotReward}`;
      pill.innerHTML = `
        <span class="point-stamp-wrap">
          <img src="/point-icon.png?v=3" alt="${slotReward}" class="point-stamp-img" />
        </span>
        <span class="slot-num ${i === 10 ? 'slot-num-gift' : ''}">${slotReward}</span>
      `;
      pill.addEventListener('click', () => updateNewCustomerPointsUI(i));
      newPointsStrip.appendChild(pill);
    }
  }

  btnMinusNew.addEventListener('click', () => {
    if (newCustomerPoints > 1) updateNewCustomerPointsUI(newCustomerPoints - 1);
  });

  btnPlusNew.addEventListener('click', () => {
    if (newCustomerPoints < 10) updateNewCustomerPointsUI(newCustomerPoints + 1);
  });

  createCustomerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = newCustomerPhoneInput.value.trim();
    const fullName = newCustomerNameInput.value.trim();

    if (!fullName) {
      showToast('Vui lòng nhập Tên khách hàng!', true);
      newCustomerNameInput.focus();
      return;
    }

    btnSaveNewCustomer.disabled = true;
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          full_name: fullName,
          points: newCustomerPoints
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || 'Không thể tạo khách hàng.', true);
        return;
      }

      persistCustomerLocally(data.customer, true);
      syncSavedRecordsToServer().catch(() => {});
      showToast(data.message || 'Đã tạo mới & tích điểm!');
      renderExistingCustomerCard(data.customer);
      if (data.dailyStats) {
        applyDailyStatsData(data.dailyStats, data.stats ? data.stats.total_customers : null);
      } else {
        loadTotalCustomers();
        loadDailyStats();
      }
      if (customerListPanel && customerListPanel.classList.contains('active')) {
        loadCustomerList();
      }
    } catch (err) {
      showToast('Lỗi kết nối khi lưu khách hàng.', true);
    } finally {
      btnSaveNewCustomer.disabled = false;
    }
  });

  // Total Customers Button & Full Customer List Panel
  const statTotalCustomers = document.getElementById('statTotalCustomers');
  const btnToggleCustomerList = document.getElementById('btnToggleCustomerList');
  const toggleListLabel = document.getElementById('toggleListLabel');
  const customerListPanel = document.getElementById('customerListPanel');
  const btnCloseCustomerList = document.getElementById('btnCloseCustomerList');
  const customerListSearchInput = document.getElementById('customerListSearchInput');
  const customerListTableBody = document.getElementById('customerListTableBody');
  const listShowingCount = document.getElementById('listShowingCount');
  let listSearchTimer = null;

  // Today's Customers & Daily History Panel Elements
  const statTodayCustomers = document.getElementById('statTodayCustomers');
  const todayDateSubtitle = document.getElementById('todayDateSubtitle');
  const btnToggleDailyHistory = document.getElementById('btnToggleDailyHistory');
  const toggleDailyHistoryLabel = document.getElementById('toggleDailyHistoryLabel');
  const btnViewDailyHistory = document.getElementById('btnViewDailyHistory');
  const dailyHistoryPanel = document.getElementById('dailyHistoryPanel');
  const btnCloseDailyHistory = document.getElementById('btnCloseDailyHistory');
  const dailyHistoryDateInput = document.getElementById('dailyHistoryDateInput');
  const btnShowAllHistoryDates = document.getElementById('btnShowAllHistoryDates');
  const dailyHistoryContent = document.getElementById('dailyHistoryContent');

  let cachedDailyStats = null;
  let lastKnownDateKey = null;

  function getLocalVietnamDateKey(dateObj = new Date()) {
    const safeDate =
      dateObj instanceof Date && !Number.isNaN(dateObj.getTime()) ? dateObj : new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(safeDate);
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
  }

  function formatDateDisplayVN(dateKey) {
    const [y, m, d] = String(dateKey || '').split('-');
    if (!y || !m || !d) return String(dateKey || '');
    return `${d}/${m}/${y}`;
  }

  function getEffectiveTotalCustomers(serverTotal = null) {
    const savedMap = getSavedCustomersMap();
    const localNewCount = Object.values(savedMap).filter((c) => c && c.is_new).length;
    const minExpectedTotal = BASE_SEED_COUNT + localNewCount;
    return Math.max(Number(serverTotal) || BASE_SEED_COUNT, minExpectedTotal);
  }

  function mergeWithLocalDailyStats(serverDailyData) {
    const todayDateKey = getLocalVietnamDateKey();
    const todayDateDisplay = formatDateDisplayVN(todayDateKey);
    const localLogs = getSavedDailyLogs();
    const savedMap = getSavedCustomersMap();

    const byPhone = new Map();
    if (serverDailyData && Array.isArray(serverDailyData.historyByDate)) {
      for (const day of serverDailyData.historyByDate) {
        if (Array.isArray(day.customers)) {
          for (const c of day.customers) {
            if (c && c.phone) {
              const latest = savedMap[c.phone];
              byPhone.set(c.phone, {
                phone: c.phone,
                full_name: latest ? latest.full_name : c.full_name,
                points: latest ? latest.points : c.points,
                created_at: c.created_at,
                date_key: c.date_key || day.date_key
              });
            }
          }
        }
      }
    }

    for (const log of localLogs) {
      if (log && log.phone) {
        const latest = savedMap[log.phone];
        byPhone.set(log.phone, {
          phone: log.phone,
          full_name: latest ? latest.full_name : log.full_name,
          points: latest ? latest.points : log.points,
          created_at: log.created_at,
          date_key: log.date_key || todayDateKey
        });
      }
    }

    const groupedMap = new Map();
    groupedMap.set(todayDateKey, []);

    for (const item of byPhone.values()) {
      const dKey = item.date_key || todayDateKey;
      if (!groupedMap.has(dKey)) {
        groupedMap.set(dKey, []);
      }
      groupedMap.get(dKey).push(item);
    }

    const sortedDateKeys = Array.from(groupedMap.keys()).sort((a, b) => b.localeCompare(a));
    const historyByDate = sortedDateKeys.map((dKey) => {
      const customers = (groupedMap.get(dKey) || []).sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      return {
        date_key: dKey,
        date_display: formatDateDisplayVN(dKey),
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

  function applyDailyStatsData(dailyData, totalCustCount = null) {
    const mergedDaily = mergeWithLocalDailyStats(dailyData);
    cachedDailyStats = mergedDaily;
    lastKnownDateKey = mergedDaily.todayDateKey;

    if (statTotalCustomers) {
      statTotalCustomers.textContent = getEffectiveTotalCustomers(totalCustCount);
    }

    if (statTodayCustomers) {
      statTodayCustomers.textContent = mergedDaily.todayCount;
    }

    if (todayDateSubtitle) {
      todayDateSubtitle.textContent = `Ngày ${mergedDaily.todayDateDisplay}`;
    }

    renderDailyHistoryContent();
  }

  async function loadDailyStats() {
    try {
      const res = await fetch(`/api/daily-stats?_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success && json.data) {
        applyDailyStatsData(json.data, json.total_customers ?? null);
        return;
      }
    } catch (e) {
      // Ignore
    }
    applyDailyStatsData(null, null);
  }

  function renderDailyHistoryContent() {
    if (!dailyHistoryContent || !cachedDailyStats) return;

    const selectedDateKey = dailyHistoryDateInput ? dailyHistoryDateInput.value.trim() : '';
    let daysToRender = cachedDailyStats.historyByDate || [];

    if (selectedDateKey) {
      const found = daysToRender.find((d) => d.date_key === selectedDateKey);
      if (found) {
        daysToRender = [found];
      } else {
        daysToRender = [
          {
            date_key: selectedDateKey,
            date_display: formatDateDisplayVN(selectedDateKey),
            is_today: selectedDateKey === cachedDailyStats.todayDateKey,
            count: 0,
            customers: []
          }
        ];
      }
    }

    if (daysToRender.length === 0) {
      dailyHistoryContent.innerHTML = `
        <div class="daily-empty-box">Chưa có lịch sử khách hàng mới theo ngày.</div>
      `;
      return;
    }

    dailyHistoryContent.innerHTML = daysToRender
      .map((day) => {
        const dayLabel = day.is_today
          ? `Hôm nay (${escapeHtml(day.date_display)})`
          : `Ngày ${escapeHtml(day.date_display)}`;

        const rowsHtml =
          day.customers && day.customers.length > 0
            ? `
          <div class="table-responsive" style="border: none; border-radius: 0; box-shadow: none;">
            <table class="customer-table">
              <thead>
                <tr>
                  <th>Tên Khách Hàng</th>
                  <th>Số Điện Thoại</th>
                  <th>Điểm Tích</th>
                </tr>
              </thead>
              <tbody>
                ${day.customers
                  .map(
                    (c) => `
                  <tr data-history-phone="${escapeHtml(c.phone)}" title="Chạm để xem khách hàng này">
                    <td class="customer-name-cell">${escapeHtml(c.full_name)}</td>
                    <td class="customer-phone-cell">${escapeHtml(c.phone)}</td>
                    <td>
                      <span class="score-pill">${c.points} / 10đ</span>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
            : `
          <div class="daily-empty-box">
            <div class="daily-empty-line1">🌸 Ngày ${escapeHtml(day.date_display)}: 0 khách mới</div>
            <div class="daily-empty-line2">💡 Tạo khách &amp; tích điểm sẽ +1 tại đây</div>
          </div>
        `;

        return `
        <div class="daily-history-day-card">
          <div class="daily-day-header">
            <span class="daily-day-title">
              <img src="/history-icon.png" alt="" class="history-day-icon" />
              <span>${dayLabel}</span>
            </span>
            <span class="daily-day-count-badge">${day.count} Khách mới</span>
          </div>
          ${rowsHtml}
        </div>
      `;
      })
      .join('');

    dailyHistoryContent.querySelectorAll('tr[data-history-phone]').forEach((row) => {
      row.addEventListener('click', () => {
        const phone = row.getAttribute('data-history-phone');
        phoneLookupInput.value = phone;
        updatePhoneValidationUI(phone, true);
        performPhoneLookup(phone);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function toggleDailyHistoryPanel(forceOpen = null) {
    if (!dailyHistoryPanel) return;
    const isOpen =
      forceOpen !== null
        ? dailyHistoryPanel.classList.toggle('active', forceOpen)
        : dailyHistoryPanel.classList.toggle('active');

    if (toggleDailyHistoryLabel) {
      toggleDailyHistoryLabel.textContent = isOpen ? 'Khách ▴' : 'Khách ▾';
    }
    if (isOpen) {
      loadDailyStats();
      setTimeout(() => {
        dailyHistoryPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
    }
  }

  if (btnToggleDailyHistory) {
    btnToggleDailyHistory.addEventListener('click', () => {
      toggleDailyHistoryPanel();
    });
  }

  if (btnViewDailyHistory) {
    btnViewDailyHistory.addEventListener('click', () => {
      toggleDailyHistoryPanel();
    });
  }

  if (btnCloseDailyHistory) {
    btnCloseDailyHistory.addEventListener('click', () => {
      toggleDailyHistoryPanel(false);
    });
  }

  if (dailyHistoryDateInput) {
    dailyHistoryDateInput.addEventListener('change', () => {
      renderDailyHistoryContent();
    });
  }

  if (btnShowAllHistoryDates && dailyHistoryDateInput) {
    btnShowAllHistoryDates.addEventListener('click', () => {
      dailyHistoryDateInput.value = '';
      renderDailyHistoryContent();
    });
  }

  // Tự động kiểm tra qua nửa đêm (00:00) để reset lượng khách ngày mới về 0
  setInterval(() => {
    const currentKey = getLocalVietnamDateKey();
    if (lastKnownDateKey && currentKey !== lastKnownDateKey) {
      loadDailyStats();
    }
  }, 20000);

  async function loadTotalCustomers() {
    if (!statTotalCustomers) return;
    try {
      const res = await fetch(`/api/stats?_t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success && json.data) {
        statTotalCustomers.textContent = getEffectiveTotalCustomers(json.data.total_customers);
        return;
      }
    } catch (e) {
      // Ignore
    }
    statTotalCustomers.textContent = getEffectiveTotalCustomers(null);
  }

  async function loadCustomerList() {
    if (!customerListTableBody) return;
    try {
      const search = customerListSearchInput ? customerListSearchInput.value.trim() : '';
      const res = await fetch(
        `/api/customers?search=${encodeURIComponent(search)}&limit=1000&_t=${Date.now()}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!data.success) return;

      const savedMap = getSavedCustomersMap();
      const mergedByPhone = new Map();

      for (const savedCust of Object.values(savedMap)) {
        if (savedCust && savedCust.phone) {
          mergedByPhone.set(savedCust.phone, savedCust);
        }
      }

      if (Array.isArray(data.items)) {
        for (const c of data.items) {
          if (c && c.phone) {
            if (savedMap[c.phone]) {
              mergedByPhone.set(c.phone, {
                ...c,
                full_name: savedMap[c.phone].full_name,
                points: savedMap[c.phone].points,
                updated_at: savedMap[c.phone].updated_at || c.updated_at
              });
            } else {
              mergedByPhone.set(c.phone, c);
            }
          }
        }
      }

      let items = Array.from(mergedByPhone.values());
      if (search) {
        const qLower = search.toLowerCase();
        items = items.filter(
          (c) =>
            c.phone.includes(qLower) ||
            String(c.full_name || '')
              .toLowerCase()
              .includes(qLower)
        );
      }

      items.sort(
        (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      );

      const effectiveTotal = search ? items.length : getEffectiveTotalCustomers(data.total);
      if (listShowingCount) {
        listShowingCount.textContent = effectiveTotal;
      }
      if (!search && statTotalCustomers) {
        statTotalCustomers.textContent = effectiveTotal;
      }

      if (items.length === 0) {
        customerListTableBody.innerHTML = `
          <tr>
            <td colspan="3" class="empty-cell">Không tìm thấy khách hàng phù hợp.</td>
          </tr>
        `;
        return;
      }

      customerListTableBody.innerHTML = items
        .map(
          (c) => `
          <tr data-row-phone="${escapeHtml(c.phone)}" title="Chạm để chọn khách hàng này">
            <td class="customer-name-cell">${escapeHtml(c.full_name)}</td>
            <td class="customer-phone-cell">${escapeHtml(c.phone)}</td>
            <td>
              <span class="score-pill">${c.points} / 10đ</span>
            </td>
          </tr>
        `
        )
        .join('');

      customerListTableBody.querySelectorAll('tr[data-row-phone]').forEach((row) => {
        row.addEventListener('click', () => {
          const phone = row.getAttribute('data-row-phone');
          phoneLookupInput.value = phone;
          updatePhoneValidationUI(phone, true);
          performPhoneLookup(phone);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (err) {
      // Ignore
    }
  }

  if (btnToggleCustomerList && customerListPanel) {
    btnToggleCustomerList.addEventListener('click', () => {
      const isOpen = customerListPanel.classList.toggle('active');
      if (toggleListLabel) {
        toggleListLabel.textContent = isOpen ? 'Khách ▴' : 'Khách ▾';
      }
      if (isOpen) {
        loadCustomerList();
        setTimeout(() => {
          customerListPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 80);
      }
    });
  }

  if (btnCloseCustomerList && customerListPanel) {
    btnCloseCustomerList.addEventListener('click', () => {
      customerListPanel.classList.remove('active');
      if (toggleListLabel) {
        toggleListLabel.textContent = 'Khách ▾';
      }
    });
  }

  if (customerListSearchInput) {
    customerListSearchInput.addEventListener('input', () => {
      clearTimeout(listSearchTimer);
      listSearchTimer = setTimeout(loadCustomerList, 200);
    });
  }

  let isSyncingCrossDevice = false;
  async function runCrossDeviceSync() {
    if (isSyncingCrossDevice) return;
    isSyncingCrossDevice = true;
    try {
      const synced = await syncSavedRecordsToServer();
      if (synced && synced.dailyStats) {
        applyDailyStatsData(synced.dailyStats, synced.total_customers ?? null);
      } else {
        await Promise.all([loadTotalCustomers(), loadDailyStats()]);
      }
      if (customerListPanel && customerListPanel.classList.contains('active')) {
        loadCustomerList();
      }
    } finally {
      isSyncingCrossDevice = false;
    }
  }

  runCrossDeviceSync();

  // Tự động đồng bộ định kỳ giữa các máy của nhân viên (mỗi 10 giây và khi mở lại tab/màn hình)
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      runCrossDeviceSync();
    }
  }, 10000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runCrossDeviceSync();
    }
  });

  window.addEventListener('focus', () => {
    runCrossDeviceSync();
  });
});
