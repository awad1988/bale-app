(function(){
  function safe(value){
    return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  window.viewShipmentItems=function(id){
    const shipment=(data.shipments||[]).find(s=>String(s.id)===String(id));
    if(!shipment) return alert('الشحنة غير موجودة');

    const bales=(data.bales||[]).filter(b=>String(b.shipmentId)===String(id));
    const list=document.getElementById('shipmentList');
    if(!list) return;

    const rows=bales.map((b,index)=>`
      <tr>
        <td>${index+1}</td>
        <td><b>${safe(b.nameAr||'-')}</b><div class="small">${safe(b.nameEn||'')}</div></td>
        <td>${safe(b.grade||'-')}</td>
        <td>${Number(b.weight||0)}</td>
        <td>$ ${Number(b.buyUsd||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${safe(b.status||'-')}</td>
      </tr>`).join('');

    list.innerHTML=`
      <div class="card">
        <h2>أصناف الشحنة: ${safe(shipment.container||'')}</h2>
        <div class="small" style="margin-bottom:10px">${safe(shipment.supplier||'بدون مورد')} • ${bales.length} بالة</div>
        <div style="overflow:auto" class="card">
          <table>
            <thead><tr><th>#</th><th>الصنف</th><th>التصنيف</th><th>الوزن</th><th>شراء $</th><th>الحالة</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="muted">لا توجد أصناف مسجلة في هذه الشحنة.</td></tr>'}</tbody>
          </table>
        </div>
        <button class="btn secondary wide" onclick="renderAll()" style="margin-top:15px">رجوع للشحنات</button>
      </div>`;
  };

  const baseRenderAll=window.renderAll;
  window.renderAll=function(){
    baseRenderAll();
    const list=document.getElementById('shipmentList');
    if(!list) return;
    const shipments=(data.shipments||[]).slice().reverse();
    [...list.children].forEach((card,index)=>{
      const s=shipments[index];
      if(!s || card.querySelector('[data-view-shipment]')) return;
      const btn=document.createElement('button');
      btn.className='btn secondary';
      btn.setAttribute('data-view-shipment','1');
      btn.style.marginTop='10px';
      btn.textContent='مشاهدة الأصناف';
      btn.onclick=()=>window.viewShipmentItems(s.id);
      card.appendChild(btn);
    });
  };
})();
