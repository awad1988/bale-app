module.exports = function registerSalesProfitRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const CUSTOMS_TOTAL_JOD = 48000;
  const CUSTOMS_ALLOCATION_BALES = 2773;
  const CUSTOMS_PER_BALE_JOD = CUSTOMS_TOTAL_JOD / CUSTOMS_ALLOCATION_BALES;

  function norm(value) {
    return String(value || '')
      .trim().toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[ـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function normGrade(value) {
    const g = norm(value);
    if (['CREAM','CREME','CRÈME','كريم'].map(norm).includes(g)) return 'CREAM';
    if (g === 'B') return 'B';
    return 'A';
  }
  function branchId(status) {
    const m = String(status || '').match(/\[BRANCH:(\d+)\]/i);
    return m ? Number(m[1]) : 2;
  }
  function isSold(status) { return /مباع/i.test(String(status || '')); }
  function productKey(bale, season) {
    return [norm(bale.name_en || bale.name_ar || ''), normGrade(bale.grade), Number(bale.weight || 0), norm(season || 'شتوي')].join('|');
  }
  async function fetchAll(basePath) {
    const out=[]; const pageSize=1000;
    for(let offset=0;offset<100000;offset+=pageSize){
      const sep=basePath.includes('?')?'&':'?';
      const page=await supabaseRequest(basePath+sep+'limit='+pageSize+'&offset='+offset);
      const rows=Array.isArray(page)?page:[]; out.push(...rows);
      if(rows.length<pageSize) break;
    }
    return out;
  }

  app.post('/api/v5/sales/profit-preview', async function(req,res){
    try{
      const input=req.body||{};
      const lines=Array.isArray(input.lines)?input.lines:[];
      const fallbackFx=Number(input.fallback_fx||0.709);
      if(!(fallbackFx>0)) throw new Error('سعر الصرف الاحتياطي غير صحيح.');
      if(!lines.length) throw new Error('أضف صنفًا واحدًا على الأقل.');

      const [shipments,bales]=await Promise.all([
        fetchAll('shipments?select=id,season,fx'),
        fetchAll('bales?select=id,shipment_id,name_en,name_ar,grade,weight,buy_usd,status,created_at&order=created_at.asc')
      ]);
      const shipMap=new Map(shipments.map(s=>[String(s.id),s]));
      const available=bales.filter(b=>!isSold(b.status));

      // Build same catalog IDs/key basis used by generic_sales_routes.
      const crypto=require('crypto');
      function stableUuid(value){
        const chars=crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,32).split('');
        chars[12]='5'; chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);
        const hex=chars.join('');
        return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
      }
      const groups=new Map();
      for(const b of available){
        const ship=shipMap.get(String(b.shipment_id))||{};
        const season=ship.season||'شتوي';
        const key=productKey(b,season);
        const br=branchId(b.status);
        const id=stableUuid('sale-product|'+br+'|'+key);
        if(!groups.has(id)) groups.set(id,{id,key,branch_id:br,bales:[]});
        groups.get(id).bales.push(b);
      }

      let totalSale=0,totalPurchaseUsd=0,totalPurchaseJod=0,totalCustoms=0,totalCost=0,totalQty=0;
      let fallbackCount=0;
      const details=[];
      for(const line of lines){
        const g=groups.get(String(line.product_id||''));
        if(!g) throw new Error('أحد الأصناف غير موجود في المخزون الحالي.');
        const qty=Number(line.quantity||0);
        const sale=Number(line.line_total_jod||0);
        if(!Number.isInteger(qty)||qty<=0) throw new Error('كمية غير صحيحة.');
        if(!(sale>0)) throw new Error('إجمالي بيع الصنف يجب أن يكون أكبر من صفر.');
        if(g.bales.length<qty) throw new Error('الكمية المتاحة للصنف أقل من المطلوب.');
        const selected=g.bales.slice(0,qty);
        let linePurchaseUsd=0,linePurchaseJod=0,lineFallback=0;
        for(const b of selected){
          const ship=shipMap.get(String(b.shipment_id))||{};
          const fx=Number(ship.fx||0)>0?Number(ship.fx):fallbackFx;
          if(!(Number(ship.fx||0)>0)){fallbackCount++;lineFallback++;}
          const usd=Number(b.buy_usd||0);
          linePurchaseUsd+=usd;
          linePurchaseJod+=usd*fx;
        }
        const lineCustoms=CUSTOMS_PER_BALE_JOD*qty;
        const lineCost=linePurchaseJod+lineCustoms;
        const lineProfit=sale-lineCost;
        totalSale+=sale; totalPurchaseUsd+=linePurchaseUsd; totalPurchaseJod+=linePurchaseJod;
        totalCustoms+=lineCustoms; totalCost+=lineCost; totalQty+=qty;
        details.push({quantity:qty,sale_jod:sale,purchase_usd:linePurchaseUsd,purchase_jod:linePurchaseJod,customs_jod:lineCustoms,cost_jod:lineCost,profit_jod:lineProfit,fallback_fx_bales:lineFallback});
      }
      res.json({
        ok:true,
        total_qty:totalQty,
        sale_total_jod:totalSale,
        purchase_total_usd:totalPurchaseUsd,
        purchase_total_jod:totalPurchaseJod,
        customs_per_bale_jod:CUSTOMS_PER_BALE_JOD,
        customs_total_jod:totalCustoms,
        total_cost_jod:totalCost,
        profit_jod:totalSale-totalCost,
        profit_margin_pct:totalSale?((totalSale-totalCost)/totalSale*100):0,
        fallback_fx:fallbackFx,
        fallback_fx_bales:fallbackCount,
        details
      });
    }catch(e){res.status(400).json({error:e.message});}
  });
};
