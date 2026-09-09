module.exports = function registerAgentSaleRoutes(ctx){
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

  function norm(v){
    return String(v||'').trim().toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g,'')
      .replace(/[ـ]/g,'')
      .replace(/[أإآ]/g,'ا')
      .replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  function arabicDigits(v){
    return String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
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

  app.post('/api/v7/agent/sale-preview', async function(req,res){
    try{
      const prompt=arabicDigits(req.body?.prompt||'').trim();
      if(!prompt) throw new Error('اكتب أمر المبيعة.');
      const t=norm(prompt);
      if(!/(بيع|مبيع|بيعه)/.test(t)) throw new Error('الأمر لا يبدو كمبيعة.');

      const [customers,shipments,bales]=await Promise.all([
        fetchAll('customers?select=id,name,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z'),
        fetchAll('shipments?select=id,season'),
        fetchAll('bales?select=id,shipment_id,name_en,name_ar,grade,weight,status,created_at&order=created_at.asc')
      ]);
      const customer=[...customers].sort((a,b)=>String(b.name||'').length-String(a.name||'').length).find(c=>t.includes(norm(c.name)));
      if(!customer) throw new Error('لم أتعرف على اسم الزبون. اذكر اسم الزبون كما هو مسجل.');

      const qtyMatch=prompt.match(/(\d+)\s*(?:باله|بالات|بالة)/i);
      const qty=qtyMatch?Number(qtyMatch[1]):0;
      if(!Number.isInteger(qty)||qty<=0) throw new Error('اذكر عدد البالات، مثال: 3 بالات.');

      let unitPrice=0,total=0;
      const unitMatch=prompt.match(/(?:بسعر|سعر)\s*(\d+(?:\.\d+)?)\s*(?:للباله|للبالة|للبالات|للبالة الواحدة)?/i);
      const totalMatch=prompt.match(/(?:اجمالي|الإجمالي|المجموع|مجموع)\s*(\d+(?:\.\d+)?)/i);
      if(unitMatch){unitPrice=Number(unitMatch[1]); total=unitPrice*qty}
      else if(totalMatch){total=Number(totalMatch[1]); unitPrice=total/qty}
      else throw new Error('اذكر السعر، مثال: بسعر 180 للبالة أو إجمالي 540.');

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

      const ignored=new Set(['سجل','بيع','مبيع','مبيعه','بيعه','للزبون','الزبون','باله','بالات','بسعر','سعر','للباله','دينار','اجمالي','المجموع','مجموع']);
      const customerTokens=norm(customer.name).split(' ');
      const tokens=t.split(' ').filter(x=>x.length>1&&!ignored.has(x)&&!customerTokens.includes(x)&&!/^[0-9.]+$/.test(x));
      const scored=[...groups.values()].map(g=>{
        const text=norm([g.name_ar,g.name_en,g.grade,g.weight].join(' '));
        const score=tokens.reduce((s,x)=>s+(text.includes(x)?1:0),0);
        return {g,score};
      }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.g.quantity-a.g.quantity);
      if(!scored.length) throw new Error('لم أتعرف على الصنف في المخزون. اذكر اسم الصنف بشكل أوضح.');
      const bestScore=scored[0].score;
      const best=scored.filter(x=>x.score===bestScore);
      if(best.length>1){
        return res.json({ok:false,needs_choice:true,message:'وجدت أكثر من تصنيف مطابق. افتح شاشة المبيعات واختر الوزن/الدرجة المطلوبة.',customer:{id:customer.id,name:customer.name},matches:best.slice(0,8).map(x=>x.g)});
      }
      const product=best[0].g;
      if(qty>product.quantity) throw new Error('المطلوب '+qty+' بالات، والمتاح من هذا التصنيف '+product.quantity+' فقط.');

      res.json({
        ok:true,
        message:'فهمت المبيعة. راجعها ثم افتح شاشة المبيعات للتأكيد النهائي.',
        customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},
        product,
        quantity:qty,
        unit_price_jod:unitPrice,
        total_jod:total,
        expected_debt_after:Number(customer.debt||0)+total
      });
    }catch(e){res.status(400).json({error:e.message})}
  });
};
