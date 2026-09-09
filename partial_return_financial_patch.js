(function(){
  const realFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const response=await realFetch(input,init);
    try{
      const m=String(url).match(/\/api\/v7\/sales\/([^/]+)\/partial-return(?:\?|$)/);
      const method=String(init?.method||'GET').toUpperCase();
      if(m&&method==='POST'&&response.ok){
        const saleId=decodeURIComponent(m[1]);
        const rr=await realFetch('/api/v8/sales/'+encodeURIComponent(saleId)+'/reconcile-return',{
          method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'
        });
        const body=await rr.json().catch(()=>({}));
        if(!rr.ok)throw new Error(body.error||'تعذر تسوية المرتجع ماليًا');
      }
    }catch(e){
      console.error('partial return finance reconciliation failed',e);
      throw e;
    }
    return response;
  };
})();
