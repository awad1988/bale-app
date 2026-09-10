(function(){
  const originalStatement=window.statement;
  if(typeof originalStatement!=='function')return;

  function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function dateFmt(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?String(v).slice(0,10):d.toLocaleDateString('en-GB')}
  function phoneForWhatsApp(value){
    let digits=String(value||'').replace(/\D/g,'');
    if(digits.startsWith('00'))digits=digits.slice(2);
    if(digits.startsWith('0'))digits='962'+digits.slice(1);
    if(digits&&!digits.startsWith('962')&&digits.length<=9)digits='962'+digits;
    return digits;
  }
  async function jsonCall(url){
    const response=await fetch(url,{cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||'تعذر تجهيز كشف الحساب للإرسال.');
    return body;
  }
  function statementText(r){
    const c=r.customer||{};
    const latest=(r.movements||[]).slice(0,25).reverse();
    const rows=latest.map(m=>{
      const sale=m.type==='sale';
      const returned=m.type==='return';
      const title=returned?'مرتجع':sale?'مبيعة':'دفعة';
      const amount=returned?Number(m.returned_total||0):Math.abs(Number(m.amount||0));
      const sign=sale&&Number(m.amount||0)>=0?'+':'−';
      return `${dateFmt(m.date)} | ${title} | ${sign}${money(amount)} د.أ | الرصيد ${money(m.balance_after)} د.أ`;
    });
    const label=(r.movements||[]).length>latest.length?`آخر ${latest.length} حركة من أصل ${(r.movements||[]).length}`:'حركة الحساب';
    return [
      'وكالة البالة',
      `كشف حساب: ${c.name||''}`,
      `الرصيد الحالي: ${money(c.current_debt)} د.أ`,
      `إجمالي المبيعات: ${money(r.total_sales)} د.أ`,
      `إجمالي الدفعات: ${money(r.total_payments)} د.أ`,
      `إجمالي المرتجعات: ${money(r.total_returns)} د.أ`,
      '',`${label}:`,...(rows.length?rows:['لا توجد حركات مسجلة.'])
    ].join('\n');
  }
  function attachButtons(r){
    if(document.getElementById('statementShareActions'))return;
    const back=document.getElementById('prBack')||document.getElementById('csBack');
    if(!back)return;
    const actions=document.createElement('div');
    actions.id='statementShareActions';
    actions.className='row';
    actions.style.marginTop='14px';
    actions.innerHTML='<button class="btn secondary wide" id="statementWhatsAppManual">فتح الكشف في واتساب</button><button class="btn wide" id="statementWhatsAppAuto">إرسال تلقائي عبر واتساب</button>';
    back.parentNode.insertBefore(actions,back);

    const phone=phoneForWhatsApp(r.customer?.phone);
    const message=statementText(r);
    document.getElementById('statementWhatsAppManual').onclick=()=>{
      if(!/^9627\d{8}$/.test(phone)){alert('رقم واتساب للزبون غير صالح. عدّله أولًا.');return;}
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener');
    };
    const automatic=document.getElementById('statementWhatsAppAuto');
    automatic.onclick=async()=>{
      if(!/^9627\d{8}$/.test(phone)){alert('رقم واتساب للزبون غير صالح. عدّله أولًا.');return;}
      if(!confirm(`تأكيد إرسال كشف الحساب تلقائيًا إلى ${r.customer.name} على الرقم ${r.customer.phone}؟`))return;
      const pin=prompt('أدخل رمز التأكيد الإداري للإرسال:');if(!pin)return;
      automatic.disabled=true;automatic.textContent='جاري الإرسال...';
      try{
        const response=await fetch('/api/v7/whatsapp/send',{method:'POST',headers:{'Content-Type':'application/json','x-admin-pin':pin},body:JSON.stringify({confirmation:'SEND-CONFIRMED',phone:r.customer.phone,message})});
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.error||'تعذر إرسال الكشف.');
        alert('تم إرسال كشف الحساب عبر واتساب.');
      }catch(error){alert(error.message)}
      finally{automatic.disabled=false;automatic.textContent='إرسال تلقائي عبر واتساب'}
    };
  }
  async function enhance(cid){
    for(let attempt=0;attempt<30;attempt+=1){
      if(document.getElementById('prBack')||document.getElementById('csBack'))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    try{attachButtons(await jsonCall('/api/v7/customers/'+encodeURIComponent(cid)+'/statement'))}
    catch(error){console.warn('Statement share buttons unavailable:',error.message)}
  }
  window.statement=function(cid){
    const result=originalStatement(cid);
    enhance(cid);
    return result;
  };
})();
