(function(){
  const prevRun=window.runAgent;
  function el(id){return document.getElementById(id)}
  function norm(v){return String(v||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065f\u0670]/g,'').replace(/ـ/g,'').replace(/\s+/g,' ').trim()}
  function isReturn(v){return /(ارجاع|ارجع|رجع|مرتجع|استرجاع|تبديل|بدل|استبدال)/.test(norm(v))}
  function qtyFrom(v){
    const s=String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const m=s.match(/(\d+)\s*(?:باله|بالة|بالات)/i);if(m)return Number(m[1]);
    if(/(?:باله|بالة)\s+(?:واحده|واحدة)/i.test(s))return 1;
    return 0;
  }
  function hintFrom(prompt,customerName){
    let s=norm(prompt);
    if(customerName)s=s.replace(norm(customerName),' ');
    s=s.replace(/\b(ارجاع|ارجع|رجع|مرتجع|استرجاع|تبديل|بدل|استبدال|من|للزبون|لزبون|الزبون|باله|بالة|بالات|عدد)\b/g,' ')
      .replace(/\d+/g,' ').replace(/\s+/g,' ').trim();
    return s;
  }
  async function call(url,opt){const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر فهم أمر الإرجاع');return b}
  function prefill(intent){
    if(!intent)return;
    const hint=norm(intent.productHint||'');
    const tokens=hint.split(' ').filter(x=>x.length>2);
    const items=[...document.querySelectorAll('.prQty')].map(input=>({input,item:input.closest('.item')}));
    let best=null,bestScore=0;
    for(const x of items){
      const text=norm(x.item?.textContent||'');let score=0;
      for(const t of tokens)if(text.includes(t))score++;
      if(score>bestScore){bestScore=score;best=x}
    }
    if(!best)return;
    const chooser=best.input.closest('[id^="prChooser_"]');
    if(chooser&&chooser.classList.contains('hidden')){
      const idx=chooser.id.replace('prChooser_','');
      document.querySelector('.prOpen[data-index="'+idx+'"]')?.click();
    }
    const max=Number(best.input.dataset.max||0);const q=Math.max(1,Math.min(max,Number(intent.quantity||1)));
    best.input.value=String(q);best.input.dispatchEvent(new Event('input',{bubbles:true}));
    best.item?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  window.runAgent=async function(){
    const prompt=el('agentPrompt')?.value.trim()||'';
    if(!prompt||!isReturn(prompt))return typeof prevRun==='function'?prevRun():undefined;
    const button=el('agentRunButton');if(button){button.disabled=true;button.textContent='جاري فهم الإرجاع...'}
    try{
      const r=await call('/api/v11/agent/ops-preview',{method:'POST',body:JSON.stringify({prompt})});
      const a=r.action;
      if(!a||!/^open_customer_(?:return|exchange)$/.test(String(a.type||'')))return typeof prevRun==='function'?prevRun():undefined;
      const exchange=a.type==='open_customer_exchange';
      const intent={quantity:qtyFrom(prompt),productHint:hintFrom(prompt,a.payload?.customerName),exchange};
      window.agentReturnIntent=intent;
      if(typeof window.showAgentMessage==='function')window.showAgentMessage(exchange?'سأفتح مبيعات '+a.payload.customerName+' لتحديد البالة المراد تبديلها. نرجع البالة القديمة أولًا، وبعدها نجهز البالة البديلة.':r.message,'local',null);
      if(typeof openSection==='function')openSection('customers');
      const opener=window.openPartialReturnStatement||window.statement;
      if(typeof opener==='function'){
        const out=opener(a.payload.customerId);
        if(out&&typeof out.then==='function')await out;
        setTimeout(()=>prefill(intent),250);
      }
    }catch(e){if(typeof window.showAgentMessage==='function')window.showAgentMessage(e.message,'local',null);else if(el('agentResult'))el('agentResult').textContent=e.message}
    finally{if(button){button.disabled=false;button.textContent='فهم الأمر'}}
  };
})();
