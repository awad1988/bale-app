module.exports = function registerAgentGeminiSaleRoutes(ctx){
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  function norm(v){
    return String(v||'').trim().toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g,'')
      .replace(/[ـ]/g,'')
      .replace(/[أإآ]/g,'ا')
      .replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  async function fetchAll(path){
    const out=[]; const size=1000;
    for(let offset=0;offset<100000;offset+=size){
      const sep=path.includes('?')?'&':'?';
      const rows=await supabaseRequest(path+sep+'limit='+size+'&offset='+offset);
      const arr=Array.isArray(rows)?rows:[]; out.push(...arr);
      if(arr.length<size) break;
    }
    return out;
  }
  function branchId(status){const m=String(status||'').match(/\[BRANCH:(\d+)\]/i);return m?Number(m[1]):2}
  function sold(status){return /مباع|محجوز|\[SALE_BATCH:/i.test(String(status||''))}
  function grade(v){const g=norm(v);if(g==='CREAM'||g==='كريم')return 'CREAM';if(g==='B')return 'B';return 'A'}
  function productGroups(shipments,bales){
    const shipMap=new Map(shipments.map(s=>[String(s.id),s]));
    const groups=new Map();
    for(const b of bales){
      if(sold(b.status)) continue;
      const season=shipMap.get(String(b.shipment_id))?.season||'شتوي';
      const key=[norm(b.name_en||b.name_ar),grade(b.grade),Number(b.weight||0),norm(season),branchId(b.status)].join('|');
      let g=groups.get(key);
      if(!g){g={key,name_ar:b.name_ar||'',name_en:b.name_en||'',grade:grade(b.grade)==='CREAM'?'Cream':grade(b.grade),weight:Number(b.weight||0),season,branch_id:branchId(b.status),quantity:0};groups.set(key,g)}
      g.quantity++;
    }
    return [...groups.values()];
  }
  function findCustomer(customers,name,prompt){
    const wanted=norm(name);
    const text=norm(prompt);
    return [...customers].sort((a,b)=>String(b.name||'').length-String(a.name||'').length).find(c=>norm(c.name)===wanted)
      || [...customers].sort((a,b)=>String(b.name||'').length-String(a.name||'').length).find(c=>text.includes(norm(c.name)))
      || null;
  }
  function matchProduct(line,groups){
    const raw=[line.product_name,line.grade,line.weight_kg].filter(v=>v!==null&&v!==undefined&&v!=='').join(' ');
    const tokens=norm(raw).split(' ').filter(x=>x.length>1&&!/^[0-9.]+$/.test(x));
    const wantedGrade=norm(line.grade||'');
    const wantedWeight=Number(line.weight_kg||0);
    const scored=groups.map(g=>{
      const text=norm([g.name_ar,g.name_en,g.grade,g.weight].join(' '));
      let score=0;
      for(const token of tokens){if(text.includes(token))score+=token.length>=4?2:1}
      if(/\bEX\b|EXTRA|اكسترا|إكسترا/i.test(String(line.product_name||'')+' '+String(line.grade||'')) && /EX/i.test(String(g.name_en||''))) score+=5;
      if(wantedGrade){
        const wg=wantedGrade==='CREAM'||wantedGrade==='كريم'?'CREAM':wantedGrade==='B'?'B':'A';
        const gg=String(g.grade).toUpperCase()==='CREAM'?'CREAM':String(g.grade).toUpperCase();
        if(wg===gg)score+=4;else score-=3;
      }
      if(wantedWeight){if(wantedWeight===Number(g.weight))score+=5;else score-=2}
      return {g,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.g.quantity-a.g.quantity);
    if(!scored.length)return {error:'لم أجد الصنف «'+(line.product_name||'')+'» في المخزون.'};
    const top=scored[0].score;
    const best=scored.filter(x=>x.score===top);
    if(best.length>1)return {choice:best.slice(0,8).map(x=>x.g)};
    return {product:best[0].g};
  }

  async function geminiParse(prompt,customers,groups){
    if(!GEMINI_API_KEY) throw new Error('مفتاح Gemini غير موجود في إعدادات السيرفر.');
    const catalog=groups.map(g=>({name_ar:g.name_ar,name_en:g.name_en,grade:g.grade,weight_kg:g.weight,available:g.quantity}));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
        method:'POST',signal:controller.signal,
        headers:{'x-goog-api-key':GEMINI_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:GEMINI_MODEL,
          input:[
            'أنت محلل أوامر مبيعات لتجارة بالات في الأردن. افهم اللهجة الأردنية والكلام الطبيعي والصوت المحول إلى نص.',
            'مهم: لا تنفذ أي عملية. فقط استخرج بيانات الفاتورة/المبيعة بدقة.',
            'تمييز الأرقام مهم جدًا: «عدد 1 بالة» أو «بالة واحدة» يعني quantity=1. «بسعر 200» يعني unit_price_jod=200. «بقيمة 200» أو «إجمالي 200» يعني line_total_jod=200.',
            'EX و Extra وإكسترا تعني توصيف الصنف Extra/EX، وليست كمية.',
            'إذا ذكر المستخدم أكثر من صنف استخرج كل صنف كسطر مستقل.',
            'إذا معلومة ناقصة اتركها null ولا تخمن.',
            'أسماء الزبائن المتاحة: '+JSON.stringify(customers.map(c=>c.name)),
            'كتالوج المخزون المتاح: '+JSON.stringify(catalog),
            'أمر المستخدم: '+prompt
          ].join('\n'),
          tools:[{
            type:'function',name:'parse_bale_sale',description:'استخراج مبيعة أو فاتورة بالات من كلام المستخدم بدون تنفيذ.',
            parameters:{
              type:'object',
              properties:{
                customer_name:{type:'string'},
                is_invoice:{type:'boolean'},
                lines:{type:'array',items:{type:'object',properties:{
                  product_name:{type:'string'},
                  grade:{type:'string'},
                  weight_kg:{type:'number'},
                  quantity:{type:'number'},
                  unit_price_jod:{type:'number'},
                  line_total_jod:{type:'number'}
                },required:['product_name']}},
                missing_info:{type:'array',items:{type:'string'}}
              },required:['customer_name','is_invoice','lines']
            }
          }]
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body?.error?.message||('Gemini error '+response.status));
      const call=(body.steps||[]).find(x=>x.type==='function_call');
      if(!call)throw new Error('Gemini لم يرجع فهمًا منظمًا للأمر.');
      const args=typeof call.arguments==='string'?JSON.parse(call.arguments||'{}'):(call.arguments||{});
      return args;
    }finally{clearTimeout(timer)}
  }

  app.post('/api/v10/agent/sale-preview',async(req,res)=>{
    try{
      const prompt=String(req.body?.prompt||'').trim();
      if(!prompt)throw new Error('اكتب أو احكي أمر المبيعة.');
      const [customers,shipments,bales]=await Promise.all([
        fetchAll('customers?select=id,name,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z'),
        fetchAll('shipments?select=id,season'),
        fetchAll('bales?select=id,shipment_id,name_en,name_ar,grade,weight,status,created_at&order=created_at.asc')
      ]);
      const groups=productGroups(shipments,bales);
      const parsed=await geminiParse(prompt,customers,groups);
      const customer=findCustomer(customers,parsed.customer_name,prompt);
      if(!customer)throw new Error('لم أتعرف على الزبون. اذكر اسمه كما هو مسجل.');
      const rawLines=Array.isArray(parsed.lines)?parsed.lines:[];
      if(!rawLines.length){
        return res.json({ok:false,provider:'gemini',invoice_mode:true,needs_more:true,customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},message:'فهمت الزبون، لكن ما وصلني صنف واضح. احكي اسم الصنف والكمية والسعر.'});
      }
      const lines=[];
      for(let i=0;i<rawLines.length;i++){
        const line=rawLines[i]||{};
        const mp=matchProduct(line,groups);
        if(mp.error)return res.status(400).json({error:mp.error});
        if(mp.choice)return res.json({ok:false,provider:'gemini',invoice_mode:parsed.is_invoice||rawLines.length>1,needs_choice:true,message:'الصنف رقم '+(i+1)+' يطابق أكثر من تصنيف. حدد الوزن أو الدرجة.',customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},matches:mp.choice,lines});
        const qty=Number(line.quantity||0);
        if(!Number.isInteger(qty)||qty<=0)return res.json({ok:false,provider:'gemini',invoice_mode:parsed.is_invoice||rawLines.length>1,needs_more:true,customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},message:'الصنف رقم '+(i+1)+' ناقصه عدد البالات.',lines});
        const product=mp.product;
        if(qty>product.quantity)throw new Error('الصنف '+(product.name_ar||product.name_en)+': المطلوب '+qty+' والمتاح '+product.quantity+' فقط.');
        let unit=Number(line.unit_price_jod||0),total=Number(line.line_total_jod||0);
        if(unit>0&&!total)total=unit*qty;
        if(total>0&&!unit)unit=total/qty;
        if(!(total>0))return res.json({ok:false,provider:'gemini',invoice_mode:parsed.is_invoice||rawLines.length>1,needs_more:true,customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},message:'الصنف رقم '+(i+1)+' ناقصه السعر أو قيمة الصنف.',lines:lines.concat([{product,quantity:qty}])});
        lines.push({product,quantity:qty,unit_price_jod:unit,total_jod:total});
      }
      const total=lines.reduce((s,x)=>s+x.total_jod,0);
      const totalQty=lines.reduce((s,x)=>s+x.quantity,0);
      const invoiceMode=!!parsed.is_invoice||lines.length>1;
      res.json({ok:true,provider:'gemini',invoice_mode:invoiceMode,message:invoiceMode?'Gemini فهم الفاتورة. راجع الأصناف ثم انقلها للفحص النهائي.':'Gemini فهم المبيعة. راجعها ثم انقلها للفحص النهائي.',customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},lines,product:lines[0]?.product,quantity:lines[0]?.quantity||0,unit_price_jod:lines[0]?.unit_price_jod||0,total_jod:total,total_qty:totalQty,expected_debt_after:Number(customer.debt||0)+total});
    }catch(e){
      const msg=e.name==='AbortError'?'انتهت مهلة اتصال Gemini. حاول مرة ثانية.':e.message;
      res.status(/Gemini|مفتاح|مهلة/.test(msg)?502:400).json({error:msg});
    }
  });
};
