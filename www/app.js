// ============================
// مصاريفي - تطبيق إدارة الحسابات
// ============================

// --- قاعدة البيانات ---
const db = new Dexie('MasyafiDB');
db.version(1).stores({
  accounts: '++id, name, isActive',
  transactions: '++id, accountId, type, groupId, date',
  groups: '++id, accountId, name'
});

// --- حالة التطبيق ---
let currentPage = 'home';
let currentAccountId = null;
let selectedTxType = 'income';

// --- التهيئة ---
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
  setTimeout(() => {
    document.getElementById('splash-screen').classList.add('hide');
    document.getElementById('main-app').style.display = 'flex';
  }, 800);
});

async function initApp() {
  let accounts = await db.accounts.toArray();
  if (accounts.length === 0) {
    const id = await db.accounts.add({ name: 'الحساب الرئيسي', isActive: true, createdAt: new Date().toISOString() });
    currentAccountId = id;
  } else {
    const active = accounts.find(a => a.isActive);
    currentAccountId = active ? active.id : accounts[0].id;
    await db.accounts.update(currentAccountId, { isActive: true });
  }
  await refreshApp();
}

async function refreshApp() {
  await updateAccountDisplay();
  await renderHome();
  renderAccounts();
  renderGroups();
  populateGroupFilters();
}

async function updateAccountDisplay() {
  const account = await db.accounts.get(currentAccountId);
  if (account) document.getElementById('active-account-name').textContent = account.name;
}

// ============================
// التنقل بين الصفحات
// ============================
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');
  const titles = { home: 'الرئيسية', transactions: 'كل المعاملات', accounts: 'الحسابات', groups: 'المجموعات', settings: 'الإعدادات', about: 'حول التطبيق' };
  document.getElementById('page-title').textContent = titles[page] || 'مصاريفي';
  closeMenu();
  if (page === 'transactions') renderTransactions();
}

function toggleMenu() {
  document.getElementById('side-menu').classList.toggle('open');
  document.getElementById('side-menu-overlay').classList.toggle('open');
}

function closeMenu() {
  document.getElementById('side-menu').classList.remove('open');
  document.getElementById('side-menu-overlay').classList.remove('open');
}

// ============================
// الإشعارات والنوافذ
// ============================
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function openModal(id) { document.getElementById(id).classList.add('open'); }

function showConfirm(title, msg, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = msg;
  document.getElementById('confirm-btn').onclick = () => {
    closeModal('confirm-modal');
    if (callback) callback();
  };
  openModal('confirm-modal');
}

// ============================
// الصفحة الرئيسية
// ============================
async function renderHome() {
  const account = await db.accounts.get(currentAccountId);
  const balance = await calculateBalance(currentAccountId);
  document.getElementById('account-balance-display').textContent = `الرصيد الحالي: ${formatCurrency(balance)}`;

  const transactions = await db.transactions.where({ accountId: currentAccountId }).toArray();
  const totals = { income: 0, expense: 0, debt: 0, receivable: 0 };
  const pending = { debt: 0, receivable: 0 };
  transactions.forEach(tx => {
    if (tx.type === 'debt' || tx.type === 'receivable') {
      if (!tx.settled) { const rem = tx.remaining ?? tx.amount; totals[tx.type] += Math.max(0, rem); pending[tx.type]++; }
    } else if (totals[tx.type] !== undefined) totals[tx.type] += tx.amount;
  });
  document.getElementById('total-income').textContent = formatCurrency(totals.income);
  document.getElementById('total-expense').textContent = formatCurrency(totals.expense);
  document.getElementById('total-debt').textContent = formatCurrency(totals.debt) + (pending.debt ? ` (${pending.debt} معلق)` : '');
  document.getElementById('total-receivable').textContent = formatCurrency(totals.receivable) + (pending.receivable ? ` (${pending.receivable} معلق)` : '');

  const sorted = transactions.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  renderTransactionList('recent-transactions', sorted);
}

async function calculateBalance(accountId) {
  const transactions = await db.transactions.where({ accountId }).toArray();
  let balance = 0;
  transactions.forEach(tx => {
    if (tx.type === 'income') balance += tx.amount;
    else if (tx.type === 'expense') balance -= tx.amount;
  });
  return balance;
}

