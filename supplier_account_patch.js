(() => {
  const MARKER = '[SUPPLIER_ACCOUNT_V1:';

  function suppliersData() {
    try { return (typeof data !== 'undefined' && Array.isArray(data.suppliers)) ? data.suppliers : []; }
    catch (_) { return []; }
  }

  function parseAccount(notesValue) {
    const text = String(notesValue || '');
    const start = text.indexOf(MARKER);
    if (start < 0) return null;
    const end = text.indexOf(']', start + MARKER.length);
    if (end < 0) return null;
    try { return JSON.parse(decodeURIComponent(text.slice(start + MARKER.length, end))); }
    catch (_) { return null; }
  }

  function moneyUsd(v) {
    return '$ ' + Number(v || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function fmtDate(v) {
    if (!v) return '-';
    const p = String(v).slice(0,10).split('-');
    return p.length === 3 ? p.reverse().join('/') : String(v);
  }

  function safe(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function today() { return new Date().toISOString().slice(0,10); }

  async function saveEntry(id) {
    const type = document.getElementById('saType')?.value || '';
    const amount = Number(document.getElementById('saAmount')?.value || 0);
    if (!(amount > 0)) return alert('أدخل مبلغ صحيح');

    const body = {
      type,
      amount,
      date: document.getElementById('saDate')?.value || today(),
      ref: document.getElementById('saRef')?.value || '',
      container: document.getElementById('saContainer')?.value || '',
      bales: Number(document.getElementById('saBales')?.value || 0),
      notes: document.getElementById('saNotes')?.value || ''
    };

    try {
      await api('/api/supplier-account/' + encodeURIComponent(id) + '/entries', {
        method: 'POST', body: JSON.stringify(body)
      });
      await refresh();
      window.supplierStatement(id);
    } catch (e) { alert(e.message); }
  }
  window.saveSupplierAccountEntry = saveEntry;

  const originalRenderAll = window.renderAll;
  if (typeof originalRenderAll === 'function') {
    window.renderAll = function() {
      originalRenderAll();
      const suppliers = suppliersData();
      const holder = document.getElementById('supplierList');
      if (!holder || !suppliers.some(s => parseAccount(s.notes))) return;

      holder.innerHTML = suppliers.map(s => {
        const a = parseAccount(s.notes);
        return `<div class="item">
          <div class="top"><b>${safe(s.name)}</b><b>${a ? moneyUsd(s.balance) : money(s.balance)+' د.أ'}</b></div>
          <div class="small">${safe(s.phone || 'بدون هاتف')}</div>
          ${a ? '<div class="small">حساب المورد بالدولار</div>' : (s.notes ? `<div class="small">${safe(s.notes)}</div>` : '')}
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            ${a ? '' : `<button class="btn secondary" onclick="addSupplierPayment('${s.id}')">تسجيل دفعة</button>`}
            <button class="btn secondary" onclick="supplierStatement('${s.id}')">كشف حساب</button>
          </div>
        </div>`;
      }).join('');
    };
  }

  const originalSupplierStatement = window.supplierStatement;
  window.supplierStatement = function(id) {
    const supplier = suppliersData().find(x => String(x.id) === String(id));
    const account = supplier && parseAccount(supplier.notes);
    if (!supplier || !account) return originalSupplierStatement ? originalSupplierStatement(id) : undefined;

    const rows = (account.entries || []).map(e => {
      const debit = e.type === 'purchase' ? e.amount : '';
      const credit = e.type === 'payment' ? e.amount : '';
      const desc = e.type === 'opening' ? 'رصيد افتتاحي' : e.type === 'purchase' ? 'وارد / مشتريات' : 'دفعة للمورد';
      const detail = [e.ref && ('مرجع '+safe(e.ref)), e.container && ('كونتينر '+safe(e.container)), e.bales && (Number(e.bales)+' بالة'), e.notes && safe(e.notes)].filter(Boolean).join(' • ');
      return `<tr>
        <td>${fmtDate(e.date)}</td>
        <td>${desc}${detail ? `<div class="small">${detail}</div>` : ''}</td>
        <td>${debit === '' ? '-' : moneyUsd(debit)}</td>
        <td>${credit === '' ? '-' : moneyUsd(credit)}</td>
        <td><b>${moneyUsd(e.balance)}</b></td>
      </tr>`;
    }).join('');

    const holder = document.getElementById('supplierList');
    holder.innerHTML = `<div class="card">
      <h2>كشف حساب المورد: ${safe(supplier.name)}</h2>
      <div class="grid" style="margin:15px 0">
        <div class="card"><div class="small">الرصيد الحالي</div><div class="metric">${moneyUsd(account.currentBalance)}</div></div>
        <div class="card"><div class="small">إجمالي الوارد</div><div class="metric">${moneyUsd(account.totalPurchases)}</div></div>
        <div class="card"><div class="small">إجمالي الدفعات</div><div class="metric">${moneyUsd(account.totalPayments)}</div></div>
      </div>

      <div class="card" style="margin:12px 0">
        <h3>إضافة حركة جديدة</h3>
        <div class="row">
          <div><label>نوع الحركة</label><select id="saType"><option value="purchase">وارد / مشتريات (+)</option><option value="payment">دفعة للمورد (-)</option></select></div>
          <div><label>المبلغ USD</label><input id="saAmount" type="number" step="0.01"></div>
        </div>
        <div class="row">
          <div><label>التاريخ</label><input id="saDate" type="date" value="${today()}"></div>
          <div><label>المرجع</label><input id="saRef" placeholder="مثال V4"></div>
        </div>
        <div class="row">
          <div><label>رقم الكونتينر</label><input id="saContainer"></div>
          <div><label>عدد البالات</label><input id="saBales" type="number" step="1"></div>
        </div>
        <label>ملاحظات</label><input id="saNotes">
        <button class="btn primary wide" onclick="saveSupplierAccountEntry('${supplier.id}')">حفظ الحركة</button>
      </div>

      <div style="overflow:auto" class="card">
        <table><thead><tr><th>التاريخ</th><th>البيان</th><th>وارد</th><th>دفعة</th><th>الرصيد</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
      <button class="btn secondary wide" onclick="renderAll()" style="margin-top:15px">رجوع للموردين</button>
    </div>`;
  };

  if (typeof window.renderAll === 'function') window.renderAll();
})();
