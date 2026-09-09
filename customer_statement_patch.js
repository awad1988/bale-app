(function(){
  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function dateFmt(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?esc(String(v).slice(0,10)):d.toLocaleDateString('en-GB')}
  async function call(url){const r=await fetch(url,{cache:'no-store'});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر تحميل كشف الحساب');return b}

  function lineHtml(line){
    const meta=[line.grade||'',line.weight?line.weight+' كغ':'',line.quantity?'عدد '+line.quantity:''].filter(Boolean).join(' • ');
    return `<div style="padding:8px 10px;margin-top:6px;background:#f8fafc;border-radius:10px"><b>${esc(line.name||'صنف')}</b>${meta?`<div class="small">${esc(meta)}</div>`:''}${line.line_total_jod?`<div class="small">إجمالي الصنف: <b>${money(line.line_total_jod)} د.أ</b></div>`:''}</div>`;
  }

  function movementHtml(m,index){
    const sale=m.type==='sale';
    const returned=m.type==='return';
    const negative=Number(m.amount||0)<0;
    const reversal=sale&&negative;
    const title=returned?'مرتجع مبيعة':reversal?'عكس مبيعة':!sale&&negative?'عكس دفعة':sale?'مبيعة':'دفعة';
    const sign=returned?'−':sale?(negative?'−':'+'):(negative?'+':'−');
    const shownAmount=returned?Number(m.returned_total||0):Math.abs(Number(m.amount||0));
    const lines=(m.lines||[]).map(lineHtml).join('');
    const hasLines=!!lines;
    const detailsId='csDetails_'+index;
    return `<div class="item" style="margin-top:10px">
      <div class="top"><b>${title}</b><b>${sign}${money(shownAmount)} د.أ</b></div>
      <div class="small">التاريخ: ${dateFmt(m.date)}</div>
      <div class="small">الرصيد بعد الحركة: <b>${money(m.balance_after)} د.أ</b></div>
      ${returned?`<div class="small" style="margin-top:6px">تخفيض من الدين: <b>${money(m.amount)} د.أ</b>${Number(m.cash_refund||0)>0?` • مردود كاش: <b>${money(m.cash_refund)} د.أ</b>`:''}</div>`:''}
      ${m.returned?'<div class="small" style="color:#166534;font-weight:700;margin-top:6px">تم تسجيل مرتجع لهذه المبيعة وإرجاع مخزونها</div>':''}
      ${hasLines?`<button class="btn secondary wide csToggle" data-target="${detailsId}" style="margin-top:10px">عرض تفاصيل الفاتورة</button><div id="${detailsId}" class="hidden" style="margin-top:8px"><b style="font-size:13px">تفاصيل الفاتورة</b>${lines}</div>`:''}
      ${m.can_reverse?`<button class="btn danger wide csReverse" data-sale-id="${esc(m.id)}" style="margin-top:10px">تسجيل مرتجع وإرجاع البالات</button>`:''}
    </div>`;
  }

  function bindToggles(cid){
    document.querySelectorAll('.csToggle').forEach(btn=>{
      btn.onclick=()=>{
        const target=document.getElementById(btn.dataset.target);
        if(!target)return;
        const willOpen=target.classList.contains('hidden');
        target.classList.toggle('hidden');
        btn.textContent=willOpen?'إخفاء تفاصيل الفاتورة':'عرض تفاصيل الفاتورة';
      };
    });
    document.querySelectorAll('.csReverse').forEach(btn=>{
      btn.onclick=async()=>{
        if(!confirm('تأكيد تسجيل المرتجع؟ ستعود البالات للمخزون، وينخفض الدين أو يُسجل رد كاش حسب طريقة دفع المبيعة.'))return;
        btn.disabled=true;btn.textContent='جاري تسجيل المرتجع...';
        try{
          const response=await fetch('/api/v6/sales/'+encodeURIComponent(btn.dataset.saleId)+'/reverse',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'});
          const body=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(body.error||'تعذر عكس المبيعة');
          if(typeof refresh==='function')await refresh();
          await openDetailedStatement(body.customer_id||cid);
        }catch(e){alert(e.message);btn.disabled=false;btn.textContent='تسجيل مرتجع وإرجاع البالات'}
      };
    });
  }

  async function openDetailedStatement(cid){
    const list=document.getElementById('customerList');
    if(!list)return;
    list.innerHTML='<div class="card">جاري تحميل كشف الحساب...</div>';
    try{
      const r=await call('/api/v6/customers/'+encodeURIComponent(cid)+'/statement');
      const c=r.customer;
      list.innerHTML=`<div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2 style="margin:0">كشف حساب ${esc(c.name)}</h2><div class="small">${esc(c.phone||'')}</div></div><div style="text-align:left"><div class="small">الرصيد الحالي</div><b style="font-size:22px">${money(c.current_debt)} د.أ</b></div></div>
        <div class="row" style="margin-top:14px"><div class="card" style="margin:0"><div class="small">الرصيد الافتتاحي</div><b>${money(r.opening_debt)} د.أ</b></div><div class="card" style="margin:0"><div class="small">إجمالي المبيعات</div><b>${money(r.total_sales)} د.أ</b></div></div>
        <div class="row" style="margin-top:10px"><div class="card" style="margin:0"><div class="small">إجمالي الدفعات</div><b>${money(r.total_payments)} د.أ</b></div><div class="card" style="margin:0"><div class="small">إجمالي المرتجعات</div><b>${money(r.total_returns)} د.أ</b></div></div>
        <h3 style="margin-top:18px">حركة الحساب</h3>
        ${(r.movements||[]).map((m,i)=>movementHtml(m,i)).join('')||'<div class="muted">لا توجد حركات مسجلة.</div>'}
        <button class="btn secondary wide" id="csBack" style="margin-top:14px">رجوع للزبائن</button>
      </div>`;
      bindToggles(cid);
      document.getElementById('csBack').onclick=()=>{ if(typeof renderAll==='function') renderAll(); };
    }catch(e){
      list.innerHTML=`<div class="card"><div style="color:#991b1b">${esc(e.message)}</div><button class="btn secondary wide" id="csBackErr" style="margin-top:12px">رجوع</button></div>`;
      document.getElementById('csBackErr').onclick=()=>{ if(typeof renderAll==='function') renderAll(); };
    }
  }

  window.statement=function(cid){openDetailedStatement(cid)};
})();