// ============================
// عرض قائمة المعاملات
// ============================
async function renderTransactionList(containerId, transactions) {
  const container = document.getElementById(containerId);
  if (!transactions || transactions.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-receipt"></i><p>لا توجد معاملات بعد</p></div>';
    return;
  }
  const groups = await db.groups.toArray();
  const groupMap = {};
  groups.forEach(g => groupMap[g.id] = g.name);

  const typeNames = { income: 'وارد', expense: 'مصروف', debt: 'دين', receivable: 'مستحق' };
  const typeIcons = { income: 'fa-arrow-down', expense: 'fa-arrow-up', debt: 'fa-hand-holding-usd', receivable: 'fa-file-invoice' };

  let html = '';
  for (const tx of transactions) {
    const dateStr = new Date(tx.date).toLocaleDateString('ar-SA-u-nu-latn', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const badge = tx.groupId && groupMap[tx.groupId] ? `<span class="tx-group-badge">${groupMap[tx.groupId]}</span>` : '';
    const isPending = (tx.type === 'debt' || tx.type === 'receivable') && !tx.settled;
    const settleBtn = isPending
      ? `<button class="tx-settle" onclick="settleTransaction(${tx.id})">${tx.type === 'debt' ? '💳 سدد' : '💰 تحصيل'}</button>`
      : '';
    const settledBadge = tx.settled ? `<span class="tx-settled-badge">✅ تمت</span>` : '';
    const remainingStr = isPending
      ? `<div class="tx-remaining">متبقي: ${formatCurrency(Math.max(0, tx.remaining ?? tx.amount))}</div>`
      : '';
    html += `
      <div class="transaction-item">
        <div class="tx-icon ${tx.type}"><i class="fas ${typeIcons[tx.type]}"></i></div>
        <div class="tx-info">
          <div class="tx-desc">${esc(tx.description || typeNames[tx.type])} ${badge} ${settledBadge}</div>
          <div class="tx-date">${dateStr}</div>
          ${remainingStr}
        </div>
        <div class="tx-amount ${tx.type}">${formatCurrency(tx.amount)}</div>
        ${settleBtn}
        <button class="tx-delete" onclick="deleteTransaction(${tx.id})" title="حذف"><i class="fas fa-times"></i></button>
      </div>`;
  }
  container.innerHTML = html;
}

// ============================
// صفحة كل المعاملات
// ============================
async function renderTransactions() {
  const filterType = document.getElementById('filter-type').value;
  const filterGroup = document.getElementById('filter-group').value;
  let transactions = await db.transactions.where({ accountId: currentAccountId }).toArray();
  if (filterType !== 'all') transactions = transactions.filter(tx => tx.type === filterType);
  if (filterGroup !== 'all') transactions = transactions.filter(tx => String(tx.groupId) === filterGroup);
  const sorted = transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  renderTransactionList('all-transactions', sorted);
}

async function populateGroupFilters() {
  const groups = await db.groups.where({ accountId: currentAccountId }).toArray();
  ['filter-group', 'transaction-group', 'export-group-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    const isTx = id === 'transaction-group';
    sel.innerHTML = isTx ? '<option value="">بدون مجموعة</option>' : '<option value="all">كل المجموعات</option>';
    groups.forEach(g => {
      sel.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
    });
    sel.value = val;
  });
}

// ============================
// إدارة المعاملات
// ============================
function showAddTransactionModal(type) {
  selectedTxType = type || 'income';
  document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.type-option[data-type="${selectedTxType}"]`);
  if (el) el.classList.add('selected');
  const names = { income: 'وارد', expense: 'مصروف', debt: 'دين', receivable: 'مستحق' };
  document.getElementById('modal-transaction-title').textContent = `إضافة ${names[selectedTxType]}`;
  document.getElementById('transaction-amount').value = '';
  document.getElementById('transaction-desc').value = '';
  document.getElementById('transaction-date').value = new Date().toISOString().split('T')[0];
  populateGroupFilters();
  openModal('add-transaction-modal');
}

function openAddTransaction(type) { showAddTransactionModal(type); }

function selectTransactionType(type) {
  selectedTxType = type;
  document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.type-option[data-type="${type}"]`).classList.add('selected');
  const names = { income: 'وارد', expense: 'مصروف', debt: 'دين', receivable: 'مستحق' };
  document.getElementById('modal-transaction-title').textContent = `إضافة ${names[type]}`;
}

