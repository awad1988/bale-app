(function(){
  async function updateDashboardBales(){
    try{
      const r=await fetch('/api/v3/inventory/full',{cache:'no-store'});
      const b=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(b.error||'فشل تحميل عدد المخزون');
      const all=Array.isArray(b.bales)?b.bales:[];
      const available=all.filter(x=>!/مباع/i.test(String(x.status||'')));
      const el=document.getElementById('mBales');
      if(el) el.textContent=available.length.toLocaleString('en-US');
    }catch(e){
      console.error('dashboard inventory count',e);
    }
  }
  function install(){
    updateDashboardBales();
    try{
      if(typeof renderAll==='function' && !renderAll.__dashboardInventoryPatched){
        const original=renderAll;
        const wrapped=function(){
          const result=original.apply(this,arguments);
          setTimeout(updateDashboardBales,0);
          return result;
        };
        wrapped.__dashboardInventoryPatched=true;
        renderAll=wrapped;
      }
    }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
