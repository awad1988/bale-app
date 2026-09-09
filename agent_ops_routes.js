module.exports = function registerAgentOpsRoutes(ctx){
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

  function norm(v){
    return String(v||'').trim().toLowerCase()
      .replace(/[\u064b-\u065f\u0670]/g,'')
      .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/\s+/g,' ');
  }
  function arabicDigits(v){
    return String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g,'').replace(/٫/g,'.');
  }
  function amountFrom(v){
    const s=arabicDigits(v);
    const matches=[...s.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter(n=>Number.isFinite(n)&&n>0);
    return matches.length?matches[matches.length-1]:0;
  }
  async function customers(){
    const rows=await supabaseRequest('customers?select=id,name,debt,created_at&order=created_at.asc');
    return Array.isArray(rows)?rows:[];
  }
  function mentionedCustomer(items,prompt){
    const text=norm(prompt);
    return [...items].sort((a,b)=>String(b.name||'').length-String(a.name||'').length)
      .find(x=>norm(x.name)&&text.includes(norm(x.name)))||null;
  }

  app.post('/api/v11/agent/ops-preview', async function(req,res){
    try{
      const prompt=String(req.body?.prompt||'').trim();
      if(!prompt) throw new Error('اكتب الأمر أولاً.');
      const text=norm(prompt);

      const isReturn=/(ارجاع|ارجع|رجع|مرتجع|استرجاع)/.test(text);
      const isExchange=/(تبديل|بدل|استبدال)/.test(text);
      const isCashIn=/(دخل|ادخل|ايداع|ايداع|قبض).*?(صندوق|كاش|نقد)|(صندوق|كاش|نقد).*?(دخل|ادخل|ايداع|قبض)/.test(text);
      const isCashOut=/(طلع|اخرج|سحب|صرف).*?(صندوق|كاش|نقد)|(صندوق|كاش|نقد).*?(طلع|اخرج|سحب|صرف)/.test(text);

      if(isReturn||isExchange){
        const list=await customers();
        const customer=mentionedCustomer(list,prompt);
        if(!customer) throw new Error('اذكر اسم الزبون المسجل حتى أفتح مبيعاته للإرجاع أو التبديل.');
        return res.json({
          ok:true,
          action:{
            type:isExchange?'open_customer_exchange':'open_customer_return',
            requiresConfirmation:false,
            payload:{customerId:customer.id,customerName:customer.name}
          },
          message:(isExchange?'سأفتح حساب ':'سأفتح حساب ')+customer.name+' على المبيعات حتى تختار البالة أو الكمية المراد '+(isExchange?'تبديلها.':'إرجاعها.')
        });
      }

      if(isCashIn||isCashOut){
        const amount=amountFrom(prompt);
        if(!(amount>0)) throw new Error('اذكر مبلغ حركة الصندوق.');
        const type=isCashIn?'in':'out';
        return res.json({
          ok:true,
          action:{type:'record_cash_movement',requiresConfirmation:true,payload:{type,amount,notes:prompt}},
          message:'تأكيد '+(type==='in'?'إدخال ':'إخراج ')+amount.toFixed(2)+' د.أ '+(type==='in'?'إلى':'من')+' الصندوق؟'
        });
      }

      return res.json({ok:false,passThrough:true});
    }catch(e){res.status(400).json({error:e.message})}
  });
};
