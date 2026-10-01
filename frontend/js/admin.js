// frontend/js/admin.js
/**
 * Blankup Admin Dashboard
 * Operational dashboard for orders, payment status, users, and generated designs.
 */

const API_ADMIN = window.location.origin + '/api/admin';
const API_ORDERS = window.location.origin + '/api/orders';
const API_REVIEWS = window.location.origin + '/api/reviews';

const adminState = {
  stats: null,
  orders: [],
  users: [],
  designs: [],
  vouchers: [],
  plans: [],
  credits: [],
  reviews: [],
  reviewFilter: 'all',
  reviewSearch: '',
  currentTab: 'overview',
  orderFilter: 'all',
  paymentFilter: 'all',
  orderSearch: '',
  designVisibilityFilter: 'all',
  userSearch: '',
  voucherSearch: '',
  creditsSearch: '',
  orderUserFilter: null,
  orderUserFilterLabel: '',
  selectedPreviewOrder: null,
  previewSide: 'front',
  previewShirtColor: '#ffffff',
  reportPeriod: 'month',
  reportYear: new Date().getFullYear(),
  reportData: [],
  reportSummary: null,
};

const t = (key, fallback, params) => {
  let text = fallback;
  if (window.i18n && typeof window.i18n.t === 'function') {
    const translated = window.i18n.t(key);
    if (translated && translated !== key) text = translated;
  }
  if (params && typeof text === 'string') {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value ?? ''));
    }
  }
  return text;
};

const _busy = new Set();
function busyGuard(key) { if (_busy.has(key)) return true; _busy.add(key); return false; }
function busyRelease(key) { _busy.delete(key); }
function setBusyBtn(btn, busy, text) {
  if (!btn) return function () {};
  const prev = btn.textContent;
  btn.disabled = !!busy;
  if (text) btn.textContent = busy ? text : prev;
  return function () { btn.disabled = false; btn.textContent = prev; };
}

const STATUS_META = {
  pending: { label: () => t('admin.filter.pending', 'Đang xử lý'), cls: 'badge-pending' },
  awaiting_payment: { label: () => t('admin.filter.awaitingPayment', 'Chờ thanh toán'), cls: 'badge-awaiting-payment' },
  paid: { label: () => t('admin.filter.paidOrder', 'Đã thanh toán'), cls: 'badge-paid' },
  processing: { label: () => t('admin.filter.processing', 'Đang sản xuất'), cls: 'badge-processing' },
  shipped: { label: () => t('admin.filter.shipped', 'Đã gửi hàng'), cls: 'badge-shipped' },
  delivered: { label: () => t('admin.filter.delivered', 'Đã giao hàng'), cls: 'badge-delivered' },
  completed: { label: () => t('admin.filter.completed', 'Hoàn thành'), cls: 'badge-completed' },
  cancelled: { label: () => t('admin.filter.cancelled', 'Đã hủy'), cls: 'badge-cancelled' },
  payment_failed: { label: () => t('admin.filter.paymentFailed', 'Thanh toán thất bại'), cls: 'badge-payment-failed' },
};

const PAYMENT_META = {
  COD: { label: () => t('admin.filter.payCod', 'COD'), cls: 'badge-cod' },
  BANK_TRANSFER: { label: () => t('admin.filter.payBank', 'QR chuyển khoản'), cls: 'badge-bank' },
};

const PAYMENT_STATUS_META = {
  cod_pending: { label: () => t('admin.payStatus.codPending', 'COD khi nhận hàng'), cls: 'badge-muted' },
  awaiting_transfer: { label: () => t('admin.payStatus.awaitingTransfer', 'Chờ chuyển khoản'), cls: 'badge-awaiting' },
  paid: { label: () => t('admin.payStatus.paid', 'Đã thanh toán'), cls: 'badge-paid' },
  underpaid: { label: () => t('admin.payStatus.underpaid', 'Chuyển thiếu'), cls: 'badge-underpaid' },
  failed: { label: () => t('admin.payStatus.failed', 'Thanh toán thất bại'), cls: 'badge-payment-failed' },
};

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initOrderFilters();
  initOrderTools();
  initReviewTools();
  initDesignFilters();
  initUserTools();
  initColorDotPreview();
  initPreviewSideToggle();
  initPreviewModalClose();
  initUserDetailModalClose();
  initUserFormModal();
  initRefreshActions();
  initExportActions();
  initVoucherTools();
  initPlanTools();
  initCreditTools();
  initReportTools();
  loadDashboardData();
  startOrdersRealtime();
});

async function loadDashboardData() {
  setDashboardLoading(true);
  try {
    const [statsResponse, ordersResponse, designsResponse, vouchersResponse, plansResponse, creditsResponse] = await Promise.all([
      fetch(`${API_ADMIN}/stats`, { headers: auth.getAuthHeaders() }),
      fetch(API_ORDERS, { headers: auth.getAuthHeaders() }),
      fetch(`${API_ADMIN}/designs`, { headers: auth.getAuthHeaders() }),
      fetch(`${API_ADMIN}/vouchers`, { headers: auth.getAuthHeaders() }),
      fetch(`${API_ADMIN}/plans`, { headers: auth.getAuthHeaders() }),
      fetch(`${API_ADMIN}/credits`, { headers: auth.getAuthHeaders() }),
    ]);

    if (!statsResponse.ok) throw new Error(t('admin.err.stats', 'Không thể tải thống kê admin.'));
    if (!ordersResponse.ok) throw new Error(t('admin.err.orders', 'Không thể tải danh sách đơn hàng.'));

    const statsData = await statsResponse.json();
    const ordersData = await ordersResponse.json();
    let designsData = { data: [] };
    if (designsResponse.ok) {
      const ct = designsResponse.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        designsData = await designsResponse.json();
      }
    }

    adminState.stats = statsData.stats || null;
    adminState.users = statsData.users || [];
    adminState.orders = ordersData.data || [];
    adminState.designs = designsData.data || [];
    if (vouchersResponse.ok) adminState.vouchers = (await vouchersResponse.json()).data || [];
    if (plansResponse.ok) adminState.plans = (await plansResponse.json()).data || [];
    if (creditsResponse.ok) adminState.credits = (await creditsResponse.json()).data || [];
    console.log('[Admin] Data loaded:', { users: adminState.users.length, orders: adminState.orders.length, designs: adminState.designs.length, vouchers: adminState.vouchers.length, plans: adminState.plans.length, credits: adminState.credits.length });

    renderDashboard();
  } catch (err) {
    console.error('Admin data error:', err);
    showAdminToast(err.message || t('admin.err.data', 'Không thể tải dữ liệu admin.'), 'error');
  } finally {
    setDashboardLoading(false);
  }
}

function renderDashboard() {
  renderOverview();
  renderOrdersList();
  renderUsersList();
  renderDesignsGrid();
  renderVouchersList();
  renderPlansList();
  renderCreditsList();
}

function setDashboardLoading(isLoading) {
  document.body.classList.toggle('admin-loading', Boolean(isLoading));
  const refreshBtn = document.getElementById('adminRefreshBtn');
  if (refreshBtn) {
    refreshBtn.disabled = Boolean(isLoading);
    refreshBtn.textContent = isLoading ? t('admin.loading', 'Đang tải...') : t('admin.ledger.refresh', 'Làm mới');
  }
}

function initTabs() {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => switchTab(link.dataset.tab));
  });

  document.getElementById('viewAllOrdersBtn')?.addEventListener('click', () => switchTab('orders'));
}

function switchTab(tabName) {
  adminState.currentTab = tabName;
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.toggle('active', link.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabName}`);
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  document.querySelector('.admin-workspace')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  if (tabName === 'reports' && (!adminState.reportData || adminState.reportData.length === 0)) {
    loadReports();
  }
  if (tabName === 'reviews') {
    loadAdminReviews();
  }
}

function initOrderFilters() {
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
      pill.classList.add('active');
      adminState.orderFilter = pill.dataset.filter || 'all';
      renderOrdersList();
    });
  });
}

function initOrderTools() {
  const searchInput = document.getElementById('orderSearchInput');
  const paymentFilter = document.getElementById('paymentFilterSelect');

  searchInput?.addEventListener('input', () => {
    adminState.orderSearch = searchInput.value.trim().toLowerCase();
    renderOrdersList();
  });

  paymentFilter?.addEventListener('change', () => {
    adminState.paymentFilter = paymentFilter.value;
    renderOrdersList();
  });

  document.getElementById('orderUserFilterClear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearUserOrderFilter();
  });
}

function initRefreshActions() {
  document.getElementById('adminRefreshBtn')?.addEventListener('click', loadDashboardData);
}

function initExportActions() {
  document.getElementById('adminExportBtn')?.addEventListener('click', exportOrdersCsv);
}

function initDesignFilters() {
  document.querySelectorAll('.design-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.design-filter-pill').forEach(item => item.classList.remove('active'));
      pill.classList.add('active');
      adminState.designVisibilityFilter = pill.dataset.designFilter || 'all';
      renderDesignsGrid();
    });
  });
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

function initVoucherTools() {
  document.getElementById('voucherSearchInput')?.addEventListener('input', (e) => {
    adminState.voucherSearch = e.target.value.trim().toLowerCase();
    renderVouchersList();
  });
  document.getElementById('createVoucherBtn')?.addEventListener('click', () => openVoucherModal());
  document.getElementById('voucherFormModalClose')?.addEventListener('click', () => document.getElementById('voucherFormModal')?.classList.remove('open'));
  document.getElementById('voucherFormCancel')?.addEventListener('click', () => document.getElementById('voucherFormModal')?.classList.remove('open'));
  document.getElementById('voucherForm')?.addEventListener('submit', saveVoucher);
}

const VOUCHER_STATUS_META = {
  active: { label: () => t('admin.voucherStatus.active', 'Đang chạy'), cls: 'badge-completed' },
  disabled: { label: () => t('admin.voucherStatus.disabled', 'Đã tắt'), cls: 'badge-muted' },
  expired: { label: () => t('admin.voucherStatus.expired', 'Hết hạn'), cls: 'badge-cancelled' },
};

function renderVouchersList() {
  const tbody = document.getElementById('vouchersTableBody');
  const countEl = document.getElementById('vouchersResultCount');
  if (!tbody) return;

  const q = adminState.voucherSearch;
  const list = adminState.vouchers.filter(v => {
    if (!q) return true;
    return (v.code || '').toLowerCase().includes(q) || (v.title || '').toLowerCase().includes(q);
  });

  countEl.textContent = `${list.length} voucher`;
  if (list.length === 0) {
    tbody.innerHTML = renderEmptyRow(8, q ? t('admin.empty.voucherSearch', 'Không tìm thấy voucher phù hợp.') : t('admin.empty.vouchers', 'Chưa có voucher nào. Bấm "+ Tạo voucher" để bắt đầu.'));
    return;
  }

  const now = Date.now();
  tbody.innerHTML = list.map(v => {
    const statusMeta = VOUCHER_STATUS_META[v.status] || { label: () => v.status || 'N/A', cls: 'badge-muted' };
    const autoExpired = v.expiresAt && new Date(v.expiresAt).getTime() < now && v.status === 'active';
    const status = autoExpired ? VOUCHER_STATUS_META.expired : statusMeta;
    const discount = v.discountType === 'percent'
      ? `${Number(v.discountValue) || 0}%${v.maxDiscountAmount ? ` (${t('admin.voucherMax', 'tối đa')} ${formatMoney(v.maxDiscountAmount)})` : ''}`
      : `${formatMoney(v.discountValue)}${v.minOrderAmount ? ` · ${t('admin.voucherMinOrder', 'đơn ≥')} ${formatMoney(v.minOrderAmount)}` : ''}`;
    const applies = v.appliesTo === 'plan' ? t('admin.form.appliesPlan', 'Gói AI') : v.appliesTo === 'order' ? t('admin.voucherShirtOrder', 'Đơn áo') : t('admin.filter.all', 'Tất cả');
    const period = `${v.startsAt ? formatDate(v.startsAt, false) : t('admin.voucherNow', 'Ngay')} → ${v.expiresAt ? formatDate(v.expiresAt, false) : t('admin.voucherForever', 'Vĩnh viễn')}`;
    return `
      <tr data-voucher-id="${escapeAttr(v.id)}">
        <td><span class="order-code">${escapeHtml(v.code)}</span></td>
        <td>
          <div class="table-primary">${escapeHtml(v.title)}</div>
          <div class="row-muted">${escapeHtml((v.description || '').slice(0, 80))}</div>
        </td>
        <td><div class="table-primary">${discount}</div></td>
        <td><span class="badge badge-muted">${applies}</span></td>
        <td><div class="row-muted">${period}</div></td>
        <td><div class="table-primary">${Number(v.redemptionCount || v.usedCount || 0)}${v.totalUsageLimit ? `/${v.totalUsageLimit}` : ''}</div></td>
        <td><span class="badge ${status.cls}">${status.label()}</span></td>
        <td>
          <div class="action-buttons">
            <button class="btn-icon btn-view-action" data-action="edit-voucher" data-id="${escapeAttr(v.id)}" title="${escapeAttr(t('admin.actions.edit', 'Chỉnh sửa'))}">✎</button>
            <button class="btn-icon ${v.status === 'active' ? 'btn-cancel-action' : 'btn-complete-action'}" data-action="toggle-voucher" data-id="${escapeAttr(v.id)}" title="${v.status === 'active' ? escapeAttr(t('admin.voucherOff', 'Tắt voucher')) : escapeAttr(t('admin.voucherOn', 'Bật voucher'))}">${v.status === 'active' ? '⏻' : '▶'}</button>
            <button class="btn-icon btn-cancel-action" data-action="delete-voucher" data-id="${escapeAttr(v.id)}" title="${escapeAttr(t('admin.actions.delete', 'Xóa voucher'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const voucher = adminState.vouchers.find(v => v.id === id);
      if (!voucher) return;
      const busyKey = `${action}-${id}`;
      if (busyGuard(busyKey)) return;
      btn.disabled = true;
      try {
        if (action === 'edit-voucher') openVoucherModal(voucher);
        if (action === 'toggle-voucher') await updateVoucher(id, { status: voucher.status === 'active' ? 'disabled' : 'active', expectedUpdatedAt: voucher.updatedAt });
        if (action === 'delete-voucher') {
          if (!confirm(t('admin.confirm.deleteVoucher', 'Xóa voucher "{code}"?', { code: voucher.code }))) return;
          await deleteVoucher(id, voucher.updatedAt);
        }
      } finally {
        busyRelease(busyKey);
        btn.disabled = false;
      }
    });
  });
}

