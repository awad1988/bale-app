(function(){
  function el(id){ return document.getElementById(id); }
  function value(id){ const x=el(id); return x ? String(x.value||'').trim() : ''; }
  function numberValue(id){ const n=Number(value(id)); return Number.isFinite(n) ? n : 0; }

  function installFormFix(){
    const form=el('baleForm');
    const nameAr=el('nameAr');
    const nameEn=el('nameEn');
    if(!form || !nameAr || !nameEn) return;

    nameAr.type='text';
    nameAr.removeAttribute('hidden');
    nameAr.style.display='block';
    nameAr.placeholder='اكتب الاسم بالعربي أو اختر من القائمة';

    const select=el('oldBaleCatalogSelect');
    if(select && !el('manualArabicNameHint')){
      const hint=document.createElement('div');
      hint.id='manualArabicNameHint';
      hint.className='small';
      hint.style.marginTop='6px';
      hint.textContent='يمكنك اختيار صنف موجود من القائمة أو كتابة اسم عربي جديد يدويًا.';
      nameAr.insertAdjacentElement('afterend',hint);
    }

    if(!el('baleQty')){
      const weight=el('weight');
      const target=weight && weight.parentElement ? weight.parentElement : null;
      const box=document.createElement('div');
      box.innerHTML='<label>الكمية / عدد البالات</label><input id="baleQty" type="number" inputmode="numeric" min="1" step="1" value="1" placeholder="1">';
      if(target && target.parentElement && target.parentElement.classList.contains('row')){
        target.parentElement.insertAdjacentElement('beforebegin',box);
      }else{
        const saveBtn=form.querySelector('button[onclick*="saveBale"]');
        if(saveBtn) saveBtn.insertAdjacentElement('beforebegin',box); else form.appendChild(box);
      }
    }
  }

  async function saveBaleWithQuantity(){
    if(!value('baleShipment')) return alert('أضف شحنة أولاً');
    if(!value('nameEn') && !value('nameAr')) return alert('أدخل اسم الصنف');

    const qty=Math.floor(numberValue('baleQty')||1);
    if(qty<1) return alert('أدخل كمية صحيحة، 1 أو أكثر');
    if(qty>500) return alert('الكمية كبيرة جدًا. الحد الأقصى 500 بالة في العملية الواحدة.');

    const base={
      shipmentId:value('baleShipment'),
      grade:value('grade'),
      nameEn:value('nameEn'),
      nameAr:value('nameAr'),
      weight:numberValue('weight'),
      buyUsd:numberValue('buyUsd'),
      status:'في الطريق'
    };

    const btn=document.querySelector('#baleForm button[onclick*="saveBale"]');
    const oldText=btn ? btn.textContent : '';
    if(btn){ btn.disabled=true; btn.textContent='جاري حفظ '+qty+' بالة...'; }

    try{
      for(let i=0;i<qty;i++){
        const x={...base,id:(typeof uid==='function'?uid():String(Date.now())+'-'+i)};
        if(typeof api==='function'){
          await api('/api/bales',{method:'POST',body:JSON.stringify(x)});
        }else{
          const r=await fetch('/api/bales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});
          const b=await r.json().catch(()=>({}));
          if(!r.ok) throw new Error(b.error||'فشل حفظ البالة');
        }
      }

      ['nameEn','nameAr','weight','buyUsd'].forEach(id=>{ if(el(id)) el(id).value=''; });
      if(el('baleQty')) el('baleQty').value='1';
      const catalog=el('oldBaleCatalogSelect');
      if(catalog) catalog.value='';
      if(typeof refresh==='function') await refresh();
      if(typeof refreshInventoryNow==='function') await refreshInventoryNow();
      alert('تمت إضافة '+qty+' بالة للمخزون بنجاح.');
    }catch(e){
      alert(e && e.message ? e.message : 'تعذر حفظ البالات');
    }finally{
      if(btn){ btn.disabled=false; btn.textContent=oldText||'حفظ البالة'; }
    }
  }

  function install(){
    installFormFix();
    window.saveBale=saveBaleWithQuantity;
    document.addEventListener('click',function(e){
      const t=e.target&&e.target.closest?e.target.closest('button,a,[role="button"]'):null;
      if(t && String(t.textContent||'').includes('إضافة بالة')) setTimeout(installFormFix,0);
    },true);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
