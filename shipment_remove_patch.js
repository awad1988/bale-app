(function(){
  const TOTAL_CUSTOMS_EXPENSES_JOD=48000;
  const CUSTOMS_ALLOCATION_BALES=2773;

  window.showShipmentItems = function(id){
    const shipment=(data.shipments||[]).find(s=>String(s.id)===String(id));
    if(!shipment) return alert('الشحنة غير موجودة');
    const items=(data.bales||[]).filter(b=>String(b.shipmentId)===String(id));
    const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const holder=document.getElementById('shipmentList');
    if(!holder) return;
    const rows=items.map(b=>`<tr>
      <td><b>${safe(b.nameAr||'-')}</b><div class="small">${safe(b.nameEn||'')}</div></td>
      <td>${safe(b.grade||'-')}</td>
      <td>${Number(b.weight||0)}</td>
      <td>${Number(b.buyUsd||0).toFixed(2)}</td>
      <td>${safe(b.status||'')}</td>
    </tr>`).join('');
    holder.innerHTML=`<div class="card">
      <h2>أصناف الشحنة: ${safe(shipment.container||'')}</h2>
      <div class="small" style="margin-bottom:10px">عدد البالات: ${items.length}</div>
      <div style="overflow:auto"><table><thead><tr><th>الصنف</th><th>الدرجة</th><th>الوزن</th><th>شراء $</th><th>الحالة</th></tr></thead><tbody>${rows||'<tr><td colspan="5">لا توجد أصناف.</td></tr>'}</tbody></table></div>
      <button class="btn secondary wide" onclick="renderAll()" style="margin-top:12px">رجوع للشحنات</button>
    </div>`;
  };

  function hasAllocatedExpenses(){
    const baleCount=(data.bales||[]).length;
    return TOTAL_CUSTOMS_EXPENSES_JOD>0 && baleCount>=CUSTOMS_ALLOCATION_BALES;
  }

  const baseRenderAll=window.renderAll;
  window.renderAll=function(){
    baseRenderAll();
    const list=document.getElementById('shipmentList');
    if(!list) return;
    const shipments=(data.shipments||[]).slice().reverse();
    const allocated=hasAllocatedExpenses();

    [...list.children].forEach((card,index)=>{
      const s=shipments[index];
      if(!s) return;

      const pill=card.querySelector('.pill');
      const shipmentHasOwnExpenses=Number(s.customs||0)>0 || Number(s.clearance||0)>0 || Number(s.otherCost||0)>0;
      if(pill && (shipmentHasOwnExpenses || allocated)){
        pill.textContent='المصاريف مدخلة';
        pill.classList.remove('pending');
        pill.classList.add('ok');
      }

      if(!card.querySelector('[data-view-shipment-items]')){
        const btn=document.createElement('button');
        btn.className='btn secondary';
        btn.setAttribute('data-view-shipment-items','1');
        btn.style.marginTop='10px';
        btn.textContent='مشاهدة الأصناف';
        btn.onclick=()=>window.showShipmentItems(s.id);
        card.appendChild(btn);
      }
    });
  };
})();
