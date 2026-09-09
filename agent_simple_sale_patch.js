(function(){
  const prevRun=window.runAgent;
  function el(id){return document.getElementById(id)}
  function norm(v){
    return String(v||'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065f\u0670]/g,'').replace(/ـ/g,'').replace(/\s+/g,' ').trim();
  }
  function isSimpleFinancialSale(v){
    const s=norm(v);
    const sale=/(مبيع|بيعه|بيعة|بيع)/.test(s);
    const hasMoney=/(دينار|دنانير|د\.ا|د\.أ)/.test(s);
    const detailed=/(باله|بالات|عدد|صنف|اصناف|كيلو|كغ|وزن|بسعر|سعر الباله|كريم|اكسترا|\bex\b|\bextra\b|\bgrade\b)/i.test(s);
    return sale&&hasMoney&&!detailed;
  }
  async function apiAgent(prompt){
    const r=await fetch('/api/agent',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(b.error||'تعذر فهم المبيعة');
    return b;
  }
  window.runAgent=async function(){
    const prompt=el('agentPrompt')?.value.trim()||'';
    if(!isSimpleFinancialSale(prompt))return typeof prevRun==='function'?prevRun():undefined;
    const button=el('agentRunButton');
    if(button){button.disabled=true;button.textContent='جاري فهم المبيعة...'}
    try{
      const result=await apiAgent(prompt);
      window.agentPendingAction=result.action||null;
      try{agentPendingAction=result.action||null}catch(_){ }
      if(typeof window.showAgentMessage==='function'){
        window.showAgentMessage(result.message,result.mode,result.action);
      }else if(el('agentResult')){
        el('agentResult').textContent=result.message||'';
      }
    }catch(e){
      if(typeof window.showAgentMessage==='function')window.showAgentMessage(e.message);else if(el('agentResult'))el('agentResult').textContent=e.message;
    }finally{
      if(button){button.disabled=false;button.textContent='فهم الأمر'}
    }
  };
})();
