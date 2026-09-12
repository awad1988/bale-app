(function(){
  const originalRefresh = window.refresh;
  let fullRefreshRunning = false;

  async function fullRefreshInBackground(){
    if(fullRefreshRunning || typeof originalRefresh !== 'function') return;
    fullRefreshRunning = true;
    try{
      await originalRefresh();
    }catch(_){
      // The fast payload is already usable; keep the UI available if the
      // background inventory refresh has a transient network failure.
    }finally{
      fullRefreshRunning = false;
    }
  }

  async function fastInitialLoad(){
    const status=document.getElementById('cloudStatus');
    try{
      const fast = await api('/api/v12/data/fast');
      data = fast || {shipments:[],bales:[],customers:[],payments:[]};
      if(!Array.isArray(data.bales)) data.bales=[];
      if(status) status.textContent='سحابي • متصل';
      renderAll();
      setTodayDates();

      // Heavy bale/inventory data is deliberately loaded only after the
      // visible business data has already rendered.
      if('requestIdleCallback' in window){
        requestIdleCallback(()=>fullRefreshInBackground(),{timeout:1800});
      }else{
        setTimeout(()=>fullRefreshInBackground(),700);
      }
    }catch(e){
      // Preserve previous behavior as a safe fallback.
      if(typeof originalRefresh==='function') await originalRefresh();
    }
  }

  window.fastInitialLoad = fastInitialLoad;
  fastInitialLoad();
})();
