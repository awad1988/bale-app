(function(){
  const originalRun=window.runAgent;
  function el(id){return document.getElementById(id)}
  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function isStockSaleCommand(v){const s=String(v||'');return /(بيع|مبيع|بيعة|بيعه)/.test(s)}
  async function call(url,opt){const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر فهم المبيعة');return b}
  function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

  function show(r){
    const out=el('agentResult');if(!out)return;
    if(r.needs_choice){
      out.innerHTML=`<div style="background:#fff7ed;color:#7c2d12;border-radius:12px;padding:12px"><b>احتاج تحديد التصنيف</b><br>${safe(r.message)}<br>${(r.matches||[]).map(x=>`<div style="margin-top:6px">• ${safe(x.name_ar||x.name_en)} • ${safe(x.grade)} • ${Number(x.weight||0)} كغ • متاح ${Number(x.quantity||0)}</div>`).join('')}<button id="asOpenSales" class="btn wide" style="margin-top:12px">فتح شاشة المبيعات</button></div>`;
      el('asOpenSales').onclick=()=>openSection('normalSalesSection');
      return;
    }
    const p=r.product||{};
    out.innerHTML=`<div style="background:#ecfdf5;color:#166534;border-radius:12px;padding:12px"><b>✅ فهمت المبيعة</b><br>الزبون: <b>${safe(r.customer?.name)}</b><br>الصنف: <b>${safe(p.name_ar||p.name_en)}</b><br>${safe(p.grade)} • ${Number(p.weight||0)} كغ<br>الكمية: <b>${Number(r.quantity||0)} بالة</b><br>السعر للبالة: <b>${money(r.unit_price_jod)} د.أ</b><br>إجمالي المبيعة: <b>${money(r.total_jod)} د.أ</b><br>الرصيد الحالي: ${money(r.customer?.current_debt)} د.أ<br>الرصيد المتوقع بعد المبيعة: <b>${money(r.expected_debt_after)} د.أ</b><div style="font-size:12px;margin-top:8px">لم يتم تسجيل أي شيء. التسجيل يتم فقط بعد فحص المبيعة وتأكيدك.</div><button id="asPrepareSale" class="btn wide" style="margin-top:12px">نقلها إلى شاشة المبيعات للفحص</button></div>`;
    el('asPrepareSale').onclick=()=>prepare(r);
  }

  async function prepare(r){
    openSection('normalSalesSection');
    try{
      const catalog=await call('/api/v4/sales/catalog');
      const customer=el('gsCustomer');
      if(customer){
        customer.innerHTML=(catalog.customers||[]).map(x=>`<option value="${safe(x.id)}">${safe(x.name)} — رصيد ${money(x.debt)} د.أ</option>`).join('');
        customer.value=String(r.customer.id);
        customer.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }catch(_){ }

    setTimeout(()=>{
      const rows=document.querySelectorAll('[data-gs-row]');
      const row=rows[0];
      if(!row)return;
      const prod=row.querySelector('.gsProd');
      const targetName=String(r.product.name_ar||r.product.name_en||'').trim();
      const targetGrade=String(r.product.grade||'').trim();
      const targetWeight=Number(r.product.weight||0);
      const option=[...prod.options].find(o=>{
        const text=String(o.textContent||'');
        return text.includes(targetName)&&text.includes(targetGrade)&&text.includes(String(targetWeight)+' كغ');
      });
      if(option){prod.value=option.value;prod.dispatchEvent(new Event('change',{bubbles:true}))}
      const qty=row.querySelector('.gsQtyIn'); if(qty){qty.value=String(r.quantity);qty.dispatchEvent(new Event('change',{bubbles:true}))}
      const amt=row.querySelector('.gsAmt'); if(amt){amt.value=String(r.total_jod);amt.dispatchEvent(new Event('change',{bubbles:true}))}
      const paid=el('gsPaid'); if(paid) paid.value='0';
      const notes=el('gsNotes'); if(notes) notes.value='تم تجهيز المبيعة من الوكيل الذكي';
      el('gsResult')?.replaceChildren();
    },250);
  }

  window.runAgent=async function(){
    const prompt=el('agentPrompt')?.value.trim()||'';
    if(!isStockSaleCommand(prompt)) return typeof originalRun==='function'?originalRun():undefined;
    const button=el('agentRunButton');
    if(!prompt)return;
    if(button){button.disabled=true;button.textContent='جاري فهم المبيعة...'}
    try{const r=await call('/api/v7/agent/sale-preview',{method:'POST',body:JSON.stringify({prompt})});show(r)}
    catch(e){if(typeof window.showAgentMessage==='function')window.showAgentMessage(e.message);else if(el('agentResult'))el('agentResult').textContent=e.message}
    finally{if(button){button.disabled=false;button.textContent='فهم الأمر'}}
  };
})();
