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

  function lineParts(prompt, customerName){
    let body=String(prompt||'');
    if(customerName) body=body.replace(new RegExp(customerName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),' ');
    body=body
      .replace(/(?:سجل|اعمل|أعمل|فاتورة|الفاتورة|مبيعة|بيعة|للزبون|للعميل|لزبون|لعميل)/gi,' ')
      .replace(/\s+/g,' ').trim();
    if(!body) return [];

    const marked=body
      .replace(/\s+(?:وزيد|وزيدلي|وكمان|كمان)\s+/gi,' || ')
      .replace(/[،؛;\n]+/g,' || ')
      .replace(/\s+و(?=\s*\d+\s+)/g,' || ');
    return marked.split('||').map(x=>x.trim()).filter(Boolean);
  }

  function parseQty(segment){
    const s=String(segment||'');
    // Prefer an explicit quantity tied to the bale word, especially spoken forms like "عدد 1 بالة".
    const bale=s.match(/(?:عدد\s*)?(\d+)\s*(?:باله|بالات|بالة)\b/i);
    if(bale) return Number(bale[1]);
    const count=s.match(/\bعدد\s*(\d+)\b/i);
    if(count) return Number(count[1]);
    // Last resort: only accept a leading number when it is not clearly a price/value expression.
    const lead=s.match(/^\s*(\d+)\b/);
    if(lead&&!/(?:بقيمة|قيمه|قيمة|بسعر|سعر)\s*\d+/i.test(s.slice(0,(lead.index||0)+lead[0].length+20))) return Number(lead[1]);
    return 0;
  }
  function parsePrice(segment,qty){
    const s=String(segment||'');
    // "بسعر" means price per bale.
    const unit=s.match(/(?:بسعر|سعر)\s*(\d+(?:\.\d+)?)/i);
    if(unit){const p=Number(unit[1]);return {unit:p,total:p*qty}}
    // "بقيمة" / "إجمالي" means the total value of the line/invoice line.
    const total=s.match(/(?:بقيمة|بقمه|قيمه|قيمة|اجمالي|الإجمالي|الاجمالي|المجموع|مجموع)\s*(\d+(?:\.\d+)?)/i);
    if(total){const t=Number(total[1]);return {unit:qty?t/qty:0,total:t}}
    // If wording says "البالة 200" treat it as unit price.
    const balePrice=s.match(/(?:الباله|البالة)\s*(\d+(?:\.\d+)?)/i);
    if(balePrice){const p=Number(balePrice[1]);return {unit:p,total:p*qty}}
    return {unit:0,total:0};
  }

  function matchProduct(segment,groups){
    const ignored=new Set(['سجل','بيع','مبيع','مبيعه','بيعه','فاتوره','فاتورة','باله','بالات','بالة','بسعر','سعر','بقيمة','بقمه','قيمه','قيمة','للباله','للبالة','دينار','اجمالي','الاجمالي','المجموع','مجموع','وزيد','كمان','وكمان','عدد']);
    const tokens=norm(segment).split(' ').map(x=>x==='EXTRA'?'EX':x).filter(x=>x.length>1&&!ignored.has(x)&&!/^[0-9.]+$/.test(x));
    const scored=groups.map(g=>{
      const text=norm([g.name_ar,g.name_en,g.grade,g.weight].join(' '));
      let score=0;
      for(const token of tokens){
        if(text.includes(token)) score+=token.length>=4?2:1;
      }
      if(/\b(?:EX|EXTRA)\b/i.test(segment)&&/EX/i.test(g.name_en||'')) score+=3;
      if(/(?:اكسترا|إكسترا)/i.test(segment)&&/EX/i.test(g.name_en||'')) score+=3;
      if(/كريم/i.test(segment)&&String(g.grade).toLowerCase()==='cream') score+=3;
      if(/(?:^|\s)B(?:\s|$)/i.test(segment)&&g.grade==='B') score+=2;
      if(/(?:^|\s)A(?:\s|$)/i.test(segment)&&g.grade==='A') score+=2;
      const wm=segment.match(/(20|25|40)\s*(?:كغ|كيلو)/i);
      if(wm&&Number(wm[1])===Number(g.weight)) score+=3;
      return {g,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.g.quantity-a.g.quantity);
    if(!scored.length) return {error:'لم أتعرف على الصنف: '+segment};
    const top=scored[0].score;
    const best=scored.filter(x=>x.score===top);
    if(best.length>1) return {choice:best.slice(0,8).map(x=>x.g)};
    return {product:best[0].g};
  }

  app.post('/api/v7/agent/sale-preview', async function(req,res){
    try{
      const prompt=arabicDigits(req.body?.prompt||'').trim();
      if(!prompt) throw new Error('اكتب أمر المبيعة.');
      const t=norm(prompt);
      if(!/(بيع|مبيع|بيعه|فاتور)/.test(t)) throw new Error('الأمر لا يبدو كمبيعة أو فاتورة.');

      const [customers,shipments,bales]=await Promise.all([
        fetchAll('customers?select=id,name,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z'),
        fetchAll('shipments?select=id,season'),
        fetchAll('bales?select=id,shipment_id,name_en,name_ar,grade,weight,status,created_at&order=created_at.asc')
      ]);
      const customer=[...customers].sort((a,b)=>String(b.name||'').length-String(a.name||'').length).find(c=>t.includes(norm(c.name)));
      if(!customer) throw new Error('لم أتعرف على اسم الزبون. اذكر اسم الزبون كما هو مسجل.');

      const groups=productGroups(shipments,bales);
      const segments=lineParts(prompt,String(customer.name||''));
      if(!segments.length){
        return res.json({ok:false,invoice_mode:true,needs_more:true,customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},message:'تمام، الفاتورة للزبون '+customer.name+'. اذكر أول صنف مع الكمية والسعر.'});
      }

      const parsed=[];
      for(let i=0;i<segments.length;i++){
        const seg=segments[i];
        const qty=parseQty(seg);
        if(!Number.isInteger(qty)||qty<=0){
          return res.json({ok:false,invoice_mode:true,needs_more:true,customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},message:'الصنف رقم '+(i+1)+' ناقصه عدد البالات. مثال: 3 بالات.',lines:parsed});
        }
        const mp=matchProduct(seg,groups);
        if(mp.error) return res.status(400).json({error:mp.error});
        if(mp.choice){
          return res.json({ok:false,invoice_mode:true,needs_choice:true,message:'الصنف رقم '+(i+1)+' يطابق أكثر من تصنيف. حدد الوزن أو الدرجة.',customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},matches:mp.choice,lines:parsed});
        }
        const product=mp.product;
        if(qty>product.quantity) throw new Error('الصنف '+(product.name_ar||product.name_en)+': المطلوب '+qty+' والمتاح '+product.quantity+' فقط.');
        const price=parsePrice(seg,qty);
        if(!(price.total>0)){
          return res.json({ok:false,invoice_mode:true,needs_more:true,customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},message:'الصنف رقم '+(i+1)+' ناقصه السعر. مثال: بسعر 180 للبالة.',lines:parsed.concat([{product,quantity:qty}])});
        }
        parsed.push({product,quantity:qty,unit_price_jod:price.unit,total_jod:price.total});
      }

      const total=parsed.reduce((s,x)=>s+x.total_jod,0);
      const totalQty=parsed.reduce((s,x)=>s+x.quantity,0);
      const invoiceMode=/فاتور/i.test(prompt)||parsed.length>1;
      res.json({
        ok:true,
        invoice_mode:invoiceMode,
        message:invoiceMode?'فهمت الفاتورة. تقدر تضيف صنف آخر أو تنقلها للفحص النهائي.':'فهمت المبيعة. راجعها ثم افتح شاشة المبيعات للتأكيد النهائي.',
        customer:{id:customer.id,name:customer.name,current_debt:Number(customer.debt||0)},
        lines:parsed,
        product:parsed[0]?.product,
        quantity:parsed[0]?.quantity||0,
        unit_price_jod:parsed[0]?.unit_price_jod||0,
        total_jod:total,
        total_qty:totalQty,
        expected_debt_after:Number(customer.debt||0)+total
      });
    }catch(e){res.status(400).json({error:e.message})}
  });
};
