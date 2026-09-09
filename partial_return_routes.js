const crypto = require('crypto');

module.exports = function registerPartialReturnRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

  const ITALIAN_BATCH = 'ITALIAN-SALE-2026-09-09-V1';
  const ITALIAN_LINES = [
    { name:'JOGGING WCR', grade:'Cream', weight:25, quantity:10, line_total_jod:1875 },
    { name:'MEDIUM RUMMAGE WCR', grade:'Cream', weight:25, quantity:12, line_total_jod:2250 },
    { name:'HOODED WCR', grade:'Cream', weight:25, quantity:6, line_total_jod:1125 },
    { name:'LADY WINTER DRESS WCR', grade:'Cream', weight:25, quantity:5, line_total_jod:925 },
    { name:'MEN ANORAK WCR', grade:'Cream', weight:20, quantity:7, line_total_jod:1050 },
    { name:'MEN WINTER SHIRT WCR', grade:'Cream', weight:25, quantity:1, line_total_jod:185 },
    { name:'LOC WCR', grade:'Cream', weight:20, quantity:4, line_total_jod:600 },
    { name:'BOY ANORAK WCR', grade:'Cream', weight:20, quantity:7, line_total_jod:1050 },
    { name:'LADY ANORAK WCR', grade:'Cream', weight:20, quantity:3, line_total_jod:450 },
    { name:'LADY WINTER SKIRT WCR', grade:'Cream', weight:40, quantity:4, line_total_jod:1200 },
    { name:'LADY FLANNEL BLOUSE WCR', grade:'Cream', weight:25, quantity:3, line_total_jod:560 },
    { name:'LADY WINTER ABAYA', grade:'A', weight:25, quantity:5, line_total_jod:1250 },
    { name:'LADY WINTER BLOUSE WCR', grade:'Cream', weight:25, quantity:5, line_total_jod:625 },
    { name:'BODY T SHIRT L/S WCR', grade:'Cream', weight:25, quantity:5, line_total_jod:625 },
    { name:'BABY ANORAK 40KG', grade:'A', weight:40, quantity:4, line_total_jod:640 },
    { name:'BOY ANORAK EX', grade:'A', weight:40, quantity:4, line_total_jod:640 },
    { name:'CHILDREN HOODED', grade:'A', weight:40, quantity:8, line_total_jod:1200 },
    { name:'LRC JACKET EX', grade:'A', weight:40, quantity:2, line_total_jod:260 },
    { name:'LADY LONG FASHION WINTER JACKET', grade:'A', weight:40, quantity:3, line_total_jod:450 },
    { name:'MIX CROP TOP HOODED', grade:'A', weight:40, quantity:2, line_total_jod:300 },
    { name:'DUBLANKA JACKET EX', grade:'A', weight:40, quantity:4, line_total_jod:560 },
    { name:'FARU JACKET EX', grade:'A', weight:40, quantity:4, line_total_jod:560 },
    { name:'LEGGING PREMIUM', grade:'A', weight:40, quantity:2, line_total_jod:320 },
    { name:'OVERALL FLEECE', grade:'A', weight:40, quantity:4, line_total_jod:400 }
  ];

  function stableUuid(value) {
    const chars = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
    chars[12] = '5';
    chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
    const hex = chars.join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }

  function norm(value) {
    return String(value || '').trim().toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g,'').replace(/[ـ]/g,'')
      .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function normGrade(value) {
    const g=norm(value); if(['CREAM','CREME','كريم'].map(norm).includes(g)) return 'CREAM'; if(g==='B') return 'B'; return 'A';
  }
  function saleBatch(notes){const m=String(notes||'').match(/\[SALE_BATCH:([^\]]+)\]/i);return m?String(m[1]):''}
  function branchId(status){const m=String(status||'').match(/\[BRANCH:(\d+)\]/i);return m?Number(m[1]):2}
  function returnBatch(status){const m=String(status||'').match(/\[RETURN_BATCH:([^\]]+)\]/i);return m?String(m[1]):''}
  function returnValue(status){const m=String(status||'').match(/\[RETURN_VALUE:([0-9.]+)\]/i);return m?Number(m[1]):0}
  function returnLineIndex(status){const m=String(status||'').match(/\[RETURN_LINE:(\d+)\]/i);return m?Number(m[1]):-1}
  function exchangeOf(notes){const m=String(notes||'').match(/\[EXCHANGE_OF:([^\]]+)\]/i);return m?String(m[1]):''}
  function exchangeReturn(notes){const m=String(notes||'').match(/\[EXCHANGE_RETURN:([^\]]+)\]/i);return m?String(m[1]):''}
  function returnRecords(notes){
    const records=new Map();const re=/\[RETURN_DATA:([A-Za-z0-9_-]+)\]/g;let match;
    while((match=re.exec(String(notes||'')))){
      try{
        const record=JSON.parse(Buffer.from(match[1],'base64url').toString('utf8'));
        if(record&&record.id&&Array.isArray(record.lines)&&!records.has(String(record.id)))records.set(String(record.id),record);
      }catch(_){ }
    }
    return [...records.values()];
  }

  function recordTotal(record){
    return (record?.lines||[]).reduce((sum,line)=>sum+Number(line.quantity||0)*Number(line.unit_price_jod||0),0);
  }
  function legacyReturnRecords(rows){
    const grouped=new Map();
    for(const bale of rows||[]){
      const id=returnBatch(bale.status);const lineIndex=returnLineIndex(bale.status);const value=returnValue(bale.status);
      if(!id||lineIndex<0||!(value>0))continue;
      let record=grouped.get(id);
      if(!record){record={id,created_at:null,lines:[]};grouped.set(id,record)}
      let line=record.lines.find(x=>Number(x.line_index)===lineIndex&&Number(x.unit_price_jod)===value);
      if(!line){line={line_index:lineIndex,quantity:0,unit_price_jod:value};record.lines.push(line)}
      line.quantity+=1;
    }
    return [...grouped.values()];
  }
  function mergeReturnRecords(notes,legacyRows){
    const merged=new Map(returnRecords(notes).map(record=>[String(record.id),record]));
    for(const record of legacyReturnRecords(legacyRows))if(!merged.has(String(record.id)))merged.set(String(record.id),record);
    return [...merged.values()];
  }
  async function ensureReturnRecord(sale,returnId,rows){
    let records=returnRecords(sale.notes);
    if(records.some(record=>String(record.id)===returnId))return records;
    const legacy=legacyReturnRecords(rows).find(record=>String(record.id)===returnId);
    if(!legacy)return records;
    const record={...legacy,created_at:new Date().toISOString()};
    const encoded=Buffer.from(JSON.stringify(record),'utf8').toString('base64url');
    const notes='[RETURN_DATA:'+encoded+'] '+String(sale.notes||'');
    await supabaseRequest('sales?id=eq.'+encodeURIComponent(sale.id),{
      method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({notes})
    });
    sale.notes=notes;
    records=returnRecords(notes);
    return records;
  }

  async function fetchAll(basePath){
    const out=[];const pageSize=1000;
    for(let offset=0;offset<100000;offset+=pageSize){
      const sep=basePath.includes('?')?'&':'?';
      const page=await supabaseRequest(basePath+sep+'limit='+pageSize+'&offset='+offset);
      const rows=Array.isArray(page)?page:[];out.push(...rows);if(rows.length<pageSize)break;
    }
    return out;
  }

  function parseSaleLines(notes){
    const text=String(notes||'');
    if(text.includes('[SALE_BATCH:'+ITALIAN_BATCH+']')) return ITALIAN_LINES.map(x=>({...x}));
    const marker='الأصناف:';const idx=text.indexOf(marker);if(idx===-1)return[];
    const tail=text.slice(idx+marker.length).trim();if(!tail)return[];
    return tail.split('||').map(part=>{
      const bits=part.split('|').map(x=>x.trim()).filter(Boolean);const name=bits[0]||'';
      let grade='',weight=0,quantity=0,lineTotal=0;
      for(const b of bits.slice(1)){
        if(/^عدد\s+/i.test(b))quantity=Number((b.match(/\d+(?:\.\d+)?/)||[0])[0]);
        else if(/^اجمالي\s+/i.test(b)||/^إجمالي\s+/i.test(b))lineTotal=Number((b.match(/\d+(?:\.\d+)?/)||[0])[0]);
        else if(/كغ|kg/i.test(b))weight=Number((b.match(/\d+(?:\.\d+)?/)||[0])[0]);
        else if(!grade)grade=b;
      }
      return {name,grade,weight,quantity,line_total_jod:lineTotal};
    }).filter(x=>x.name&&x.quantity>0&&x.line_total_jod>0);
  }

  async function paymentById(id){const rows=await supabaseRequest('payments?select=id,customer_id,amount,paid_at&id=eq.'+encodeURIComponent(id)+'&limit=1');return Array.isArray(rows)?rows[0]:null}
  function lineMatchesBale(line,bale){
    const names=[norm(bale.name_en),norm(bale.name_ar)].filter(Boolean);
    return names.includes(norm(line.name))&&normGrade(bale.grade)===normGrade(line.grade)&&Number(bale.weight||0)===Number(line.weight||0);
  }

  async function soldBalesForBatch(batchId){
    return fetchAll('bales?select=id,name_en,name_ar,grade,weight,status&status=like.'+encodeURIComponent('*[SALE_BATCH:'+batchId+']*'));
  }
  async function returnedBalesForSale(saleId){
    return fetchAll('bales?select=id,name_en,name_ar,grade,weight,status&status=like.'+encodeURIComponent('*[RETURN_OF:'+saleId+']*'));
  }
  async function restoreSelectedBales(selected,saleId,returnId){
    for(const item of selected){
      const bale=item.bale;
      const status='[BRANCH:'+branchId(bale.status)+'] متوفر [RETURN_OF:'+saleId+'] [RETURN_BATCH:'+returnId+'] [RETURN_LINE:'+item.line_index+'] [RETURN_VALUE:'+Number(item.value).toFixed(6)+']';
      await supabaseRequest('bales?id=eq.'+encodeURIComponent(bale.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status})});
    }
  }

  async function financialState(sale,batchId,records){
    const saleAmount=Math.abs(Number(sale.total_jod||0));
    const originalPayment=await paymentById(stableUuid('payment|'+batchId));
    const paidAmount=Math.min(saleAmount,Math.max(0,Number(originalPayment?.amount||0)));
    const originalCredit=Math.max(0,saleAmount-paidAmount);
    const returnedTotal=(records||[]).reduce((sum,record)=>sum+recordTotal(record),0);
    const batches=[...new Set((records||[]).map(record=>String(record.id||'')).filter(Boolean))];
    let credited=0;
    for(const rb of batches){const p=await paymentById(stableUuid('partial-return-credit|'+sale.id+'|'+rb));credited+=Number(p?.amount||0)}
    const cashRows=await fetchAll('cash_movements?select=id,amount,movement_date,reference_id,notes&reference_type=eq.sale_partial_return&reference_id=eq.'+encodeURIComponent(sale.id));
    const cashRefunded=cashRows.reduce((sum,x)=>sum+Number(x.amount||0),0);
    const targetCredit=Math.min(returnedTotal,originalCredit);
    const targetCash=Math.max(0,returnedTotal-targetCredit);
    return {saleAmount,paidAmount,originalCredit,returnedTotal,batches,credited,cashRefunded,targetCredit,targetCash,cashRows};
  }

  async function applyFinancialAdjustment(sale,batchId,returnId,records){
    const state=await financialState(sale,batchId,records);
    const creditNeed=Math.max(0,Number((state.targetCredit-state.credited).toFixed(2)));
    const cashNeed=Math.max(0,Number((state.targetCash-state.cashRefunded).toFixed(2)));
    const paymentId=stableUuid('partial-return-credit|'+sale.id+'|'+returnId);
    if(creditNeed>0&&!(await paymentById(paymentId))){
      await supabaseRequest('rpc/record_payment',{method:'POST',body:JSON.stringify({p_id:paymentId,p_customer_id:Number(sale.customer_id),p_amount:creditNeed})});
    }
    const batchCash=state.cashRows.filter(x=>String(x.notes||'').includes('[RETURN_BATCH:'+returnId+']'));
    if(cashNeed>0&&!batchCash.length){
      await supabaseRequest('cash_movements',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
        movement_type:'out',amount:cashNeed,movement_date:new Date().toISOString().slice(0,10),reference_type:'sale_partial_return',reference_id:sale.id,
        notes:'[RETURN_BATCH:'+returnId+'] [RETURN_OF:'+sale.id+'] رد نقدي لمرتجع جزئي'
      })});
    }
    return financialState(sale,batchId,records);
  }


  async function saleSnapshot(sale){
    const batchId=saleBatch(sale.notes);const lines=parseSaleLines(sale.notes);
    if(!batchId||!lines.length)return{batchId,lines:[],soldBales:[],returnedBales:[],returnRecords:[]};
    const [soldBales,returnedBales]=await Promise.all([soldBalesForBatch(batchId),returnedBalesForSale(sale.id)]);
    const records=mergeReturnRecords(sale.notes,returnedBales);
    const returnedByLine=new Map();
    for(const record of records){
      for(const item of record.lines||[]){
        const idx=Number(item.line_index);
        if(idx>=0)returnedByLine.set(idx,(returnedByLine.get(idx)||0)+Number(item.quantity||0));
      }
    }
    const detailed=lines.map((line,index)=>{
      const soldQty=soldBales.filter(b=>lineMatchesBale(line,b)).length;
      const returnedQty=returnedByLine.get(index)||0;
      const unit=Number(line.line_total_jod||0)/Math.max(1,Number(line.quantity||0));
      return {...line,line_index:index,unit_price_jod:Number(unit.toFixed(6)),returned_qty:returnedQty,remaining_qty:soldQty,returned_value:Number((returnedQty*unit).toFixed(2))};
    });
    return{batchId,lines:detailed,soldBales,returnedBales,returnRecords:records};
  }


  app.get('/api/v7/customers/:id/statement',async function(req,res){
    try{
      const customerId=String(req.params.id||'').trim();
      const [customers,sales,payments,fullCashReturns]=await Promise.all([
        fetchAll('customers?select=id,name,phone,debt,created_at&id=eq.'+encodeURIComponent(customerId)),
        fetchAll('sales?select=id,customer_id,total_jod,notes,sale_date,created_at&customer_id=eq.'+encodeURIComponent(customerId)+'&order=created_at.asc'),
        fetchAll('payments?select=id,customer_id,amount,paid_at&customer_id=eq.'+encodeURIComponent(customerId)+'&order=paid_at.asc'),
        fetchAll('cash_movements?select=id,amount,movement_date,reference_id,notes&reference_type=eq.sale_return&order=movement_date.asc')
      ]);
      const customer=customers[0];if(!customer)throw new Error('الزبون غير موجود.');
      const saleById=new Map(sales.map(s=>[String(s.id),s]));
      const exchangeSaleByReturn=new Map();
      for(const item of sales){
        const exchangeReturnId=exchangeReturn(item.notes);
        if(exchangeReturnId)exchangeSaleByReturn.set(exchangeReturnId,item);
      }
      const fullReturnPaymentToSale=new Map(sales.map(s=>[stableUuid('return-credit|'+s.id),String(s.id)]));
      const fullReturnPayments=payments.filter(p=>fullReturnPaymentToSale.has(String(p.id)));
      const fullReturnPaymentIds=new Set(fullReturnPayments.map(p=>String(p.id)));
      const fullReturnedSaleIds=new Set();
      for(const p of fullReturnPayments)fullReturnedSaleIds.add(fullReturnPaymentToSale.get(String(p.id)));
      for(const c of fullCashReturns)if(saleById.has(String(c.reference_id)))fullReturnedSaleIds.add(String(c.reference_id));

      const saleDetails=new Map();const partialPaymentIds=new Set();let partialReturnedTotal=0;let partialCreditTotal=0;
      for(const sale of sales){
        const snap=await saleSnapshot(sale);saleDetails.set(String(sale.id),snap);
        partialReturnedTotal+=snap.returnRecords.reduce((sum,record)=>sum+recordTotal(record),0);
        const batches=[...new Set(snap.returnRecords.map(record=>String(record.id||'')).filter(Boolean))];
        for(const rb of batches){
          const pid=stableUuid('partial-return-credit|'+sale.id+'|'+rb);partialPaymentIds.add(pid);
          const p=payments.find(x=>String(x.id)===pid)||await paymentById(pid);if(p)partialCreditTotal+=Number(p.amount||0);
        }
      }
      const regularPayments=payments.filter(p=>!fullReturnPaymentIds.has(String(p.id))&&!partialPaymentIds.has(String(p.id)));
      const totalSales=sales.reduce((s,x)=>s+Number(x.total_jod||0),0);
      const totalPayments=regularPayments.reduce((s,x)=>s+Number(x.amount||0),0);
      const fullReturnedTotal=[...fullReturnedSaleIds].reduce((sum,id)=>sum+Number(saleById.get(id)?.total_jod||0),0);
      const fullCreditTotal=fullReturnPayments.reduce((s,x)=>s+Number(x.amount||0),0);
      const totalReturns=fullReturnedTotal+partialReturnedTotal;
      const currentDebt=Number(customer.debt||0);
      const openingDebt=currentDebt-totalSales+totalPayments+fullCreditTotal+partialCreditTotal;

      const movements=[];
      for(const sale of sales){
        const snap=saleDetails.get(String(sale.id));const fullReturned=fullReturnedSaleIds.has(String(sale.id));
        const exchangeReturnId=exchangeReturn(sale.notes);
        movements.push({id:sale.id,type:'sale',date:sale.sale_date||sale.created_at||null,created_at:sale.created_at||sale.sale_date||null,
          amount:Number(sale.total_jod||0),notes:sale.notes||'',lines:snap.lines,returned:fullReturned,partial_returned:snap.returnRecords.length>0,
          exchange:exchangeReturnId?{role:'replacement',original_sale_id:exchangeOf(sale.notes),return_id:exchangeReturnId}:null,
          can_return:!!snap.batchId&&!fullReturned&&snap.lines.some(x=>x.remaining_qty>0)});
      }
      for(const p of regularPayments)movements.push({id:p.id,type:'payment',date:p.paid_at||null,created_at:p.paid_at||null,amount:Number(p.amount||0),notes:'',lines:[]});

      for(const sale of sales){
        const saleId=String(sale.id);
        if(fullReturnedSaleIds.has(saleId)){
          const credit=fullReturnPayments.find(p=>fullReturnPaymentToSale.get(String(p.id))===saleId);
          const cash=fullCashReturns.find(x=>String(x.reference_id)===saleId);
          movements.push({id:'return-'+saleId,type:'return',date:credit?.paid_at||cash?.movement_date||null,created_at:credit?.paid_at||cash?.movement_date||null,
            amount:Number(credit?.amount||0),returned_total:Number(sale.total_jod||0),cash_refund:Number(cash?.amount||0),notes:'مرتجع مبيعة',lines:parseSaleLines(sale.notes)});
        }
        const snap=saleDetails.get(saleId);
        const partialCashRows=await fetchAll('cash_movements?select=id,amount,movement_date,notes&reference_type=eq.sale_partial_return&reference_id=eq.'+encodeURIComponent(saleId));
        for(const record of snap.returnRecords){
          const rb=String(record.id||'');if(!rb)continue;
          const returnedTotal=recordTotal(record);
          const pid=stableUuid('partial-return-credit|'+saleId+'|'+rb);
          const credit=payments.find(p=>String(p.id)===pid)||await paymentById(pid);
          const cash=partialCashRows.find(x=>String(x.notes||'').includes('[RETURN_BATCH:'+rb+']'));
          const byLine=new Map();
          for(const item of record.lines||[]){
            const idx=Number(item.line_index);
            byLine.set(idx,(byLine.get(idx)||0)+Number(item.quantity||0));
          }
          const originals=parseSaleLines(sale.notes);
          const retLines=[...byLine.entries()].map(([idx,qty])=>{const original=originals[idx]||{};const unit=Number(original.line_total_jod||0)/Math.max(1,Number(original.quantity||0));return{...original,quantity:qty,line_total_jod:Number((qty*unit).toFixed(2))}});
          const replacement=exchangeSaleByReturn.get(rb)||null;
          const movementDate=credit?.paid_at||cash?.movement_date||record.created_at||null;
          movements.push({id:'partial-return-'+saleId+'-'+rb,type:'partial_return',date:movementDate,created_at:movementDate,
            amount:Number(credit?.amount||0),returned_total:Number(returnedTotal.toFixed(2)),cash_refund:Number(cash?.amount||0),notes:replacement?'بالات راجعة ضمن تبديل':'مرتجع جزئي',lines:retLines,
            exchange:replacement?{role:'returned',replacement_sale_id:replacement.id,replacement_total:Number(replacement.total_jod||0),replacement_lines:parseSaleLines(replacement.notes)}:null});
        }

      }
      movements.sort((a,b)=>new Date(a.created_at||a.date||0)-new Date(b.created_at||b.date||0));
      let running=openingDebt;for(const m of movements){if(m.type==='sale')running+=Number(m.amount||0);else running-=Number(m.amount||0);m.balance_after=running}
      res.set&&res.set('Cache-Control','no-store');
      res.json({ok:true,customer:{id:customer.id,name:customer.name,phone:customer.phone||'',current_debt:currentDebt},opening_debt:openingDebt,total_sales:totalSales,total_payments:totalPayments,total_returns:Number(totalReturns.toFixed(2)),movements:movements.slice().reverse()});
    }catch(e){res.status(400).json({error:e.message})}
  });

  app.post('/api/v7/sales/:id/partial-return',async function(req,res){
    const saleId=String(req.params.id||'').trim();const returnId=String(req.body?.return_id||'').trim();
    try{
      if(!saleId)throw new Error('رقم المبيعة غير صالح.');
      if(!/^[A-Za-z0-9_-]{8,100}$/.test(returnId))throw new Error('معرّف المرتجع غير صالح.');
      const sales=await fetchAll('sales?select=id,customer_id,total_jod,notes&id=eq.'+encodeURIComponent(saleId));const sale=sales[0];if(!sale)throw new Error('المبيعة غير موجودة.');
      const snap=await saleSnapshot(sale);if(!snap.batchId||!snap.lines.length)throw new Error('هذه المبيعة غير مرتبطة بأصناف قابلة للإرجاع.');

      let records=snap.returnRecords;
      const existingRecord=records.find(record=>String(record.id)===returnId)||null;
      let batchReturned=snap.returnedBales.filter(b=>returnBatch(b.status)===returnId);
      if(!existingRecord&&!batchReturned.length){
        const requested=Array.isArray(req.body?.lines)?req.body.lines:[];if(!requested.length)throw new Error('اختر صنفًا واحدًا على الأقل للإرجاع.');
        const used=new Set();const selected=[];
        for(const raw of requested){
          const idx=Number(raw.line_index),qty=Number(raw.quantity||0),line=snap.lines[idx];
          if(!line)throw new Error('أحد أصناف المرتجع غير صالح.');
          if(!Number.isInteger(qty)||qty<=0)throw new Error('كمية المرتجع غير صحيحة.');
          const candidates=snap.soldBales.filter(b=>lineMatchesBale(line,b)&&!used.has(String(b.id)));
          if(qty>candidates.length)throw new Error((line.name||'الصنف')+': المتاح للإرجاع '+candidates.length+' فقط.');
          const unit=Number(line.line_total_jod||0)/Math.max(1,Number(line.quantity||0));
          for(const bale of candidates.slice(0,qty)){used.add(String(bale.id));selected.push({bale,line_index:idx,value:unit})}
        }
        if(!selected.length)throw new Error('لم يتم اختيار أي بالة للإرجاع.');
        await restoreSelectedBales(selected,saleId,returnId);
        batchReturned=await returnedBalesForSale(saleId);batchReturned=batchReturned.filter(b=>returnBatch(b.status)===returnId);
      }

      if(batchReturned.length)records=await ensureReturnRecord(sale,returnId,batchReturned);
      const currentRecord=records.find(record=>String(record.id)===returnId)||existingRecord;
      if(!currentRecord)throw new Error('تعذر تثبيت سجل المرتجع. أعد المحاولة بنفس العملية.');
      const state=await applyFinancialAdjustment(sale,snap.batchId,returnId,records);
      const customers=await fetchAll('customers?select=id,name,debt&id=eq.'+encodeURIComponent(sale.customer_id));const customer=customers[0]||{};
      const thisTotal=recordTotal(currentRecord);
      const thisQty=(currentRecord.lines||[]).reduce((sum,line)=>sum+Number(line.quantity||0),0);
      res.json({ok:true,customer_id:sale.customer_id,customer:customer.name||'',debt:Number(customer.debt||0),returned_qty:thisQty,returned_total:Number(thisTotal.toFixed(2)),
        cumulative_returned:Number(state.returnedTotal.toFixed(2)),cumulative_debt_credit:Number(state.targetCredit.toFixed(2)),cumulative_cash_refund:Number(state.targetCash.toFixed(2))});

    }catch(e){res.status(400).json({error:e.message,retry_safe:true,return_id:returnId})}
  });
};