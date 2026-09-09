module.exports = function registerAgentOpsRoutes(ctx){
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const OPS_VERSION='2026-09-09-number-words-v2';

  function norm(v){
    return String(v||'').trim().toLowerCase()
      .replace(/[\u064b-\u065f\u0670]/g,'')
      .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/ـ/g,'')
      .replace(/\s+/g,' ');
  }
  function arabicDigits(v){
    return String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٬/g,'').replace(/٫/g,'.');
  }

  const NUMBER_WORDS=new Map(Object.entries({
    'صفر':0,
    'واحد':1,'وحد':1,'وحده':1,'وحدة':1,
    'اثنين':2,'اثنان':2,'اتنين':2,'تنين':2,'ثنتين':2,
    'ثلاث':3,'ثلاثه':3,'ثلاثة':3,
    'اربع':4,'اربعه':4,'أربع':4,'أربعة':4,
    'خمس':5,'خمسه':5,'خمسة':5,
    'ست':6,'سته':6,'ستة':6,
    'سبع':7,'سبعه':7,'سبعة':7,
    'ثمان':8,'ثمانيه':8,'ثمانية':8,'تمنيه':8,'تمانيه':8,
    'تسع':9,'تسعه':9,'تسعة':9,
    'عشر':10,'عشره':10,'عشرة':10,
    'احدعش':11,'احدعشر':11,'احد عشر':11,
    'اثنعش':12,'اثنا عشر':12,'اثني عشر':12,'اتنعش':12,
    'ثلاثطعش':13,'ثلاثتعش':13,'ثلاثه عشر':13,'ثلاثة عشر':13,
    'اربعطعش':14,'اربعتعش':14,'اربعه عشر':14,'أربعة عشر':14,
    'خمسطعش':15,'خمستعش':15,'خمسه عشر':15,
    'ستطعش':16,'ستعش':16,'سته عشر':16,
    'سبعطعش':17,'سبعتعش':17,'سبعه عشر':17,
    'ثمنطعش':18,'ثمانتعش':18,'ثمانيه عشر':18,
    'تسعطعش':19,'تسعتعش':19,'تسعه عشر':19,
    'عشرين':20,'عشرون':20,
    'ثلاثين':30,'ثلاثون':30,
    'اربعين':40,'أربعين':40,
    'خمسين':50,'ستين':60,'سبعين':70,'ثمانين':80,'تمانين':80,'تسعين':90,
    'ميه':100,'مية':100,'مئه':100,'مئة':100,'مائه':100,'مائة':100,'مايه':100,'ماية':100,
    'ميتين':200,'مئتين':200,'مائتين':200,'مايتين':200,
    'ثلاثميه':300,'ثلاثمية':300,'ثلاثمئه':300,'ثلاثمائة':300,
    'اربعمية':400,'اربعمئه':400,'اربعميه':400,'اربعمائة':400,
    'خمسميه':500,'خمسمية':500,'خمسمئه':500,'خمسمائة':500,
    'ستميه':600,'ستمية':600,'ستمئه':600,'ستمائة':600,
    'سبعميه':700,'سبعمية':700,'سبعمئه':700,'سبعمائة':700,
    'ثمانميه':800,'ثمانمية':800,'تمانميه':800,'تمانمية':800,'ثمانمائة':800,
    'تسعميه':900,'تسعمية':900,'تسعمئه':900,'تسعمائة':900
  }));

  function tokenNumber(token){
    const t=norm(token).replace(/^و(?=[\u0600-\u06ff])/,'');
    if(NUMBER_WORDS.has(t))return NUMBER_WORDS.get(t);
    if(/^\d+(?:\.\d+)?$/.test(t))return Number(t);
    return null;
  }

  function wordsNumber(value){
    let s=norm(arabicDigits(value))
      .replace(/[،,؛;:.!?()\[\]{}]/g,' ')
      .replace(/\s+/g,' ').trim();
    if(!s)return 0;
    const replacements=[
      [/احد\s+عشر/g,'احدعشر'],[/اثنا\s+عشر|اثني\s+عشر/g,'اثنعش'],
      [/ثلاث(?:ه)?\s+عشر/g,'ثلاثتعش'],[/اربع(?:ه)?\s+عشر/g,'اربعتعش'],
      [/خمس(?:ه)?\s+عشر/g,'خمستعش'],[/ست(?:ه)?\s+عشر/g,'ستعش'],
      [/سبع(?:ه)?\s+عشر/g,'سبعتعش'],[/ثمان(?:يه)?\s+عشر/g,'ثمانتعش'],
      [/تسع(?:ه)?\s+عشر/g,'تسعتعش']
    ];
    for(const [re,to] of replacements)s=s.replace(re,to);

    const tokens=s.split(' ');
    let total=0,current=0,seen=false;
    for(const raw of tokens){
      if(!raw)continue;
      let t=raw;
      if(t.length>1&&t[0]==='و')t=t.slice(1);
      if(t==='الف'){current=(current||1)*1000;total+=current;current=0;seen=true;continue;}
      if(t==='الفين'){total+=2000;current=0;seen=true;continue;}
      if(t==='الاف'){current=(current||1)*1000;total+=current;current=0;seen=true;continue;}
      if(t==='مليون'){current=(current||1)*1000000;total+=current;current=0;seen=true;continue;}
      if(t==='مليونين'){total+=2000000;current=0;seen=true;continue;}
      const n=tokenNumber(raw);
      if(n!==null){current+=n;seen=true;continue;}
      if(seen&&/(دينار|دنانير|ليره|ليرة|الصندوق|صندوق|كاش|نقد|من|الى)/.test(raw))break;
    }
    return seen?total+current:0;
  }

  function amountFrom(v){
    const s=arabicDigits(v);
    const matches=[...s.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0])).filter(n=>Number.isFinite(n)&&n>0);
    if(matches.length)return matches[matches.length-1];
    return wordsNumber(v);
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

  app.get('/api/v11/agent/ops-version',(_req,res)=>res.json({ok:true,version:OPS_VERSION}));

  app.post('/api/v11/agent/ops-preview', async function(req,res){
    try{
      const prompt=String(req.body?.prompt||'').trim();
      if(!prompt) throw new Error('اكتب الأمر أولاً.');
      const text=norm(prompt);
      const isReturn=/(ارجاع|ارجع|رجع|مرتجع|استرجاع)/.test(text);
      const isExchange=/(تبديل|بدل|استبدال)/.test(text);
      const isCashIn=/(دخل|ادخل|اودع|ايداع|قبض|حط|حطيت).*?(صندوق|كاش|نقد)|(صندوق|كاش|نقد).*?(دخل|ادخل|اودع|ايداع|قبض|حط|حطيت)/.test(text);
      const isCashOut=/(طلع|اخرج|سحب|صرف|خذ|خد).*?(صندوق|كاش|نقد)|(صندوق|كاش|نقد).*?(طلع|اخرج|سحب|صرف|خذ|خد)/.test(text);

      if(isReturn||isExchange){
        const list=await customers();
        const customer=mentionedCustomer(list,prompt);
        if(!customer) throw new Error('اذكر اسم الزبون المسجل حتى أفتح مبيعاته للإرجاع أو التبديل.');
        return res.json({ok:true,version:OPS_VERSION,action:{type:isExchange?'open_customer_exchange':'open_customer_return',requiresConfirmation:false,payload:{customerId:customer.id,customerName:customer.name}},message:'سأفتح حساب '+customer.name+' على المبيعات حتى تختار البالة أو الكمية المراد '+(isExchange?'تبديلها.':'إرجاعها.')});
      }

      if(isCashIn||isCashOut){
        const amount=amountFrom(prompt);
        if(!(amount>0)) throw new Error('اذكر مبلغ حركة الصندوق، بالأرقام أو بالكلام مثل: مائة دينار. [NUM-V2]');
        const type=isCashIn?'in':'out';
        return res.json({ok:true,version:OPS_VERSION,action:{type:'record_cash_movement',requiresConfirmation:true,payload:{type,amount,notes:prompt}},message:'تأكيد '+(type==='in'?'إدخال ':'إخراج ')+amount.toFixed(2)+' د.أ '+(type==='in'?'إلى':'من')+' الصندوق؟'});
      }

      return res.json({ok:false,version:OPS_VERSION,passThrough:true});
    }catch(e){res.status(400).json({error:e.message,version:OPS_VERSION})}
  });
};
