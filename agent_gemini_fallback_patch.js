(function(){
  const originalFetch=window.fetch.bind(window);
  const quotaRe=/(quota|high demand|rate limit|resource_exhausted|too many requests|try again|429)/i;

  function normalizeFallbackPrompt(prompt){
    return String(prompt||'')
      // Split a second product even when Arabic waw is attached to the next word: "وجاكيت ... عدد 2 بالة بسعر 180".
      // Do not split words like "وكيل" / "والزبون" / "والعميل".
      .replace(/\s*و(?!كيل\b|الزبون\b|العميل\b)(?=[^،؛\n]{1,90}(?:عدد\s*)?\d+\s*(?:باله|بالات|بالة)\b[^،؛\n]{0,60}(?:بسعر|سعر|بقيمة|قيمة))/gi,'، ')
      .replace(/\s*(?:وضيف|واضيف|وأضيف|وإضيف)\s+/gi,'، ')
      // Normalize spoken/typed quantity forms so the safe local parser sees them consistently.
      .replace(/عدد\s*(\d+)\s*(?:باله|بالة|بالات)/gi,'عدد $1 بالة')
      .replace(/(\d+)\s*(?:باله|بالة|بالات)/gi,'$1 بالة');
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:String(input&&input.url||'');
    if(!url.includes('/api/v10/agent/sale-preview')) return originalFetch(input,init);

    const primary=await originalFetch(input,init);
    if(primary.ok) return primary;

    let primaryBody={};
    try{primaryBody=await primary.clone().json()}catch(_){ }
    const primaryMessage=String(primaryBody.error||'');
    if(!quotaRe.test(primaryMessage)) return primary;

    try{
      let fallbackInit={...(init||{})};
      if(fallbackInit.body){
        try{
          const payload=JSON.parse(String(fallbackInit.body));
          payload.prompt=normalizeFallbackPrompt(payload.prompt);
          fallbackInit.body=JSON.stringify(payload);
        }catch(_){ }
      }
      const fallback=await originalFetch('/api/v7/agent/sale-preview',fallbackInit);
      if(!fallback.ok) return fallback;
      const body=await fallback.json();
      body.provider='local-fallback';
      body.message=(body.message||'')+' (Gemini مشغول، استخدمت الفهم الاحتياطي الآمن.)';
      return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
    }catch(_){
      return primary;
    }
  };
})();
