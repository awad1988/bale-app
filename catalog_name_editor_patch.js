(() => {
  const state = { rows: [], loaded: false };
  const el = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  async function apiCall(url, opt) {
    const r = await fetch(url, {
      cache: 'no-store',
      ...(opt || {}),
      headers: { 'Content-Type': 'application/json', ...((opt && opt.headers) || {}) }
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'تعذر تنفيذ العملية');
    return b;
  }

  function install() {
    if (el('catalogNameEditorSection')) return;
    const wrap = document.querySelector('.wrap');
    if (!wrap) return;

    const sec = document.createElement('section');
    sec.id = 'catalogNameEditorSection';
    sec.innerHTML = `
      <div class="section-title"><h2>تعديل أسماء الأصناف</h2><span class="pill ok">عربي فقط</span></div>
      <div class="card">
        <div class="small">يعرض كل الأسماء الإنجليزية الموجودة في الشحنتين، بدون تكرار. يمكنك تنزيل كشف وكتابة الاسم العربي الصحيح ثم إرساله لي. التعديل يشمل المتوفر والمباع والمرتجع، ولا يغيّر الكمية أو السعر أو الربط.</div>
        <button id="catalogNamesLoad" class="btn secondary wide" style="margin-top:10px">تحميل جدول الأصناف</button>
        <button id="catalogNamesDownload" class="btn secondary wide hidden" style="margin-top:10px">تنزيل كشف الأسماء</button>
      </div>
      <div id="catalogNamesStatus" style="margin-top:10px"></div>
      <div id="catalogNamesList" class="list" style="margin-top:12px"></div>
      <button id="catalogNamesPreview" class="btn primary wide hidden" style="margin-top:12px">فحص التعديلات قبل الحفظ</button>
      <div id="catalogNamesPreviewBox" style="margin-top:12px"></div>
      <button id="catalogNamesApply" class="btn primary wide hidden" style="margin-top:12px">حفظ التعديلات الآن</button>`;
    wrap.appendChild(sec);

    el('catalogNamesLoad').onclick = loadRows;
    el('catalogNamesDownload').onclick = downloadSheet;
    el('catalogNamesPreview').onclick = preview;
    el('catalogNamesApply').onclick = apply;
  }

  async function loadRows() {
    const status = el('catalogNamesStatus');
    status.textContent = 'جاري تحميل الأصناف...';
    try {
      const r = await apiCall('/api/catalog-name-editor');
      state.rows = r.rows || [];
      state.loaded = true;
      status.textContent = `تم تحميل ${state.rows.length} اسم إنجليزي من ${r.shipmentCount || 0} شحنة.`;
      renderRows();
      el('catalogNamesPreview').classList.remove('hidden');
      el('catalogNamesDownload').classList.remove('hidden');
    } catch (e) {
      status.textContent = e.message;
    }
  }

  function csvCell(v) {
    return '"' + String(v ?? '').replace(/"/g, '""') + '"';
  }

  function downloadSheet() {
    if (!state.rows.length) return alert('حمّل جدول الأصناف أولاً.');
    const header = ['#','English Name','Arabic Current','Arabic Correct','Total Bales','Sold Bales'];
    const lines = [header.map(csvCell).join(',')];
    state.rows.forEach((r, i) => {
      lines.push([
        i + 1,
        r.name_en || '',
        r.current_name_ar || '',
        '',
        Number(r.total || 0),
        Number(r.sold || 0)
      ].map(csvCell).join(','));
    });
    const csv = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bale-catalog-arabic-names.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderRows() {
    const host = el('catalogNamesList');
    host.innerHTML = state.rows.map((r, i) => `
      <div class="card" data-name-row="${i}">
        <div><b>${i + 1}. ${esc(r.name_en)}</b></div>
        <div class="small" style="margin-top:5px">العربي الحالي: ${esc(r.current_name_ar || '-')}</div>
        <div class="small">عدد البالات: ${Number(r.total || 0)} • المباعة: ${Number(r.sold || 0)}</div>
        <label style="margin-top:10px">الاسم العربي الصحيح</label>
        <input class="catalogArabicName" data-index="${i}" placeholder="اكتب الاسم العربي الصحيح" value="${esc(r.current_name_ar || '')}">
      </div>`).join('') || '<div class="muted">لا توجد أصناف.</div>';
  }

  function collectUpdates() {
    return Array.from(document.querySelectorAll('.catalogArabicName')).map(input => {
      const i = Number(input.dataset.index);
      const row = state.rows[i];
      return { name_en: row.name_en, name_ar: input.value.trim(), old_name_ar: row.current_name_ar || '' };
    }).filter(x => x.name_ar && x.name_ar !== x.old_name_ar);
  }

  async function preview() {
    const updates = collectUpdates();
    const box = el('catalogNamesPreviewBox');
    el('catalogNamesApply').classList.add('hidden');
    if (!updates.length) {
      box.innerHTML = '<div class="notice">ما في تغييرات جديدة حتى الآن.</div>';
      return;
    }
    try {
      const r = await apiCall('/api/catalog-name-editor/preview', {
        method: 'POST', body: JSON.stringify({ updates })
      });
      const rows = (r.changes || []).map(c => `
        <div class="item">
          <b>${esc(c.name_en)}</b>
          <div class="small">${esc(c.old_name_ar || '-')} ← ${esc(c.new_name_ar)}</div>
          <div class="small">سيتعدل ${c.affected} بالة، منها ${c.sold} مباعة.</div>
        </div>`).join('');
      box.innerHTML = `<div class="card"><b>معاينة التعديلات</b><div class="small" style="margin:6px 0">إجمالي البالات التي ستتأثر: ${r.totalBales || 0}</div>${rows}</div>`;
      el('catalogNamesApply').classList.remove('hidden');
    } catch (e) {
      box.innerHTML = `<div style="color:#991b1b">${esc(e.message)}</div>`;
    }
  }

  async function apply() {
    const updates = collectUpdates();
    if (!updates.length) return alert('لا توجد تغييرات للحفظ.');
    if (!confirm('تأكيد تعديل الأسماء العربية فقط لكل البالات المطابقة، بما فيها المباعة؟')) return;
    const btn = el('catalogNamesApply');
    btn.disabled = true;
    btn.textContent = 'جاري الحفظ...';
    try {
      const r = await apiCall('/api/catalog-name-editor/apply', {
        method: 'POST', body: JSON.stringify({ updates })
      });
      alert(`تم تعديل ${r.updatedBales || 0} بالة بنجاح.`);
      await loadRows();
      if (typeof refresh === 'function') await refresh();
      el('catalogNamesPreviewBox').innerHTML = '';
      el('catalogNamesApply').classList.add('hidden');
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'حفظ التعديلات الآن';
    }
  }

  window.openCatalogNameEditor = function() {
    install();
    if (typeof openSection === 'function') openSection('catalogNameEditorSection');
    if (!state.loaded) loadRows();
  };

  document.addEventListener('click', e => {
    const target = e.target && e.target.closest ? e.target.closest('button,a,[role="button"]') : null;
    if (!target) return;
    if (String(target.textContent || '').trim() === 'المخزون') {
      setTimeout(() => {
        const inv = document.getElementById('bales');
        if (!inv || inv.querySelector('[data-catalog-name-editor]')) return;
        const btn = document.createElement('button');
        btn.className = 'btn secondary';
        btn.setAttribute('data-catalog-name-editor', '1');
        btn.textContent = 'تعديل أسماء الأصناف';
        btn.onclick = () => window.openCatalogNameEditor();
        const title = inv.querySelector('.section-title');
        if (title) title.appendChild(btn);
        else inv.prepend(btn);
      }, 50);
    }
  }, true);

  install();
})();
