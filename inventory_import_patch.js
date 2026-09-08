(function(){
  function install(){
    const section=document.getElementById('inventory');
    if(!section||document.getElementById('inventoryImportCard')) return;
    const card=document.createElement('div');
    card.id='inventoryImportCard';
    card.className='card';
    card.style.marginBottom='12px';
    card.innerHTML=`
      <h3 style="margin-top:0">استيراد الكشوفات الثلاثة الجديدة</h3>
      <div class="small" style="line-height:1.8">الملف المعتمد: 89 صف • 2,120 بالة • 65,375 كغ • 218,325 دولار • الفرع الجديد</div>
      <div class="notice" style="margin-top:10px">اختر ملف الاستيراد النهائي فقط. النظام يمنع تكرار نفس الدفعة.</div>
      <input id="inventoryImportFile" type="file" accept="application/json,.json">
      <button id="inventoryImportBtn" class="btn primary wide">فحص ثم استيراد</button>
      <div id="inventoryImportResult" class="small" style="margin-top:10px"></div>`;
    const title=section.querySelector('.section-title');
    if(title&&title.nextSibling) section.insertBefore(card,title.nextSibling); else section.prepend(card);

    document.getElementById('inventoryImportBtn').addEventListener('click',async function(){
      const file=document.getElementById('inventoryImportFile').files[0];
      const result=document.getElementById('inventoryImportResult');
      if(!file){ result.textContent='اختر ملف الاستيراد أولاً.'; return; }
      let payload;
      try{ payload=JSON.parse(await file.text()); }catch(e){ result.textContent='الملف ليس JSON صالحًا.'; return; }
      const rows=Array.isArray(payload.rows)?payload.rows:[];
      const qty=rows.reduce((a,x)=>a+Number(x.quantity||0),0);
      const weight=rows.reduce((a,x)=>a+Number(x.total_weight_kg||0),0);
      const total=rows.reduce((a,x)=>a+Number(x.invoice_total_usd||0),0);
      if(rows.length!==89||qty!==2120||weight!==65375||total!==218325||Number(payload.branch_id)!==2||String(payload.season)!=='شتوي'){
        result.textContent='تم إيقاف الاستيراد: أرقام الملف لا تطابق الكشف المعتمد.';
        return;
      }
      if(!confirm('تم فحص الملف: 89 صف و2,120 بالة. تأكيد الاستيراد إلى الفرع الجديد؟')) return;
      const btn=this; btn.disabled=true; result.textContent='جاري الاستيراد... لا تغلق الصفحة.';
      try{
        const r=await fetch('/api/v2/inventory/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const b=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(b.error||'فشل الاستيراد');
        result.textContent=b.already_imported?'هذه الدفعة مستوردة سابقًا ولم يتم تكرارها.':`تم الاستيراد: ${Number(b.imported_quantity||0).toLocaleString('en-US')} بالة • جديد ${b.created_products||0} • مطابق مع موجود ${b.updated_products||0}`;
        setTimeout(()=>location.reload(),1800);
      }catch(e){ result.textContent='خطأ: '+e.message; btn.disabled=false; }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
