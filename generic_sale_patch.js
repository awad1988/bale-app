(function(){
  const STATE={catalog:null,rows:[],exchange:null};
  function el(id){return document.getElementById(id)}
  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
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
      <div id="gsExchangeBanner" class="card hidden" style="border:2px solid #f59e0b;background:#fffbeb"></div>
      <div class="card">
        <label>الزبون</label><select id="gsCustomer"></select>
        <div class="row"><div><label>المدفوع الآن</label><input id="gsPaid" type="number" step="0.01" value="0"></div><div><label>ملاحظة</label><input id="gsNotes" placeholder="اختياري"></div></div>
        <div style="margin-top:10px"><label>سعر صرف الدولار للشحنات بدون سعر صرف</label><input id="gsFx" type="number" step="0.001" value="0.709"><div class="small">يُستخدم فقط إذا كانت الشحنة لا تحتوي سعر صرف محفوظ.</div></div>
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
    el('gsPaid').oninput=()=>{if(STATE.exchange)STATE.exchange.paidTouched=true};
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
  function suggestedExchangePayment(total){
    const x=STATE.exchange;if(!x)return Number(el('gsPaid')?.value||0);
    const cash=Math.max(0,Number(x.cashRefund||0));
    const credit=Math.max(0,Number(x.debtCredit||0));
    if(cash>0&&credit<0.005)return total;
    if(credit>0&&cash<0.005)return 0;
    return Math.min(total,cash);
  }
  function renderExchangeBanner(total){
    const host=el('gsExchangeBanner');const x=STATE.exchange;
    if(!host)return;
    if(!x){host.classList.add('hidden');host.innerHTML='';return}
    const returned=(x.returnedLines||[]).map(item=>`<div class="small">• ${esc(item.name||'صنف')} — عدد ${Number(item.quantity||0)}</div>`).join('');
    const replacementTotal=Number(total||0);
    const difference=replacementTotal-Number(x.returnedTotal||0);
    const diffText=difference>0.005?'على الزبون فرق '+money(difference)+' د.أ':difference< -0.005?'للزبون فرق '+money(Math.abs(difference))+' د.أ':'لا يوجد فرق سعر';
    host.classList.remove('hidden');
    host.innerHTML=`<b>تبديل للزبون ${esc(x.customerName||'')}</b><div class="small" style="margin-top:6px">البالات الراجعة:</div>${returned||'<div class="small">تم تسجيل البالات الراجعة.</div>'}<div class="small" style="margin-top:7px">قيمة الراجع: <b>${money(x.returnedTotal)} د.أ</b> • خُصم من الحساب: <b>${money(x.debtCredit)} د.أ</b> • مردود كاش: <b>${money(x.cashRefund)} د.أ</b></div><div class="small" style="margin-top:7px">قيمة البديل الحالية: <b>${money(replacementTotal)} د.أ</b> • ${diffText}</div><div class="small" style="margin-top:7px">اختر البالة البديلة وسعرها. خانة «المدفوع الآن» مضبوطة تلقائيًا حسب طريقة المبيعة الأصلية، ويمكن تعديلها إذا دفع الزبون فرقًا إضافيًا الآن.</div><button id="gsCancelExchange" class="btn secondary wide" style="margin-top:10px">إلغاء اختيار البديل (يبقى الإرجاع مسجلاً)</button>`;
    const cancel=el('gsCancelExchange');
    if(cancel)cancel.onclick=()=>{STATE.exchange=null;STATE.rows=[{product_id:'',quantity:1,line_total_jod:''}];if(el('gsPaid'))el('gsPaid').value='0';if(el('gsNotes'))el('gsNotes').value='';renderRows();renderExchangeBanner(0)};
  }
  function sync(){
    document.querySelectorAll('[data-gs-row]').forEach(node=>{const i=Number(node.dataset.gsRow);STATE.rows[i]={product_id:node.querySelector('.gsProd').value,quantity:Number(node.querySelector('.gsQtyIn').value||0),line_total_jod:Number(node.querySelector('.gsAmt').value||0)}});
    const qty=STATE.rows.reduce((sum,item)=>sum+Number(item.quantity||0),0);
    const total=STATE.rows.reduce((sum,item)=>sum+Number(item.line_total_jod||0),0);
    if(STATE.exchange&&!STATE.exchange.paidTouched&&el('gsPaid'))el('gsPaid').value=String(Number(suggestedExchangePayment(total).toFixed(2)));
    el('gsQty').textContent=qty;el('gsTotal').textContent=money(total);el('gsCommit').classList.add('hidden');renderExchangeBanner(total);
  }

  function renderRows(){
    const host=el('gsLines');if(!host)return;
    host.innerHTML=STATE.rows.map((r,i)=>`<div class="card" data-gs-row="${i}"><label>الصنف</label><select class="gsProd">${productOptions(r.product_id)}</select><div class="row"><div><label>الكمية</label><input class="gsQtyIn" type="number" min="1" step="1" value="${r.quantity||1}"></div><div><label>إجمالي بيع هذا الصنف د.أ</label><input class="gsAmt" type="number" step="0.01" value="${r.line_total_jod||''}" placeholder="إجمالي السطر، ليس سعر البالة"></div></div><button class="btn danger wide gsRemove">حذف الصنف</button></div>`).join('');
    host.querySelectorAll('input,select').forEach(x=>x.onchange=sync);
    host.querySelectorAll('.gsRemove').forEach((b,i)=>b.onclick=()=>removeLine(i));
    sync();
  }
  function payload(){
    sync();
    let notes=el('gsNotes').value||'';
    if(STATE.exchange){
      const tag='[EXCHANGE_OF:'+STATE.exchange.originalSaleId+'] [EXCHANGE_RETURN:'+STATE.exchange.returnId+']';
      notes=tag+' '+notes.replace(new RegExp('\\[EXCHANGE_(?:OF|RETURN):[^\\]]+\\]\\s*','g'),'').trim();
    }
    return {batch_id:uid2(),customer_id:el('gsCustomer').value,paid_now:Number(el('gsPaid').value||0),notes,fallback_fx:Number(el('gsFx').value||0.709),lines:STATE.rows};
  }
  let pending=null;
  async function preview(){
    try{
      const p=payload();
      const [r,profit]=await Promise.all([
        call('/api/v4/sales/preview',{method:'POST',body:JSON.stringify(p)}),
        call('/api/v5/sales/profit-preview',{method:'POST',body:JSON.stringify(p)})
      ]);
      pending=p;
      const fxNote=profit.fallback_fx_bales>0?`<br><span style="font-size:12px">ملاحظة: استُخدم سعر الصرف ${Number(profit.fallback_fx).toFixed(3)} لعدد ${profit.fallback_fx_bales} بالة لأن الشحنة لا تحتوي سعر صرف محفوظ.</span>`:'';
      const exchangeNote=STATE.exchange?`<br><b>قيمة البالات الراجعة: ${money(STATE.exchange.returnedTotal)} د.أ</b><br>فرق التبديل: <b>${money(Number(r.total_jod)-Number(STATE.exchange.returnedTotal||0))} د.أ</b>`:'';
      el('gsResult').innerHTML=`<div style="padding:10px;border-radius:10px;background:#ecfdf5;color:#166534"><b>✅ ${STATE.exchange?'التبديل':'المبيعة'} جاهز للفحص</b><br>${r.customer.name}<br>الكمية: ${r.total_qty} بالة<br>الإجمالي: ${money(r.total_jod)} د.أ${exchangeNote}<br>المدفوع الآن: ${money(r.paid_now)} د.أ<br>الآجل: ${money(r.credit_jod)} د.أ<br>الرصيد بعد التسجيل: ${money(r.expected_debt_after)} د.أ<hr style="border:0;border-top:1px solid #bbf7d0;margin:9px 0"><b>حساب الربح</b><br>شراء البالات: ${money(profit.purchase_total_jod)} د.أ (${money(profit.purchase_total_usd)} $)<br>جمرك ومصاريف: ${money(profit.customs_total_jod)} د.أ (${money(profit.customs_per_bale_jod)} للبالة)<br>إجمالي التكلفة: ${money(profit.total_cost_jod)} د.أ<br><b>الربح: ${money(profit.profit_jod)} د.أ</b><br>هامش الربح: ${Number(profit.profit_margin_pct||0).toFixed(1)}%${fxNote}</div>`;
      el('gsCommit').classList.remove('hidden');
    }catch(e){pending=null;el('gsCommit').classList.add('hidden');el('gsResult').innerHTML='<div style="color:#991b1b">'+e.message+'</div>'}
  }
  async function commit(){
    if(!pending)return;
    if(!confirm(STATE.exchange?'تأكيد تسجيل البالات البديلة وخصمها من المخزون لإكمال التبديل؟':'تأكيد تسجيل المبيعة وخصم البالات من المخزون؟'))return;
    const b=el('gsCommit');b.disabled=true;b.textContent='جاري التسجيل...';
    try{
      const exchange=STATE.exchange;
      const r=await call('/api/v4/sales/commit',{method:'POST',body:JSON.stringify(pending)});
      const difference=exchange?Number(r.total_jod)-Number(exchange.returnedTotal||0):0;
      el('gsResult').innerHTML=`<div style="padding:10px;border-radius:10px;background:#ecfdf5;color:#166534;font-weight:700">تم تسجيل ${exchange?'التبديل':'المبيعة'} ✅<br>${r.total_qty} بالة • ${money(r.total_jod)} د.أ${exchange?`<br>قيمة الراجع: ${money(exchange.returnedTotal)} د.أ • فرق التبديل: ${money(difference)} د.أ`:''}<br>رصيد ${r.customer}: ${money(r.debt)} د.أ</div>`;
      STATE.rows=[{product_id:'',quantity:1,line_total_jod:''}];STATE.exchange=null;pending=null;
      if(el('gsPaid'))el('gsPaid').value='0';
      if(el('gsNotes'))el('gsNotes').value='';
      renderRows();renderExchangeBanner(0);
      if(typeof refresh==='function')await refresh();
      await loadCatalog();
    }catch(e){
      el('gsResult').innerHTML='<div style="color:#991b1b">'+e.message+'</div>';
    }finally{
      b.disabled=false;b.textContent='تسجيل المبيعة الآن';b.classList.add('hidden');
    }
  }

  window.prepareExchangeSale=async function(context){
    installSection();
    STATE.exchange={...context,paidTouched:false};
    STATE.rows=[{product_id:'',quantity:1,line_total_jod:''}];pending=null;
    if(typeof openSection==='function')openSection('normalSalesSection');
    await loadCatalog();
    renderRows();
    if(el('gsCustomer'))el('gsCustomer').value=String(context.customerId||'');
    if(el('gsPaid'))el('gsPaid').value='0';
    if(el('gsNotes'))el('gsNotes').value='تبديل مرتبط بالبالات الراجعة';
    sync();
    el('gsExchangeBanner')?.scrollIntoView({behavior:'smooth',block:'start'});
  };


  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installSection);else installSection();
})();
