(() => {
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[c]));
  }

  async function getRows() {
    const r = await fetch('/api/catalog-name-editor', { cache: 'no-store' });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'تعذر تحميل الأصناف');
    return Array.isArray(b.rows) ? b.rows : [];
  }

  async function downloadExcel(e) {
    const btn = e.target && e.target.closest ? e.target.closest('#catalogNamesDownload') : null;
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جاري تجهيز ملف Excel...';

    try {
      const rows = await getRows();
      if (!rows.length) throw new Error('لا توجد أصناف للتنزيل');

      const body = rows.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="mso-number-format:'\\@'">${esc(r.name_en || '')}</td>
          <td style="direction:rtl;text-align:right">${esc(r.current_name_ar || '')}</td>
          <td style="direction:rtl;text-align:right;background:#fffbe6"></td>
          <td>${Number(r.total || 0)}</td>
          <td>${Number(r.sold || 0)}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif}table{border-collapse:collapse}th,td{border:1px solid #999;padding:8px;white-space:nowrap}th{font-weight:700;background:#e9eef5}.ar{direction:rtl;text-align:right}.edit{background:#fffbe6}
</style></head><body>
<table>
<thead><tr><th>#</th><th>English Name</th><th class="ar">الاسم العربي الحالي</th><th class="ar edit">الاسم العربي الصحيح</th><th>عدد البالات</th><th>المباعة</th></tr></thead>
<tbody>${body}</tbody>
</table></body></html>`;

      const blob = new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bale-catalog-arabic-names.xls';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      alert(err.message || 'تعذر تنزيل ملف Excel');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تنزيل كشف Excel';
      if (!oldText) btn.textContent = 'تنزيل كشف Excel';
    }
  }

  document.addEventListener('click', downloadExcel, true);

  function relabel() {
    const btn = document.getElementById('catalogNamesDownload');
    if (btn) btn.textContent = 'تنزيل كشف Excel';
  }
  setInterval(relabel, 600);
})();
