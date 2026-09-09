(function(){
  const CARD_ID='italianApprovedSaleCard';

  function el(id){ return document.getElementById(id); }
  function money(v){ return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

  async function call(url,opt){
    const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});
    const b=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(b.error||'تعذر تنفيذ العملية');
    return b;
  }

  function renderPreview(p){
    const out=el('italianSaleResult');
    const bad=(p.lines||[]).filter(x=>!x.ok);
    if(p.already_recorded){
      out.innerHTML='<div style="padding:10px;border-radius:10px;background:#ecfdf5;color:#166534;font-weight:700">هذه المبيعة مسجلة مسبقًا. لن يسمح النظام بتكرارها.</div>';
      el('italianSaleCommit').classList.add('hidden');
      return;
    }
    const status=p.ok?'✅ كل الأصناف والكميات متوفرة':'⚠️ يوجد نقص ويجب عدم التسجيل';
    out.innerHTML=
      '<div style="margin-top:10px;padding:10px;border-radius:10px;background:'+(p.ok?'#ecfdf5':'#fee2e2')+';color:'+(p.ok?'#166534':'#991b1b')+'">'+
      '<b>'+status+'</b><br>'+p.customer.name+' — الرصيد الحالي '+money(p.customer.current_debt)+' د.أ<br>'+ 
      'بعد المبيعة: '+money(p.expected_debt_after)+' د.أ<br>'+ 
      'الكمية: '+p.total_qty+' بالة • الإجمالي: '+money(p.total_jod)+' د.أ'+
      (bad.length?'<br><br>'+bad.map(x=>x.name+' — المطلوب '+x.qty+' والمتاح '+(x.already_marked+x.available)).join('<br>'):'')+
      '</div>';
    el('italianSaleCommit').classList.toggle('hidden',!p.ok);
  }

  async function preview(){
    try{
      el('italianSaleResult').textContent='جاري فحص المخزون والحساب...';
      const p=await call('/api/v2/sales/italian-2026-09-09/preview');
      renderPreview(p);
    }catch(e){
      el('italianSaleResult').innerHTML='<div style="color:#991b1b;margin-top:10px">'+e.message+'</div>';
    }
  }

  async function commit(){
    if(!confirm('تأكيد تسجيل المبيعة الحقيقية؟\n\nحمودة الإيطالي\n114 بالة\n19,060 د.أ\nآجل بالكامل — المدفوع 0\n\nسيتم خصم الأصناف من المخزون وزيادة دين الزبون.')) return;
    const btn=el('italianSaleCommit');
    btn.disabled=true;
    btn.textContent='جاري التسجيل...';
    try{
      const b=await call('/api/v2/sales/italian-2026-09-09/commit',{method:'POST',body:'{}'});
      el('italianSaleResult').innerHTML='<div style="margin-top:10px;padding:10px;border-radius:10px;background:#ecfdf5;color:#166534;font-weight:700">تم تسجيل المبيعة بنجاح ✅<br>114 بالة • 19,060 د.أ<br>رصيد حمودة الإيطالي الآن: '+money(b.debt)+' د.أ</div>';
      btn.classList.add('hidden');
      if(typeof refresh==='function') await refresh();
    }catch(e){
      btn.disabled=false;
      btn.textContent='تسجيل المبيعة الآن';
      el('italianSaleResult').innerHTML='<div style="color:#991b1b;margin-top:10px">لم يتم التسجيل: '+e.message+'</div>';
    }
  }

  function install(){
    const section=el('customers');
    const list=el('customerList');
    if(!section||!list||el(CARD_ID)) return;
    const card=document.createElement('div');
    card.id=CARD_ID;
    card.className='card';
    card.style.marginBottom='12px';
    card.innerHTML=
      '<h3 style="margin-top:0">مبيعة حمودة الإيطالي المعتمدة</h3>'+ 
      '<div class="muted">فاتورة حقيقية • 114 بالة • 19,060 د.أ • آجل بالكامل • مدفوع 0</div>'+ 
      '<div class="notice" style="margin-top:10px">التصحيحات المعتمدة: WINTER ABAYA عدد 5 وزن 25 كغ بدل WINTER FANCY، وLADY FLANNEL BLOUSE C عدد 3 بدل LADY WINTER BLOUSE، وLADY WINTER BLOUSE C عدد 5 بدل BODY SWEATER.</div>'+ 
      '<button id="italianSalePreview" class="btn secondary wide">فحص المبيعة قبل التسجيل</button>'+ 
      '<button id="italianSaleCommit" class="btn primary wide hidden">تسجيل المبيعة الآن</button>'+ 
      '<div id="italianSaleResult"></div>';
    list.parentElement.insertBefore(card,list);
    el('italianSalePreview').onclick=preview;
    el('italianSaleCommit').onclick=commit;
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
