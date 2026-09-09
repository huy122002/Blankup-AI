// frontend/js/pricing.js — Phase 1H/I/J
const API_BASE = window.location.origin + '/api';
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=String(s??''); return d.innerHTML; }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
function formatMoney(a){ return Number(a||0).toLocaleString('vi-VN')+'đ'; }

let pricingPlans = [];
let pricingVouchers = [];
let pricingSelectedVoucher = '';
let pricingQuoteCache = null;
let pricingSelectedPlan = null;
let pricingPollTimer = null;
let pricingPollAttempts = 0;
let pricingLastPurchaseId = null;
// Idempotency key lifecycle: one stable key per (plan, voucher) selection.
// Generated when the modal session starts or the selection changes; every
// retry/re-click reuses the SAME key so the server replays instead of
// duplicating. Server/database remains authoritative.
let pricingIdemKey = null;
function newPricingIdemKey(planId) {
  pricingIdemKey = 'pricing-' + String(planId || 'na') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return pricingIdemKey;
}

document.addEventListener('DOMContentLoaded', () => {
  updateAuthLinks();
  loadPricingPlans();
  loadPricingVouchers();
  initPricingModal();
});

function updateAuthLinks(){
  const isLoggedIn = typeof auth !== 'undefined' && auth.isLoggedIn();
  const loginLink = document.getElementById('pricingLoginLink');
  const accountLink = document.getElementById('pricingAccountLink');
  if (isLoggedIn) {
    if (loginLink) loginLink.style.display='none';
    if (accountLink) accountLink.style.display='';
  } else {
    if (loginLink) loginLink.style.display='';
    if (accountLink) accountLink.style.display='none';
  }
}

