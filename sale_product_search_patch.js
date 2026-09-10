(function(){
  let catalogProducts=[];
  let loading=null;

  function esc(v){
    return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function norm(v){
    return String(v||'')
      .toLowerCase()
      .trim()
      .replace(/[\u064b-\u065f\u0670]/g,'')
      .replace(/[أإآ]/g,'ا')
      .replace(/ى/g,'ي')
      .replace(/ة/g,'ه')
      .replace(/ـ/g,'')
      .replace(/[^a-z0-9\u0600-\u06ff]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  async function ensureCatalog(){
    if(catalogProducts.length) return catalogProducts;
    if(loading) return loading;
    loading=fetch('/api/v4/sales/catalog?ts='+Date.now(),{cache:'no-store'})
      .then(async r=>{
        const body=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(body.error||'تعذر تحميل أصناف المخزون');
        catalogProducts=Array.isArray(body.products)?body.products:[];
        return catalogProducts;
      })
      .finally(()=>{loading=null;});
    return loading;
  }

  function productLabel(p){
    const names=[p.name_ar,p.name_en].filter(Boolean).join(' / ');
    return `${names||'بدون اسم'} • ${p.grade||'-'} • ${Number(p.weight||0)} كغ • متاح ${Number(p.quantity||0)}`;
  }

  async function filterSelect(row,query){
    const select=row.querySelector('.gsProd');
    if(!select) return;
    const products=await ensureCatalog();
    const wanted=norm(query);
    const current=String(select.value||'');
    const tokens=wanted.split(' ').filter(Boolean);

    const matches=!wanted ? products : products.filter(p=>{
      const hay=norm([p.name_ar,p.name_en,p.grade,p.weight].filter(Boolean).join(' '));
      if(hay.includes(wanted)) return true;
      return tokens.length>0 && tokens.every(t=>hay.includes(t));
    });

    select.innerHTML='<option value="">اختر الصنف</option>'+matches.map(p=>
      `<option value="${esc(p.id)}" ${String(p.id)===current?'selected':''}>${esc(productLabel(p))}</option>`
    ).join('');

    if(current && !matches.some(p=>String(p.id)===current)) select.value='';
    select.dispatchEvent(new Event('change',{bubbles:true}));

    const count=row.querySelector('.gsSearchCount');
    if(count) count.textContent=wanted ? `تم العثور على ${matches.length} صنف` : `كل الأصناف: ${matches.length}`;
  }

  function enhanceRow(row){
    if(!row || row.dataset.gsSearchReady==='1') return;
    const select=row.querySelector('.gsProd');
    if(!select) return;
    row.dataset.gsSearchReady='1';

    const box=document.createElement('div');
    box.style.cssText='display:grid;grid-template-columns:1fr auto;gap:8px;margin:6px 0 10px';
    box.innerHTML=`
      <input class="gsProdSearch" type="search" autocomplete="off" placeholder="ابحث بالعربي أو الإنجليزي" style="min-width:0">
      <button type="button" class="btn secondary gsProdSearchBtn">بحث</button>
      <div class="small gsSearchCount" style="grid-column:1/-1"></div>`;
    select.insertAdjacentElement('beforebegin',box);

    const input=box.querySelector('.gsProdSearch');
    const button=box.querySelector('.gsProdSearchBtn');
    let timer=null;
    const run=()=>filterSelect(row,input.value).catch(e=>alert(e.message));
    input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,120);});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run();}});
    button.addEventListener('click',run);
    filterSelect(row,'').catch(()=>{});
  }

  function scan(){
    document.querySelectorAll('[data-gs-row]').forEach(enhanceRow);
  }

  const observer=new MutationObserver(()=>scan());
  function install(){
    scan();
    observer.observe(document.body,{childList:true,subtree:true});
    ensureCatalog().then(scan).catch(()=>{});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install);
  else install();
})();
