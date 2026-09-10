(() => {
  function addButton() {
    if (document.querySelector('[data-catalog-name-editor-fixed]')) return;

    const baleRows = document.getElementById('baleRows');
    const section = baleRows ? baleRows.closest('section') : null;
    const title = section ? (section.querySelector('.section-title') || section.querySelector('h2')?.parentElement) : null;
    if (!section || !title) return;

    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.setAttribute('data-catalog-name-editor-fixed', '1');
    btn.textContent = 'تعديل أسماء الأصناف';
    btn.style.marginInlineStart = '8px';
    btn.onclick = () => {
      if (typeof window.openCatalogNameEditor === 'function') {
        window.openCatalogNameEditor();
      } else {
        alert('صفحة تعديل أسماء الأصناف لم تُحمّل بعد. حدّث الصفحة وحاول مرة ثانية.');
      }
    };
    title.appendChild(btn);
  }

  document.addEventListener('DOMContentLoaded', addButton);
  document.addEventListener('click', e => {
    const target = e.target && e.target.closest ? e.target.closest('button,a,[role="button"]') : null;
    if (target && String(target.textContent || '').includes('المخزون')) setTimeout(addButton, 50);
  }, true);

  const observer = new MutationObserver(addButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();
