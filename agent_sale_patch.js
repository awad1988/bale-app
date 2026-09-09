(function(){
  const originalRun=window.runAgent;
  let pendingSalePrompt='';
  let invoiceMode=false;
  function el(id){return document.getElementById(id)}
  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function isSaleCommand(v){const s=String(v||'');return /(بيع|مبيع|بيعة|بيعه|فاتورة|فاتوره)/.test(s)}
  function isShortFollowup(v){
    const s=String(v||'').trim();
    if(!s||s.length>180)return false;
    if(invoiceMode)return true;
    return /(بالة|باله|بالات|كيلو|كغ|كريم|EX|اكسترا|إكسترا|A|B|بسعر|سعر|دفع|مدفوع|اجمالي|إجمالي|المجموع|مجموع|^[٠-٩0-9\s.]+$)/i.test(s);
  }
  async function call(url,opt){const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر فهم المبيعة');return b}
  function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

  function linesHtml(lines){
    return (lines||[]).map((x,i)=>{
      const p=x.product||{};
      return `<div style="padding:8px 10px;margin-top:7px;background:#ffffffaa;border-radius:10px;color:#14532d"><b>${i+1}. ${safe(p.name_ar||p.name_en||'صنف')}</b><br>${safe(p.grade||'')} • ${Number(p.weight||0)} كغ • ${Number(x.quantity||0)} بالة${x.unit_price_jod?`<br>سعر البالة: ${money(x.unit_price_jod)} د.أ`:''}${x.total_jod?`<br><b>إجمالي الصنف: ${money(x.total_jod)} د.أ</b>`:''}</div>`;
    }).join('');
  }

  function show(r,fullPrompt){
    const out=el('agentResult');if(!out)return;
    if(r.needs_more){
      invoiceMode=!!r.invoice_mode;
      pendingSalePrompt=fullPrompt||pendingSalePrompt;
      out.innerHTML=`<div style="background:#fff7ed;color:#7c2d12;border-radius:12px;padding:12px"><b>${invoiceMode?'فاتورة قيد التجهيز':'المبيعة ناقصة معلومة'}</b><br>${safe(r.message)}${linesHtml(r.lines)}<div style="font-size:12px;margin-top:8px">اكتب المعلومة أو الصنف التالي فقط، وأنا أكمل نفس الفاتورة.</div></div>`;
      return;
    }
    if(r.needs_choice){
      invoiceMode=!!r.invoice_mode||invoiceMode;
      pendingSalePrompt=fullPrompt||pendingSalePrompt;
      out.innerHTML=`<div style="background:#fff7ed;color:#7c2d12;border-radius:12px;padding:12px"><b>احتاج تحديد التصنيف</b><br>${safe(r.message)}${linesHtml(r.lines)}<br>${(r.matches||[]).map(x=>`<div style="margin-top:6px">• ${safe(x.name_ar||x.name_en)} • ${safe(x.grade)} • ${Number(x.weight||0)} كغ • متاح ${Number(x.quantity||0)}</div>`).join('')}<div style="font-size:12px;margin-top:8px">اكتب فقط التصنيف المطلوب مثل: 40 كيلو EX</div></div>`;
      return;
    }

    const lines=(r.lines&&r.lines.length)?r.lines:[{product:r.product,quantity:r.quantity,unit_price_jod:r.unit_price_jod,total_jod:r.total_jod}];
    invoiceMode=!!r.invoice_mode;
    pendingSalePrompt=invoiceMode?(fullPrompt||pendingSalePrompt):'';
    const title=invoiceMode?'✅ فهمت الفاتورة':'✅ فهمت المبيعة';
    const note=invoiceMode?'تقدر تكتب «وزيد ...» لإضافة صنف آخر، أو انقل الفاتورة للفحص النهائي.':'لم يتم تسجيل أي شيء. التسجيل يتم فقط بعد فحص المبيعة وتأكيدك.';
    out.innerHTML=`<div style="background:#ecfdf5;color:#166534;border-radius:12px;padding:12px"><b>${title}</b><br>الزبون: <b>${safe(r.customer?.name)}</b>${linesHtml(lines)}<div style="margin-top:9px">عدد البالات: <b>${Number(r.total_qty||lines.reduce((s,x)=>s+Number(x.quantity||0),0))}</b><br>إجمالي ${invoiceMode?'الفاتورة':'المبيعة'}: <b>${money(r.total_jod)} د.أ</b><br>الرصيد الحالي: ${money(r.customer?.current_debt)} د.أ<br>الرصيد المتوقع بعد التسجيل: <b>${money(r.expected_debt_after)} د.أ</b></div><div style="font-size:12px;margin-top:8px">${note}</div><button id="asPrepareSale" class="btn wide" style="margin-top:12px">${invoiceMode?'نقل الفاتورة إلى شاشة المبيعات للفحص':'نقلها إلى شاشة المبيعات للفحص'}</button>${invoiceMode?'<button id="asFinishInvoice" class="btn wide" style="margin-top:8px;background:#ffffff;color:#166534">إنهاء إضافة الأصناف والاحتفاظ بالمعاينة</button>':''}</div>`;
    el('asPrepareSale').onclick=()=>prepare(r,lines);
    if(el('asFinishInvoice')) el('asFinishInvoice').onclick=()=>{invoiceMode=false;pendingSalePrompt='';el('agentPrompt').value='';};
  }

  async function prepare(r,lines){
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
      let rows=[...document.querySelectorAll('[data-gs-row]')];
      while(rows.length>lines.length&&rows.length>1){
        const btn=rows[rows.length-1].querySelector('.gsRemove');
        if(btn) btn.click();
        rows=[...document.querySelectorAll('[data-gs-row]')];
      }
      while(rows.length<lines.length){
        el('gsAddLine')?.click();
        rows=[...document.querySelectorAll('[data-gs-row]')];
      }
      rows=[...document.querySelectorAll('[data-gs-row]')];
      lines.forEach((line,i)=>{
        const row=rows[i];if(!row)return;
        const prod=row.querySelector('.gsProd');
        const p=line.product||{};
        const targetName=String(p.name_ar||p.name_en||'').trim();
        const targetGrade=String(p.grade||'').trim();
        const targetWeight=Number(p.weight||0);
        const option=[...prod.options].find(o=>{
          const text=String(o.textContent||'');
          return text.includes(targetName)&&text.includes(targetGrade)&&text.includes(String(targetWeight)+' كغ');
        });
        if(option){prod.value=option.value;prod.dispatchEvent(new Event('change',{bubbles:true}))}
        const qty=row.querySelector('.gsQtyIn'); if(qty){qty.value=String(line.quantity||1);qty.dispatchEvent(new Event('change',{bubbles:true}))}
        const amt=row.querySelector('.gsAmt'); if(amt){amt.value=String(line.total_jod||0);amt.dispatchEvent(new Event('change',{bubbles:true}))}
      });
      const paid=el('gsPaid'); if(paid) paid.value='0';
      const notes=el('gsNotes'); if(notes) notes.value='تم تجهيز الفاتورة من الوكيل الذكي';
      el('gsResult')?.replaceChildren();
      invoiceMode=false;pendingSalePrompt='';
    },350);
  }

  window.runAgent=async function(){
    const typed=el('agentPrompt')?.value.trim()||'';
    const continuing=!!pendingSalePrompt&&isShortFollowup(typed)&&!isSaleCommand(typed);
    if(!isSaleCommand(typed)&&!continuing) return typeof originalRun==='function'?originalRun():undefined;
    const prompt=continuing?(pendingSalePrompt+' وزيد '+typed):typed;
    const button=el('agentRunButton');
    if(!prompt)return;
    if(button){button.disabled=true;button.textContent='جاري فهم الفاتورة...'}
    try{
      const r=await call('/api/v7/agent/sale-preview',{method:'POST',body:JSON.stringify({prompt})});
      show(r,prompt);
    }
    catch(e){
      if(/اذكر عدد البالات|اذكر السعر|لم أتعرف على الصنف|اسم الزبون/.test(String(e.message||''))) pendingSalePrompt=prompt;
      const suffix=pendingSalePrompt?'\nتقدر تكمل بالمعلومة الناقصة فقط بدون إعادة الكلام من البداية.':'';
      if(typeof window.showAgentMessage==='function')window.showAgentMessage(e.message+suffix);else if(el('agentResult'))el('agentResult').textContent=e.message+suffix;
    }
    finally{if(button){button.disabled=false;button.textContent='فهم الأمر'}}
  };
})();