async function saveTransaction() {
  const amount = parseFloat(document.getElementById('transaction-amount').value);
  const description = document.getElementById('transaction-desc').value.trim();
  const groupId = document.getElementById('transaction-group').value;
  const date = document.getElementById('transaction-date').value;
  if (!amount || amount <= 0) { showToast('الرجاء إدخال مبلغ صحيح'); return; }
  if (!date) { showToast('الرجاء اختيار التاريخ'); return; }
  await db.transactions.add({
    accountId: currentAccountId, type: selectedTxType, amount,
    description: description || '', groupId: groupId || null,
    date, createdAt: new Date().toISOString(),
    settled: false,
    remaining: (selectedTxType === 'debt' || selectedTxType === 'receivable') ? amount : null
  });
  closeModal('add-transaction-modal');
  showToast('تمت إضافة المعاملة بنجاح');
  await refreshApp();
}

async function deleteTransaction(id) {
  showConfirm('حذف المعاملة', 'هل أنت متأكد من حذف هذه المعاملة؟', async () => {
    await db.transactions.delete(id);
    showToast('تم حذف المعاملة');
    await refreshApp();
    if (currentPage === 'transactions') renderTransactions();
  });
}

async function settleTransaction(id) {
  const tx = await db.transactions.get(id);
  if (!tx) return;
  const isDebt = tx.type === 'debt';
  const remaining = tx.remaining ?? tx.amount;
  const settleAmountStr = prompt(
    isDebt
      ? `المبلغ المتبقي: ${formatCurrency(Math.max(0, remaining))}\nأدخل المبلغ المراد تسديده:`
      : `المبلغ المتبقي: ${formatCurrency(Math.max(0, remaining))}\nأدخل المبلغ المراد تحصيله:`,
    Math.max(0, remaining)
  );
  if (settleAmountStr === null) return;
  const settleAmount = parseFloat(settleAmountStr);
  if (settleAmount <= 0 || settleAmount > Math.max(0, remaining)) {
    showToast('الرجاء إدخال مبلغ صحيح');
    return;
  }
  const newType = isDebt ? 'expense' : 'income';
  const newRemaining = Math.max(0, remaining - settleAmount);
  await db.transactions.add({
    accountId: tx.accountId, type: newType, amount: settleAmount,
    description: (isDebt ? 'سداد دين: ' : 'تحصيل مستحق: ') + (tx.description || ''),
    groupId: tx.groupId, date: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(), settled: true, settlesId: tx.id
  });
  if (newRemaining <= 0) {
    await db.transactions.update(id, { settled: true, remaining: 0 });
    showToast(isDebt ? 'تم تسديد الدين بالكامل' : 'تم تحصيل المستحق بالكامل');
  } else {
    await db.transactions.update(id, { remaining: newRemaining });
    showToast(`تم تسوية ${formatCurrency(settleAmount)}. المتبقي: ${formatCurrency(newRemaining)}`);
  }
  await refreshApp();
  if (currentPage === 'transactions') renderTransactions();
}

