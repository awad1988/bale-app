(function(){
  function installResetButton(){
    if(document.getElementById('resetExperimentalDataButton')) return;
    const dashboard=document.getElementById('dashboard');
    if(!dashboard) return;

    const card=document.createElement('div');
    card.className='card';
    card.id='resetExperimentalCard';
    card.style.marginTop='12px';
    card.innerHTML=`
      <h3 style="margin-top:0">بدء العمل الحقيقي</h3>
      <div class="muted">هذا الزر يحذف كل البيانات التشغيلية التجريبية: الشحنات، البالات، الزبائن، الموردين، المبيعات، الدفعات، المصاريف وحركات الصندوق. قائمة الأصناف والبرنامج تبقى كما هي.</div>
      <button id="resetExperimentalDataButton" class="btn danger wide" style="margin-top:12px">حذف كل البيانات التجريبية والبدء من صفر</button>
    `;
    dashboard.appendChild(card);

    document.getElementById('resetExperimentalDataButton').onclick=async()=>{
      const ok=confirm('تأكيد نهائي: سيتم حذف كل البيانات التشغيلية الحالية لأنها تجريبية. لا يمكن التراجع. هل تريد المتابعة؟');
      if(!ok) return;
      const typed=prompt('للتأكيد اكتب: احذف الكل التجريبي');
      if(String(typed||'').trim()!=='احذف الكل التجريبي'){
        alert('لم يتم الحذف لأن عبارة التأكيد غير مطابقة.');
        return;
      }

      const button=document.getElementById('resetExperimentalDataButton');
      button.disabled=true;
      button.textContent='جاري حذف البيانات التجريبية...';
      try{
        const result=await api('/api/reset-experimental-data',{
          method:'POST',
          body:JSON.stringify({confirmation:'RESET-ALL-EXPERIMENTAL'})
        });
        await refresh();
        alert(result.message||'تم حذف كل البيانات التجريبية. النظام جاهز للبدء من صفر.');
        card.remove();
      }catch(e){
        alert('تعذر إكمال الحذف: '+e.message);
        button.disabled=false;
        button.textContent='حذف كل البيانات التجريبية والبدء من صفر';
      }
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installResetButton);
  else installResetButton();
})();
