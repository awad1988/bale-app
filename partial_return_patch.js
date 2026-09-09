(function(){
  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function dateFmt(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?esc(String(v).slice(0,10)):d.toLocaleDateString('en-GB')}
  function returnId(){return 'RET_'+(crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):Date.now().toString(36)+Math.random().toString(36).slice(2))}
  let currentCustomer=null;
  async function jsonCall(url,options){
    const r=await fetch(url,{cache:'no-store',headers:{'Content-Type':'application/json'},...(options||{})});
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(b.error||'تعذر تنفيذ العملية');
    return b;
  }

  function lineMeta(line){
    return [line.grade||'',line.weight?line.weight+' كغ':'',line.quantity?'عدد '+line.quantity:''].filter(Boolean).join(' • ');
  }

  function saleReturnState(m){
    if(m.type!=='sale')return {full:false,partial:false};
    const lines=Array.isArray(m.lines)?m.lines:[];
    const hasTracked=lines.some(x=>Number(x.returned_qty||0)>0 || Number(x.remaining_qty||0)>=0);
    const anyReturned=lines.some(x=>Number(x.returned_qty||0)>0);
    const allReturned=hasTracked && lines.length>0 && lines.every(x=>Number(x.remaining_qty||0)===0) && anyReturned;
    const full=!!m.returned || allReturned;
    const partial=!full && (!!m.partial_returned || anyReturned);
    return {full,partial};
  }

  function detailLine(line){
    const originalQty=Number(line.quantity||0);
    const returnedQty=Number(line.returned_qty||0);
    const remainingQty=Number(line.remaining_qty||0);
    const tracked=Object.prototype.hasOwnProperty.call(line,'returned_qty') || Object.prototype.hasOwnProperty.call(line,'remaining_qty');
    return `<div style="padding:8px 10px;margin-top:6px;background:#f8fafc;border-radius:10px">
      <b>${esc(line.name||'صنف')}</b>
      ${lineMeta(line)?`<div class="small">${esc(lineMeta(line))}</div>`:''}
      ${line.line_total_jod?`<div class="small">إجمالي الصنف: <b>${money(line.line_total_jod)} د.أ</b></div>`:''}
      ${tracked?`<div class="small" style="margin-top:5px">الأصل: <b>${originalQty}</b> • المرتجع: <b>${returnedQty}</b> • المتبقي مبيع: <b>${remainingQty}</b></div>`:''}
      ${tracked&&returnedQty>0&&remainingQty===0?'<div class="small" style="color:#166534;font-weight:700;margin-top:4px">هذا الصنف مرتجع بالكامل</div>':''}
      ${tracked&&returnedQty>0&&remainingQty>0?'<div class="small" style="color:#92400e;font-weight:700;margin-top:4px">هذا الصنف مرتجع جزئيًا</div>':''}
    </div>`;
  }

  function returnChooser(m,index){
    const rows=(m.lines||[]).map(line=>{
      const remaining=Number(line.remaining_qty||0);
      if(remaining<=0)return '';
      const unit=Number(line.unit_price_jod||0);
      return `<div class="item" style="margin-top:8px;padding:10px">
        <div class="top"><b>${esc(line.name||'صنف')}</b><span class="small">متاح للإرجاع: ${remaining}</span></div>
        <div class="small">${esc([line.grade||'',line.weight?line.weight+' كغ':''].filter(Boolean).join(' • '))}</div>
        <div class="small">سعر البالة في الفاتورة: <b>${money(unit)} د.أ</b></div>
        ${Number(line.returned_qty||0)>0?`<div class="small" style="color:#166534">مرتجع سابقًا: ${Number(line.returned_qty||0)}</div>`:''}
        <label style="margin-top:8px">كمية الإرجاع</label>
        <input class="prQty" data-line-index="${line.line_index}" data-max="${remaining}" data-unit="${unit}" type="number" min="0" max="${remaining}" step="1" value="0">
      </div>`;
    }).join('');
    return `<div id="prChooser_${index}" class="hidden" style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px">
      <div class="small prModeText" style="margin-bottom:8px">اختر الصنف والكمية المراد إرجاعها فقط. باقي الفاتورة يبقى مبيعًا.</div>
      ${rows}
      <div class="small" id="prEstimate_${index}" style="margin-top:10px;font-weight:700">قيمة المرتجع المختار: 0.00 د.أ</div>
      <button class="btn danger wide prCommit" data-sale-id="${esc(m.id)}" data-index="${index}">تأكيد إرجاع الأصناف المختارة</button>
      <button class="btn secondary wide prAll" data-sale-id="${esc(m.id)}" data-index="${index}" style="margin-top:8px">إرجاع كل الكمية المتبقية</button>
    </div>`;
  }

  function movementHtml(m,index){
    const sale=m.type==='sale';
    const returned=m.type==='return';
    const partial=m.type==='partial_return';
    const state=saleReturnState(m);
    const exchange=!!m.exchange;
    const title=exchange&&sale?'البالات البديلة (تبديل)':exchange&&partial?'البالات الراجعة (تبديل)':partial?'مرتجع جزئي':returned?'مرتجع مبيعة':sale?'مبيعة':'دفعة';
    const sign=(returned||partial)?'−':sale?'+':'−';
    const shown=(returned||partial)?Number(m.returned_total||0):Math.abs(Number(m.amount||0));
    const lines=(m.lines||[]).map(detailLine).join('');
    const detailsId='prDetails_'+index;
    const exchangeNote=exchange?(sale?'<div class="small" style="color:#92400e;font-weight:700;margin-top:6px">هذه هي البالات التي أخذها الزبون بدل البالات الراجعة.</div>':'<div class="small" style="color:#92400e;font-weight:700;margin-top:6px">تم تسجيل البالات البديلة بقيمة '+money(m.exchange?.replacement_total||0)+' د.أ.</div>'):'';
    const statusNote=state.full
      ?'<div class="small" style="color:#166534;font-weight:700;margin-top:6px">مرتجع كامل — تم إرجاع جميع أصناف وكميات هذه الفاتورة</div>'
      :state.partial
        ?'<div class="small" style="color:#92400e;font-weight:700;margin-top:6px">مرتجع جزئي — ما زال جزء من الفاتورة مبيعًا</div>'
        :'';
    return `<div class="item" style="margin-top:10px" data-pr-sale-card="${sale?esc(m.id):''}">
      <div class="top"><b>${title}</b><b>${sign}${money(shown)} د.أ</b></div>
      <div class="small">التاريخ: ${dateFmt(m.date)}</div>
      <div class="small">الرصيد بعد الحركة: <b>${money(m.balance_after)} د.أ</b></div>
      ${(returned||partial)?`<div class="small" style="margin-top:6px">تخفيض من الدين: <b>${money(m.amount)} د.أ</b>${Number(m.cash_refund||0)>0?` • مردود كاش: <b>${money(m.cash_refund)} د.أ</b>`:''}</div>`:''}
      ${exchangeNote}
      ${statusNote}
      ${lines?`<button class="btn secondary wide prToggle" data-target="${detailsId}" style="margin-top:10px">عرض تفاصيل الفاتورة</button><div id="${detailsId}" class="hidden" style="margin-top:8px">${lines}</div>`:''}
      ${m.can_return&&!state.full?`<button class="btn danger wide prOpen" data-index="${index}" style="margin-top:10px">إرجاع صنف / كمية من هذه الفاتورة</button><button class="btn secondary wide prExchangeOpen" data-index="${index}" style="margin-top:8px;border-color:#f59e0b;color:#92400e">تبديل صنف / بالة من هذه الفاتورة</button>${returnChooser(m,index)}`:''}
    </div>`;
  }

  function bind(cid){
    document.querySelectorAll('.prToggle').forEach(btn=>{
      btn.onclick=()=>{
        const el=document.getElementById(btn.dataset.target);if(!el)return;
        const opening=el.classList.contains('hidden');el.classList.toggle('hidden');
        btn.textContent=opening?'إخفاء تفاصيل الفاتورة':'عرض تفاصيل الفاتورة';
      };
    });
    document.querySelectorAll('.prOpen,.prExchangeOpen').forEach(btn=>{
      btn.onclick=()=>{
        const chooser=document.getElementById('prChooser_'+btn.dataset.index);if(!chooser)return;
        const exchange=btn.classList.contains('prExchangeOpen');
        const mode=exchange?'exchange':'return';
        const opening=chooser.classList.contains('hidden')||chooser.dataset.mode!==mode;
        chooser.dataset.mode=mode;
        chooser.classList.toggle('hidden',!opening);
        const returnButton=document.querySelector('.prOpen[data-index="'+btn.dataset.index+'"]');
        const exchangeButton=document.querySelector('.prExchangeOpen[data-index="'+btn.dataset.index+'"]');
        if(returnButton)returnButton.textContent=opening&&!exchange?'إخفاء خيارات الإرجاع':'إرجاع صنف / كمية من هذه الفاتورة';
        if(exchangeButton)exchangeButton.textContent=opening&&exchange?'إخفاء خيارات التبديل':'تبديل صنف / بالة من هذه الفاتورة';
        const note=chooser.querySelector('.prModeText');
        const commit=chooser.querySelector('.prCommit');
        const all=chooser.querySelector('.prAll');
        if(note)note.textContent=exchange?'الخطوة 1: اختر البالة الراجعة. بعد التأكيد نفتح المخزون لاختيار البالة البديلة.':'اختر الصنف والكمية المراد إرجاعها فقط. باقي الفاتورة يبقى مبيعًا.';
        if(commit)commit.textContent=exchange?'تأكيد الراجع والانتقال لاختيار البديل':'تأكيد إرجاع الأصناف المختارة';
        if(all)all.textContent=exchange?'تبديل كل الكمية المتبقية':'إرجاع كل الكمية المتبقية';
      };
    });

    document.querySelectorAll('.prQty').forEach(input=>{
      input.oninput=()=>{
        const chooser=input.closest('[id^="prChooser_"]');if(!chooser)return;
        let total=0;
        chooser.querySelectorAll('.prQty').forEach(x=>{
          let q=Math.floor(Number(x.value||0));const max=Number(x.dataset.max||0);
          if(q<0)q=0;if(q>max)q=max;x.value=q;
          total+=q*Number(x.dataset.unit||0);
        });
        const idx=chooser.id.replace('prChooser_','');
        const est=document.getElementById('prEstimate_'+idx);if(est)est.textContent='قيمة المرتجع المختار: '+money(total)+' د.أ';
      };
    });
    document.querySelectorAll('.prCommit').forEach(btn=>{
      btn.onclick=async()=>{
        const chooser=document.getElementById('prChooser_'+btn.dataset.index);if(!chooser)return;
        const lines=[...chooser.querySelectorAll('.prQty')].map(x=>({line_index:Number(x.dataset.lineIndex),quantity:Number(x.value||0)})).filter(x=>x.quantity>0);
        if(!lines.length)return alert('اختر صنفًا وكمية واحدة على الأقل للإرجاع.');
        await submitReturn(btn,cid,lines,false,chooser.dataset.mode==='exchange');
      };
    });
    document.querySelectorAll('.prAll').forEach(btn=>{
      btn.onclick=async()=>{
        const chooser=document.getElementById('prChooser_'+btn.dataset.index);if(!chooser)return;
        const lines=[...chooser.querySelectorAll('.prQty')].map(x=>({line_index:Number(x.dataset.lineIndex),quantity:Number(x.dataset.max||0)})).filter(x=>x.quantity>0);
        if(!lines.length)return alert('لا توجد كمية متبقية للإرجاع.');
        if(!confirm(chooser.dataset.mode==='exchange'?'تأكيد إرجاع كل الكمية المتبقية ثم الانتقال لاختيار البالات البديلة؟':'تأكيد إرجاع كل الكمية المتبقية من هذه الفاتورة؟ عندها تصبح الفاتورة مرتجعة بالكامل.'))return;
        await submitReturn(btn,cid,lines,true,chooser.dataset.mode==='exchange');
      };
    });
  }

  async function submitReturn(btn,cid,lines,alreadyConfirmed,exchangeMode){
    const chooser=document.getElementById('prChooser_'+btn.dataset.index);
    const selectedLines=lines.map(line=>{
      const input=chooser?.querySelector(`.prQty[data-line-index="${line.line_index}"]`);
      const name=input?.closest('.item')?.querySelector('b')?.textContent||'صنف';
      return {name,quantity:line.quantity};
    });
    if(!alreadyConfirmed){
      let total=0;
      lines.forEach(line=>{
        const input=chooser?.querySelector(`.prQty[data-line-index="${line.line_index}"]`);
        total+=line.quantity*Number(input?.dataset.unit||0);
      });
      const question=exchangeMode
        ?'تأكيد البالات الراجعة بقيمة تقريبية '+money(total)+' د.أ، ثم اختيار البالات البديلة؟'
        :'تأكيد إرجاع الأصناف المختارة فقط بقيمة تقريبية '+money(total)+' د.أ؟';
      if(!confirm(question))return;
    }
    const rid=btn.dataset.returnId||returnId();
    btn.dataset.returnId=rid;
    const original=btn.textContent;
    btn.disabled=true;btn.textContent=exchangeMode?'جاري تسجيل الراجع...':'جاري تسجيل المرتجع...';
    try{
      const saleId=String(btn.dataset.saleId||'');
      const r=await jsonCall('/api/v7/sales/'+encodeURIComponent(saleId)+'/partial-return',{
        method:'POST',body:JSON.stringify({return_id:rid,lines})
      });
      if(typeof refresh==='function')await refresh();
      const finance=window.returnReconcileResults?.[saleId+'|'+rid]||{};
      const batch=finance.current_batch||{};
      const returnedTotal=Number(batch.returned_total??r.returned_total??0);
      const cashRefund=Number(batch.cash_refund||0);
      const debtCredit=Number(batch.debt_credit??returnedTotal-cashRefund);
      if(exchangeMode){
        window.agentReturnIntent=null;
        alert('تمت إعادة '+r.returned_qty+' بالة إلى المخزون. الآن اختر البالة البديلة وسعرها.');
        if(typeof window.prepareExchangeSale==='function'){
          await window.prepareExchangeSale({
            customerId:cid,
            customerName:currentCustomer?.name||r.customer||'',
            originalSaleId:saleId,
            returnId:rid,
            returnedLines:selectedLines,
            returnedTotal,
            cashRefund,
            debtCredit
          });
          return;
        }
        if(typeof openSection==='function')openSection('normalSalesSection');
        return;
      }
      alert('تم الإرجاع: '+r.returned_qty+' بالة بقيمة '+money(returnedTotal)+' د.أ'+(cashRefund>0?' • مردود كاش حسب الفاتورة':'')+'.');
      await openStatement(cid);
    }catch(e){
      alert(e.message+'\nيمكنك الضغط مرة أخرى بأمان لإكمال نفس المرتجع.');
      btn.disabled=false;btn.textContent=original;
    }
  }


  async function openStatement(cid){
    const list=document.getElementById('customerList');if(!list)return;
    list.innerHTML='<div class="card">جاري تحميل كشف الحساب...</div>';
    try{
      const r=await jsonCall('/api/v7/customers/'+encodeURIComponent(cid)+'/statement');
      const c=r.customer;
      currentCustomer=c;
      list.innerHTML=`<div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2 style="margin:0">كشف حساب ${esc(c.name)}</h2><div class="small">${esc(c.phone||'')}</div></div><div style="text-align:left"><div class="small">الرصيد الحالي</div><b style="font-size:22px">${money(c.current_debt)} د.أ</b></div></div>
        <div class="row" style="margin-top:14px"><div class="card" style="margin:0"><div class="small">الرصيد الافتتاحي</div><b>${money(r.opening_debt)} د.أ</b></div><div class="card" style="margin:0"><div class="small">إجمالي المبيعات</div><b>${money(r.total_sales)} د.أ</b></div></div>
        <div class="row" style="margin-top:10px"><div class="card" style="margin:0"><div class="small">إجمالي الدفعات</div><b>${money(r.total_payments)} د.أ</b></div><div class="card" style="margin:0"><div class="small">إجمالي المرتجعات</div><b>${money(r.total_returns)} د.أ</b></div></div>
        <h3 style="margin-top:18px">حركة الحساب</h3>
        ${(r.movements||[]).map((m,i)=>movementHtml(m,i)).join('')||'<div class="muted">لا توجد حركات مسجلة.</div>'}
        <button class="btn secondary wide" id="prBack" style="margin-top:14px">رجوع للزبائن</button>
      </div>`;
      bind(cid);
      document.getElementById('prBack').onclick=()=>{if(typeof renderAll==='function')renderAll()};
    }catch(e){
      list.innerHTML=`<div class="card"><div style="color:#991b1b">${esc(e.message)}</div><button class="btn secondary wide" id="prBackErr" style="margin-top:12px">رجوع</button></div>`;
      document.getElementById('prBackErr').onclick=()=>{if(typeof renderAll==='function')renderAll()};
    }
  }

  window.openPartialReturnStatement=openStatement;
  window.statement=function(cid){return openStatement(cid)};
})();