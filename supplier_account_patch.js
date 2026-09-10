(() => {
  const MARKER = '[SUPPLIER_ACCOUNT_V1:';

  function parseAccount(notesValue) {
    const text = String(notesValue || '');
    const start = text.indexOf(MARKER);
    if (start < 0) return null;
    const end = text.indexOf(']', start + MARKER.length);
    if (end < 0) return null;
    try {
      return JSON.parse(decodeURIComponent(text.slice(start + MARKER.length, end)));
    } catch (_) {
      return null;
    }
  }

  function formatMoney(value, currency = 'USD') {
    const amount = Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return currency === 'USD' ? `$ ${amount}` : `${amount} ${currency}`;
  }

  function formatDate(value) {
    if (!value) return '-';
    const parts = String(value).slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  function safe(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  const originalRenderAll = window.renderAll;
  if (typeof originalRenderAll === 'function') {
    window.renderAll = function patchedRenderAll() {
      originalRenderAll();
      const suppliers = (window.data && window.data.suppliers) || [];
      const holder = document.getElementById('supplierList');
      if (!holder) return;

      const hasForeign = suppliers.some(s => parseAccount(s.notes));
      if (!hasForeign) return;

      holder.innerHTML = suppliers.map(x => {
        const account = parseAccount(x.notes);
        const balance = account
          ? formatMoney(x.balance, account.currency || 'USD')
          : `${window.money ? window.money(x.balance) : Number(x.balance || 0).toFixed(2)} د.أ`;
        const noteText = account
          ? `حساب مورد بعملة ${safe(account.currency || 'USD')} • آخر كشف مستورد حتى 26/08/2026`
          : (x.notes ? safe(x.notes) : '');
        return `
          <div class="item">
            <div class="top">
              <b>${safe(x.name)}</b>
              <b>${balance}</b>
            </div>
            <div class="small">${safe(x.phone || 'بدون هاتف')}</div>
            ${noteText ? `<div class="small">${noteText}</div>` : ''}
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              ${account ? '' : `<button class="btn secondary" onclick="addSupplierPayment('${x.id}')">تسجيل دفعة</button>`}
              <button class="btn secondary" onclick="supplierStatement('${x.id}')">كشف حساب</button>
              <button class="btn secondary" onclick="deleteSupplier('${x.id}')">حذف</button>
            </div>
          </div>`;
      }).join('') || '<div class="muted">لا يوجد موردون بعد.</div>';
    };
  }

  const originalSupplierStatement = window.supplierStatement;
  window.supplierStatement = function patchedSupplierStatement(id) {
    const suppliers = (window.data && window.data.suppliers) || [];
    const supplier = suppliers.find(x => String(x.id) === String(id));
    const account = supplier && parseAccount(supplier.notes);
    if (!supplier || !account) {
      return typeof originalSupplierStatement === 'function'
        ? originalSupplierStatement(id)
        : undefined;
    }

    const entriesHtml = (account.entries || []).slice().reverse().map(entry => {
      const isPurchase = entry.type === 'purchase';
      const isPayment = entry.type === 'payment';
      const title = entry.type === 'opening' ? 'رصيد افتتاحي' : isPurchase ? 'مشتريات من المورد' : 'دفعة للمورد';
      const sign = isPurchase ? '+' : isPayment ? '-' : '';
      const details = [
        entry.ref ? `المرجع: ${safe(entry.ref)}` : '',
        entry.container ? `الكونتينر: ${safe(entry.container)}` : '',
        entry.bales ? `عدد البالات: ${Number(entry.bales).toLocaleString('en-US')}` : ''
      ].filter(Boolean).join(' • ');
      return `
        <div class="item">
          <div class="top">
            <b>${title}</b>
            <b>${sign}${formatMoney(entry.amount, account.currency)}</b>
          </div>
          <div class="small" style="margin-top:7px">التاريخ: ${formatDate(entry.date)}</div>
          ${details ? `<div class="small">${details}</div>` : ''}
          <div style="margin-top:7px">الرصيد بعد الحركة: <b>${formatMoney(entry.balance, account.currency)}</b></div>
        </div>`;
    }).join('');

    const holder = document.getElementById('supplierList');
    if (!holder) return;
    holder.innerHTML = `
      <div class="card">
        <h2>كشف حساب المورد: ${safe(supplier.name)}</h2>
        <div class="grid" style="margin:15px 0">
          <div class="card"><div class="small">الرصيد الحالي المستحق</div><div class="metric">${formatMoney(account.currentBalance, account.currency)}</div></div>
          <div class="card"><div class="small">الرصيد الافتتاحي</div><div class="metric">${formatMoney(account.openingBalance, account.currency)}</div></div>
          <div class="card"><div class="small">إجمالي المشتريات</div><div class="metric">${formatMoney(account.totalPurchases, account.currency)}</div></div>
          <div class="card"><div class="small">إجمالي الدفعات</div><div class="metric">${formatMoney(account.totalPayments, account.currency)}</div></div>
        </div>
        <div class="notice">المبلغ المستحق حسب كشف NOVATEX: ${formatMoney(account.currentBalance, account.currency)} • ما يعادله في الكشف: AED ${Number(account.dueAed || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
        <h3>حركة الحساب</h3>
        <div class="list">${entriesHtml}</div>
        <button class="btn secondary wide" onclick="renderAll()" style="margin-top:15px">رجوع للموردين</button>
      </div>`;
  };

  if (typeof window.renderAll === 'function' && window.data) window.renderAll();
})();
