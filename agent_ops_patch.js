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
  function norm(v){
    return String(v||'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065f\u0670]/g,'').replace(/ـ/g,'').replace(/\s+/g,' ').trim();
  }
  function digitize(v){
    return String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g,'').replace(/٫/g,'.');
  }
  const numWords={
    صفر:0,واحد:1,وحد:1,اثنين:2,اثنان:2,اتنين:2,تنين:2,ثلاث:3,ثلاثه:3,اربع:4,اربعه:4,خمس:5,خمسه:5,ست:6,سته:6,سبع:7,سبعه:7,ثمان:8,ثمانيه:8,تمان:8,تمانيه:8,تسع:9,تسعه:9,
    عشر:10,عشره:10,احدعش:11,احدعشر:11,اثنعش:12,اتنعش:12,ثلاثتعش:13,اربعتعش:14,خمستعش:15,ستعش:16,سبعتعش:17,ثمانتعش:18,تسعتعش:19,
    عشرين:20,ثلاثين:30,اربعين:40,خمسين:50,ستين:60,سبعين:70,ثمانين:80,تمانين:80,تسعين:90,
    ميه:100,مئه:100,مائه:100,مايه:100,ميتين:200,مئتين:200,مائتين:200,مايتين:200,
    ثلاثميه:300,ثلاثمئه:300,ثلاثمائه:300,اربعمية:400,اربعميه:400,اربعمئه:400,اربعمائه:400,
    خمسمية:500,خمسميه:500,خمسمئه:500,خمسمائه:500,ستمية:600,ستميه:600,ستمئه:600,ستمائه:600,
    سبعمية:700,سبعميه:700,سبعمئه:700,سبعمائه:700,ثمانمية:800,ثمانميه:800,ثمانمئه:800,ثمانمائه:800,تمانمية:800,تمانميه:800,
    تسعمية:900,تسعميه:900,تسعمئه:900,تسعمائه:900
  };
  function wordAmount(v){
    let s=norm(digitize(v))
      .replace(/احد\s+عشر/g,'احدعشر')
      .replace(/(?:اثنا|اثني)\s+عشر/g,'اثنعش')
      .replace(/ثلاث(?:ه)?\s+عشر/g,'ثلاثتعش')
      .replace(/اربع(?:ه)?\s+عشر/g,'اربعتعش')
      .replace(/خمس(?:ه)?\s+عشر/g,'خمستعش')
      .replace(/ست(?:ه)?\s+عشر/g,'ستعش')
      .replace(/سبع(?:ه)?\s+عشر/g,'سبعتعش')
      .replace(/ثمان(?:يه)?\s+عشر/g,'ثمانتعش')
      .replace(/تسع(?:ه)?\s+عشر/g,'تسعتعش');
    const numeric=[...s.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).find(n=>n>0);
    if(numeric)return numeric;
    const tokens=s.split(' ');
    let total=0,current=0,seen=false;
    for(const raw of tokens){
      let t=raw.replace(/^و(?=[\u0600-\u06ff])/,'');
      if(t==='الف'){current=(current||1)*1000;total+=current;current=0;seen=true;continue;}
      if(t==='الفين'){total+=2000;current=0;seen=true;continue;}
      if(t==='الاف'){current=(current||1)*1000;total+=current;current=0;seen=true;continue;}
      if(Object.prototype.hasOwnProperty.call(numWords,t)){current+=numWords[t];seen=true;continue;}
      if(seen&&/(دينار|دنانير|الصندوق|صندوق|كاش|نقد|الى|الي|من)/.test(t))break;
    }
    return seen?total+current:0;
  }
  function cashType(v){
    const s=norm(v);
    if(!/(صندوق|كاش|نقد)/i.test(s))return null;
    if(/(طلع|اخرج|سحب|سحبت|صرف|اطلع|خذ|خد)/i.test(s))return 'out';
    if(/(دخل|ادخل|اودع|ايداع|قبض|حط|حطيت)/i.test(s))return 'in';
    if(/(سجل|سجللي|سجلي|سجل لي)/i.test(s)){
      if(/من\s+(?:ال)?(?:صندوق|كاش|نقد)/i.test(s))return 'out';
      if(/(?:الى|الي)\s+(?:ال)?(?:صندوق|كاش|نقد)/i.test(s))return 'in';
    }
    return null;
  }
  function isExpense(v){
    const s=norm(v);
    if(/(مصروف|مصاريف|صرفنا|دفعت|ادفع|دفعنا)/i.test(s))return true;
    return /(سجل|سجللي|سجلي|سجل لي)/i.test(s) && /(بنزين|ديزل|سولار|محروقات|وقود|راتب|رواتب|ايجار|اجار|توصيل|نقل|صيانه|كهرباء|ماء|انترنت|هاتف|اكل|طعام)/i.test(s);
  }
  function isReturnOrExchange(v){
    return /(ارجاع|إرجاع|ارجع|رجع|مرتجع|استرجاع|تبديل|بدل|استبدال)/i.test(String(v||''));
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
  async function runOpsPreview(prompt){
    const button=el('agentRunButton');
    if(button){button.disabled=true;button.textContent='جاري فهم الأمر...'}
    try{
      const r=await call('/api/v11/agent/ops-preview',{method:'POST',body:JSON.stringify({prompt})});
      if(r.passThrough)return prevRun?prevRun():undefined;
      const action=r.action||null;
      if(action?.type==='open_customer_return'||action?.type==='open_customer_exchange'){
        showMessage(r.message,null);
        if(typeof openSection==='function')openSection('customers');
        if(typeof window.openPartialReturnStatement==='function')setTimeout(()=>window.openPartialReturnStatement(action.payload.customerId),80);
        else if(typeof statement==='function')setTimeout(()=>statement(action.payload.customerId),80);
        return;
      }
      try{agentPendingAction=action}catch(_){ }
      window.agentPendingAction=action;
      showMessage(r.message,action);
    }catch(e){showMessage(e.message,null)}
    finally{if(button){button.disabled=false;button.textContent='فهم الأمر'}}
  }
  window.runAgent=async function(){
    const prompt=el('agentPrompt')?.value.trim()||'';
    if(!prompt)return prevRun?prevRun():undefined;

    const type=cashType(prompt);
    if(type){
      const amount=wordAmount(prompt);
      if(amount>0){
        const action={type:'record_cash_movement',requiresConfirmation:true,payload:{type,amount,notes:prompt}};
        try{agentPendingAction=action}catch(_){ }
        window.agentPendingAction=action;
        return showMessage('تأكيد '+(type==='in'?'إدخال ':'إخراج ')+amount.toFixed(2)+' د.أ '+(type==='in'?'إلى':'من')+' الصندوق؟',action);
      }
      return runOpsPreview(prompt);
    }
    if(isExpense(prompt))return runOpsPreview(prompt);
    if(isReturnOrExchange(prompt))return runOpsPreview(prompt);
    return prevRun?prevRun():undefined;
  };

  window.confirmAgentAction=async function(){
    let action=null;
    try{action=agentPendingAction}catch(_){action=window.agentPendingAction}
    action=action||window.agentPendingAction;
    if(action?.type!=='record_cash_movement' && action?.type!=='record_expense')return prevConfirm?prevConfirm():undefined;
    const payload=action.payload||{};
    showMessage(action.type==='record_expense'?'جاري تسجيل المصروف...':'جاري تسجيل حركة الصندوق...',null);
    try{
      if(action.type==='record_expense'){
        await call('/api/expenses',{method:'POST',body:JSON.stringify({
          category:payload.category||'عام',
          amount:Number(payload.amount||0),
          date:new Date().toISOString().slice(0,10),
          notes:payload.notes||'سجله الوكيل الذكي'
        })});
      }else{
        await call('/api/cash-movements',{method:'POST',body:JSON.stringify({
          type:payload.type,
          amount:Number(payload.amount||0),
          date:new Date().toISOString().slice(0,10),
          notes:payload.notes||'سجلها الوكيل الذكي'
        })});
      }
      if(typeof refresh==='function')await refresh();
      if(el('agentPrompt'))el('agentPrompt').value='';
      try{agentPendingAction=null}catch(_){ }
      window.agentPendingAction=null;
      showMessage(action.type==='record_expense'?'تم تسجيل المصروف بنجاح.':'تم تسجيل حركة الصندوق بنجاح.',null);
    }catch(e){showMessage('تعذر تسجيل العملية: '+e.message,null)}
  };
})();