function openVoucherModal(voucher) {
  const modal = document.getElementById('voucherFormModal');
  const form = document.getElementById('voucherForm');
  if (!modal || !form) return;

  document.getElementById('vf-edit-id').value = voucher?.id || '';
  document.getElementById('voucherFormTitle').textContent = voucher ? t('admin.modal.editVoucher', 'Sửa voucher') : t('admin.modal.createVoucher', 'Tạo voucher mới');
  document.getElementById('voucherFormSubmit').textContent = voucher ? t('admin.form.submitSave', 'Lưu thay đổi') : t('admin.form.submitCreate', 'Tạo voucher');
  document.getElementById('vf-code').value = voucher?.code || '';
  document.getElementById('vf-code').disabled = Boolean(voucher);
  document.getElementById('vf-title').value = voucher?.title || '';
  document.getElementById('vf-description').value = voucher?.description || '';
  document.getElementById('vf-discount-type').value = voucher?.discountType || 'fixed';
  document.getElementById('vf-discount-value').value = voucher?.discountValue ?? '';
  document.getElementById('vf-max-discount').value = voucher?.maxDiscountAmount ?? '';
  document.getElementById('vf-min-order').value = voucher?.minOrderAmount ?? 0;
  document.getElementById('vf-applies-to').value = voucher?.appliesTo || 'all';
  document.getElementById('vf-plan-codes').value = voucher?.eligiblePlanCodes || '';
  document.getElementById('vf-bonus-high').value = voucher?.bonusHighCredits ?? 0;
  document.getElementById('vf-bonus-low').value = voucher?.bonusLowCredits ?? 0;
  document.getElementById('vf-per-user').value = voucher?.perUserLimit ?? 1;
  document.getElementById('vf-total-usage').value = voucher?.totalUsageLimit ?? '';
  document.getElementById('vf-starts-at').value = voucher?.startsAt ? toDatetimeLocal(voucher.startsAt) : '';
  document.getElementById('vf-expires-at').value = voucher?.expiresAt ? toDatetimeLocal(voucher.expiresAt) : '';
  document.getElementById('vf-internal-note').value = voucher?.internalNote || '';

  modal.classList.add('open');
}

