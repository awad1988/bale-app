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
  function saleBatch(notes){const m=String(notes||'').match(/\[SALE_BATCH:([^\]]+)\]/i);return m?String(m[1]):''}
  function returnBatch(status){const m=String(status||'').match(/\[RETURN_BATCH:([^\]]+)\]/i);return m?String(m[1]):''}
  function returnValue(status){const m=String(status||'').match(/\[RETURN_VALUE:([0-9.]+)\]/i);return m?Number(m[1]):0}
  function ts(v){const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0}

  async function paymentAllocationForTarget(targetSale, allSales, regularPayments, fullReturnedIds){
    const obligations=new Map();
    for(const s of allSales){
      obligations.set(String(s.id),fullReturnedIds.has(String(s.id))?0:Math.max(0,Number(s.total_jod||0)));
    }
    const allocated=new Map(allSales.map(s=>[String(s.id),0]));
    const sortedSales=[...allSales].sort((a,b)=>ts(a.created_at||a.sale_date)-ts(b.created_at||b.sale_date));
    const sortedPayments=[...regularPayments].sort((a,b)=>ts(a.paid_at)-ts(b.paid_at));
    for(const p of sortedPayments){
      let left=Math.max(0,Number(p.amount||0));
      if(!left)continue;
      const ptime=ts(p.paid_at);
      const eligible=sortedSales.filter(s=>ts(s.created_at||s.sale_date)<=ptime).reverse();
      for(const s of eligible){
        if(left<=0)break;
        const id=String(s.id);
        const due=Math.max(0,(obligations.get(id)||0)-(allocated.get(id)||0));
        if(!due)continue;
        const use=Math.min(left,due);
        allocated.set(id,(allocated.get(id)||0)+use);
        left-=use;
      }
    }
    return Math.min(Math.max(0,Number(targetSale.total_jod||0)),allocated.get(String(targetSale.id))||0);
  }

  app.post('/api/v8/sales/:id/reconcile-return',async function(req,res){
    const saleId=String(req.params.id||'').trim();
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
      for(const s of allSales){
        if(payments.some(p=>String(p.id)===stableUuid('return-credit|'+s.id)))fullReturnedIds.add(String(s.id));
      }
      for(const c of fullCashReturns){if(allSales.some(s=>String(s.id)===String(c.reference_id)))fullReturnedIds.add(String(c.reference_id));}

      const batches=[...new Set(returnedBales.map(b=>returnBatch(b.status)).filter(Boolean))];
      const partialPaymentIds=new Set();
      for(const s of allSales){
        const rb=await fetchAll('bales?select=status&status=like.'+encodeURIComponent('*[RETURN_OF:'+s.id+']*'));
        for(const batch of [...new Set(rb.map(b=>returnBatch(b.status)).filter(Boolean))]){
          partialPaymentIds.add(stableUuid('partial-return-credit|'+s.id+'|'+batch));
        }
      }
      const regularPayments=payments.filter(p=>!fullReturnPaymentIds.has(String(p.id))&&!partialPaymentIds.has(String(p.id)));
      const paidCoverage=await paymentAllocationForTarget(sale,allSales,regularPayments,fullReturnedIds);
      const saleAmount=Math.max(0,Number(sale.total_jod||0));
      const returnedTotal=returnedBales.reduce((sum,b)=>sum+returnValue(b.status),0);
      const unpaidPart=Math.max(0,saleAmount-paidCoverage);
      const desiredCredit=Math.min(returnedTotal,unpaidPart);
      const desiredCash=Math.max(0,returnedTotal-desiredCredit);

      for(const p of payments){
        if(partialPaymentIds.has(String(p.id))&&Number(p.customer_id)===Number(sale.customer_id)){
          await supabaseRequest('payments?id=eq.'+encodeURIComponent(p.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});
        }
      }
      if(desiredCredit>0){
        const batch=batches[0]||('RECON_'+Date.now());
        await supabaseRequest('rpc/record_payment',{method:'POST',body:JSON.stringify({
          p_id:stableUuid('partial-return-credit|'+sale.id+'|'+batch),
          p_customer_id:Number(sale.customer_id),p_amount:Number(desiredCredit.toFixed(2))
        })});
      }

      for(const row of partialCashRows){
        await supabaseRequest('cash_movements?id=eq.'+encodeURIComponent(row.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});
      }
      if(desiredCash>0){
        const batch=batches[0]||('RECON_'+Date.now());
        await supabaseRequest('cash_movements',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
          movement_type:'out',amount:Number(desiredCash.toFixed(2)),movement_date:new Date().toISOString().slice(0,10),
          reference_type:'sale_partial_return',reference_id:sale.id,
          notes:'[RETURN_BATCH:'+batch+'] [RETURN_OF:'+sale.id+'] رد نقدي لمرتجع جزئي'
        })});
      }

      const customers=await fetchAll('customers?select=id,name,debt&id=eq.'+encodeURIComponent(customerId));
      res.json({ok:true,customer_id:sale.customer_id,paid_coverage:Number(paidCoverage.toFixed(2)),returned_total:Number(returnedTotal.toFixed(2)),debt_credit:Number(desiredCredit.toFixed(2)),cash_refund:Number(desiredCash.toFixed(2)),debt:Number(customers[0]?.debt||0)});
    }catch(e){res.status(400).json({error:e.message,retry_safe:true})}
  });
};
