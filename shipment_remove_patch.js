(function(){
  window.removeShipment = async function(id){
    const shipment=(data.shipments||[]).find(s=>String(s.id)===String(id));
    if(!shipment) return alert('الشحنة غير موجودة');
    const count=(data.bales||[]).filter(b=>String(b.shipmentId)===String(id)).length;
    if(!confirm('تأكيد حذف الشحنة '+(shipment.container||'')+' مع '+count+' بالة مرتبطة بها؟')) return;
    try{
      await api('/api/shipments/'+encodeURIComponent(id),{method:'DELETE'});
      await refresh();
      alert('تم حذف الشحنة.');
    }catch(e){ alert(e.message); }
  };

  const baseRenderAll=window.renderAll;
  window.renderAll=function(){
    baseRenderAll();
    const list=document.getElementById('shipmentList');
    if(!list) return;
    const shipments=(data.shipments||[]).slice().reverse();
    [...list.children].forEach((card,index)=>{
      const s=shipments[index];
      if(!s || card.querySelector('[data-remove-shipment]')) return;
      const btn=document.createElement('button');
      btn.className='btn danger';
      btn.setAttribute('data-remove-shipment','1');
      btn.style.marginTop='10px';
      btn.textContent='حذف الشحنة';
      btn.onclick=()=>window.removeShipment(s.id);
      card.appendChild(btn);
    });
  };
})();
