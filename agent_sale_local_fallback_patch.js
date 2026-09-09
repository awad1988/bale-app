(function(){
  const prevFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:String(input&&input.url||'');
    if(!url.includes('/api/v10/agent/sale-preview')) return prevFetch(input,init);

    let primary;
    try{
      primary=await prevFetch(input,init);
    }catch(_){
      primary=null;
    }
    if(primary&&primary.ok) return primary;

    try{
      const local=await prevFetch('/api/v7/agent/sale-preview',init);
      if(local.ok) return local;
      if(primary) return primary;
      return local;
    }catch(_){
      if(primary) return primary;
      throw _;
    }
  };
})();