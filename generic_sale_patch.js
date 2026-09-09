(function(){
  const STATE={catalog:null,rows:[]};
  function el(id){return document.getElementById(id)}
  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  async function call(url,opt){const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر تنفيذ العملية');return b}
  function uid2(){return 'sale_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10)}

  function installSection(){
    if(el('normalSalesSection')) return;
    const nav=el('nav');
    const wrap=document.querySelector('.wrap');
    if(!nav||!wrap) return;
    const btn=document.createElement('button');
    btn.dataset.target='normalSalesSection';
    btn.textContent='المبيعات';
    nav.appendChild(btn);
    btn.onclick=()=>openSection('normalSalesSection');

    const sec=document.createElement('section');
    sec.id='normalSalesSection';
    sec.innerHTML=`
      <div class="section-title"><h2>مبيعة أصناف من المخزون</h2><span class="pill ok">مرتبطة بالمخزون</span></div>
      <div class="card">
        <label>الزبون</label><select id="gsCustomer"></select>
        <div class="row"><div><label>المدفوع الآن</label><input id="gsPaid" type="number" step="0.01" value="0"></div><div><label>ملاحظة</label><input id="gsNotes" placeholder="اختياري"></div></div>
      </div>
      <div id="gsLines" class="list" style="margin-top:12px"></div>
      <button id="gsAddLine" class="btn secondary wide">+ إضافة صنف</button>
      <div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between"><b>عدد البالات</b><b id="gsQty">0</b></div><div style="display:flex;justify-content:space-between;margin-top:6px"><b>إجمالي البيع</b><b><span id="gsTotal">0.00</span> د.أ</b></div></div>
      <button id="gsPreview" class="btn primary wide">فحص المبيعة</button>
      <button id="gsCommit" class="btn primary wide hidden">تسجيل المبيعة الآن</button>
      <div id="gsResult" style="margin-top:12px"></div>`;
    wrap.appendChild(sec);
    el('gsAddLine').onclick=addLine;
    el('gsPreview').onclick=preview;
    el('gsCommit').onclick=commit;
    loadCatalog();
  }

  async function loadCatalog(){
    try{
      STATE.catalog=await call('/api/v4/sales/catalog');
      const c=el('gsCustomer');
      if(c)c.innerHTML=(STATE.catalog.customers||[]).map(x=>`<option value="${x.id}">${x.name} — رصيد ${money(x.debt)} د.أ</option>`).join('');
      if(!STATE.rows.length)addLine(); else renderRows();
    }catch(e){ if(el('gsResult'))el('gsResult').textContent=e.message; }
  }

  function productOptions(selected){
    return '<option value="">اختر الصنف</option>'+(STATE.catalog?.products||[]).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${p.name_ar||p.name_en} • ${p.grade} • ${p.weight} كغ • متاح ${p.quantity}</option>`).join('');
  }
  function addLine(){STATE.rows.push({product_id:'',quantity:1,line_total_jod:''});renderRows()}
  function removeLine(i){STATE.rows.splice(i,1);if(!STATE.rows.length)STATE.rows.push({product_id:'',quantity:1,line_total_jod:''});renderRows()}
  function sync(){
    document.querySelectorAll('[data-gs-row]').forEach(node=>{const i=Number(node.dataset.gsRow);STATE.rows[i]={product_id:node.querySelector('.gsProd').value,quantity:Number(node.querySelector('.gsQtyIn').value||0),line_total_jod:Number(node.querySelector('.gsAmt').value||0)}});
    const qty=STATE.rows.reduce((s,x)=>s+Number(x.quantity||0),0);const total=STATE.rows.reduce((s,x)=>s+Number(x.line_total_jod||0),0);el('gsQty').textContent=qty;el('gsTotal').textContent=money(total);el('gsCommit').classList.add('hidden');
  }
  function renderRows(){
    const host=el('gsLines');if(!host)return;
    host.innerHTML=STATE.rows.map((r,i)=>`<div class="card" data-gs-row="${i}"><label>الصنف</label><select class="gsProd">${productOptions(r.product_id)}</select><div class="row"><div><label>الكمية</label><input class="gsQtyIn" type="number" min="1" step="1" value="${r.quantity||1}"></div><div><label>إجمالي بيع هذا الصنف د.أ</label><input class="gsAmt" type="number" step="0.01" value="${r.line_total_jod||''}" placeholder="إجمالي السطر، ليس سعر البالة"></div></div><button class="btn danger wide gsRemove">حذف الصنف</button></div>`).join('');
    host.querySelectorAll('input,select').forEach(x=>x.onchange=sync);
    host.querySelectorAll('.gsRemove').forEach((b,i)=>b.onclick=()=>removeLine(i));
    sync();
  }
  function payload(){sync();return {batch_id:uid2(),customer_id:el('gsCustomer').value,paid_now:Number(el('gsPaid').value||0),notes:el('gsNotes').value||'',lines:STATE.rows}}
  let pending=null;
  async function preview(){
    try{const p=payload();const r=await call('/api/v4/sales/preview',{method:'POST',body:JSON.stringify(p)});pending=p;el('gsResult').innerHTML=`<div style="padding:10px;border-radius:10px;background:#ecfdf5;color:#166534"><b>✅ المبيعة جاهزة</b><br>${r.customer.name}<br>الكمية: ${r.total_qty} بالة<br>الإجمالي: ${money(r.total_jod)} د.أ<br>المدفوع الآن: ${money(r.paid_now)} د.أ<br>الآجل: ${money(r.credit_jod)} د.أ<br>الرصيد بعد التسجيل: ${money(r.expected_debt_after)} د.أ</div>`;el('gsCommit').classList.remove('hidden')}catch(e){pending=null;el('gsCommit').classList.add('hidden');el('gsResult').innerHTML='<div style="color:#991b1b">'+e.message+'</div>'}
  }
  async function commit(){
    if(!pending)return;
    if(!confirm('تأكيد تسجيل المبيعة وخصم البالات من المخزون؟'))return;
    const b=el('gsCommit');b.disabled=true;b.textContent='جاري التسجيل...';
    try{const r=await call('/api/v4/sales/commit',{method:'POST',body:JSON.stringify(pending)});el('gsResult').innerHTML=`<div style="padding:10px;border-radius:10px;background:#ecfdf5;color:#166534;font-weight:700">تم تسجيل المبيعة ✅<br>${r.total_qty} بالة • ${money(r.total_jod)} د.أ<br>رصيد ${r.customer}: ${money(r.debt)} د.أ</div>`;STATE.rows=[{product_id:'',quantity:1,line_total_jod:''}];pending=null;renderRows();if(typeof refresh==='function')await refresh();await loadCatalog();}catch(e){el('gsResult').innerHTML='<div style="color:#991b1b">'+e.message+'</div>'}finally{b.disabled=false;b.textContent='تسجيل المبيعة الآن';b.classList.add('hidden')}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSection);else installSection();
})();
