const crypto=require('crypto');

module.exports=function registerPartialReturnFinancialRoutes(ctx){
  const app=ctx.app;
  const supabaseRequest=ctx.supabaseRequest;

  function stableUuid(value){
    const chars=crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,32).split('');
    chars[12]='5';
    chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);
    const hex=chars.join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
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
  function returnBatch(status){const m=String(status||'').match(/\[RETURN_BATCH:([^\]]+)\]/i);return m?String(m[1]):''}
  function returnValue(status){const m=String(status||'').match(/\[RETURN_VALUE:([0-9.]+)\]/i);return m?Number(m[1]):0}
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
  function legacyRecords(rows){
    const totals=new Map();
    for(const bale of rows||[]){
      const id=returnBatch(bale.status);if(!id)continue;
      totals.set(id,(totals.get(id)||0)+returnValue(bale.status));
    }
    return [...totals.entries()].map(([id,total])=>({id,lines:[{line_index:-1,quantity:1,unit_price_jod:total}]}));
  }
  function mergedRecords(notes,rows){
    const merged=new Map(returnRecords(notes).map(record=>[String(record.id),record]));
    for(const record of legacyRecords(rows))if(!merged.has(String(record.id)))merged.set(String(record.id),record);
    return [...merged.values()];
  }
  function ts(v){const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0}

  async function paymentAllocationForTarget(targetSale,allSales,regularPayments,fullReturnedIds){
    const obligations=new Map();
    for(const s of allSales)obligations.set(String(s.id),fullReturnedIds.has(String(s.id))?0:Math.max(0,Number(s.total_jod||0)));
    const allocated=new Map(allSales.map(s=>[String(s.id),0]));
    const sortedSales=[...allSales].sort((a,b)=>ts(a.created_at||a.sale_date)-ts(b.created_at||b.sale_date));
    const sortedPayments=[...regularPayments].sort((a,b)=>ts(a.paid_at)-ts(b.paid_at));
    for(const p of sortedPayments){
      let left=Math.max(0,Number(p.amount||0));if(!left)continue;
      const ptime=ts(p.paid_at);
      const eligible=sortedSales.filter(s=>ts(s.created_at||s.sale_date)<=ptime).reverse();
      for(const s of eligible){
        if(left<=0)break;
        const id=String(s.id),due=Math.max(0,(obligations.get(id)||0)-(allocated.get(id)||0));
        if(!due)continue;
        const use=Math.min(left,due);allocated.set(id,(allocated.get(id)||0)+use);left-=use;
      }
    }
    return Math.min(Math.max(0,Number(targetSale.total_jod||0)),allocated.get(String(targetSale.id))||0);
  }

  app.post('/api/v8/sales/:id/reconcile-return',async function(req,res){
    const saleId=String(req.params.id||'').trim();
    const requestedReturnId=String(req.body?.return_id||'').trim();
    try{
      if(!saleId)throw new Error('رقم المبيعة غير صالح.');
      const sales=await fetchAll('sales?select=id,customer_id,total_jod,notes,sale_date,created_at&id=eq.'+encodeURIComponent(saleId));
      const sale=sales[0];if(!sale)throw new Error('المبيعة غير موجودة.');
      const customerId=String(sale.customer_id);
      const [allSales,payments,fullCashReturns,returnedBales,partialCashRows]=await Promise.all([
        fetchAll('sales?select=id,customer_id,total_jod,notes,sale_date,created_at&customer_id=eq.'+encodeURIComponent(customerId)+'&order=created_at.asc'),
        fetchAll('payments?select=id,customer_id,amount,paid_at&customer_id=eq.'+encodeURIComponent(customerId)+'&order=paid_at.asc'),
        fetchAll('cash_movements?select=id,reference_id&reference_type=eq.sale_return'),
        fetchAll('bales?select=id,status&status=like.'+encodeURIComponent('*[RETURN_OF:'+saleId+']*')),
        fetchAll('cash_movements?select=id,amount,notes&reference_type=eq.sale_partial_return&reference_id=eq.'+encodeURIComponent(saleId))
      ]);

      const fullReturnPaymentIds=new Set(allSales.map(s=>stableUuid('return-credit|'+s.id)));
      const fullReturnedIds=new Set();
      for(const s of allSales){if(payments.some(p=>String(p.id)===stableUuid('return-credit|'+s.id)))fullReturnedIds.add(String(s.id));}
      for(const c of fullCashReturns){if(allSales.some(s=>String(s.id)===String(c.reference_id)))fullReturnedIds.add(String(c.reference_id));}

      const records=mergedRecords(sale.notes,returnedBales);
      const batchTotals=new Map();
      for(const record of records)batchTotals.set(String(record.id),recordTotal(record));
      const batches=[...batchTotals.keys()];

      const partialPaymentIds=new Set();
      for(const item of allSales){
        let recordsForSale=returnRecords(item.notes);
        if(!recordsForSale.length){
          const rows=await fetchAll('bales?select=status&status=like.'+encodeURIComponent('*[RETURN_OF:'+item.id+']*'));
          recordsForSale=legacyRecords(rows);
        }
        for(const record of recordsForSale)partialPaymentIds.add(stableUuid('partial-return-credit|'+item.id+'|'+record.id));
      }
      const regularPayments=payments.filter(p=>!fullReturnPaymentIds.has(String(p.id))&&!partialPaymentIds.has(String(p.id)));
      const paidCoverage=await paymentAllocationForTarget(sale,allSales,regularPayments,fullReturnedIds);
      const saleAmount=Math.max(0,Number(sale.total_jod||0));
      const returnedTotal=[...batchTotals.values()].reduce((s,v)=>s+Number(v||0),0);
      const unpaidPart=Math.max(0,saleAmount-paidCoverage);
      const desiredCredit=Math.min(returnedTotal,unpaidPart);
      const desiredCash=Math.max(0,returnedTotal-desiredCredit);

      for(const p of payments){
        if(partialPaymentIds.has(String(p.id))&&Number(p.customer_id)===Number(sale.customer_id)){
          await supabaseRequest('payments?id=eq.'+encodeURIComponent(p.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});
        }
      }
      for(const row of partialCashRows){
        await supabaseRequest('cash_movements?id=eq.'+encodeURIComponent(row.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});
      }

      let creditLeft=desiredCredit;
      const batchSettlements=[];
      for(const batch of batches){
        const batchTotal=Number(batchTotals.get(batch)||0);
        const batchCredit=Math.min(batchTotal,creditLeft);
        const batchCash=Math.max(0,batchTotal-batchCredit);
        creditLeft=Math.max(0,creditLeft-batchCredit);
        batchSettlements.push({
          return_id:batch,
          returned_total:Number(batchTotal.toFixed(2)),
          debt_credit:Number(batchCredit.toFixed(2)),
          cash_refund:Number(batchCash.toFixed(2))
        });

        if(batchCredit>0){

          await supabaseRequest('rpc/record_payment',{method:'POST',body:JSON.stringify({
            p_id:stableUuid('partial-return-credit|'+sale.id+'|'+batch),
            p_customer_id:Number(sale.customer_id),p_amount:Number(batchCredit.toFixed(2))
          })});
        }
        if(batchCash>0){
          await supabaseRequest('cash_movements',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
            movement_type:'out',amount:Number(batchCash.toFixed(2)),movement_date:new Date().toISOString().slice(0,10),
            reference_type:'sale_partial_return',reference_id:sale.id,
            notes:'[RETURN_BATCH:'+batch+'] [RETURN_OF:'+sale.id+'] رد نقدي لمرتجع جزئي'
          })});
        }
      }

      const customers=await fetchAll('customers?select=id,name,debt&id=eq.'+encodeURIComponent(customerId));
      const currentBatch=batchSettlements.find(x=>x.return_id===requestedReturnId)||null;
      res.json({ok:true,customer_id:sale.customer_id,paid_coverage:Number(paidCoverage.toFixed(2)),returned_total:Number(returnedTotal.toFixed(2)),debt_credit:Number(desiredCredit.toFixed(2)),cash_refund:Number(desiredCash.toFixed(2)),batch_settlements:batchSettlements,current_batch:currentBatch,debt:Number(customers[0]?.debt||0)});
    }catch(e){res.status(400).json({error:e.message,retry_safe:true})}
  });
};