async function saveVoucher(event) {
  event.preventDefault();
  if (busyGuard('saveVoucher')) return;
  const btn = document.getElementById('voucherSubmitBtn') || document.querySelector('#voucherFormModal button[type="submit"]');
  const releaseBtn = btn ? (btn.disabled = true, btn.textContent = 'Đang lưu…', function(){ btn.disabled=false; btn.textContent='Lưu voucher'; }) : function(){};
  const editId = document.getElementById('vf-edit-id').value;
  const existingVoucher = editId ? adminState.vouchers.find(v => v.id === editId) : null;
  const payload = {
    code: document.getElementById('vf-code').value.trim(),
    title: document.getElementById('vf-title').value.trim(),
    description: document.getElementById('vf-description').value.trim() || null,
    discountType: document.getElementById('vf-discount-type').value,
    discountValue: Number(document.getElementById('vf-discount-value').value) || 0,
    maxDiscountAmount: document.getElementById('vf-max-discount').value ? Number(document.getElementById('vf-max-discount').value) : null,
    minOrderAmount: Number(document.getElementById('vf-min-order').value) || 0,
    appliesTo: document.getElementById('vf-applies-to').value,
    eligiblePlanCodes: document.getElementById('vf-plan-codes').value.trim() || null,
    bonusHighCredits: Number(document.getElementById('vf-bonus-high').value) || 0,
    bonusLowCredits: Number(document.getElementById('vf-bonus-low').value) || 0,
    perUserLimit: Number(document.getElementById('vf-per-user').value) || 1,
    totalUsageLimit: document.getElementById('vf-total-usage').value ? Number(document.getElementById('vf-total-usage').value) : null,
    startsAt: document.getElementById('vf-starts-at').value ? new Date(document.getElementById('vf-starts-at').value).toISOString() : null,
    expiresAt: document.getElementById('vf-expires-at').value ? new Date(document.getElementById('vf-expires-at').value).toISOString() : null,
    internalNote: document.getElementById('vf-internal-note').value.trim() || null,
    ...(existingVoucher && existingVoucher.updatedAt ? { expectedUpdatedAt: existingVoucher.updatedAt } : {}),
  };

  try {
    const url = editId ? `${API_ADMIN}/vouchers/${encodeURIComponent(editId)}` : `${API_ADMIN}/vouchers`;
    const response = await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.voucherSave', 'Không thể lưu voucher.'));

    document.getElementById('voucherFormModal')?.classList.remove('open');
    showAdminToast(data.message || t('admin.toast.voucherSaved', 'Đã lưu voucher.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Voucher save error:', err);
    showAdminToast(err.message || t('admin.err.voucherSave', 'Lỗi lưu voucher.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  } finally { busyRelease('saveVoucher'); releaseBtn(); }
}

async function updateVoucher(id, patch) {
  try {
    const response = await fetch(`${API_ADMIN}/vouchers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.voucherUpdate', 'Không thể cập nhật voucher.'));
    showAdminToast(data.message || t('admin.toast.voucherUpdated', 'Đã cập nhật voucher.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Voucher update error:', err);
    showAdminToast(err.message || t('admin.err.voucherUpdate', 'Lỗi cập nhật voucher.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  }
}

async function deleteVoucher(id, expectedUpdatedAt) {
  try {
    const response = await fetch(`${API_ADMIN}/vouchers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: expectedUpdatedAt ? JSON.stringify({ expectedUpdatedAt }) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.voucherDelete', 'Không thể xóa voucher.'));
    showAdminToast(data.message || t('admin.toast.voucherDeleted', 'Đã xóa voucher.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Voucher delete error:', err);
    showAdminToast(err.message || t('admin.err.voucherDelete', 'Lỗi xóa voucher.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  }
}

// ---------------------------------------------------------------------------
// AI Plans
// ---------------------------------------------------------------------------

function initPlanTools() {
  document.getElementById('createPlanBtn')?.addEventListener('click', () => openPlanModal());
  document.getElementById('planFormModalClose')?.addEventListener('click', () => document.getElementById('planFormModal')?.classList.remove('open'));
  document.getElementById('planFormCancel')?.addEventListener('click', () => document.getElementById('planFormModal')?.classList.remove('open'));
  document.getElementById('planForm')?.addEventListener('submit', savePlan);
}

function renderPlansList() {
  const tbody = document.getElementById('plansTableBody');
  if (!tbody) return;

  if (adminState.plans.length === 0) {
    tbody.innerHTML = renderEmptyRow(9, t('admin.empty.plans', 'Chưa có gói AI nào. Bấm "+ Tạo gói" để bắt đầu.'));
    return;
  }

  tbody.innerHTML = adminState.plans.map(p => {
    const status = p.isActive
      ? { label: () => t('admin.planStatus.selling', 'Đang bán'), cls: 'badge-completed' }
      : { label: () => t('admin.voucherStatus.disabled', 'Đã tắt'), cls: 'badge-muted' };
    const credits = [];
    if (Number(p.highCredits) > 0) credits.push(`High ${p.highCredits}`);
    if (Number(p.bonusLowCredits) > 0) credits.push(`Low ${p.bonusLowCredits}`);
    if (Number(p.dailyFreeLowCredits) > 0) credits.push(`${t('admin.planFreeDay', 'Free/ngày')} ${p.dailyFreeLowCredits}`);
    const badge = p.isComebackOffer
      ? '<span class="badge badge-shipped">Comeback</span>'
      : p.isPaid ? `<span class="badge badge-paid">${escapeHtml(t('admin.planPaid', 'Trả phí'))}</span>` : `<span class="badge badge-muted">${escapeHtml(t('admin.planFree', 'Miễn phí'))}</span>`;
    return `
      <tr data-plan-id="${escapeAttr(p.id)}">
        <td><span class="order-code">${escapeHtml(p.code)}</span></td>
        <td>
          <div class="table-primary">${escapeHtml(p.name)}</div>
          <div class="row-muted">${escapeHtml((p.description || '').slice(0, 70))}</div>
        </td>
        <td><div class="table-primary">${formatMoney(p.priceVnd)}</div></td>
        <td><div class="row-muted">${escapeHtml(credits.join(' · ') || t('admin.planNoCredits', 'Không có'))}</div></td>
        <td><span class="badge badge-processing">${escapeHtml(p.outputQuality || 'low')}</span></td>
        <td><div class="table-primary">${Number(p.planRank) || 0}</div></td>
        <td><div class="table-primary">${Number(p.purchaseCount || 0)}</div></td>
        <td><span class="badge ${status.cls}">${status.label()}</span> ${badge}</td>
        <td>
          <div class="action-buttons">
            <button class="btn-icon btn-view-action" data-action="edit-plan" data-id="${escapeAttr(p.id)}" title="${escapeAttr(t('admin.actions.edit', 'Chỉnh sửa'))}">✎</button>
            <button class="btn-icon ${p.isActive ? 'btn-cancel-action' : 'btn-complete-action'}" data-action="toggle-plan" data-id="${escapeAttr(p.id)}" title="${p.isActive ? escapeAttr(t('admin.planOff', 'Tắt gói')) : escapeAttr(t('admin.planOn', 'Bật gói'))}">${p.isActive ? '⏻' : '▶'}</button>
            <button class="btn-icon btn-cancel-action" data-action="delete-plan" data-id="${escapeAttr(p.id)}" title="${escapeAttr(t('admin.actions.delete', 'Xóa gói'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const plan = adminState.plans.find(p => p.id === id);
      if (!plan) return;
      const busyKey = `${action}-${id}`;
      if (busyGuard(busyKey)) return;
      btn.disabled = true;
      try {
        if (action === 'edit-plan') openPlanModal(plan);
        if (action === 'toggle-plan') await updatePlan(id, { isActive: plan.isActive ? 0 : 1, expectedUpdatedAt: plan.updatedAt });
        if (action === 'delete-plan') {
          if (!confirm(t('admin.confirm.deletePlan', 'Xóa gói "{name}"?', { name: plan.name }))) return;
          await deletePlan(id, plan.updatedAt);
        }
      } finally {
        busyRelease(busyKey);
        btn.disabled = false;
      }
    });
  });
}

function openPlanModal(plan) {
  const modal = document.getElementById('planFormModal');
  if (!modal) return;

  document.getElementById('pf-edit-id').value = plan?.id || '';
  document.getElementById('planFormTitle').textContent = plan ? `${t('admin.modal.editPlan', 'Sửa gói')} ${plan.name}` : t('admin.modal.createPlan', 'Tạo gói AI mới');
  document.getElementById('planFormSubmit').textContent = plan ? t('admin.form.submitSave', 'Lưu thay đổi') : t('admin.form.submitCreatePlan', 'Tạo gói');
  document.getElementById('pf-code').value = plan?.code || '';
  document.getElementById('pf-code').disabled = Boolean(plan);
  document.getElementById('pf-name').value = plan?.name || '';
  document.getElementById('pf-description').value = plan?.description || '';
  document.getElementById('pf-price').value = plan?.priceVnd ?? 0;
  document.getElementById('pf-high-credits').value = plan?.highCredits ?? 0;
  document.getElementById('pf-bonus-low').value = plan?.bonusLowCredits ?? 0;
  document.getElementById('pf-daily-free').value = plan?.dailyFreeLowCredits ?? 0;
  document.getElementById('pf-quality').value = plan?.outputQuality || 'high';
  document.getElementById('pf-rank').value = plan?.planRank ?? 0;
  document.getElementById('pf-is-paid').checked = Boolean(plan?.isPaid);
  document.getElementById('pf-is-comeback').checked = Boolean(plan?.isComebackOffer);
  document.getElementById('pf-comeback-days').value = plan?.comebackWindowDays ?? '';

  modal.classList.add('open');
}

async function savePlan(event) {
  event.preventDefault();
  if (busyGuard('savePlan')) return;
  const _planBtn = document.getElementById('planSubmitBtn') || document.querySelector('#planFormModal button[type="submit"]');
  const _relPlan = _planBtn ? (_planBtn.disabled=true, _planBtn.textContent='Đang lưu…', function(){ _planBtn.disabled=false; _planBtn.textContent='Lưu gói'; }) : function(){};
  const editId = document.getElementById('pf-edit-id').value;
  const existingPlan = editId ? adminState.plans.find(p => p.id === editId) : null;
  const payload = {
    code: document.getElementById('pf-code').value.trim(),
    name: document.getElementById('pf-name').value.trim(),
    description: document.getElementById('pf-description').value.trim() || null,
    priceVnd: Number(document.getElementById('pf-price').value) || 0,
    highCredits: Number(document.getElementById('pf-high-credits').value) || 0,
    bonusLowCredits: Number(document.getElementById('pf-bonus-low').value) || 0,
    dailyFreeLowCredits: Number(document.getElementById('pf-daily-free').value) || 0,
    outputQuality: document.getElementById('pf-quality').value,
    planRank: Number(document.getElementById('pf-rank').value) || 0,
    isPaid: document.getElementById('pf-is-paid').checked ? 1 : 0,
    isComebackOffer: document.getElementById('pf-is-comeback').checked ? 1 : 0,
    comebackWindowDays: document.getElementById('pf-comeback-days').value ? Number(document.getElementById('pf-comeback-days').value) : null,
    ...(existingPlan && existingPlan.updatedAt ? { expectedUpdatedAt: existingPlan.updatedAt } : {}),
  };

  try {
    const url = editId ? `${API_ADMIN}/plans/${encodeURIComponent(editId)}` : `${API_ADMIN}/plans`;
    const response = await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.planSave', 'Không thể lưu gói.'));

    document.getElementById('planFormModal')?.classList.remove('open');
    showAdminToast(data.message || t('admin.toast.planSaved', 'Đã lưu gói.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Plan save error:', err);
    showAdminToast(err.message || t('admin.err.planSave', 'Lỗi lưu gói.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  } finally { busyRelease('savePlan'); _relPlan(); }
}

async function updatePlan(id, patch) {
  try {
    const response = await fetch(`${API_ADMIN}/plans/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.planUpdate', 'Không thể cập nhật gói.'));
    showAdminToast(data.message || t('admin.toast.planUpdated', 'Đã cập nhật gói.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Plan update error:', err);
    showAdminToast(err.message || t('admin.err.planUpdate', 'Lỗi cập nhật gói.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  }
}

async function deletePlan(id, expectedUpdatedAt) {
  try {
    const response = await fetch(`${API_ADMIN}/plans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: expectedUpdatedAt ? JSON.stringify({ expectedUpdatedAt }) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.planDelete', 'Không thể xóa gói.'));
    showAdminToast(data.message || t('admin.toast.planDeleted', 'Đã xóa gói.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Plan delete error:', err);
    showAdminToast(err.message || t('admin.err.planDelete', 'Lỗi xóa gói.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  }
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

function initCreditTools() {
  document.getElementById('creditsSearchInput')?.addEventListener('input', (e) => {
    adminState.creditsSearch = e.target.value.trim().toLowerCase();
    renderCreditsList();
  });
  document.getElementById('creditAdjustModalClose')?.addEventListener('click', () => document.getElementById('creditAdjustModal')?.classList.remove('open'));
  document.getElementById('creditAdjustCancel')?.addEventListener('click', () => document.getElementById('creditAdjustModal')?.classList.remove('open'));
  document.getElementById('creditAdjustForm')?.addEventListener('submit', saveCreditAdjust);
  document.getElementById('ledgerRefreshBtn')?.addEventListener('click', () => {
    const userId = document.getElementById('ca-user-id')?.value;
    if (userId) loadLedger(userId);
  });
}

// ---------------------------------------------------------------------------
// Reports (periodic aggregation)
// ---------------------------------------------------------------------------

function initReportTools() {
  const periodSelect = document.getElementById('reportPeriodSelect');
  const yearSelect = document.getElementById('reportYearSelect');
  const loadBtn = document.getElementById('reportLoadBtn');
  const exportBtn = document.getElementById('reportExportBtn');

  if (!periodSelect || !yearSelect) return;

  // Populate year options: 2020 .. current+1
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = '';
  for (let y = currentYear + 1; y >= 2020; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }
  adminState.reportPeriod = periodSelect.value;
  adminState.reportYear = Number(yearSelect.value);

  periodSelect.addEventListener('change', () => {
    adminState.reportPeriod = periodSelect.value;
    const isYear = periodSelect.value === 'year';
    // For year period, year filter means "all years" if we hide it; but keep visible for flexibility.
    // Disable year selector when showing all years? We'll keep enabled but export will omit year for year period.
    yearSelect.parentElement.style.opacity = isYear ? '0.6' : '1';
    yearSelect.title = isYear ? 'Khi chọn Theo năm, hệ thống sẽ hiển thị tất cả các năm (bỏ qua năm được chọn) — có thể chọn năm cụ thể rồi bấm Xuất để lọc 1 năm.' : '';
    loadReports();
  });

  yearSelect.addEventListener('change', () => {
    adminState.reportYear = Number(yearSelect.value);
    if (document.getElementById('panel-reports')?.classList.contains('active')) {
      loadReports();
    }
  });

  loadBtn?.addEventListener('click', loadReports);
  exportBtn?.addEventListener('click', exportReportsCsv);

  // Auto-load when switching to reports tab (first time)
  const reportsTabBtn = document.querySelector('.sidebar-link[data-tab="reports"]');
  reportsTabBtn?.addEventListener('click', () => {
    if (!adminState.reportData || adminState.reportData.length === 0) {
      loadReports();
    }
  });
}

/* ============================================================
   CUSTOMER REVIEWS — feedback tied to real orders
   Listed in the “Đánh giá” tab; visible ones power the homepage
   “Cộng đồng nói gì” section. Admin can hide/unhide or delete.
   ============================================================ */
function renderStarsHtml(rating) {
  const n = Math.min(5, Math.max(0, Math.floor(Number(rating) || 0)));
  return `<span class="review-stars" aria-label="${n}/5 sao">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

async function loadAdminReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  if (!tbody) return;
  try {
    const resp = await fetch(`${API_REVIEWS}`, { headers: auth.getAuthHeaders() });
    const result = await resp.json();
    if (!resp.ok || result.success === false) throw new Error(result.error || 'Không thể tải đánh giá.');
    adminState.reviews = result.data || [];
    const stats = result.stats || {};

    const avgEl = document.getElementById('review-stat-avg');
    const totalEl = document.getElementById('review-stat-total');
    const visibleEl = document.getElementById('review-stat-visible');
    if (avgEl) avgEl.textContent = stats.total ? `${stats.averageRating}/5` : '—';
    if (totalEl) totalEl.textContent = String(stats.total ?? 0);
    if (visibleEl) visibleEl.textContent = `${stats.visible ?? 0}/${stats.total ?? 0}`;

    renderAdminReviews();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="orders-result-count">${escapeHtml(err.message || 'Không thể tải đánh giá.')}</td></tr>`;
  }
}

function filteredAdminReviews() {
  const f = adminState.reviewFilter || 'all';
  const q = (adminState.reviewSearch || '').trim().toLowerCase();
  return adminState.reviews.filter((r) => {
    if (f === 'visible' && r.status !== 'visible') return false;
    if (f === 'hidden' && r.status !== 'hidden') return false;
    if (f === 'noreply' && r.reply && r.reply.text) return false;
    if (f === 'low' && (Number(r.rating) || 0) > 2) return false;
    if (/^[1-5]$/.test(f) && (Number(r.rating) || 0) !== Number(f)) return false;
    if (q) {
      const haystack = [r.orderId, r.authorName, r.comment, r.reply && r.reply.text].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function renderAdminReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  if (!tbody) return;
  const reviews = filteredAdminReviews();
  const countEl = document.getElementById('reviewsResultCount');
  if (countEl) countEl.textContent = `${reviews.length} đánh giá`;

  if (!adminState.reviews.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="orders-result-count">Chưa có đánh giá nào từ khách hàng.</td></tr>';
    return;
  }
  if (!reviews.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="orders-result-count">Không có đánh giá nào khớp bộ lọc.</td></tr>';
    return;
  }

  tbody.innerHTML = reviews.map((r) => {
    const visible = r.status === 'visible';
    const rawComment = String(r.comment || '').trim();
    const replyText = r.reply && r.reply.text ? String(r.reply.text) : '';
    return `<tr data-review-id="${escapeAttr(r.id)}">
      <td>${renderStarsHtml(r.rating)}</td>
      <td><div class="order-code">${escapeHtml(r.orderId || '—')}</div></td>
      <td><div class="table-primary">${escapeHtml(r.authorName || 'Khách hàng')}</div>${r.productType ? `<div class="row-muted">${escapeHtml(getProductName(r.productType))}</div>` : ''}</td>
      <td style="max-width:360px;">
        <div class="row-muted" style="white-space:normal;">${rawComment ? escapeHtml(rawComment) : '<em>Chỉ chấm sao</em>'}</div>
        ${replyText ? `<div class="admin-review-reply"><span class="admin-review-reply-mark">B</span> ${escapeHtml(replyText)}</div>` : ''}
      </td>
      <td><span class="badge ${visible ? 'badge-completed' : 'badge-muted'}">${visible ? 'Đang hiển thị' : 'Đã ẩn'}</span></td>
      <td><div class="table-primary">${formatDate(r.createdAt, false)}</div></td>
      <td>
        <div class="action-buttons review-actions">
          <button class="review-action-link" data-review-action="reply" data-id="${escapeAttr(r.id)}" title="${replyText ? 'Sửa phản hồi của shop' : 'Phản hồi với tư cách shop'}">${replyText ? 'Sửa' : 'Trả lời'}</button>
          <button class="review-action-link" data-review-action="toggle" data-id="${escapeAttr(r.id)}" data-visible="${visible ? '1' : '0'}" title="${visible ? 'Ẩn khỏi trang chủ' : 'Hiện lại trên trang chủ'}">${visible ? 'Ẩn' : 'Hiện'}</button>
          <button class="review-action-link review-action-danger" data-review-action="delete" data-id="${escapeAttr(r.id)}" title="Xóa đánh giá">Xóa</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function initReviewReplyModal() {
  const modal = document.getElementById('reviewReplyModal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  const close = () => { modal.style.display = 'none'; };
  document.getElementById('reviewReplyClose')?.addEventListener('click', close);
  document.getElementById('reviewReplyCancel')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  const ta = document.getElementById('reviewReplyText');
  ta?.addEventListener('input', () => {
    const count = document.getElementById('reviewReplyCount');
    if (count) count.textContent = `${ta.value.length}/600`;
  });
  document.getElementById('reviewReplySave')?.addEventListener('click', async () => {
    if (!adminState.replyReviewId) return;
    const btn = document.getElementById('reviewReplySave');
    const err = document.getElementById('reviewReplyError');
    if (err) err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      const resp = await fetch(`${API_REVIEWS}/${encodeURIComponent(adminState.replyReviewId)}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
        body: JSON.stringify({ reply: (ta?.value || '').trim() }),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || result.success === false) throw new Error(result.error || 'Không thể lưu phản hồi.');
      showAdminToast(result.message || 'Đã lưu phản hồi.', 'success');
      close();
      await loadAdminReviews();
    } catch (e2) {
      if (err) { err.textContent = e2.message || 'Không thể lưu phản hồi.'; err.style.display = 'block'; }
    } finally {
      btn.disabled = false; btn.textContent = 'Lưu phản hồi';
    }
  });
}

function openReviewReplyModal(reviewId) {
  const review = (adminState.reviews || []).find(r => r.id === reviewId);
  if (!review) return;
  adminState.replyReviewId = reviewId;
  const modal = document.getElementById('reviewReplyModal');
  const meta = document.getElementById('reviewReplyMeta');
  const ta = document.getElementById('reviewReplyText');
  const err = document.getElementById('reviewReplyError');
  const count = document.getElementById('reviewReplyCount');
  if (meta) {
    meta.textContent = `#${review.orderId || ''} · ${review.authorName || 'Khách hàng'} · ${'★'.repeat(Number(review.rating) || 0)}${'☆'.repeat(5 - (Number(review.rating) || 0))} — "${String(review.comment || 'Chỉ chấm sao').slice(0, 80)}"`;
  }
  if (ta) ta.value = (review.reply && review.reply.text) || '';
  if (count) count.textContent = `${ta ? ta.value.length : 0}/600`;
  if (err) err.style.display = 'none';
  modal.style.display = 'flex';
  setTimeout(() => ta?.focus(), 50);
}

function initReviewTools() {
  document.getElementById('reviewsRefreshBtn')?.addEventListener('click', () => loadAdminReviews());

  // Filter pills + search cho tab Đánh giá.
  document.querySelectorAll('.review-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.review-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      adminState.reviewFilter = pill.dataset.reviewFilter || 'all';
      renderAdminReviews();
    });
  });
  document.getElementById('reviewSearchInput')?.addEventListener('input', (e) => {
    adminState.reviewSearch = e.target.value;
    renderAdminReviews();
  });

  initReviewReplyModal();

  document.getElementById('reviewsTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-review-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.reviewAction;
    if (action === 'reply') { openReviewReplyModal(id); return; }
    if (busyGuard(`review-${action}-${id}`)) return;
    btn.disabled = true;
    try {
      if (action === 'toggle') {
        const visible = btn.dataset.visible !== '1';
        const resp = await fetch(`${API_REVIEWS}/${encodeURIComponent(id)}/visibility`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
          body: JSON.stringify({ visible }),
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || result.success === false) throw new Error(result.error || 'Không thể cập nhật.');
        showAdminToast(result.message || 'Đã cập nhật.', 'success');
        await loadAdminReviews();
      } else if (action === 'delete') {
        if (!confirm('Xóa vĩnh viễn đánh giá này?')) return;
        const resp = await fetch(`${API_REVIEWS}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth.getAuthHeaders() });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || result.success === false) throw new Error(result.error || 'Không thể xóa.');
        showAdminToast('Đã xóa đánh giá.', 'success');
        await loadAdminReviews();
      }
    } catch (err) {
      showAdminToast(err.message || 'Thao tác thất bại.', 'error');
      btn.disabled = false;
    } finally {
      // Luôn nhả khóa busy — nếu không lần thao tác kế tiếp trên cùng đánh giá
      // sẽ bị busyGuard chặn vĩnh viễn (bug từng gặp khi test ẩn/hiện).
      busyRelease(`review-${action}-${id}`);
    }
  });
}

async function loadReports() {
  const period = document.getElementById('reportPeriodSelect')?.value || adminState.reportPeriod || 'month';
  const yearVal = document.getElementById('reportYearSelect')?.value;
  const year = yearVal ? Number(yearVal) : null;

  adminState.reportPeriod = period;
  adminState.reportYear = year;

  const params = new URLSearchParams();
  params.set('period', period);
  // For month/quarter, year is required; for year, omit to get all years
  if (period !== 'year' && year) {
    params.set('year', String(year));
  }

  const loadBtn = document.getElementById('reportLoadBtn');
  const countEl = document.getElementById('reportResultCount');
  if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = 'Đang tải...'; }
  if (countEl) countEl.textContent = 'Đang tải...';

  try {
    const res = await fetch(`${API_ADMIN}/reports?${params.toString()}`, { headers: auth.getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'Không thể tải báo cáo.');

    adminState.reportData = data.data || [];
    adminState.reportSummary = data.summary || null;

    renderReportSummary(data.summary, period);
    renderReportChart(data.data, period, data.year);
    renderReportsTable(data.data, period);

    const totalLabel = period === 'month' ? `Năm ${data.year} · 12 tháng` : period === 'quarter' ? `Năm ${data.year} · 4 quý` : `${data.data.length} năm`;
    if (countEl) countEl.textContent = `${data.data.length} kỳ · ${totalLabel}`;
    if (document.getElementById('reportTableCount')) {
      document.getElementById('reportTableCount').textContent = `${data.data.length} kỳ`;
    }
  } catch (err) {
    console.error('[Reports] load error:', err);
    showAdminToast(err.message || 'Lỗi tải báo cáo.', 'error');
    if (countEl) countEl.textContent = 'Lỗi tải';
    const tbody = document.getElementById('reportsTableBody');
    if (tbody) tbody.innerHTML = renderEmptyRow(8, err.message || 'Không thể tải báo cáo.');
  } finally {
    if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = 'Xem báo cáo'; }
  }
}

function renderReportSummary(summary, period) {
  if (!summary) return;
  setText('report-total-revenue', formatMoney(summary.totalRevenue || 0));
  setText('report-total-orders', String(summary.totalOrdersCount || 0));
  setText('report-avg-value', formatMoney(summary.averageOrderValue || 0));
  setText('report-completed', String(summary.completedCount || 0));
}

function renderReportChart(data, period, year) {
  const svg = document.getElementById('reportChart');
  const empty = document.getElementById('reportChartEmpty');
  const labelsEl = document.getElementById('reportChartLabels');
  const totalEl = document.getElementById('reportChartTotal');
  if (!svg || !labelsEl) return;

  if (!data || data.length === 0) {
    svg.innerHTML = '';
    if (labelsEl) labelsEl.innerHTML = '';
    if (totalEl) totalEl.textContent = formatMoney(0);
    if (empty) empty.style.display = 'flex';
    return;
  }

  const values = data.map(d => Number(d.totalRevenue || 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (totalEl) totalEl.textContent = formatMoney(total);
  if (total === 0) {
    if (empty) empty.style.display = 'flex';
  } else {
    if (empty) empty.style.display = 'none';
  }

  // Build labels
  let labels = [];
  if (period === 'month') {
    labels = data.map(d => `T${d.month}`);
  } else if (period === 'quarter') {
    labels = data.map(d => `Q${d.quarter}`);
  } else {
    labels = data.map(d => String(d.year));
  }
  labelsEl.innerHTML = labels.map(l => `<span class="revenue-chart-label">${escapeHtml(l)}</span>`).join('');

  // Render chart (same style as revenueChart)
  const W = 600, H = 200, PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 8;
  const n = data.length;
  const max = Math.max(...values, 1);
  const px = (i) => PAD_L + (n === 1 ? (W - PAD_L - PAD_R) / 2 : (i * (W - PAD_L - PAD_R)) / (n - 1));
  const py = (v) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);
  const line = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${PAD_L},${H - PAD_B} ${line} ${W - PAD_R},${H - PAD_B}`;

  // Title
  const titleEl = document.getElementById('reportChartTitle');
  if (titleEl) {
    if (period === 'month') titleEl.textContent = `Doanh thu theo tháng — ${year}`;
    else if (period === 'quarter') titleEl.textContent = `Doanh thu theo quý — ${year}`;
    else titleEl.textContent = 'Doanh thu theo năm';
  }

  svg.innerHTML = `
    <defs>
      <linearGradient id="repFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#b43e12" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#b43e12" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${[0.25, 0.5, 0.75, 1].map(f => `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${py(max * f).toFixed(1)}" y2="${py(max * f).toFixed(1)}" stroke="#e7e2d6" stroke-width="1"/>`).join('')}
    ${values.map((v, i) => v > 0 ? `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3.5" fill="#b43e12"/>` : '').join('')}
    <polygon points="${area}" fill="url(#repFill)"/>
    <polyline points="${line}" fill="none" stroke="#b43e12" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  `;
}

function renderReportsTable(data, period) {
  const tbody = document.getElementById('reportsTableBody');
  if (!tbody) return;
  if (!data || data.length === 0) {
    tbody.innerHTML = renderEmptyRow(8, 'Chưa có dữ liệu cho kỳ này.');
    return;
  }
  tbody.innerHTML = data.map(row => {
    const periodLabel = escapeHtml(row.label || row.periodKey || '-');
    return `
      <tr>
        <td><span class="table-primary">${periodLabel}</span><div class="row-muted">${escapeHtml(row.periodKey || '')}</div></td>
        <td class="center-cell"><strong>${Number(row.totalOrdersCount || 0)}</strong></td>
        <td class="center-cell"><span class="badge badge-completed">${Number(row.completedCount || 0)}</span></td>
        <td class="center-cell"><span class="badge badge-pending">${Number(row.pendingCount || 0)}</span></td>
        <td class="center-cell"><span class="badge badge-cancelled">${Number(row.cancelledCount || 0)}</span></td>
        <td><span class="money-cell">${formatMoney(row.totalRevenue || 0)}</span></td>
        <td><span class="money-cell">${formatMoney(row.pendingRevenue || 0)}</span></td>
        <td><span class="money-cell">${formatMoney(row.averageOrderValue || 0)}</span></td>
      </tr>
    `;
  }).join('');
}

async function exportReportsCsv() {
  const period = document.getElementById('reportPeriodSelect')?.value || adminState.reportPeriod || 'month';
  const yearVal = document.getElementById('reportYearSelect')?.value;
  const year = yearVal ? Number(yearVal) : null;
  const params = new URLSearchParams();
  params.set('period', period);
  if (period !== 'year' && year) params.set('year', String(year));
  // For year period with specific year, allow filtering: if user wants single year export, include year
  // We'll include year if period==year and user selected a year explicitly (and not showing all). But current UI for year shows all, so omit.
  // If user switched to year and wants single year, they can still export all and filter; keep simple.

  const btn = document.getElementById('reportExportBtn');
  if (btn) { btn.disabled = true; const old = btn.textContent; btn.textContent = 'Đang xuất...'; btn.dataset.old = old; }

  try {
    const res = await fetch(`${API_ADMIN}/reports/export?${params.toString()}`, { headers: auth.getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Xuất báo cáo thất bại.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const disposition = res.headers.get('content-disposition') || '';
    let filename = `blankup-report-${period}-${year || 'all'}.csv`;
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match) filename = match[1];
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showAdminToast('Đã xuất báo cáo CSV.');
  } catch (err) {
    console.error('[Reports] export error:', err);
    showAdminToast(err.message || 'Lỗi xuất báo cáo.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.old || 'Xuất báo cáo CSV'; }
  }
}

function renderCreditsList() {
  const tbody = document.getElementById('creditsTableBody');
  const countEl = document.getElementById('creditsResultCount');
  if (!tbody) return;

  const q = adminState.creditsSearch;
  const list = adminState.credits.filter(c => {
    if (!q) return true;
    return (c.username || '').toLowerCase().includes(q) || (c.fullName || '').toLowerCase().includes(q);
  });

  countEl.textContent = t('admin.count.accounts', '{n} tài khoản', { n: list.length });
  if (list.length === 0) {
    tbody.innerHTML = renderEmptyRow(6, q ? t('admin.empty.creditSearch', 'Không tìm thấy người dùng phù hợp.') : t('admin.empty.credits', 'Chưa có tài khoản credit nào.'));
    return;
  }

  tbody.innerHTML = list.map(c => {
    const today = new Date().toISOString().slice(0, 10);
    const resetToday = c.dailyFreeResetDate && String(c.dailyFreeResetDate).slice(0, 10) === today;
    const planName = adminState.plans.find(p => p.id === c.displayPlanId)?.name || c.displayPlanId || 'Free';
    return `
      <tr data-user-id="${escapeAttr(c.userId)}">
        <td>
          <div class="table-primary">${escapeHtml(c.fullName || c.username)}</div>
          <div class="row-muted">@${escapeHtml(c.username || '')}${c.email ? ' · ' + escapeHtml(c.email) : ''}</div>
        </td>
        <td><span class="badge badge-paid">${escapeHtml(planName)}</span></td>
        <td><div class="table-primary">${Number(c.highCredits) || 0}</div></td>
        <td><div class="table-primary">${Number(c.bonusLowCredits) || 0}</div></td>
        <td><div class="row-muted">${resetToday ? `${c.dailyFreeLowCreditsUsed}/${c.dailyFreeLowCreditsUsed + freeRemaining(c)}` : t('admin.resetToday', 'Đã reset')}</div></td>
        <td>
          <div class="action-buttons">
            <button class="btn-icon btn-view-action" data-action="adjust-credit" data-id="${escapeAttr(c.userId)}" title="${escapeAttr(t('admin.actions.adjust', 'Điều chỉnh credit'))}">±</button>
            <button class="btn-icon btn-copy-action" data-action="ledger-credit" data-id="${escapeAttr(c.userId)}" title="${escapeAttr(t('admin.actions.ledger', 'Xem lịch sử credit'))}">≣</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = btn.dataset.action;
      const userId = btn.dataset.id;
      const account = adminState.credits.find(c => c.userId === userId);
      if (!account) return;
      if (action === 'adjust-credit') openCreditAdjustModal(account);
      if (action === 'ledger-credit') openCreditAdjustModal(account);
    });
  });
}

function freeRemaining(account) {
  const plan = adminState.plans.find(p => p.id === account.displayPlanId);
  const daily = Number(plan?.dailyFreeLowCredits) || 0;
  const used = Number(account.dailyFreeLowCreditsUsed) || 0;
  return Math.max(0, daily - used);
}

function openCreditAdjustModal(account) {
  const modal = document.getElementById('creditAdjustModal');
  if (!modal) return;

  document.getElementById('ca-user-id').value = account.userId;
  const planName = adminState.plans.find(p => p.id === account.displayPlanId)?.name || account.displayPlanId || 'Free';
  document.getElementById('creditAdjustUserInfo').textContent = t('admin.ledger.customerInfo',
    '{name} (@{username}) · Gói {plan} · High {high} · Low {low}',
    { name: account.fullName || account.username, username: account.username, plan: planName, high: Number(account.highCredits) || 0, low: Number(account.bonusLowCredits) || 0 });
  document.getElementById('ca-amount').value = 1;
  document.getElementById('ca-note').value = '';

  modal.classList.add('open');
  loadLedger(account.userId);
}

async function loadLedger(userId) {
  const tbody = document.getElementById('ledgerTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="empty-table">${escapeHtml(t('admin.loading', 'Đang tải...'))}</td></tr>`;

  try {
    const response = await fetch(`${API_ADMIN}/credits/${encodeURIComponent(userId)}/ledger`, { headers: auth.getAuthHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.ledger', 'Không thể tải lịch sử credit.'));

    const rows = data.data || [];
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-table">${escapeHtml(t('admin.noTransactions', 'Chưa có giao dịch.'))}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><div class="row-muted">${formatDate(r.createdAt)}</div></td>
        <td><span class="badge ${r.creditType === 'high' ? 'badge-processing' : 'badge-awaiting'}">${escapeHtml(r.creditType)}</span></td>
        <td class="${Number(r.amount) > 0 ? 'money-cell' : ''}" style="${Number(r.amount) < 0 ? 'color:#dc2626;font-weight:700;' : ''}">${Number(r.amount) > 0 ? '+' : ''}${Number(r.amount)}</td>
        <td><div class="table-primary">${r.balanceAfter ?? '-'}</div></td>
        <td><div class="row-muted">${escapeHtml(r.note || r.reason || '')}</div></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Ledger error:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table">${escapeHtml(t('admin.cantLoadLedger', 'Không thể tải lịch sử.'))}</td></tr>`;
  }
}

async function saveCreditAdjust(event) {
  event.preventDefault();
  if (busyGuard('saveCreditAdjust')) return;
  var _caBtn = document.querySelector('#creditAdjustForm button[type="submit"]');
  var _relCa = _caBtn ? (_caBtn.disabled=true, _caBtn.textContent='Đang xử lý…', function(){ _caBtn.disabled=false; _caBtn.textContent='Điều chỉnh'; }) : function(){};
  const payload = {
    userId: document.getElementById('ca-user-id').value,
    creditType: document.getElementById('ca-credit-type').value,
    amount: Number(document.getElementById('ca-amount').value),
    reason: document.getElementById('ca-reason').value,
    note: document.getElementById('ca-note').value.trim() || null,
  };
  if (!payload.amount) {
    showAdminToast(t('admin.adjustAmountZero', 'Số lượng phải khác 0.'), 'error');
    return;
  }

  try {
    const response = await fetch(`${API_ADMIN}/credits/adjust`, {
      method: 'POST',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('admin.err.adjust', 'Không thể điều chỉnh credit.'));

    showAdminToast(data.message || t('admin.toast.adjusted', 'Đã điều chỉnh credit.'));
    await loadDashboardData();
    loadLedger(payload.userId);
    const account = adminState.credits.find(c => c.userId === payload.userId);
    if (account) openCreditAdjustModal(account);
  } catch (err) {
    console.error('Credit adjust error:', err);
    showAdminToast(err.message || t('admin.err.adjust', 'Lỗi điều chỉnh credit.'), 'error');
  }
}

function toDatetimeLocal(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initUserTools() {
  const searchInput = document.getElementById('userSearchInput');
  searchInput?.addEventListener('input', () => {
    adminState.userSearch = searchInput.value.trim().toLowerCase();
    renderUsersList();
  });
}

function viewOrdersForUser(user) {
  switchTab('orders');
  adminState.orderUserFilter = user.id;
  adminState.orderUserFilterLabel = user.fullName || user.username;
  document.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
  document.querySelector('.filter-pill[data-filter="all"]')?.classList.add('active');
  adminState.orderFilter = 'all';
  const searchInput = document.getElementById('orderSearchInput');
  if (searchInput) searchInput.value = '';
  adminState.orderSearch = '';
  renderOrdersList();
}

function clearUserOrderFilter() {
  adminState.orderUserFilter = null;
  adminState.orderUserFilterLabel = '';
  renderOrdersList();
}

function renderOverview() {
  const stats = adminState.stats;
  if (!stats) return;

  const paymentStats = getPaymentStats(adminState.orders);
  setText('stat-revenue', formatMoney(stats.totalRevenue));
  setText('stat-pending-revenue', formatMoney(stats.pendingRevenue));
  setText('stat-average-value', formatMoney(stats.averageOrderValue));
  setText('stat-total-orders', stats.totalOrdersCount);
  setText('stat-users-count', stats.usersCount);
  setText('stat-designs-count', stats.designsCount);
  setText('stat-paid-orders', paymentStats.paid);
  setText('stat-awaiting-payment', paymentStats.awaiting);

  // KPI đánh giá — SỐ THẬT từ reviews store (stat thật, không phải số bừa).
  const rs = stats.reviews || adminState.reviewSummary;
  const rsAvgEl = document.getElementById('stat-reviews-avg');
  const rsTotalEl = document.getElementById('stat-reviews-total');
  if (rsAvgEl) rsAvgEl.textContent = rs && rs.total ? `${rs.averageRating}/5` : '—';
  if (rsTotalEl) rsTotalEl.textContent = rs ? `${rs.total} đánh giá${rs.unreplied ? ` · ${rs.unreplied} chưa phản hồi` : ''}` : '0 đánh giá';

  setText('summary-completed', stats.completedCount);
  setText('summary-pending', stats.pendingCount);
  setText('summary-cancelled', stats.cancelledCount);
  setText('summary-paid', paymentStats.paid);
  setText('summary-awaiting', paymentStats.awaiting);
  setText('ops-paid-revenue', formatMoney(paymentStats.paidRevenue));
  setText('ops-awaiting-money', formatMoney(paymentStats.awaitingRevenue));
  setText('ops-underpaid-count', paymentStats.underpaid);

  renderCategoryBreakdown(stats.categories || {});
  renderRevenueChart();
  renderRecentOrders();
}

function renderRevenueChart() {
  const svg = document.getElementById('revenueChart');
  const empty = document.getElementById('revenueChartEmpty');
  const labelsEl = document.getElementById('revenueChartLabels');
  const totalEl = document.getElementById('revenueChartTotal');
  if (!svg) return;

  const W = 600, H = 200, PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 8;
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push(d.toDateString());
  }
  const paidStatuses = ['paid'];
  const revenueByDay = days.map(() => 0);
  (adminState.orders || []).forEach(order => {
    if (!order.createdAt) return;
    const created = new Date(order.createdAt);
    const idx = days.indexOf(created.toDateString());
    if (idx === -1) return;
    const isPaid = paidStatuses.includes(order.paymentStatus) || order.status === 'completed';
    if (!isPaid) return;
    revenueByDay[idx] += Number(order.total || (order.price || 0) * (order.quantity || 1));
  });

  const total = revenueByDay.reduce((a, b) => a + b, 0);
  if (totalEl) totalEl.textContent = formatMoney(total);
  if (labelsEl) {
    labelsEl.innerHTML = days.map(d => {
      const dt = new Date(d);
      return `<span class="revenue-chart-label">${dt.getDate()}/${dt.getMonth() + 1}</span>`;
    }).join('');
  }

  const max = Math.max(...revenueByDay, 1);
  const px = (i) => PAD_L + (i * (W - PAD_L - PAD_R)) / 6;
  const py = (v) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

  const line = revenueByDay.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${PAD_L},${H - PAD_B} ${line} ${W - PAD_R},${H - PAD_B}`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#b43e12" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#b43e12" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${[0.25, 0.5, 0.75, 1].map(f => `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${py(max * f).toFixed(1)}" y2="${py(max * f).toFixed(1)}" stroke="#e7e2d6" stroke-width="1"/>`).join('')}
    ${revenueByDay.map((v, i) => v > 0 ? `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3.5" fill="#b43e12"/>` : '').join('')}
    <polygon points="${area}" fill="url(#revFill)"/>
    <polyline points="${line}" fill="none" stroke="#b43e12" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  `;
  if (empty) empty.style.display = total > 0 ? 'none' : 'flex';
}

function renderCategoryBreakdown(categories) {
  const list = document.getElementById('categoryBreakdownList');
  if (!list) return;

  const names = {
    tshirt: t('admin.productTshirt', 'Áo thun'),
    oversize: 'Oversize',
    polo: 'Polo',
    hoodie: 'Hoodie',
  };
  const maxRevenue = Math.max(...Object.values(categories).map(cat => cat.revenue || 0), 1);
  list.innerHTML = Object.entries(categories).map(([key, cat]) => {
    const pct = Math.round(((cat.revenue || 0) / maxRevenue) * 100);
    return `
      <div class="category-row">
        <div class="category-labels">
          <span class="cat-name">${escapeHtml(names[key] || key)}</span>
          <span class="cat-count">${escapeHtml(t('admin.count.products', '{n} cái · {amount}', { n: Number(cat.count || 0), amount: formatMoney(cat.revenue || 0) }))}</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRecentOrders() {
  const recentBody = document.getElementById('recentOrdersTableBody');
  if (!recentBody) return;
  const recent = [...adminState.orders]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  recentBody.innerHTML = recent.length
    ? recent.map(order => renderOrderRow(order, true)).join('')
    : renderEmptyRow(8, t('admin.empty.orders', 'Chưa có đơn hàng nào.'));
  bindRowActions(recentBody);
}

function renderOrdersList() {
  const tbody = document.getElementById('allOrdersTableBody');
  const countEl = document.getElementById('ordersResultCount');
  if (!tbody) return;

  const filteredOrders = getFilteredOrders();
  if (countEl) countEl.textContent = t('admin.count.orders', '{a}/{b} đơn', { a: filteredOrders.length, b: adminState.orders.length });

  const filterChip = document.getElementById('orderUserFilterChip');
  if (filterChip) {
    if (adminState.orderUserFilter) {
      filterChip.style.display = 'inline-flex';
      filterChip.querySelector('.filter-chip-label').textContent = `${t('admin.customer', 'Khách')}: ${adminState.orderUserFilterLabel}`;
    } else {
      filterChip.style.display = 'none';
    }
  }

  tbody.innerHTML = filteredOrders.length
    ? filteredOrders.map(order => renderOrderRow(order)).join('')
    : renderEmptyRow(8, t('admin.empty.orderFilter', 'Không có đơn hàng nào khớp bộ lọc.'));
  bindRowActions(tbody);
  lastOrdersSignature = ordersRenderSignature();
}

/* ============================================================
   REALTIME ORDERS
   The admin board follows every order change (SePay confirmation, a new order,
   another admin's edit) without a manual reload: SSE push with a 10s poll as a
   safety net. Re-rendering is skipped while a modal is open so an in-flight
   edit is never yanked away, and skipped when nothing actually changed so the
   table does not flicker under the cursor.
   ============================================================ */
let ordersStreamHandle = null;
let ordersPollTimer = null;
let lastOrdersSignature = '';

function ordersRenderSignature() {
  return (adminState.orders || [])
    .map(o => [o.orderId, o.status, o.paymentStatus || '', o.paidAt || '', o.updatedAt || ''].join(':'))
    .join('|');
}

function isAdminModalOpen() {
  return Boolean(document.querySelector('.modal-overlay.open'));
}

function renderOrdersIfChanged(force) {
  const signature = ordersRenderSignature();
  if (!force && signature === lastOrdersSignature) return;
  renderOrdersList();
}

async function refreshOrdersOnly() {
  if (isAdminModalOpen()) return; // never disturb an open editor
  try {
    const resp = await fetch(API_ORDERS, { headers: auth.getAuthHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.success !== false && Array.isArray(data.data)) {
      adminState.orders = data.data;
      renderOrdersIfChanged(false);
    }
  } catch (err) { /* transient — the poll retries */ }
}

function mergeOrderEvent(event) {
  if (!event || !event.orderId) return;
  const orders = adminState.orders || [];
  const idx = orders.findIndex(o => o.orderId === event.orderId);
  if (idx === -1) { refreshOrdersOnly(); return; } // brand new order → refetch
  orders[idx] = Object.assign({}, orders[idx], {
    status: event.status,
    paymentStatus: event.paymentStatus,
    paidAt: event.paidAt,
    updatedAt: event.updatedAt,
  });
  renderOrdersIfChanged(false);
}

function startOrdersRealtime() {
  if (ordersStreamHandle) return;
  if (typeof window.watchOrderStream === 'function') {
    ordersStreamHandle = window.watchOrderStream({ onEvent: mergeOrderEvent });
  }
  if (ordersPollTimer) return;
  ordersPollTimer = setInterval(() => {
    if (document.hidden) return;
    if (adminState.currentTab !== 'orders' && adminState.currentTab !== 'overview') return;
    refreshOrdersOnly();
  }, 10000);
}

function getFilteredOrders() {
  return adminState.orders.filter(order => {
    const statusMatch = adminState.orderFilter === 'all' || order.status === adminState.orderFilter;
    const paymentStatus = order.paymentStatus || '';
    const paymentMatch = adminState.paymentFilter === 'all'
      || order.payment === adminState.paymentFilter
      || paymentStatus === adminState.paymentFilter;
    const userMatch = !adminState.orderUserFilter || order.userId === adminState.orderUserFilter;
    const haystack = [
      order.orderId,
      order.customer?.name,
      order.customer?.phone,
      order.customer?.address,
      order.transferContent,
      order.productType,
      order.payment,
      paymentStatus,
    ].join(' ').toLowerCase();
    const searchMatch = !adminState.orderSearch || haystack.includes(adminState.orderSearch);
    return statusMatch && paymentMatch && userMatch && searchMatch;
  });
}

function renderOrderRow(order, compact = false) {
  const total = getOrderTotal(order);
  const status = STATUS_META[order.status] || { label: () => order.status || 'N/A', cls: 'badge-muted' };
  const payment = PAYMENT_META[order.payment] || { label: () => order.payment || 'N/A', cls: 'badge-muted' };
  const paymentStatus = PAYMENT_STATUS_META[order.paymentStatus] || { label: () => order.paymentStatus || t('admin.notPaid', 'Chưa rõ'), cls: 'badge-muted' };
  const dateStr = formatDate(order.createdAt);
  const paidAt = order.paidAt ? `<div class="row-muted">${escapeHtml(t('admin.paidAt', 'Thanh toán: {date}', { date: formatDate(order.paidAt) }))}</div>` : '';
  const transferLine = order.transferContent ? `<div class="row-muted">${escapeHtml(order.transferContent)}</div>` : '';
  const customerNote = order.customer?.note ? `<div class="row-muted">${escapeHtml(t('admin.customerNote', 'Ghi chú: {note}', { note: order.customer.note }))}</div>` : '';
  const completeActionHtml = order.status === 'pending' || order.status === 'delivered'
    ? `<button class="btn-icon btn-complete-action" data-action="complete" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.complete', 'Đánh dấu hoàn thành'))}">✓</button>`
    : '';
  const cancelActionHtml = order.status === 'pending'
    ? `<button class="btn-icon btn-cancel-action" data-action="cancel" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.cancel', 'Hủy đơn'))}">×</button>`
    : '';
  // Đã thanh toán (paid) chưa sản xuất — admin bấm để bắt đầu sản xuất.
  const startProductionActionHtml = order.status === 'paid'
    ? `<button class="btn-icon btn-start-action" data-action="start-production" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.startProduction', 'Bắt đầu sản xuất'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg></button>`
    : '';
  const shipActionHtml = order.status === 'processing'
    ? `<button class="btn-icon btn-ship-action" data-action="ship" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.ship2', 'Chuyển sang đã gửi hàng'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></button>`
    : '';
  const deliverActionHtml = order.status === 'shipped'
    ? `<button class="btn-icon btn-deliver-action" data-action="deliver" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.deliver2', 'Chuyển sang đã giao hàng'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg></button>`
    : '';
  const markPaidActionHtml = order.payment === 'BANK_TRANSFER' && order.paymentStatus !== 'paid'
    ? `<button class="btn-icon btn-paid-action" data-action="mark-paid" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.markPaid', 'Xác nhận đã nhận tiền'))}">₫</button>`
    : '';
  const copyActionHtml = order.transferContent
    ? `<button class="btn-icon btn-copy-action" data-action="copy-transfer" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.copyTransfer', 'Copy nội dung chuyển khoản'))}">⧉</button>`
    : '';

  return `
    <tr data-order-id="${escapeAttr(order.orderId)}">
      <td>
        <div class="order-code">${escapeHtml(order.orderId)}</div>
        ${transferLine}
      </td>
      <td>
        <div class="table-primary">${escapeHtml(order.customer?.name || t('admin.customerUnknown', 'Khách lẻ'))}</div>
        <div class="row-muted">${escapeHtml(order.customer?.phone || t('admin.noPhone', 'Không có SĐT'))}</div>
        ${compact ? '' : `<div class="row-muted address-line">${escapeHtml(order.customer?.address || '')}</div>`}
        ${compact ? '' : customerNote}
      </td>
      <td>
        <div class="table-primary">${escapeHtml(getProductName(order.productType))}</div>
        <div class="row-muted">${escapeHtml(order.size || 'N/A')} · SL ${Number(order.quantity || 1)} · ${escapeHtml(order.color || '')}</div>
      </td>
      <td>
        <div class="money-cell">${formatMoney(total)}</div>
        <div class="row-muted">${formatMoney(order.price || 0)}${escapeHtml(t('admin.perShirt', '/áo'))}</div>
      </td>
      <td>
        <span class="badge ${payment.cls}">${payment.label()}</span>
        <span class="badge ${paymentStatus.cls}">${paymentStatus.label()}</span>
      </td>
      <td><span class="badge ${status.cls}">${status.label()}</span></td>
      <td>
        <div class="table-primary">${dateStr}</div>
        ${paidAt}
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn-icon btn-view-action" data-action="preview" data-id="${escapeAttr(order.orderId)}" title="${escapeAttr(t('admin.actions.preview', 'Xem chi tiết'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></button>
          ${copyActionHtml}
          ${markPaidActionHtml}
          ${startProductionActionHtml}
          ${shipActionHtml}
          ${deliverActionHtml}
          ${completeActionHtml}
          ${cancelActionHtml}
        </div>
      </td>
    </tr>
  `;
}

function bindRowActions(container) {
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = btn.dataset.action;
      const orderId = btn.dataset.id;
      if (action === 'preview' || action === 'copy-transfer') {
        if (action === 'copy-transfer') copyTransferContent(orderId);
        if (action === 'preview') openPreviewModal(orderId);
        return;
      }
      const busyKey = `order-${action}-${orderId}`;
      if (busyGuard(busyKey)) return;
      const prevDisabled = btn.disabled;
      btn.disabled = true;
      try {
        if (action === 'complete') await updateOrderStatus(orderId, 'completed');
        if (action === 'start-production') await updateOrderStatus(orderId, 'processing');
        if (action === 'ship') await updateOrderStatus(orderId, 'shipped');
        if (action === 'deliver') await updateOrderStatus(orderId, 'delivered');
        if (action === 'mark-paid') await markOrderPaid(orderId);
        if (action === 'cancel' && confirm(t('admin.confirm.cancelOrder', 'Bạn chắc chắn muốn hủy đơn hàng này?'))) {
          await updateOrderStatus(orderId, 'cancelled');
        }
      } finally {
        busyRelease(busyKey);
        btn.disabled = prevDisabled;
      }
    });
  });
}

async function markOrderPaid(orderId) {
  const busyKey = `order-paid-${orderId}`;
  if (busyGuard(busyKey)) return;
  const order = adminState.orders.find(item => item.orderId === orderId);
  if (!order) { busyRelease(busyKey); return; }
  if (!confirm(t('admin.confirm.markPaid', 'Xác nhận đã nhận {amount} cho đơn {orderId}?', { amount: formatMoney(getOrderTotal(order)), orderId }))) { busyRelease(busyKey); return; }

  try {
    const response = await fetch(`${API_ORDERS}/${encodeURIComponent(orderId)}/payment`, {
      method: 'PUT',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify({
        paymentStatus: 'paid',
        receivedAmount: getOrderTotal(order),
        note: 'Admin manual confirmation',
      }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || t('admin.err.markPaid', 'Không thể xác nhận thanh toán.'));
    }
    showAdminToast(t('admin.toast.markedPaid', 'Đã xác nhận thanh toán.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Payment update error:', err);
    showAdminToast(err.message || t('admin.err.markPaid', 'Không thể xác nhận thanh toán.'), 'error');
  } finally { busyRelease(busyKey); }
}

async function copyTransferContent(orderId) {
  const order = adminState.orders.find(item => item.orderId === orderId);
  const content = order?.transferContent || orderId;
  try {
    await navigator.clipboard.writeText(content);
    showAdminToast(t('admin.toast.copied', 'Đã copy: {content}', { content }));
  } catch (err) {
    showAdminToast(t('admin.err.copy', 'Không thể copy nội dung chuyển khoản.'), 'error');
  }
}

function exportOrdersCsv() {
  const rows = getFilteredOrders();
  const headers = [
    'orderId',
    'customerName',
    'phone',
    'product',
    'size',
    'quantity',
    'total',
    'payment',
    'paymentStatus',
    'transferContent',
    'status',
    'createdAt',
  ];
  const csv = [
    headers.join(','),
    ...rows.map(order => headers.map(key => csvCell({
      orderId: order.orderId,
      customerName: order.customer?.name || '',
      phone: order.customer?.phone || '',
      product: order.productType || '',
      size: order.size || '',
      quantity: order.quantity || 1,
      total: getOrderTotal(order),
      payment: order.payment || '',
      paymentStatus: order.paymentStatus || '',
      transferContent: order.transferContent || '',
      status: order.status || '',
      createdAt: order.createdAt || '',
    }[key])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `blankup-orders-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showAdminToast(t('admin.toast.exported', 'Đã xuất {count} đơn hàng.', { count: rows.length }));
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function renderUsersList() {
  console.log('[Admin] renderUsersList called, users:', adminState.users.length);
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) { console.warn('[Admin] #usersTableBody not found'); return; }

  const search = adminState.userSearch;
  const filtered = !search
    ? adminState.users
    : adminState.users.filter(u =>
        (u.username || '').toLowerCase().includes(search) ||
        (u.fullName || '').toLowerCase().includes(search)
      );

  const countEl = document.getElementById('usersResultCount');
  if (countEl) countEl.textContent = t('admin.count.users', '{a}/{b} người dùng', { a: filtered.length, b: adminState.users.length });

  tbody.innerHTML = filtered.length
    ? filtered.map(user => {
      const isAdmin = user.role === 'admin';
      const isCurrentUser = user.id === auth.user?.id;
      return `
      <tr>
        <td><span class="table-primary">@${escapeHtml(user.username)}</span></td>
        <td><span class="table-primary">${escapeHtml(user.fullName)}</span></td>
        <td>
          <select class="admin-select user-role-select" data-user-id="${escapeAttr(user.id)}" data-current-role="${escapeAttr(user.role)}" ${isCurrentUser ? `disabled title="${escapeAttr(t('admin.actions.roleLocked', 'Không thể đổi vai trò của chính mình'))}"` : ''}>
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${isAdmin ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td>${formatDate(user.createdAt, false)}</td>
        <td class="center-cell">${Number(user.ordersCount || 0)}</td>
        <td><span class="money-cell">${formatMoney(user.totalSpend || 0)}</span></td>
        <td>
          <div class="action-buttons">
            <button class="btn-icon btn-view-action" data-user-detail-id="${escapeAttr(user.id)}" title="${escapeAttr(t('admin.actions.preview', 'Xem chi tiết'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></button>
            <button class="btn-icon btn-view-action" data-user-edit-id="${escapeAttr(user.id)}" title="${escapeAttr(t('admin.actions.edit', 'Chỉnh sửa'))}">✎</button>
            <button class="btn-icon btn-view-action" data-user-id="${escapeAttr(user.id)}" data-user-label="${escapeAttr(user.fullName || user.username)}" title="${escapeAttr(t('admin.actions.viewOrders', 'Xem đơn hàng'))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M9 16h.01"/><path d="M15 16h.01"/></svg></button>
            ${!isCurrentUser && !isAdmin ? `<button class="btn-icon btn-cancel-action" data-user-delete-id="${escapeAttr(user.id)}" data-user-delete-name="${escapeAttr(user.username)}" title="${escapeAttr(t('admin.actions.deleteUser', 'Xóa tài khoản'))}">×</button>` : ''}
          </div>
        </td>
      </tr>
    `}).join('')
    : renderEmptyRow(7, search ? t('admin.empty.userSearch', 'Không tìm thấy người dùng khớp.') : t('admin.empty.users', 'Chưa có tài khoản người dùng.'));

  tbody.querySelectorAll('[data-user-id]:not([data-user-detail-id]):not([data-user-delete-id])').forEach(btn => {
    btn.addEventListener('click', () => {
      viewOrdersForUser({ id: btn.dataset.userId, fullName: btn.dataset.userLabel });
    });
  });

  tbody.querySelectorAll('[data-user-detail-id]').forEach(btn => {
    btn.addEventListener('click', () => openUserDetailModal(btn.dataset.userDetailId));
  });

  tbody.querySelectorAll('[data-user-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = adminState.users.find(u => u.id === btn.dataset.userEditId);
      if (user) openUserFormModal(user);
    });
  });

  tbody.querySelectorAll('[data-user-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteUser(btn.dataset.userDeleteId, btn.dataset.userDeleteName));
  });

  tbody.querySelectorAll('.user-role-select').forEach(select => {
    select.addEventListener('change', async () => {
      const userId = select.dataset.userId;
      const newRole = select.value;
      await updateUserRole(userId, newRole);
    });
  });
}

function renderDesignsGrid() {
  const grid = document.getElementById('designsGrid');
  if (!grid) return;

  const filter = adminState.designVisibilityFilter;
  const filtered = adminState.designs.filter(d => {
    if (filter === 'shared') return d.isShared !== false;
    if (filter === 'hidden') return d.isShared === false;
    return true;
  });

  const countEl = document.getElementById('designsResultCount');
  if (countEl) countEl.textContent = t('admin.count.designs', '{a}/{b} thiết kế', { a: filtered.length, b: adminState.designs.length });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">${adminState.designs.length ? escapeHtml(t('admin.empty.designFilter', 'Không có thiết kế nào khớp bộ lọc.')) : escapeHtml(t('admin.empty.designs', 'Chưa có thiết kế AI nào được tạo.'))}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(design => {
    const prompt = String(design.prompt || design.promptEn || t('admin.noPrompt', 'Không có prompt')).slice(0, 200);
    const promptDisplay = String(design.prompt || design.promptEn || t('admin.noPrompt', 'Không có prompt')).slice(0, 120);
    const promptAlt = String(design.prompt || design.promptEn || '').slice(0, 80);
    const previewUrl = design.designUrl || design.frontDesignUrl || '';
    const isHidden = design.isShared === false;
    return `
      <article class="design-item-card ${isHidden ? 'is-hidden' : ''}">
        <div class="design-card-preview">
          ${previewUrl ? `<img src="${escapeAttr(previewUrl)}" alt="${escapeAttr(promptAlt)}" loading="lazy">` : `<span>${escapeHtml(t('admin.noImage', 'Không có ảnh'))}</span>`}
          <span class="design-visibility-badge ${isHidden ? 'badge-muted' : 'badge-completed'}">${isHidden ? escapeHtml(t('admin.visibility.hidden', 'Đã ẩn')) : escapeHtml(t('admin.visibility.public', 'Công khai'))}</span>
        </div>
        <div class="design-card-details">
          <div class="design-card-prompt">"${escapeHtml(promptDisplay)}"</div>
          <div class="design-card-meta">
            <span>${escapeHtml(String(design.author || 'Guest').slice(0, 40))}</span>
            <span>${formatDate(design.createdAt || design.updatedAt || Date.now(), false)}</span>
          </div>
          <button class="btn btn-secondary btn-sm design-visibility-toggle" data-design-id="${escapeAttr(design.id)}" data-next-visible="${isHidden ? 'true' : 'false'}">
            ${isHidden ? escapeHtml(t('admin.designShow', 'Hiện lại trên thư viện')) : escapeHtml(t('admin.designHide', 'Ẩn khỏi thư viện'))}
          </button>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('.design-visibility-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleDesignVisibility(btn.dataset.designId, btn.dataset.nextVisible === 'true'));
  });
}

async function toggleDesignVisibility(designId, nextIsShared) {
  const busyKey = `design-visibility-${designId}`;
  if (busyGuard(busyKey)) return;
  try {
    const response = await fetch(`${API_ADMIN}/designs/${encodeURIComponent(designId)}/visibility`, {
      method: 'PUT',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify({ isShared: nextIsShared }),
    });
    const result = await response.json();
    if (!response.ok || result.success === false) {
      throw new Error(result.error || t('admin.err.designToggle', 'Không thể cập nhật trạng thái thiết kế.'));
    }
    const index = adminState.designs.findIndex(d => d.id === designId);
    if (index !== -1) adminState.designs[index] = result.data;
    renderDesignsGrid();
    showAdminToast(nextIsShared ? t('admin.toast.designShown', 'Đã hiện lại thiết kế trên thư viện.') : t('admin.toast.designHidden', 'Đã ẩn thiết kế khỏi thư viện.'));
  } catch (err) {
    showAdminToast(err.message || t('admin.err.designToggle', 'Không thể cập nhật trạng thái thiết kế.'), 'error');
  } finally { busyRelease(busyKey); }
}

async function updateOrderStatus(orderId, newStatus) {
  const busyKey = `order-status-${orderId}`;
  if (busyGuard(busyKey)) return;
  try {
    const response = await fetch(`${API_ORDERS}/${encodeURIComponent(orderId)}/status`, {
      method: 'PUT',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify({ status: newStatus }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || t('admin.err.orderUpdate', 'Không thể cập nhật đơn hàng.'));
    }

    showAdminToast(newStatus === 'completed' ? t('admin.toast.orderCompleted', 'Đã đánh dấu hoàn thành.') : t('admin.toast.orderUpdated', 'Đã cập nhật đơn hàng.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Order status error:', err);
    showAdminToast(err.message || t('admin.err.orderUpdate', 'Lỗi cập nhật đơn hàng.'), 'error');
    if (String(err.message).includes('chỉnh sửa bởi người khác')) await loadDashboardData();
  } finally { busyRelease(busyKey); }
}

function openPreviewModal(orderId) {
  const order = adminState.orders.find(item => item.orderId === orderId);
  if (!order) return;

  adminState.selectedPreviewOrder = order;
  adminState.previewSide = 'front';
  adminState.previewShirtColor = order.color || '#ffffff';

  setText('prev-order-id', order.orderId);
  setText('prev-customer-name', order.customer?.name || t('admin.customerUnknown', 'Khách lẻ'));
  setText('prev-customer-contact', order.customer?.phone || t('admin.noPhone', 'Không có SĐT'));
  setText('prev-customer-address', order.customer?.address || t('admin.noAddress', 'Không có địa chỉ'));
  setText('prev-customer-note', order.customer?.note || t('admin.noNote', 'Không có ghi chú'));
  setText('prev-product-details', `${getProductName(order.productType)} (${order.size || 'N/A'}) · ${formatMoney(order.price || 0)}${t('admin.perShirt', '/áo')}`);
  setText('prev-quantity', `${Number(order.quantity || 1)} ${t('admin.shirtUnit', 'áo')} · ${formatMoney(getOrderTotal(order))}`);
  setText('prev-author', order.authorName || 'Guest');
  setText('prev-payment', `${(PAYMENT_META[order.payment]?.label || (() => order.payment || 'N/A'))()} · ${(PAYMENT_STATUS_META[order.paymentStatus]?.label || (() => order.paymentStatus || 'N/A'))()}`);
  setText('prev-transfer-content', order.transferContent || t('admin.noValue', 'Không có'));
  setText('prev-paid-at', order.paidAt ? formatDate(order.paidAt) : t('admin.notPaid', 'Chưa thanh toán'));
  populateStatusSelect(document.getElementById('prev-status-select'), order.status);

  syncAdminPreviewSideButtons();
  renderAdminPreviewDesign();
  updateAdminMockupColor();
  document.querySelectorAll('.admin-color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === adminState.previewShirtColor);
  });
  // 3D mặc định khi mở đơn — mount viewer vào đơn này (lazy import GLB lần đầu).
  const note = document.getElementById('admin3dNote');
  if (note) note.hidden = true;
  setAdminPreviewView('3d');
  document.getElementById('designPreviewModal')?.classList.add('open');
}

function initPreviewSideToggle() {
  document.querySelectorAll('.admin-side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      adminState.previewSide = btn.dataset.side || 'front';
      syncAdminPreviewSideButtons();
      renderAdminPreviewDesign();
    });
  });
}

function syncAdminPreviewSideButtons() {
  const order = adminState.selectedPreviewOrder;
  const hasBack = Boolean(order?.backDesignUrl);
  document.querySelectorAll('.admin-side-btn').forEach(btn => {
    const side = btn.dataset.side;
    btn.classList.toggle('active', side === adminState.previewSide);
    btn.disabled = side === 'back' && !hasBack;
  });
  // 3D viewer quay camera tới đúng mặt đang chọn (giống Studio).
  if (admin3d.booted) {
    try { window.tshirt360Viewer?.showSide(adminState.previewSide || 'front'); } catch { /* viewer chưa sẵn sàng */ }
  }
}

function renderAdminPreviewDesign() {
  const order = adminState.selectedPreviewOrder;
  const designUrl = getOrderDesignUrl(order, adminState.previewSide);
  const overlay = document.getElementById('mockupDesignAdmin');

  if (overlay) {
    overlay.innerHTML = designUrl
      ? `<img src="${escapeAttr(designUrl)}" alt="${escapeAttr(t('admin.designThumb', 'Thiết kế in áo'))}" loading="lazy">`
      : `<span class="row-muted">${escapeHtml(t('admin.noDesign', 'Không có thiết kế'))}</span>`;
  }

  updateAdminPrintDownloads();
}

/* ---- ADMIN 3D PREVIEW — nhìn áo của khách bằng model 3D thật ----
   Tái sử dụng NGUYÊN VÊN viewer 3D của Studio (tshirt-360.js): GLB thật,
   decal thật từ composite đã in, xoay/zoom bằng OrbitControls. Viewer studio
   cũng dùng tshirt360Viewer làm facade nên không thể mount 2 instance bằng
   window object — import một instance riêng cho admin qua dynamic import,
   chỉ khi modal mở đơn ĐẦU TIÊN (lazy: admin không carga 3D nếu không mở đơn).
   THỜI GIAN: GLB tải 1 lần duy nhất; đóng/mở modal chỉ chuyển setProduct +
   applyDesigns (model nằm trong bounded cache của viewer). */
const admin3d = {
  viewerPromise: null,
  booted: false,
  productType: null,
  appliedUrls: { front: null, back: null },
};

function adminOrderDesignUrls(order) {
  return {
    front: (order && (order.frontDesignUrl || order.designUrl)) || null,
    back: (order && order.backDesignUrl) || null,
  };
}

function mapAdminProductType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  // 'oversize' dùng chung model t-shirt (cut rộng hơn nhưng surface in giống).
  if (v === 'oversize') return 'tshirt';
  return v;
}

async function ensureAdmin3dViewer() {
  if (admin3d.viewerPromise) return admin3d.viewerPromise;
  admin3d.viewerPromise = import('/js/tshirt-360.js')
    .then((mod) => {
      const v = window.tshirt360Viewer;
      if (!v) throw new Error('3D viewer module loaded but facade missing');
      return v;
    })
    .catch((err) => {
      admin3d.viewerPromise = null; // cho phép retry lần mở sau
      throw err;
    });
  return admin3d.viewerPromise;
}

/* Boot 3D cho đơn đang mở: đúng loại áo + đúng màu + đúng thiết kế front/back. */
async function bootAdmin3d(order) {
  const container = document.getElementById('admin3dContainer');
  const note = document.getElementById('admin3dNote');
  if (!container) return false;
  const productType = mapAdminProductType(order.productType);
  const urls = adminOrderDesignUrls(order);

  // Điều kiện đã boot đúng sản phẩm + đúng thiết kế (đơn khác → re-apply)
  const sameContext = admin3d.booted
    && admin3d.productType === productType
    && admin3d.appliedUrls.front === urls.front
    && admin3d.appliedUrls.back === urls.back;

  try {
    const viewer = await ensureAdmin3dViewer();
    if (!admin3d.booted) {
      viewer.setColor(order.color || '#ffffff');
      admin3d.booted = true;
    }
    if (!sameContext) {
      viewer.setProduct(productType);
      const state = viewer.getProductState();
      if (state.available3D === false) {
        // Không có GLB thật cho loại áo này (vd polo): báo rõ, không fake.
        if (note) {
          note.hidden = false;
          note.textContent = `Mẫu 3D cho ${order.productType || 'sản phẩm'} chưa có — hãy dùng chế độ 2D ở trên để xem bản in.`;
        }
        admin3d.productType = productType;
        admin3d.appliedUrls = urls;
        return false;
      }
      if (note) note.hidden = true;
      viewer.setDesigns(urls);
      admin3d.productType = productType;
      admin3d.appliedUrls = urls;
    }
    viewer.setColor(order.color || '#ffffff');
    viewer.resize();
    viewer.showSide(adminState.previewSide || 'front');
    return true;
  } catch (err) {
    console.warn('[Admin3D] viewer boot failed:', err);
    if (note) {
      note.hidden = false;
      note.textContent = 'Không tải được mẫu 3D — chuyển sang chế độ 2D để xem bản in.';
    }
    // Lỗi 3D → tự rơi về 2D cho admin không bị treo màn hình trống.
    setAdminPreviewView('2d');
    return false;
  }
}

/* Đóng modal: chỉ ẩn, KHÔNG hủy viewer (GLB cache giữ nguyên cho lần mở sau). */
function hideAdmin3d() {
  const container = document.getElementById('admin3dContainer');
  if (container) container.style.display = 'none';
}

function setAdminPreviewView(view) {
  const want3d = view !== '2d';
  const container = document.getElementById('admin3dContainer');
  const mockup = document.getElementById('mockupContainerAdmin');
  document.querySelectorAll('.admin-view-btn').forEach((b) => {
    b.classList.toggle('active', (b.dataset.view === '3d') === want3d);
  });
  if (container) container.style.display = want3d ? '' : 'none';
  if (mockup) mockup.style.display = want3d ? 'none' : '';
  if (want3d) {
    const order = adminState.selectedPreviewOrder;
    if (order) bootAdmin3d(order);
  }
}

function initAdminViewToggle() {
  document.querySelectorAll('.admin-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setAdminPreviewView(btn.dataset.view));
  });
}

/* ---- DOWNLOAD BẢN IN — composite đúng mặt, đúng tên file đơn ---- */
function updateAdminPrintDownloads() {
  const order = adminState.selectedPreviewOrder;
  const front = (order && (order.frontDesignUrl || order.designUrl)) || '';
  const back = (order && order.backDesignUrl) || '';
  const id = order?.orderId || 'order';
  const ext = (url) => {
    if (String(url).startsWith('data:image/svg')) return 'svg';
    if (String(url).startsWith('data:image/png')) return 'png';
    if (String(url).startsWith('data:image/jpeg')) return 'jpg';
    if (String(url).startsWith('data:image/webp')) return 'webp';
    const m = String(url).split('?')[0].match(/\.(png|jpe?g|webp|svg|gif)$/i);
    return m ? m[1].toLowerCase() : 'png';
  };
  const setLink = (el, url, side) => {
    if (!el) return;
    if (!url) {
      el.hidden = true;
      el.removeAttribute('href');
      return;
    }
    el.hidden = false;
    el.href = url;
    el.download = `blankup-${id}-${side}.${ext(url)}`;
  };
  setLink(document.getElementById('dlFrontLink'), front, 'front');
  setLink(document.getElementById('dlBackLink'), back, 'back');
}

function getOrderDesignUrl(order, side = adminState.previewSide) {
  if (!order) return '';
  const front = order.frontDesignUrl || order.designUrl || '';
  const back = order.backDesignUrl || '';
  return side === 'back' ? (back || front) : front;
}

function initColorDotPreview() {
  document.querySelectorAll('.admin-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      adminState.previewShirtColor = dot.dataset.color;
      document.querySelectorAll('.admin-color-dot').forEach(item => item.classList.remove('active'));
      dot.classList.add('active');
      updateAdminMockupColor();
      // Đổi màu áo trên model 3D thật (nếu viewer đã boot).
      if (admin3d.booted) {
        try { window.tshirt360Viewer?.setColor(adminState.previewShirtColor); } catch { /* viewer chưa sẵn sàng */ }
      }
    });
  });
}

function initPreviewModalClose() {
  const modal = document.getElementById('designPreviewModal');
  document.getElementById('previewModalClose')?.addEventListener('click', () => { modal?.classList.remove('open'); hideAdmin3d(); });
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) { modal.classList.remove('open'); hideAdmin3d(); }
  });
  document.getElementById('prev-status-save')?.addEventListener('click', savePreviewStatus);
  initAdminViewToggle();
}

/* Populate select trạng thái theo ĐÚNG state machine của backend
   (ORDER_TRANSITIONS trong routes/orders.js): chỉ hiện các trạng thái
   chuyển được hợp lệ + trạng thái hiện tại → admin không bao giờ bấm vào
   409 transition-invalid nữa. Đơn terminal (completed/cancelled) khóa select. */
const ORDER_TRANSITIONS_CLIENT = {
  pending: ['paid', 'processing', 'cancelled', 'payment_failed'],
  awaiting_payment: ['paid', 'processing', 'cancelled', 'payment_failed'],
  payment_failed: ['paid', 'processing', 'cancelled'],
  paid: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled', 'completed'],
  shipped: ['delivered', 'completed', 'cancelled'],
  delivered: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

function populateStatusSelect(selectEl, currentStatus) {
  if (!selectEl) return;
  const allowed = ORDER_TRANSITIONS_CLIENT[currentStatus] || [];
  const options = [currentStatus, ...allowed];
  const currentMeta = STATUS_META[currentStatus] || { label: () => currentStatus || 'N/A' };
  selectEl.innerHTML = options
    .map((value) => {
      const meta = STATUS_META[value] || { label: () => value };
      const isCurrent = value === currentStatus;
      return `<option value="${value}" ${isCurrent ? 'selected' : ''}>${isCurrent ? `● ${escapeHtml(currentMeta.label())}` : `→ ${escapeHtml(meta.label())}`}</option>`;
    })
    .join('');
  // Đơn terminal: không còn chuyển tiếp nào → khóa select, title giải thích.
  selectEl.disabled = allowed.length === 0;
  selectEl.title = allowed.length === 0
    ? t('admin.status.terminal', 'Đơn đã ở trạng thái cuối — không thể thay đổi.')
    : t('admin.status.hint', 'Chỉ hiện các bước chuyển hợp lệ theo quy trình.');
}

async function savePreviewStatus() {
  const busyKey = `preview-status-${adminState.selectedPreviewOrder?.orderId}`;
  if (busyGuard(busyKey)) return;
  const order = adminState.selectedPreviewOrder;
  const selectEl = document.getElementById('prev-status-select');
  if (!order || !selectEl) { busyRelease(busyKey); return; }
  const newStatus = selectEl.value;
  if (newStatus === order.status) { busyRelease(busyKey); return; }

  try {
    const response = await fetch(`${API_ORDERS}/${encodeURIComponent(order.orderId)}/status`, {
      method: 'PUT',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify({ status: newStatus, expectedUpdatedAt: order.updatedAt || null }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || t('admin.err.orderUpdate', 'Không thể cập nhật đơn hàng.'));
    }

    const result = await response.json().catch(() => null);
    if (result?.data?.updatedAt) order.updatedAt = result.data.updatedAt;
    order.status = newStatus;
    showAdminToast(t('admin.toast.orderUpdated', 'Đã cập nhật trạng thái đơn hàng.'));
    await loadDashboardData();
  } catch (err) {
    console.error('Order status error:', err);
    showAdminToast(err.message || t('admin.err.orderUpdate', 'Lỗi cập nhật đơn hàng.'), 'error');
  } finally { busyRelease(busyKey); }
}

function updateAdminMockupColor() {
  const mockup = document.getElementById('mockupTshirtAdmin');
  if (!mockup) return;

  const color = adminState.previewShirtColor;
  const strokeColor = isLightColorAdmin(color) ? '#dbe2ea' : 'rgba(255,255,255,0.24)';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 360">
      <defs>
        <linearGradient id="g-admin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lightenColorAdmin(color, 12)}"/>
          <stop offset="100%" stop-color="${darkenColorAdmin(color, 10)}"/>
        </linearGradient>
      </defs>
      <path d="M75 50 L30 80 L10 140 L55 150 L65 100 L65 330 L235 330 L235 100 L245 150 L290 140 L270 80 L225 50 L195 65 Q175 80 150 80 Q125 80 105 65 Z" fill="url(#g-admin)" stroke="${strokeColor}" stroke-width="1"/>
      <ellipse cx="150" cy="52" rx="30" ry="15" fill="none" stroke="${strokeColor}" stroke-width="1"/>
    </svg>
  `;
  mockup.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function getPaymentStats(orders) {
  return orders.reduce((acc, order) => {
    const total = getOrderTotal(order);
    if (order.paymentStatus === 'paid') {
      acc.paid += 1;
      acc.paidRevenue += total;
    }
    if (order.paymentStatus === 'awaiting_transfer') {
      acc.awaiting += 1;
      acc.awaitingRevenue += total;
    }
    if (order.paymentStatus === 'underpaid') acc.underpaid += 1;
    return acc;
  }, { paid: 0, awaiting: 0, underpaid: 0, paidRevenue: 0, awaitingRevenue: 0 });
}

function getOrderTotal(order) {
  return Number(order.total || ((order.price || 0) * (order.quantity || 1)));
}

function getProductName(type) {
  return {
    tshirt: 'T-shirt',
    oversize: 'Oversize',
    polo: 'Polo',
    hoodie: 'Hoodie',
  }[type] || type || t('admin.product', 'Sản phẩm');
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

function formatDate(value, withTime = true) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('vi-VN', withTime
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderEmptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-table">${escapeHtml(message)}</td></tr>`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* showAdminToast → js/toast.js (window.showAdminToast) */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function isLightColorAdmin(hex) {
  if (!hex || hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

function lightenColorAdmin(hex, percent) {
  const num = parseInt(String(hex).replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, (num >> 16) + amt);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const b = Math.min(255, (num & 0x0000FF) + amt);
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

function darkenColorAdmin(hex, percent) {
  const num = parseInt(String(hex).replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.max(0, (num >> 16) - amt);
  const g = Math.max(0, ((num >> 8) & 0x00FF) - amt);
  const b = Math.max(0, (num & 0x0000FF) - amt);
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

async function updateUserRole(userId, newRole) {
  try {
    const response = await fetch(`${API_ADMIN}/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      headers: auth.getAuthHeaders(),
      body: JSON.stringify({ role: newRole }),
    });
    const result = await response.json();
    if (!response.ok || result.success === false) {
      throw new Error(result.error || t('admin.err.role', 'Không thể cập nhật vai trò.'));
    }
    const userIndex = adminState.users.findIndex(u => u.id === userId);
    if (userIndex !== -1) adminState.users[userIndex].role = newRole;
    renderUsersList();
    showAdminToast(t('admin.toast.roleChanged', 'Đã đổi vai trò thành {role}.', { role: newRole }));
  } catch (err) {
    showAdminToast(err.message || t('admin.err.role', 'Lỗi cập nhật vai trò.'), 'error');
    renderUsersList();
  }
}

async function confirmDeleteUser(userId, username) {
  if (!confirm(t('admin.confirm.deleteUser', 'Bạn chắc chắn muốn xóa tài khoản "@{name}"?\nHành động này không thể hoàn tác.', { name: username }))) return;

  try {
    const response = await fetch(`${API_ADMIN}/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: auth.getAuthHeaders(),
    });
    const result = await response.json();
    if (!response.ok || result.success === false) {
      throw new Error(result.error || t('admin.err.deleteUser', 'Không thể xóa tài khoản.'));
    }
    adminState.users = adminState.users.filter(u => u.id !== userId);
    renderUsersList();
    showAdminToast(t('admin.toast.userDeleted', 'Đã xóa tài khoản @{name}.', { name: username }));
  } catch (err) {
    showAdminToast(err.message || t('admin.err.deleteUser', 'Lỗi xóa tài khoản.'), 'error');
  }
}

async function openUserDetailModal(userId) {
  const modal = document.getElementById('userDetailModal');
  if (!modal) return;

  setText('ud-username', t('admin.loading', 'Đang tải...'));
  setText('ud-fullname', '');
  setText('ud-email', '');
  setText('ud-role', '');
  setText('ud-provider', '');
  setText('ud-registered', '');
  setText('ud-orders-count', '');
  setText('ud-total-spend', '');
  document.getElementById('ud-recent-orders').innerHTML = `<tr><td colspan="5" class="empty-table">${escapeHtml(t('admin.loading', 'Đang tải...'))}</td></tr>`;
  modal.classList.add('open');

  try {
    const response = await fetch(`${API_ADMIN}/users/${encodeURIComponent(userId)}`, {
      headers: auth.getAuthHeaders(),
    });
    if (!response.ok) throw new Error(t('admin.err.userDetail', 'Không thể tải thông tin người dùng.'));
    const result = await response.json();
    const user = result.data;

    setText('ud-username', `@${user.username}`);
    setText('ud-fullname', user.fullName || 'N/A');
    setText('ud-email', user.email || t('admin.notUpdated', 'Chưa cập nhật'));
    setText('ud-role', user.role === 'admin' ? 'Admin' : 'User');
    setText('ud-provider', user.provider || 'local');
    setText('ud-registered', formatDate(user.createdAt, true));
    setText('ud-orders-count', user.ordersCount || 0);
    setText('ud-total-spend', formatMoney(user.totalSpend || 0));

    const recentBody = document.getElementById('ud-recent-orders');
    if (recentBody) {
      if (user.recentOrders && user.recentOrders.length) {
        recentBody.innerHTML = user.recentOrders.map(o => {
          const status = STATUS_META[o.status] || { label: () => o.status || 'N/A', cls: 'badge-muted' };
          return `<tr>
            <td>${escapeHtml(o.orderId)}</td>
            <td>${escapeHtml(o.productType || 'N/A')}</td>
            <td><span class="money-cell">${formatMoney(getOrderTotal(o))}</span></td>
            <td><span class="badge ${status.cls}">${status.label()}</span></td>
            <td>${formatDate(o.createdAt, false)}</td>
          </tr>`;
        }).join('');
      } else {
        recentBody.innerHTML = renderEmptyRow(5, t('admin.empty.orders', 'Chưa có đơn hàng.'));
      }
    }
  } catch (err) {
    showAdminToast(err.message || t('admin.err.userDetail', 'Lỗi tải thông tin người dùng.'), 'error');
    modal.classList.remove('open');
  }
}

function initUserDetailModalClose() {
  const modal = document.getElementById('userDetailModal');
  document.getElementById('userDetailModalClose')?.addEventListener('click', () => modal?.classList.remove('open'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
}

function initUserFormModal() {
  const modal = document.getElementById('userFormModal');
  const form = document.getElementById('userForm');

  document.getElementById('createUserBtn')?.addEventListener('click', () => openUserFormModal());
  document.getElementById('userFormModalClose')?.addEventListener('click', () => modal?.classList.remove('open'));
  document.getElementById('userFormCancel')?.addEventListener('click', () => modal?.classList.remove('open'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleUserFormSubmit();
  });
}

function openUserFormModal(userData = null) {
  const modal = document.getElementById('userFormModal');
  const title = document.getElementById('userFormTitle');
  const submitBtn = document.getElementById('userFormSubmit');
  const editIdField = document.getElementById('uf-edit-id');
  const usernameField = document.getElementById('uf-username');
  const passwordGroup = document.getElementById('uf-password-group');
  const passwordField = document.getElementById('uf-password');
  const fullnameField = document.getElementById('uf-fullname');
  const emailField = document.getElementById('uf-email');
  const roleField = document.getElementById('uf-role');

  if (userData) {
    title.textContent = t('admin.editAccount', 'Chỉnh sửa tài khoản');
    submitBtn.textContent = t('admin.form.submitSave', 'Lưu thay đổi');
    editIdField.value = userData.id || '';
    usernameField.value = userData.username || '';
    usernameField.disabled = true;
    passwordGroup.style.display = 'none';
    passwordField.removeAttribute('required');
    fullnameField.value = userData.fullName || '';
    emailField.value = userData.email || '';
    roleField.value = userData.role || 'user';
  } else {
    title.textContent = t('admin.createAccount', 'Tạo tài khoản mới');
    submitBtn.textContent = t('admin.actions.create', 'Tạo tài khoản');
    editIdField.value = '';
    usernameField.value = '';
    usernameField.disabled = false;
    passwordGroup.style.display = '';
    passwordField.setAttribute('required', '');
    fullnameField.value = '';
    emailField.value = '';
    roleField.value = 'user';
  }

  modal?.classList.add('open');
  if (!userData) usernameField.focus();
}

async function handleUserFormSubmit() {
  const editId = document.getElementById('uf-edit-id').value;
  const username = document.getElementById('uf-username').value.trim();
  const password = document.getElementById('uf-password').value;
  const fullName = document.getElementById('uf-fullname').value.trim();
  const email = document.getElementById('uf-email').value.trim();
  const role = document.getElementById('uf-role').value;

  if (editId) {
    try {
      const response = await fetch(`${API_ADMIN}/users/${encodeURIComponent(editId)}`, {
        method: 'PUT',
        headers: auth.getAuthHeaders(),
        body: JSON.stringify({ fullName, email, role }),
      });
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || t('admin.err.accountUpdate', 'Không thể cập nhật.'));

      const idx = adminState.users.findIndex(u => u.id === editId);
      if (idx !== -1) {
        adminState.users[idx].fullName = fullName;
        adminState.users[idx].email = email;
        adminState.users[idx].role = role;
      }
      renderUsersList();
      document.getElementById('userFormModal')?.classList.remove('open');
      showAdminToast(t('admin.toast.accountUpdated', 'Đã cập nhật tài khoản.'));
    } catch (err) {
      showAdminToast(err.message || t('admin.err.accountUpdate', 'Lỗi cập nhật tài khoản.'), 'error');
    }
  } else {
    if (!username || !password || !fullName) {
      showAdminToast(t('admin.fillRequired', 'Vui lòng điền đầy đủ thông tin bắt buộc.'), 'error');
      return;
    }
    try {
      const response = await fetch(`${API_ADMIN}/users`, {
        method: 'POST',
        headers: auth.getAuthHeaders(),
        body: JSON.stringify({ username, password, fullName, email, role }),
      });
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || t('admin.err.accountCreate', 'Không thể tạo tài khoản.'));

      adminState.users.push(result.data);
      renderUsersList();
      document.getElementById('userFormModal')?.classList.remove('open');
      showAdminToast(t('admin.toast.accountCreated', 'Đã tạo tài khoản @{name}.', { name: username }));
    } catch (err) {
      showAdminToast(err.message || t('admin.err.accountCreate', 'Lỗi tạo tài khoản.'), 'error');
    }
  }
}

i18n.onChange(() => renderDashboard());