async function loadPricingPlans(){
  const grid = document.getElementById('pricingGrid');
  const errEl = document.getElementById('pricingError');
  try{
    const resp = await fetch(`${API_BASE}/ai-plans`);
    const data = await resp.json();
    if(!resp.ok || !data.success) throw new Error(data.error||'Không tải được gói');
    const plans = (data.data||[]).filter(p=>p.isActive);
    plans.sort((a,b)=> (Number(a.planRank||0)-Number(b.planRank||0)) || (Number(a.priceVnd)-Number(b.priceVnd)));
    pricingPlans = plans;
    if(plans.length===0){ grid.innerHTML='<div class="pricing-loading">Chưa có gói khả dụng.</div>'; return; }
    const maxHigh = Math.max(...plans.map(p=>Number(p.highCredits||0)));
    grid.innerHTML = plans.map(plan=>{
      const isFeatured = Number(plan.highCredits)===maxHigh && plan.isPaid;
      const price = formatMoney(plan.priceVnd);
      const credits = [];
      if(Number(plan.highCredits)>0) credits.push(`<span class="pricing-credit-pill high">${plan.highCredits} High</span>`);
      if(Number(plan.bonusLowCredits)>0) credits.push(`<span class="pricing-credit-pill low">+${plan.bonusLowCredits} Low</span>`);
      if(Number(plan.dailyFreeLowCredits)>0) credits.push(`<span class="pricing-credit-pill daily">${plan.dailyFreeLowCredits}/ngày</span>`);
      const features = [
        `Chất lượng ${escapeHtml(plan.outputQuality||'high')}`,
        `${plan.highCredits} High credits` + (plan.bonusLowCredits? ` + ${plan.bonusLowCredits} Low` : ''),
        plan.dailyFreeLowCredits ? `${plan.dailyFreeLowCredits} lượt miễn phí/ngày` : 'Không giới hạn theo gói',
        plan.isComebackOffer ? `Comeback ${plan.comebackWindowDays||7} ngày` : (plan.isPaid ? 'Gói trả phí' : 'Miễn phí'),
      ];
      return `<div class="pricing-card ${isFeatured?'featured':''}">
        <div class="pricing-card-head">
          <div class="pricing-card-name">${escapeHtml(plan.name)}</div>
          <div class="pricing-card-desc">${escapeHtml(plan.description||'')}</div>
        </div>
        <div class="pricing-card-price"><span class="amount">${price}</span><span class="unit">/gói</span></div>
        <div style="font-size:0.72rem; color:var(--text-muted);">code: ${escapeHtml(plan.code)} · rank ${plan.planRank}</div>
        <div class="pricing-card-credits">${credits.join('')}</div>
        <ul class="pricing-features">${features.map(f=>`<li>${escapeHtml(f)}</li>`).join('')}</ul>
        <div class="pricing-cta"><button class="btn ${isFeatured?'btn-primary':'btn-secondary'} pricing-buy-btn" data-plan-id="${escapeAttr(plan.id)}">${plan.isPaid?'Mua gói':'Dùng miễn phí'}</button></div>
        <div class="pricing-card-meta">${plan.isActive?'Đang bán':'Tạm ngưng'}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.pricing-buy-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const planId = btn.dataset.planId;
        const plan = pricingPlans.find(p=>p.id===planId);
        if(!plan) return;
        if(!plan.isPaid || Number(plan.priceVnd)<=0){
          showToast('Gói này miễn phí — bạn đã có thể dùng AI Studio ngay.', 'info');
          window.location.href='studio.html';
          return;
        }
        handleBuy(plan);
      });
    });
    renderCompare(plans);
  } catch(e){
    grid.innerHTML='';
    errEl.style.display='block';
    errEl.textContent = e.message||'Lỗi tải gói';
  }
}

function renderCompare(plans){
  const head = document.getElementById('compareHead');
  const body = document.getElementById('compareBody');
  if(!head||!body) return;
  head.innerHTML = plans.map(p=> `<th>${escapeHtml(p.name)}</th>`).join('');
  const rows = [
    { label:'Giá', get:p=> formatMoney(p.priceVnd) },
    { label:'High credits', get:p=> String(p.highCredits||0) },
    { label:'Bonus Low', get:p=> String(p.bonusLowCredits||0) },
    { label:'Daily free', get:p=> String(p.dailyFreeLowCredits||0) },
    { label:'Chất lượng', get:p=> escapeHtml(p.outputQuality||'low') },
  ];
  body.innerHTML = rows.map(r=> `<tr><td><strong>${escapeHtml(r.label)}</strong></td>${plans.map(p=> `<td>${r.get(p)}</td>`).join('')}</tr>`).join('');
}

async function loadPricingVouchers(){
  try{
    if(typeof auth === 'undefined' || !auth.isLoggedIn()) return;
    const resp = await fetch(`${API_BASE}/ai-plans/vouchers/available`, { headers: auth.getAuthHeaders() });
    if(!resp.ok) return;
    const data = await resp.json();
    if(data.success) pricingVouchers = data.data||[];
  } catch{}
}

function handleBuy(plan){
  pricingSelectedPlan = plan;
  pricingSelectedVoucher = '';
  pricingQuoteCache = null;
  newPricingIdemKey(plan && plan.id);
  if(typeof auth === 'undefined' || !auth.isLoggedIn()){
    sessionStorage.setItem('blankup_pending_plan', plan.id);
    showToast('Vui lòng đăng nhập để mua gói.', 'warning');
    window.location.href = 'login.html?redirect=' + encodeURIComponent('pricing.html');
    return;
  }
  openPricingModal(plan);
}

function openPricingModal(plan){
  const modal = document.getElementById('pricingPurchaseModal');
  if(!modal) return;
  document.getElementById('pricingPurchaseTitle').textContent = `Mua gói ${plan.name}`;
  // reset
  document.getElementById('pricingVoucherInput').value='';
  document.getElementById('pricingVoucherStatus').textContent='';
  document.getElementById('pricingQuotePreview').style.display='none';
  document.getElementById('pricingBreakdown').style.display='none';
  document.getElementById('pricingQrSection').style.display='none';
  document.getElementById('pricingTransferSection').style.display='none';
  document.getElementById('pricingPaymentBox').style.display='none';
  document.getElementById('pricingPostActions').style.display='none';
  const confirmBtn = document.getElementById('pricingConfirmBtn');
  confirmBtn.style.display='none';
  // render voucher list
  const list = document.getElementById('pricingVoucherList');
  list.innerHTML = `<label style="display:flex; gap:8px; align-items:center; font-size:0.88rem;"><input type="radio" name="pricingVoucherChoice" value="" checked> Không dùng voucher</label>`;
  pricingVouchers.forEach(v=>{
    const isExpired = v.expiresAt && new Date(v.expiresAt) < new Date();
    const disabled = v.status!=='active' || isExpired;
    list.innerHTML += `<label style="display:flex; gap:8px; align-items:center; font-size:0.88rem; opacity:${disabled?0.6:1}"><input type="radio" name="pricingVoucherChoice" value="${escapeAttr(v.code)}" ${disabled?'disabled':''}> ${escapeHtml(v.code)} — ${escapeHtml(v.title||'')} ${v.discountType==='percent'? v.discountValue+'%' : formatMoney(v.discountValue)}</label>`;
  });
  list.querySelectorAll('input[name="pricingVoucherChoice"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const val = list.querySelector('input[name="pricingVoucherChoice"]:checked')?.value || '';
      document.getElementById('pricingVoucherInput').value = val;
      pricingSelectedVoucher = val;
      if (pricingSelectedPlan) newPricingIdemKey(pricingSelectedPlan.id);
      if(plan) triggerPricingQuote(plan.id, val);
    });
  });
  modal.style.display='flex';
  // auto quote without voucher to show price
  triggerPricingQuote(plan.id, '');
}

async function triggerPricingQuote(planId, voucherCode){
  const statusEl = document.getElementById('pricingVoucherStatus');
  const preview = document.getElementById('pricingQuotePreview');
  statusEl.textContent='Đang kiểm tra...'; statusEl.style.color='var(--text-muted)';
  try{
    const resp = await fetch(`${API_BASE}/ai-plans/quote`, { method:'POST', headers:{'Content-Type':'application/json', ...auth.getAuthHeaders()}, body: JSON.stringify({ planId, voucherCode: voucherCode||undefined }) });
    const data = await resp.json();
    if(!resp.ok || !data.success){
      statusEl.textContent = data.error||'Voucher không hợp lệ';
      statusEl.style.color='#dc2626';
      preview.style.display='none';
      pricingQuoteCache=null;
      updatePricingBreakdown(null);
      return;
    }
    const d = data.data;
    pricingQuoteCache = d;
    pricingSelectedVoucher = voucherCode||'';
    if(voucherCode && d.discountAmount>0){ statusEl.textContent=`Voucher hợp lệ: giảm ${formatMoney(d.discountAmount)}`; statusEl.style.color='#16a34a'; }
    else if(voucherCode) { statusEl.textContent='Voucher hợp lệ'; statusEl.style.color='#16a34a'; }
    else { statusEl.textContent='Không dùng voucher'; statusEl.style.color='var(--text-muted)'; }
    preview.style.display='block';
    document.getElementById('pricingQuotePrice').textContent=formatMoney(d.priceVnd);
    document.getElementById('pricingQuoteDiscount').textContent = d.discountAmount>0? '-'+formatMoney(d.discountAmount):'0đ';
    document.getElementById('pricingQuoteFinal').textContent=formatMoney(d.finalAmount);
    document.getElementById('pricingQuoteCredits').textContent=`${d.highCredits} High + ${d.lowCredits} Low`;
    updatePricingBreakdown(d);
    const confirmBtn = document.getElementById('pricingConfirmBtn');
    confirmBtn.style.display='block';
    confirmBtn.textContent=`Thanh toán ${formatMoney(d.finalAmount)} — Tạo QR`;
  } catch(e){
    statusEl.textContent=e.message||'Lỗi';
    statusEl.style.color='#dc2626';
    preview.style.display='none';
  }
}

function updatePricingBreakdown(d){
  const box = document.getElementById('pricingBreakdown');
  if(!d){ box.style.display='none'; return; }
  box.style.display='block';
  document.getElementById('pricingBreakdownName').textContent=d.planName;
  document.getElementById('pricingBreakdownPrice').textContent=formatMoney(d.priceVnd);
  const row = document.getElementById('pricingBreakdownDiscountRow');
  if(d.discountAmount>0){ row.style.display='flex'; document.getElementById('pricingBreakdownVoucher').textContent=d.voucher?`(${d.voucher.code})`:''; document.getElementById('pricingBreakdownDiscount').textContent='-'+formatMoney(d.discountAmount); }
  else row.style.display='none';
  document.getElementById('pricingBreakdownFinal').textContent=formatMoney(d.finalAmount);
  document.getElementById('pricingBreakdownCredits').textContent=`${d.highCredits} High + ${d.lowCredits} Low`;
}

function initPricingModal(){
  document.getElementById('pricingPurchaseClose')?.addEventListener('click', ()=>{ document.getElementById('pricingPurchaseModal').style.display='none'; stopPricingPoll(); });
  document.getElementById('pricingPurchaseModal')?.addEventListener('click', (e)=>{ if(e.target.id==='pricingPurchaseModal'){ e.target.style.display='none'; stopPricingPoll(); }});
  document.getElementById('pricingVoucherApply')?.addEventListener('click', ()=>{
    const code = (document.getElementById('pricingVoucherInput').value||'').trim().toUpperCase();
    pricingSelectedVoucher = code;
    if (pricingSelectedPlan) newPricingIdemKey(pricingSelectedPlan.id);
    // sync radio
    const radios = document.querySelectorAll('input[name="pricingVoucherChoice"]');
    let matched=false; radios.forEach(r=>{ if(r.value===code){ r.checked=true; matched=true; }});
    if(!matched && code) radios.forEach(r=>r.checked=false);
    if(pricingSelectedPlan) triggerPricingQuote(pricingSelectedPlan.id, code);
  });
  document.getElementById('pricingVoucherClear')?.addEventListener('click', ()=>{
    document.getElementById('pricingVoucherInput').value=''; pricingSelectedVoucher='';
    if (pricingSelectedPlan) newPricingIdemKey(pricingSelectedPlan.id);
    document.querySelectorAll('input[name="pricingVoucherChoice"]').forEach(r=> r.value==='' ? r.checked=true : r.checked=false);
    if(pricingSelectedPlan) triggerPricingQuote(pricingSelectedPlan.id, '');
  });
  document.getElementById('pricingConfirmBtn')?.addEventListener('click', async ()=>{
    const btn = document.getElementById('pricingConfirmBtn');
    if(!pricingSelectedPlan || !pricingQuoteCache) return;
    btn.disabled=true; btn.textContent='Đang tạo đơn...';
    try{
      const planId = pricingSelectedPlan.id;
      const voucherCode = pricingSelectedVoucher;
      // Reuse the session key so timeouts/retries replay instead of duplicating.
      const idempotencyKey = pricingIdemKey || newPricingIdemKey(planId);
      const resp = await fetch(`${API_BASE}/ai-plans/purchase`, { method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey, ...auth.getAuthHeaders()}, body: JSON.stringify({ planId, voucherCode: voucherCode||undefined }) });
      const data = await resp.json();
      if(!resp.ok || !data.success) throw new Error(data.error||'Không tạo được đơn');
      // show QR with backend finalAmount
      updatePricingBreakdown({ planName:data.planName, priceVnd:data.priceVnd, discountAmount:data.discountAmount, finalAmount:data.finalAmount, highCredits:data.highCreditsAdded, lowCredits:data.lowCreditsAdded, voucher: data.voucherCode? {code:data.voucherCode}:null });
      const qrUrl = `https://img.vietqr.io/image/${data.bankInfo.bankId}-${data.bankInfo.accountNumber}-compact2.png?amount=${data.finalAmount}&addInfo=${encodeURIComponent(data.transferContent)}&accountName=${encodeURIComponent(data.bankInfo.accountName)}`;
      document.getElementById('pricingQrImg').src=qrUrl;
      document.getElementById('pricingQrSection').style.display='block';
      document.getElementById('pricingTransferContent').textContent=data.transferContent;
      document.getElementById('pricingTransferSection').style.display='block';
      document.getElementById('pricingPaymentBox').style.display='block';
      document.getElementById('pricingPaymentText').textContent='Chờ thanh toán';
      document.getElementById('pricingPaymentText').style.color='#d97706';
      document.getElementById('pricingPaymentHint').textContent='Vui lòng chuyển khoản đúng số tiền và nội dung.';
      document.getElementById('pricingPollingInfo').textContent='Đang kiểm tra mỗi 5s...';
      document.getElementById('pricingPostActions').style.display='flex';
      btn.style.display='none';
      pricingLastPurchaseId = data.purchaseId;
      startPricingPoll(data.purchaseId);
    } catch(e){ showToast(e.message||'Lỗi', 'error'); btn.disabled=false; btn.textContent='Tạo đơn & lấy QR'; }
  });
  document.getElementById('pricingCheckAgainBtn')?.addEventListener('click', async ()=>{
    if(!pricingLastPurchaseId) return;
    document.getElementById('pricingPollingInfo').textContent='Đang kiểm tra...';
    try{
      const resp = await fetch(`${API_BASE}/ai-plans/purchase/${pricingLastPurchaseId}/status`, { headers: auth.getAuthHeaders() });
      const data = await resp.json();
      if(data.paymentStatus==='paid'){ document.getElementById('pricingPaymentText').textContent='Thanh toán thành công!'; document.getElementById('pricingPaymentText').style.color='#16a34a'; showToast('Thanh toán thành công!', 'success'); stopPricingPoll(); }
      else document.getElementById('pricingPollingInfo').textContent=`Trạng thái: ${data.paymentStatus}`;
    } catch(e){ showToast('Không thể kiểm tra', 'error'); }
  });
  document.getElementById('pricingDoneBtn')?.addEventListener('click', ()=>{ document.getElementById('pricingPurchaseModal').style.display='none'; stopPricingPoll(); });
}