// ============================
// إدارة الحسابات
// ============================
async function renderAccounts() {
  const accounts = await db.accounts.toArray();
  const container = document.getElementById('accounts-list');
  if (accounts.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-wallet"></i><p>لا توجد حسابات</p></div>';
    return;
  }
  let html = '';
  for (const acc of accounts) {
    const balance = await calculateBalance(acc.id);
    const active = acc.id === currentAccountId;
    html += `
      <div class="account-card ${active ? 'active-account' : ''}">
        <div class="account-icon"><i class="fas fa-wallet"></i></div>
        <div class="account-info">
          <h4>${esc(acc.name)} ${active ? '<span class="active-badge">النشط</span>' : ''}</h4>
          <p>الرصيد: ${formatCurrency(balance)}</p>
        </div>
        <div class="account-actions">
          ${!active ? `<button class="btn-activate" onclick="switchAccount(${acc.id})" title="تفعيل"><i class="fas fa-check-circle"></i></button>` : ''}
          <button class="btn-delete-account" onclick="deleteAccount(${acc.id})" title="حذف"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

function showAddAccountModal() {
  document.getElementById('account-name').value = '';
  document.getElementById('account-balance').value = '0';
  openModal('add-account-modal');
}

async function saveAccount() {
  const name = document.getElementById('account-name').value.trim();
  const balance = parseFloat(document.getElementById('account-balance').value) || 0;
  if (!name) { showToast('الرجاء إدخال اسم الحساب'); return; }
  const id = await db.accounts.add({ name, isActive: false, createdAt: new Date().toISOString() });
  if (balance > 0) {
    await db.transactions.add({
      accountId: id, type: 'income', amount: balance,
      description: 'رصيد افتتاحي', groupId: null,
      date: new Date().toISOString().split('T')[0], createdAt: new Date().toISOString(),
      settled: false, remaining: null
    });
  }
  closeModal('add-account-modal');
  showToast('تمت إضافة الحساب بنجاح');
  await renderAccounts();
}

async function switchAccount(id) {
  await db.accounts.update(currentAccountId, { isActive: false });
  await db.accounts.update(id, { isActive: true });
  currentAccountId = id;
  showToast('تم التبديل إلى الحساب');
  await refreshApp();
  renderAccounts();
}

async function deleteAccount(id) {
  const txCount = await db.transactions.where({ accountId: id }).count();
  const msg = txCount > 0 ? `هذا الحساب يحتوي على ${txCount} معاملة. سيتم حذفها جميعاً.` : 'هل أنت متأكد من حذف هذا الحساب؟';
  showConfirm('حذف الحساب', msg, async () => {
    await db.transactions.where({ accountId: id }).delete();
    await db.groups.where({ accountId: id }).delete();
    await db.accounts.delete(id);
    if (currentAccountId === id) {
      const remaining = await db.accounts.toArray();
      if (remaining.length > 0) {
        currentAccountId = remaining[0].id;
        await db.accounts.update(currentAccountId, { isActive: true });
      } else {
        const newId = await db.accounts.add({ name: 'الحساب الرئيسي', isActive: true, createdAt: new Date().toISOString() });
        currentAccountId = newId;
      }
    }
    showToast('تم حذف الحساب');
    await refreshApp();
    renderAccounts();
  });
}

function showAccountSelector() {
  openModal('account-selector-modal');
  renderAccountSelectorList();
}

async function renderAccountSelectorList() {
  const accounts = await db.accounts.toArray();
  const container = document.getElementById('account-selector-list');
  let html = '';
  for (const acc of accounts) {
    const balance = await calculateBalance(acc.id);
    const active = acc.id === currentAccountId;
    html += `
      <div class="account-card ${active ? 'active-account' : ''}" style="cursor:pointer;margin-bottom:8px" onclick="selectAccountFromList(${acc.id})">
        <div class="account-icon"><i class="fas fa-wallet"></i></div>
        <div class="account-info">
          <h4>${esc(acc.name)} ${active ? '<span class="active-badge">النشط</span>' : ''}</h4>
          <p>الرصيد: ${formatCurrency(balance)}</p>
        </div>
      </div>`;
  }
  html += `<div style="margin-top:12px"><button class="btn-primary" style="width:100%" onclick="closeModal('account-selector-modal');showAddAccountModal()"><i class="fas fa-plus"></i> إضافة حساب جديد</button></div>`;
  container.innerHTML = html;
}

async function selectAccountFromList(id) {
  if (id === currentAccountId) { closeModal('account-selector-modal'); return; }
  await db.accounts.update(currentAccountId, { isActive: false });
  await db.accounts.update(id, { isActive: true });
  currentAccountId = id;
  closeModal('account-selector-modal');
  showToast('تم التبديل إلى ' + (await db.accounts.get(id)).name);
  await refreshApp();
}

// ============================
// إدارة المجموعات
// ============================
async function renderGroups() {
  const groups = await db.groups.where({ accountId: currentAccountId }).toArray();
  const container = document.getElementById('groups-list');
  if (groups.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-folder"></i><p>لا توجد مجموعات<br>أضف مجموعة لتنظيم معاملاتك</p></div>';
    return;
  }
  let html = '';
  for (const g of groups) {
    const count = await db.transactions.where({ groupId: g.id }).count();
    html += `
      <div class="group-card">
        <button class="group-delete" onclick="deleteGroup(${g.id})"><i class="fas fa-times"></i></button>
        <div style="font-size:32px;margin-bottom:8px">&#x1F4C1;</div>
        <h4>${esc(g.name)}</h4>
        ${g.description ? `<p>${esc(g.description)}</p>` : ''}
        <div class="group-count">${count} معاملة</div>
      </div>`;
  }
  container.innerHTML = html;
}

function showAddGroupModal() {
  document.getElementById('group-name').value = '';
  document.getElementById('group-desc').value = '';
  openModal('add-group-modal');
}

async function saveGroup() {
  const name = document.getElementById('group-name').value.trim();
  const desc = document.getElementById('group-desc').value.trim();
  if (!name) { showToast('الرجاء إدخال عنوان المجموعة'); return; }
  await db.groups.add({ accountId: currentAccountId, name, description: desc || '', createdAt: new Date().toISOString() });
  closeModal('add-group-modal');
  showToast('تمت إضافة المجموعة');
  await refreshApp();
}

async function deleteGroup(id) {
  const count = await db.transactions.where({ groupId: id }).count();
  showConfirm('حذف المجموعة', count > 0 ? `هذه المجموعة تحتوي على ${count} معاملة. سيتم إزالتها من المجموعة.` : 'هل أنت متأكد من حذف هذه المجموعة؟', async () => {
    await db.transactions.where({ groupId: id }).modify({ groupId: null });
    await db.groups.delete(id);
    showToast('تم حذف المجموعة');
    await refreshApp();
  });
}

// ============================
// النسخ الاحتياطي والاستعادة
// ============================
async function backupData() {
  try {
    const accounts = await db.accounts.toArray();
    const transactions = await db.transactions.toArray();
    const groups = await db.groups.toArray();
    const backup = { version: 1, date: new Date().toISOString(), accounts, transactions, groups };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `مصاريفي_نسخة_احتياطية_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('تم إنشاء النسخة الاحتياطية بنجاح');
  } catch (e) {
    showToast('خطأ: ' + e.message);
  }
}

