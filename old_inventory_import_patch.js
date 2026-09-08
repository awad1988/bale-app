(function(){
  function install(){
    const section=document.getElementById('inventory');
    if(!section||document.getElementById('oldInventoryImportCard')) return;
    const card=document.createElement('div');
    card.id='oldInventoryImportCard';
    card.className='card';
    card.style.marginBottom='12px';
    card.innerHTML=`
      <h3 style="margin-top:0">ربط الكشف القديم بالمخزون الحالي</h3>
      <div class="small" style="line-height:1.8">الكشف القديم المعتمد: 54 صف • 653 بالة • 21,925 كغ • 75,850 دولار • الفرع الجديد</div>
      <div class="notice" style="margin-top:10px">سيتم دمج الصنف مع الموجود إذا تطابق الاسم الإنجليزي + الدرجة + الوزن + الموسم. النظام يمنع تكرار نفس الدفعة.</div>
      <input id="oldInventoryImportFile" type="file" accept="application/json,.json">
      <button id="oldInventoryImportBtn" class="btn primary wide">فحص ثم ربط الكشف القديم</button>
      <div id="oldInventoryImportResult" class="small" style="margin-top:10px"></div>`;
    const notice=section.querySelector('.notice');
    if(notice) section.insertBefore(card,notice); else section.prepend(card);

    document.getElementById('oldInventoryImportBtn').addEventListener('click',async function(){
      const file=document.getElementById('oldInventoryImportFile').files[0];
      const result=document.getElementById('oldInventoryImportResult');
      if(!file){ result.textContent='اختر ملف الكشف القديم أولاً.'; return; }
      let payload;
      try{ payload=JSON.parse(await file.text()); }catch(e){ result.textContent='الملف ليس JSON صالحًا.'; return; }
      const rows=Array.isArray(payload.rows)?payload.rows:[];
      const qty=rows.reduce((a,x)=>a+Number(x.quantity||0),0);
      const weight=rows.reduce((a,x)=>a+Number(x.total_weight_kg||0),0);
      const total=rows.reduce((a,x)=>a+Number(x.invoice_total_usd||0),0);
      if(rows.length!==54||qty!==653||weight!==21925||total!==75850||Number(payload.branch_id)!==2||String(payload.season)!=='شتوي'){
        result.textContent='تم إيقاف الربط: أرقام الملف لا تطابق الكشف القديم المعتمد.';
        return;
      }
      if(!confirm('تم فحص الكشف القديم: 54 صف و653 بالة. ربطه مع مخزون الفرع الجديد؟')) return;
      const btn=this; btn.disabled=true; result.textContent='جاري الربط... لا تغلق الصفحة.';
      try{
        const r=await fetch('/api/v2/inventory/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const b=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(b.error||'فشل الربط');
        result.textContent=b.already_imported?'الكشف القديم مربوط سابقًا ولم يتم تكراره.':`تم الربط: ${Number(b.imported_quantity||0).toLocaleString('en-US')} بالة • جديد ${b.created_products||0} • مطابق مع موجود ${b.updated_products||0}`;
        setTimeout(()=>location.reload(),1800);
      }catch(e){ result.textContent='خطأ: '+e.message; btn.disabled=false; }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