function startPricingPoll(purchaseId){
  stopPricingPoll(); pricingPollAttempts=0;
  pricingPollTimer = setInterval(async ()=>{
    pricingPollAttempts++;
    try{
      const resp = await fetch(`${API_BASE}/ai-plans/purchase/${purchaseId}/status`, { headers: auth.getAuthHeaders() });
      const data = await resp.json();
      if(data.paymentStatus==='paid'){
        stopPricingPoll();
        document.getElementById('pricingPaymentText').textContent='Thanh toán thành công!';
        document.getElementById('pricingPaymentText').style.color='#16a34a';
        document.getElementById('pricingPaymentHint').textContent='Credit đã được cộng.';
        document.getElementById('pricingPollingInfo').textContent='';
        showToast('Thanh toán thành công! Credit đã cộng.', 'success');
      } else if(data.paymentStatus==='failed'){
        stopPricingPoll();
        document.getElementById('pricingPaymentText').textContent='Thanh toán thất bại';
        document.getElementById('pricingPaymentText').style.color='#dc2626';
      } else {
        document.getElementById('pricingPollingInfo').textContent=`Đang chờ... (${pricingPollAttempts*5}s)`;
        if(pricingPollAttempts>=60){ stopPricingPoll(); document.getElementById('pricingPaymentText').textContent='Thanh toán vẫn đang chờ xác nhận'; document.getElementById('pricingPollingInfo').textContent='Dừng tự động sau 5 phút. Bấm Kiểm tra lại.'; }
      }
    } catch{}
  },5000);
}
function stopPricingPoll(){ if(pricingPollTimer){ clearInterval(pricingPollTimer); pricingPollTimer=null; } }

// Deep link pending plan from pricing
window.addEventListener('load', ()=>{
  const pending = sessionStorage.getItem('blankup_pending_plan');
  // pricing page doesn't need, account page will handle separately
});