async function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.version || !data.accounts) { showToast('ملف غير صالح'); return; }
    showConfirm('استعادة البيانات', 'سيتم استبدال جميع البيانات الحالية. هل أنت متأكد؟', async () => {
      await db.accounts.clear();
      await db.transactions.clear();
      await db.groups.clear();
      for (const acc of data.accounts) await db.accounts.add(acc);
      for (const tx of data.transactions) await db.transactions.add(tx);
      for (const g of data.groups) await db.groups.add(g);
      currentAccountId = data.accounts.find(a => a.isActive)?.id || data.accounts[0]?.id;
      showToast('تمت استعادة البيانات بنجاح');
      await refreshApp();
    });
  } catch (e) {
    showToast('خطأ: ' + e.message);
  }
  event.target.value = '';
}

// ============================
// تصدير PDF
// ============================
async function exportPDF(filter) {
  showToast('جاري إنشاء PDF...');
  try {
    const account = await db.accounts.get(currentAccountId);
    let transactions = await db.transactions.where({ accountId: currentAccountId }).toArray();
    const groups = await db.groups.toArray();
    const groupMap = {};
    groups.forEach(g => groupMap[g.id] = g.name);
    const sorted = transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totals = { income: 0, expense: 0, debt: 0, receivable: 0 };
    sorted.forEach(tx => {
      if (tx.type === 'debt' || tx.type === 'receivable') { if (!tx.settled) { const rem = tx.remaining ?? tx.amount; totals[tx.type] += Math.max(0, rem); } }
      else if (totals[tx.type] !== undefined) totals[tx.type] += tx.amount;
    });
    const balance = totals.income - totals.expense;
    const typeNames = { income: 'وارد', expense: 'مصروف', debt: 'دين', receivable: 'مستحق' };
    const settledLabel = tx => tx.settled ? ' ✅' : '';

    let rowsHtml = '';
    for (const tx of sorted) {
      const dateStr = new Date(tx.date).toLocaleDateString('ar-SA-u-nu-latn');
      const extraLabel = (tx.type === 'debt' || tx.type === 'receivable') && !tx.settled ? ` (متبقي: ${formatCurrency(Math.max(0, tx.remaining ?? tx.amount))})` : '';
      rowsHtml += `<tr>
        <td>${dateStr}</td>
        <td>${esc(tx.description || typeNames[tx.type])}${settledLabel(tx)}${extraLabel}</td>
        <td>${tx.groupId && groupMap[tx.groupId] ? esc(groupMap[tx.groupId]) : '-'}</td>
        <td>${typeNames[tx.type]}</td>
        <td style="text-align:left;font-weight:bold">${formatCurrency(tx.amount)}</td>
      </tr>`;
    }

    const reportHtml = `
      <div style="font-family:Tajawal,Arial,sans-serif;padding:20px;direction:rtl">
        <h1 style="text-align:center;color:#1a73e8;font-size:22px;margin-bottom:4px">تقرير المعاملات المالية</h1>
        <p style="text-align:center;color:#666;font-size:13px;margin:0 0 4px">الحساب: ${esc(account.name)}</p>
        <p style="text-align:center;color:#666;font-size:13px;margin:0 0 16px">التاريخ: ${new Date().toLocaleDateString('ar-SA-u-nu-latn')}</p>
        <div style="display:flex;justify-content:space-around;background:#f0f4ff;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px">
          <span><strong>الرصيد:</strong> ${formatCurrency(balance)}</span>
          <span><strong>الواردات:</strong> ${formatCurrency(totals.income)}</span>
          <span><strong>المصروفات:</strong> ${formatCurrency(totals.expense)}</span>
          <span><strong>الديون:</strong> ${formatCurrency(totals.debt)}</span>
          <span><strong>المستحقات:</strong> ${formatCurrency(totals.receivable)}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#1a73e8;color:white">
              <th style="padding:8px;text-align:right">التاريخ</th>
              <th style="padding:8px;text-align:right">الوصف</th>
              <th style="padding:8px;text-align:right">المجموعة</th>
              <th style="padding:8px;text-align:right">النوع</th>
              <th style="padding:8px;text-align:left">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999">لا توجد معاملات</td></tr>'}
          </tbody>
        </table>
        <p style="text-align:center;color:#999;font-size:11px;margin-top:20px">تم الإنشاء بواسطة تطبيق مصاريفي</p>
      </div>`;

    // طباعة باستخدام html2canvas + jsPDF
    const container = document.createElement('div');
    container.innerHTML = reportHtml;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.background = 'white';
    container.style.direction = 'rtl';
    document.body.appendChild(container);

    const canvas = await html2canvas(container, {
      scale: 2, useCORS: true, logging: false,
      backgroundColor: '#ffffff'
    });
    document.body.removeChild(container);

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 190;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 10;
    doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    heightLeft -= 287;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 10;
      doc.addPage();
      doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= 287;
    }
    doc.save(`مصاريفي_تقرير_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast('تم تصدير PDF بنجاح');
  } catch (e) {
    showToast('خطأ في التصدير: ' + e.message);
  }
}

function showExportByGroup() {
  populateGroupFilters();
  openModal('export-group-modal');
}

async function exportPDFByGroup() {
  const groupId = document.getElementById('export-group-select').value;
  if (!groupId || groupId === 'all') { showToast('الرجاء اختيار مجموعة'); return; }
  closeModal('export-group-modal');
  showToast('جاري إنشاء PDF...');
  try {
    const account = await db.accounts.get(currentAccountId);
    const group = await db.groups.get(parseInt(groupId));
    let transactions = await db.transactions.where({ accountId: currentAccountId }).filter(tx => String(tx.groupId) === groupId).toArray();
    const sorted = transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totals = { income: 0, expense: 0, debt: 0, receivable: 0 };
    sorted.forEach(tx => {
      if (tx.type === 'debt' || tx.type === 'receivable') { if (!tx.settled) { const rem = tx.remaining ?? tx.amount; totals[tx.type] += Math.max(0, rem); } }
      else if (totals[tx.type] !== undefined) totals[tx.type] += tx.amount;
    });
    const balance = totals.income - totals.expense;
    const typeNames = { income: 'وارد', expense: 'مصروف', debt: 'دين', receivable: 'مستحق' };
    const settledLabel = tx => tx.settled ? ' ✅' : '';

    let rowsHtml = '';
    for (const tx of sorted) {
      const extraLabel = (tx.type === 'debt' || tx.type === 'receivable') && !tx.settled ? ` (متبقي: ${formatCurrency(Math.max(0, tx.remaining ?? tx.amount))})` : '';
      rowsHtml += `<tr>
        <td>${new Date(tx.date).toLocaleDateString('ar-SA-u-nu-latn')}</td>
        <td>${esc(tx.description || typeNames[tx.type])}${settledLabel(tx)}${extraLabel}</td>
        <td>${typeNames[tx.type]}</td>
        <td style="text-align:left;font-weight:bold">${formatCurrency(tx.amount)}</td>
      </tr>`;
    }

    const reportHtml = `
      <div style="font-family:Tajawal,Arial,sans-serif;padding:20px;direction:rtl">
        <h1 style="text-align:center;color:#1a73e8;font-size:22px;margin-bottom:4px">تقرير المجموعة</h1>
        <h2 style="text-align:center;color:#333;font-size:18px;margin:0 0 4px">${esc(group.name)}</h2>
        <p style="text-align:center;color:#666;font-size:13px;margin:0 0 16px">الحساب: ${esc(account.name)}</p>
        <div style="display:flex;justify-content:space-around;background:#f0f4ff;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px">
          <span><strong>الرصيد:</strong> ${formatCurrency(balance)}</span>
          <span><strong>الواردات:</strong> ${formatCurrency(totals.income)}</span>
          <span><strong>المصروفات:</strong> ${formatCurrency(totals.expense)}</span>
          <span><strong>الديون:</strong> ${formatCurrency(totals.debt)}</span>
          <span><strong>المستحقات:</strong> ${formatCurrency(totals.receivable)}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#1a73e8;color:white">
              <th style="padding:8px;text-align:right">التاريخ</th>
              <th style="padding:8px;text-align:right">الوصف</th>
              <th style="padding:8px;text-align:right">النوع</th>
              <th style="padding:8px;text-align:left">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">لا توجد معاملات</td></tr>'}
          </tbody>
        </table>
        <p style="text-align:center;color:#999;font-size:11px;margin-top:20px">تم الإنشاء بواسطة تطبيق مصاريفي</p>
      </div>`;

    const container = document.createElement('div');
    container.innerHTML = reportHtml;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.background = 'white';
    container.style.direction = 'rtl';
    document.body.appendChild(container);

    const canvas = await html2canvas(container, {
      scale: 2, useCORS: true, logging: false,
      backgroundColor: '#ffffff'
    });
    document.body.removeChild(container);

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 190;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 10;
    doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    heightLeft -= 287;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 10;
      doc.addPage();
      doc.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= 287;
    }
    doc.save(`مصاريفي_${group.name}_${new Date().toISOString().split('T')[0]}.pdf`);
    showToast('تم تصدير PDF بنجاح');
  } catch (e) {
    showToast('خطأ: ' + e.message);
  }
}

// ============================
// حذف جميع البيانات
// ============================
function clearAllData() {
  showConfirm('حذف جميع البيانات', 'سيتم حذف جميع الحسابات والمعاملات والمجموعات. هذا الإجراء لا يمكن التراجع عنه.', async () => {
    await db.accounts.clear();
    await db.transactions.clear();
    await db.groups.clear();
    const id = await db.accounts.add({ name: 'الحساب الرئيسي', isActive: true, createdAt: new Date().toISOString() });
    currentAccountId = id;
    showToast('تم حذف جميع البيانات');
    await refreshApp();
  });
}

// ============================
// دوال مساعدة
// ============================
function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('ar-SA-u-nu-latn') + ' د.ع';
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
