document.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for PWA ("Tích Điểm")
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // PWA Add to Home Screen Logic
  let deferredInstallPrompt = null;
  const btnAddToHomeScreen = document.getElementById('btnAddToHomeScreen');
  const a2hsModalBackdrop = document.getElementById('a2hsModalBackdrop');
  const btnCloseA2hsModal = document.getElementById('btnCloseA2hsModal');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

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
    try {
      const res = await fetch(`/api/customers/lookup/${encodeURIComponent(phone)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        showToast(data.message || 'Lỗi khi tra cứu SĐT.', true);
        return;
      }

      if (data.found && data.customer) {
        renderExistingCustomerCard(data.customer);
      } else {
        renderNewCustomerForm(phone);
      }
    } catch (err) {
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

  function updateExistingPointsUI(points) {
    currentPoints = Math.min(Math.max(points, 1), 10);
    existingPointsBig.textContent = currentPoints;

    const pct = currentPoints * 10;
    existingProgressBadge.textContent = `${currentPoints}/10 điểm (${pct}%)`;
    existingProgressBar.style.width = `${pct}%`;

    if (currentPoints === 10) {
      existingScoreStatusText.textContent = '👑 Đạt tối đa 10/10đ';
    } else if (currentPoints >= 8) {
      existingScoreStatusText.textContent = `🔥 Còn ${10 - currentPoints}đ đạt đỉnh`;
    } else {
      existingScoreStatusText.textContent = '💖 Đang tích điểm';
    }

    btnMinusExisting.disabled = currentPoints <= 1;
    btnPlusExisting.disabled = currentPoints >= 10;

    existingHeartsGrid.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const isFilled = i <= currentPoints;
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = `heart-slot ${isFilled ? 'filled' : ''}`;
      slot.title = `Chọn ${i} điểm`;
      slot.innerHTML = `
        <span class="point-stamp-wrap">
          <img src="/point-icon.png?v=3" alt="${i} điểm" class="point-stamp-img" />
        </span>
        <span class="slot-num">${i}đ</span>
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
    newPointsBadge.textContent = `${newCustomerPoints} / 10đ`;
    btnMinusNew.disabled = newCustomerPoints <= 1;
    btnPlusNew.disabled = newCustomerPoints >= 10;

    newPointsStrip.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const isFilled = i <= newCustomerPoints;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `heart-slot ${isFilled ? 'filled' : ''}`;
      pill.title = `Chọn ${i} điểm`;
      pill.innerHTML = `
        <span class="point-stamp-wrap">
          <img src="/point-icon.png?v=3" alt="${i} điểm" class="point-stamp-img" />
        </span>
        <span class="slot-num">${i}đ</span>
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

  function getLocalVietnamDateKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
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

  function applyDailyStatsData(dailyData, totalCustCount = null) {
    if (!dailyData) return;
    cachedDailyStats = dailyData;
    lastKnownDateKey = dailyData.todayDateKey;

    if (totalCustCount !== null && statTotalCustomers) {
      statTotalCustomers.textContent = totalCustCount;
    }

    if (statTodayCustomers) {
      statTodayCustomers.textContent = dailyData.todayCount;
    }

    if (todayDateSubtitle) {
      todayDateSubtitle.textContent = `Ngày ${dailyData.todayDateDisplay}`;
    }

    renderDailyHistoryContent();
  }

  async function loadDailyStats() {
    try {
      const res = await fetch('/api/daily-stats');
      const json = await res.json();
      if (json.success && json.data) {
        applyDailyStatsData(json.data, json.total_customers ?? null);
      }
    } catch (e) {
      // Ignore
    }
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
      const res = await fetch('/api/stats');
      const json = await res.json();
      if (json.success && json.data) {
        statTotalCustomers.textContent = json.data.total_customers;
      }
    } catch (e) {
      // Ignore
    }
  }

  async function loadCustomerList() {
    if (!customerListTableBody) return;
    try {
      const search = customerListSearchInput ? customerListSearchInput.value.trim() : '';
      const res = await fetch(
        `/api/customers?search=${encodeURIComponent(search)}&limit=1000`
      );
      const data = await res.json();
      if (!data.success) return;

      if (listShowingCount) {
        listShowingCount.textContent = data.total;
      }

      if (!data.items || data.items.length === 0) {
        customerListTableBody.innerHTML = `
          <tr>
            <td colspan="3" class="empty-cell">Không tìm thấy khách hàng phù hợp.</td>
          </tr>
        `;
        return;
      }

      customerListTableBody.innerHTML = data.items
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

  loadTotalCustomers();
  loadDailyStats();
});
