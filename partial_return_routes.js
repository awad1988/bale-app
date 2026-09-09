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
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function norm(value) {
    return String(value || '')
      .trim().toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[ـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normGrade(value) {
    const g = norm(value);
    if (['CREAM','CREME','كريم'].map(norm).includes(g)) return 'CREAM';
    if (g === 'B') return 'B';
    return 'A';
  }

  function saleBatch(notes) {
    const m = String(notes || '').match(/\[SALE_BATCH:([^\]]+)\]/i);
    return m ? String(m[1]) : '';
  }

  function branchId(status) {
    const m = String(status || '').match(/\[BRANCH:(\d+)\]/i);
    return m ? Number(m[1]) : 2;
  }

  function returnBatch(notes) {
    const m = String(notes || '').match(/\[RETURN_BATCH:([^\]]+)\]/i);
    return m ? String(m[1]) : '';
  }

  function returnValue(notes) {
    const m = String(notes || '').match(/\[RETURN_VALUE:([0-9.]+)\]/i);
    return m ? Number(m[1]) : 0;
  }

  function returnLineIndex(notes) {
    const m = String(notes || '').match(/\[RETURN_LINE:(\d+)\]/i);
    return m ? Number(m[1]) : -1;
  }

  async function fetchAll(basePath) {
    const out = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const sep = basePath.includes('?') ? '&' : '?';
      const page = await supabaseRequest(basePath + sep + 'limit=' + pageSize + '&offset=' + offset);
      const rows = Array.isArray(page) ? page : [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  function parseSaleLines(notes) {
    const text = String(notes || '');
    if (text.includes('[SALE_BATCH:' + ITALIAN_BATCH + ']')) return ITALIAN_LINES.map(x=>({...x}));
    const marker = 'الأصناف:';
    const idx = text.indexOf(marker);
    if (idx === -1) return [];
    const tail = text.slice(idx + marker.length).trim();
    if (!tail) return [];
    return tail.split('||').map(part => {
      const bits = part.split('|').map(x=>x.trim()).filter(Boolean);
      const name = bits[0] || '';
      let grade = '', weight = 0, quantity = 0, lineTotal = 0;
      for (const b of bits.slice(1)) {
        if (/^عدد\s+/i.test(b)) quantity = Number((b.match(/\d+(?:\.\d+)?/) || [0])[0]);
        else if (/^اجمالي\s+/i.test(b) || /^إجمالي\s+/i.test(b)) lineTotal = Number((b.match(/\d+(?:\.\d+)?/) || [0])[0]);
        else if (/كغ|kg/i.test(b)) weight = Number((b.match(/\d+(?:\.\d+)?/) || [0])[0]);
        else if (!grade) grade = b;
      }
      return { name, grade, weight, quantity, line_total_jod: lineTotal };
    }).filter(x=>x.name && x.quantity > 0 && x.line_total_jod > 0);
  }

  async function paymentById(id) {
    const rows = await supabaseRequest('payments?select=id,customer_id,amount,paid_at&id=eq.' + encodeURIComponent(id) + '&limit=1');
    return Array.isArray(rows) ? rows[0] : null;
  }

  function lineMatchesBale(line, bale) {
    const names = [norm(bale.name_en), norm(bale.name_ar)].filter(Boolean);
    return names.includes(norm(line.name)) && normGrade(bale.grade) === normGrade(line.grade) && Number(bale.weight || 0) === Number(line.weight || 0);
  }

  function movementMarker(saleId, returnId, lineIndex, value) {
    return '[SALE_RETURN:' + saleId + '] [RETURN_BATCH:' + returnId + '] [RETURN_LINE:' + lineIndex + '] [RETURN_VALUE:' + Number(value).toFixed(6) + ']';
  }

  async function returnMovementsForSale(saleId) {
    return fetchAll('stock_movements?select=id,bale_id,branch_id,qty,date,notes&notes=like.' + encodeURIComponent('*[SALE_RETURN:' + saleId + ']*') + '&order=date.asc');
  }

  async function allBalesForBatch(batchId) {
    return fetchAll('bales?select=id,name_en,name_ar,grade,weight,status&status=like.' + encodeURIComponent('*[SALE_BATCH:' + batchId + ']*'));
  }

  async function balesByIds(ids) {
    if (!ids.length) return [];
    const rows = [];
    for (let i=0;i<ids.length;i+=35) {
      rows.push(...await fetchAll('bales?select=id,name_en,name_ar,grade,weight,status&id=in.(' + ids.slice(i,i+35).join(',') + ')'));
    }
    return rows;
  }

  async function restoreSelectedBales(rows, saleId, returnId) {
    for (const bale of rows) {
      const status = '[BRANCH:' + branchId(bale.status) + '] متوفر [RETURN_OF:' + saleId + '] [RETURN_BATCH:' + returnId + ']';
      await supabaseRequest('bales?id=eq.' + encodeURIComponent(bale.id), {
        method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({status})
      });
    }
  }

  async function insertReturnMovements(saleId, returnId, selected) {
    const today = new Date().toISOString().slice(0,10);
    for (const item of selected) {
      const marker = movementMarker(saleId, returnId, item.line_index, item.value);
      const existing = await fetchAll('stock_movements?select=id&bale_id=eq.' + encodeURIComponent(item.bale.id) + '&notes=like.' + encodeURIComponent('*[RETURN_BATCH:' + returnId + ']*') + '&limit=1');
      if (existing.length) continue;
      await supabaseRequest('stock_movements', {
        method:'POST', headers:{Prefer:'return=minimal'},
        body:JSON.stringify({
          bale_id:item.bale.id,
          branch_id:branchId(item.bale.status),
          qty:1,
          date:today,
          notes:marker + ' مرتجع مبيعة جزئي'
        })
      });
    }
  }

  async function financialState(sale, batchId, returnMovements) {
    const saleAmount = Math.abs(Number(sale.total_jod || 0));
    const originalPayment = await paymentById(stableUuid('payment|' + batchId));
    const paidAmount = Math.min(saleAmount, Math.max(0, Number(originalPayment?.amount || 0)));
    const originalCredit = Math.max(0, saleAmount - paidAmount);
    const returnedTotal = returnMovements.reduce((sum,m)=>sum+returnValue(m.notes),0);
    const batches = [...new Set(returnMovements.map(m=>returnBatch(m.notes)).filter(Boolean))];

    let credited = 0;
    for (const rb of batches) {
      const p = await paymentById(stableUuid('partial-return-credit|' + sale.id + '|' + rb));
      credited += Number(p?.amount || 0);
    }
    const cashRows = await fetchAll('cash_movements?select=id,amount,movement_date,reference_id,notes&reference_type=eq.sale_partial_return&reference_id=eq.' + encodeURIComponent(sale.id));
    const cashRefunded = cashRows.reduce((sum,x)=>sum+Number(x.amount||0),0);
    const targetCredit = Math.min(returnedTotal, originalCredit);
    const targetCash = Math.max(0, returnedTotal - targetCredit);
    return { saleAmount, paidAmount, originalCredit, returnedTotal, batches, credited, cashRefunded, targetCredit, targetCash, cashRows };
  }

  async function applyFinancialAdjustment(sale, batchId, returnId, returnMovements) {
    const state = await financialState(sale, batchId, returnMovements);
    const creditNeed = Math.max(0, Number((state.targetCredit - state.credited).toFixed(2)));
    const cashNeed = Math.max(0, Number((state.targetCash - state.cashRefunded).toFixed(2)));
    const paymentId = stableUuid('partial-return-credit|' + sale.id + '|' + returnId);
    const existingPayment = await paymentById(paymentId);
    if (creditNeed > 0 && !existingPayment) {
      await supabaseRequest('rpc/record_payment', {
        method:'POST',
        body:JSON.stringify({ p_id:paymentId, p_customer_id:Number(sale.customer_id), p_amount:creditNeed })
      });
    }
    const batchCash = state.cashRows.filter(x=>returnBatch(x.notes) === returnId);
    if (cashNeed > 0 && !batchCash.length) {
      await supabaseRequest('cash_movements', {
        method:'POST', headers:{Prefer:'return=minimal'},
        body:JSON.stringify({
          movement_type:'out', amount:cashNeed, movement_date:new Date().toISOString().slice(0,10),
          reference_type:'sale_partial_return', reference_id:sale.id,
          notes:'[RETURN_BATCH:' + returnId + '] [RETURN_OF:' + sale.id + '] رد نقدي لمرتجع جزئي'
        })
      });
    }
    const finalState = await financialState(sale, batchId, returnMovements);
    return {
      debt_credit:Number((finalState.targetCredit).toFixed(2)),
      cash_refund:Number((finalState.targetCash).toFixed(2)),
      returned_total:Number((finalState.returnedTotal).toFixed(2)),
      paid_original:Number((finalState.paidAmount).toFixed(2)),
      credit_original:Number((finalState.originalCredit).toFixed(2))
    };
  }

  async function saleSnapshot(sale) {
    const batchId = saleBatch(sale.notes);
    const lines = parseSaleLines(sale.notes);
    if (!batchId || !lines.length) return { batchId, lines:[], partialMovements:[], soldBales:[] };
    const [partialMovements, soldBales] = await Promise.all([
      returnMovementsForSale(sale.id),
      allBalesForBatch(batchId)
    ]);
    const returnedByLine = new Map();
    for (const m of partialMovements) {
      const idx = returnLineIndex(m.notes);
      if (idx >= 0) returnedByLine.set(idx, (returnedByLine.get(idx)||0) + Number(m.qty||1));
    }
    const detailed = lines.map((line,index)=>{
      const soldQty = soldBales.filter(b=>lineMatchesBale(line,b)).length;
      const returnedQty = returnedByLine.get(index) || 0;
      const unit = Number(line.line_total_jod||0) / Math.max(1,Number(line.quantity||0));
      return {
        ...line,
        line_index:index,
        unit_price_jod:Number(unit.toFixed(6)),
        returned_qty:returnedQty,
        remaining_qty:soldQty,
        returned_value:Number((returnedQty*unit).toFixed(2))
      };
    });
    return { batchId, lines:detailed, partialMovements, soldBales };
  }

  app.get('/api/v7/customers/:id/statement', async function(req,res){
    try {
      const customerId = String(req.params.id||'').trim();
      const [customers,sales,payments,fullCashReturns] = await Promise.all([
        fetchAll('customers?select=id,name,phone,debt,created_at&id=eq.' + encodeURIComponent(customerId)),
        fetchAll('sales?select=id,customer_id,total_jod,notes,sale_date,created_at&customer_id=eq.' + encodeURIComponent(customerId) + '&order=created_at.asc'),
        fetchAll('payments?select=id,customer_id,amount,paid_at&customer_id=eq.' + encodeURIComponent(customerId) + '&order=paid_at.asc'),
        fetchAll('cash_movements?select=id,amount,movement_date,reference_id,notes&reference_type=eq.sale_return&order=movement_date.asc')
      ]);
      const customer = customers[0];
      if (!customer) throw new Error('الزبون غير موجود.');

      const saleById = new Map(sales.map(s=>[String(s.id),s]));
      const fullReturnPaymentToSale = new Map(sales.map(s=>[stableUuid('return-credit|' + s.id),String(s.id)]));
      const fullReturnPayments = payments.filter(p=>fullReturnPaymentToSale.has(String(p.id)));
      const fullReturnPaymentIds = new Set(fullReturnPayments.map(p=>String(p.id)));

      const saleDetails = new Map();
      const allPartialBatches = new Map();
      let partialReturnedTotal = 0;
      let partialCreditTotal = 0;
      for (const sale of sales) {
        const snap = await saleSnapshot(sale);
        saleDetails.set(String(sale.id),snap);
        partialReturnedTotal += snap.partialMovements.reduce((sum,m)=>sum+returnValue(m.notes),0);
        const batches = [...new Set(snap.partialMovements.map(m=>returnBatch(m.notes)).filter(Boolean))];
        allPartialBatches.set(String(sale.id),batches);
        for (const rb of batches) {
          const pid = stableUuid('partial-return-credit|' + sale.id + '|' + rb);
          const p = payments.find(x=>String(x.id)===pid) || await paymentById(pid);
          if (p) partialCreditTotal += Number(p.amount||0);
        }
      }

      const partialPaymentIds = new Set();
      for (const [saleId,batches] of allPartialBatches.entries()) {
        for (const rb of batches) partialPaymentIds.add(stableUuid('partial-return-credit|' + saleId + '|' + rb));
      }
      const regularPayments = payments.filter(p=>!fullReturnPaymentIds.has(String(p.id)) && !partialPaymentIds.has(String(p.id)));
      const totalSales = sales.reduce((s,x)=>s+Number(x.total_jod||0),0);
      const totalPayments = regularPayments.reduce((s,x)=>s+Number(x.amount||0),0);
      const fullReturnedSaleIds = new Set();
      for (const p of fullReturnPayments) fullReturnedSaleIds.add(fullReturnPaymentToSale.get(String(p.id)));
      for (const c of fullCashReturns) if (saleById.has(String(c.reference_id))) fullReturnedSaleIds.add(String(c.reference_id));
      const fullReturnedTotal = [...fullReturnedSaleIds].reduce((sum,id)=>sum+Number(saleById.get(id)?.total_jod||0),0);
      const fullCreditTotal = fullReturnPayments.reduce((s,x)=>s+Number(x.amount||0),0);
      const totalReturns = fullReturnedTotal + partialReturnedTotal;
      const currentDebt = Number(customer.debt||0);
      const openingDebt = currentDebt - totalSales + totalPayments + fullCreditTotal + partialCreditTotal;

      const movements = [];
      for (const sale of sales) {
        const snap = saleDetails.get(String(sale.id));
        const fullReturned = fullReturnedSaleIds.has(String(sale.id));
        const partialReturned = snap.partialMovements.length > 0;
        movements.push({
          id:sale.id, type:'sale', date:sale.sale_date||sale.created_at||null, created_at:sale.created_at||sale.sale_date||null,
          amount:Number(sale.total_jod||0), notes:sale.notes||'', lines:snap.lines,
          returned:fullReturned, partial_returned:partialReturned,
          can_return:!!snap.batchId && !fullReturned && snap.lines.some(x=>x.remaining_qty>0)
        });
      }
      for (const p of regularPayments) {
        movements.push({id:p.id,type:'payment',date:p.paid_at||null,created_at:p.paid_at||null,amount:Number(p.amount||0),notes:'',lines:[]});
      }

      for (const sale of sales) {
        const saleId = String(sale.id);
        if (fullReturnedSaleIds.has(saleId)) {
          const credit = fullReturnPayments.find(p=>fullReturnPaymentToSale.get(String(p.id))===saleId);
          const cash = fullCashReturns.find(x=>String(x.reference_id)===saleId);
          movements.push({
            id:'return-'+saleId,type:'return',date:credit?.paid_at||cash?.movement_date||null,created_at:credit?.paid_at||cash?.movement_date||null,
            amount:Number(credit?.amount||0),returned_total:Number(sale.total_jod||0),cash_refund:Number(cash?.amount||0),
            notes:cash?.notes||'مرتجع مبيعة',lines:parseSaleLines(sale.notes)
          });
        }
        const snap = saleDetails.get(saleId);
        const batches = [...new Set(snap.partialMovements.map(m=>returnBatch(m.notes)).filter(Boolean))];
        for (const rb of batches) {
          const rows = snap.partialMovements.filter(m=>returnBatch(m.notes)===rb);
          const returnedTotal = rows.reduce((sum,m)=>sum+returnValue(m.notes),0);
          const pid = stableUuid('partial-return-credit|' + saleId + '|' + rb);
          const credit = payments.find(p=>String(p.id)===pid) || await paymentById(pid);
          const cashRows = await fetchAll('cash_movements?select=id,amount,movement_date,notes&reference_type=eq.sale_partial_return&reference_id=eq.' + encodeURIComponent(saleId));
          const cash = cashRows.find(x=>returnBatch(x.notes)===rb);
          const byLine = new Map();
          for (const r of rows) {
            const idx = returnLineIndex(r.notes);
            byLine.set(idx,(byLine.get(idx)||0)+Number(r.qty||1));
          }
          const lines = [...byLine.entries()].map(([idx,qty])=>{
            const original = parseSaleLines(sale.notes)[idx] || {};
            const unit = Number(original.line_total_jod||0)/Math.max(1,Number(original.quantity||0));
            return {...original,quantity:qty,line_total_jod:Number((qty*unit).toFixed(2))};
          });
          movements.push({
            id:'partial-return-'+saleId+'-'+rb,type:'partial_return',date:credit?.paid_at||cash?.movement_date||rows[0]?.date||null,
            created_at:credit?.paid_at||cash?.movement_date||rows[0]?.date||null,amount:Number(credit?.amount||0),
            returned_total:Number(returnedTotal.toFixed(2)),cash_refund:Number(cash?.amount||0),notes:'مرتجع جزئي',lines
          });
        }
      }

      movements.sort((a,b)=>new Date(a.created_at||a.date||0)-new Date(b.created_at||b.date||0));
      let running = openingDebt;
      for (const m of movements) {
        if (m.type === 'sale') running += Number(m.amount||0);
        else if (m.type === 'payment' || m.type === 'return' || m.type === 'partial_return') running -= Number(m.amount||0);
        m.balance_after = running;
      }

      res.set && res.set('Cache-Control','no-store');
      res.json({
        ok:true,
        customer:{id:customer.id,name:customer.name,phone:customer.phone||'',current_debt:currentDebt},
        opening_debt:openingDebt,total_sales:totalSales,total_payments:totalPayments,total_returns:Number(totalReturns.toFixed(2)),
        movements:movements.slice().reverse()
      });
    } catch(e) {
      res.status(400).json({error:e.message});
    }
  });

  app.post('/api/v7/sales/:id/partial-return', async function(req,res){
    const saleId = String(req.params.id||'').trim();
    const returnId = String(req.body?.return_id||'').trim();
    try {
      if (!saleId) throw new Error('رقم المبيعة غير صالح.');
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(returnId)) throw new Error('معرّف المرتجع غير صالح.');
      const sales = await fetchAll('sales?select=id,customer_id,total_jod,notes&id=eq.' + encodeURIComponent(saleId));
      const sale = sales[0];
      if (!sale) throw new Error('المبيعة غير موجودة.');
      const snap = await saleSnapshot(sale);
      if (!snap.batchId || !snap.lines.length) throw new Error('هذه المبيعة غير مرتبطة بأصناف قابلة للإرجاع.');

      let batchMovements = snap.partialMovements.filter(m=>returnBatch(m.notes)===returnId);
      let selected = [];
      if (!batchMovements.length) {
        const requested = Array.isArray(req.body?.lines) ? req.body.lines : [];
        if (!requested.length) throw new Error('اختر صنفًا واحدًا على الأقل للإرجاع.');
        const used = new Set();
        for (const raw of requested) {
          const idx = Number(raw.line_index);
          const qty = Number(raw.quantity||0);
          const line = snap.lines[idx];
          if (!line) throw new Error('أحد أصناف المرتجع غير صالح.');
          if (!Number.isInteger(qty) || qty <= 0) throw new Error('كمية المرتجع غير صحيحة.');
          const candidates = snap.soldBales.filter(b=>lineMatchesBale(line,b) && !used.has(String(b.id)));
          if (qty > candidates.length) throw new Error((line.name||'الصنف') + ': المتاح للإرجاع ' + candidates.length + ' فقط.');
          const unit = Number(line.line_total_jod||0)/Math.max(1,Number(line.quantity||0));
          for (const bale of candidates.slice(0,qty)) {
            used.add(String(bale.id));
            selected.push({bale,line_index:idx,value:unit});
          }
        }
        if (!selected.length) throw new Error('لم يتم اختيار أي بالة للإرجاع.');
        await insertReturnMovements(saleId, returnId, selected);
        await restoreSelectedBales(selected.map(x=>x.bale), saleId, returnId);
        batchMovements = await returnMovementsForSale(saleId);
        batchMovements = batchMovements.filter(m=>returnBatch(m.notes)===returnId);
      } else {
        const existingIds = batchMovements.map(m=>m.bale_id).filter(Boolean);
        const existingBales = await balesByIds(existingIds);
        await restoreSelectedBales(existingBales, saleId, returnId);
      }

      const allReturns = await returnMovementsForSale(saleId);
      const financial = await applyFinancialAdjustment(sale, snap.batchId, returnId, allReturns);
      const customers = await fetchAll('customers?select=id,name,debt&id=eq.' + encodeURIComponent(sale.customer_id));
      const customer = customers[0] || {};
      const thisTotal = batchMovements.reduce((sum,m)=>sum+returnValue(m.notes),0);
      res.json({
        ok:true,customer_id:sale.customer_id,customer:customer.name||'',debt:Number(customer.debt||0),
        returned_qty:batchMovements.reduce((sum,m)=>sum+Number(m.qty||1),0),
        returned_total:Number(thisTotal.toFixed(2)),cumulative_returned:financial.returned_total,
        cumulative_debt_credit:financial.debt_credit,cumulative_cash_refund:financial.cash_refund
      });
    } catch(e) {
      res.status(400).json({error:e.message,retry_safe:true,return_id:returnId});
    }
  });
};