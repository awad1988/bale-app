(function(){
  const prevRun=window.runAgent;
  const prevConfirm=window.confirmAgentAction;
  function el(id){return document.getElementById(id)}
  async function call(url,opt){
    const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(b.error||'تعذر فهم الأمر');
    return b;
  }
  function normalizeDigits(v){
    return String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g,'').replace(/٫/g,'.');
  }
  function cashMovement(v){
    const raw=String(v||'');
    const s=raw.replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');
    if(!/(صندوق|كاش|نقد)/i.test(s))return null;
    let type=null;
    if(/(دخل|ادخل|اودع|ايداع|قبض|حط|حطيت)/i.test(s))type='in';
    if(/(طلع|اخرج|سحب|سحبت|صرف من|اطلع)/i.test(s))type='out';
    if(!type)return null;
    const nums=[...normalizeDigits(s).matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter(n=>Number.isFinite(n)&&n>0);
    return {type,amount:nums.length?nums[0]:0,notes:raw};
  }
  function isOpsCommand(v){
    const s=String(v||'');
    return !!cashMovement(s)||/(ارجاع|إرجاع|ارجع|رجع|مرتجع|استرجاع|تبديل|بدل|استبدال)/i.test(s);
  }
  function showMessage(message,action){
    if(typeof window.showAgentMessage==='function'){
      window.agentPendingAction=action||null;
      try{ agentPendingAction=action||null; }catch(_){ }
      window.showAgentMessage(message,'local',action||null);
      return;
    }
    const out=el('agentResult');if(out)out.textContent=message;
  }
  window.runAgent=async function(){
    const prompt=el('agentPrompt')?.value.trim()||'';
    if(!prompt)return prevRun?prevRun():undefined;

    const cash=cashMovement(prompt);
    if(cash){
      if(!(cash.amount>0))return showMessage('اذكر مبلغ حركة الصندوق.',null);
      const action={type:'record_cash_movement',requiresConfirmation:true,payload:cash};
      try{agentPendingAction=action}catch(_){ }
      window.agentPendingAction=action;
      return showMessage('تأكيد '+(cash.type==='in'?'إدخال ':'إخراج ')+cash.amount.toFixed(2)+' د.أ '+(cash.type==='in'?'إلى':'من')+' الصندوق؟',action);
    }

    if(!isOpsCommand(prompt))return prevRun?prevRun():undefined;
    const button=el('agentRunButton');
    if(button){button.disabled=true;button.textContent='جاري فهم الأمر...'}
    try{
      const r=await call('/api/v11/agent/ops-preview',{method:'POST',body:JSON.stringify({prompt})});
      if(r.passThrough)return prevRun?prevRun():undefined;
      const action=r.action||null;
      if(action?.type==='open_customer_return'||action?.type==='open_customer_exchange'){
        showMessage(r.message,null);
        if(typeof openSection==='function')openSection('customers');
        if(typeof window.openPartialReturnStatement==='function'){
          setTimeout(()=>window.openPartialReturnStatement(action.payload.customerId),80);
        }else if(typeof statement==='function'){
          setTimeout(()=>statement(action.payload.customerId),80);
        }
        return;
      }
      try{ agentPendingAction=action; }catch(_){ }
      window.agentPendingAction=action;
      showMessage(r.message,action);
    }catch(e){showMessage(e.message,null)}
    finally{if(button){button.disabled=false;button.textContent='فهم الأمر'}}
  };

  window.confirmAgentAction=async function(){
    let action=null;
    try{action=agentPendingAction}catch(_){action=window.agentPendingAction}
    action=action||window.agentPendingAction;
    if(action?.type!=='record_cash_movement')return prevConfirm?prevConfirm():undefined;
    const payload=action.payload||{};
    showMessage('جاري تسجيل حركة الصندوق...',null);
    try{
      await call('/api/cash-movements',{method:'POST',body:JSON.stringify({
        type:payload.type,
        amount:Number(payload.amount||0),
        date:new Date().toISOString().slice(0,10),
        notes:payload.notes||'سجلها الوكيل الذكي'
      })});
      if(typeof refresh==='function')await refresh();
      if(el('agentPrompt'))el('agentPrompt').value='';
      try{agentPendingAction=null}catch(_){ }
      window.agentPendingAction=null;
      showMessage('تم تسجيل حركة الصندوق بنجاح.',null);
    }catch(e){showMessage('تعذر تسجيل حركة الصندوق: '+e.message,null)}
  };
})();
