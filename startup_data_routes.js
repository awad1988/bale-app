module.exports = function registerStartupDataRoutes(ctx){
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

  function num(v){ return v == null ? 0 : Number(v); }

  async function fetchAllLight(basePath){
    const out=[];
    const pageSize=1000;
    for(let offset=0; offset<100000; offset+=pageSize){
      const sep=basePath.includes('?')?'&':'?';
      const page=await supabaseRequest(basePath+sep+'limit='+pageSize+'&offset='+offset);
      if(!Array.isArray(page) || !page.length) break;
      out.push(...page);
      if(page.length<pageSize) break;
    }
    return out;
  }

  app.get('/api/v12/data/fast', async function(_req,res){
    try{
      const [shipments,bales,customers,payments,sales,expenses,cashMovements,suppliers,supplierPayments] = await Promise.all([
        supabaseRequest('shipments?select=id,supplier_id,supplier,container_name,purchase_date,arrival_date,created_at,fx,season,customs,clearance,other_cost,notes&order=created_at.asc'),
        // Supabase/PostgREST commonly caps one response at 1000 rows. Page the very small
        // bale projection so the first dashboard render gets the exact same bale count as
        // the later full inventory load, without downloading full bale records.
        fetchAllLight('bales?select=id,shipment_id,status&order=created_at.asc'),
        supabaseRequest('customers?select=id,name,phone,debt,created_at&created_at=gt.2026-09-04T18:35:00Z&order=created_at.asc'),
        supabaseRequest('payments?select=id,customer_id,amount,paid_at&order=paid_at.asc'),
        supabaseRequest('sales?select=id,customer_id,total_jod,sale_date,created_at,notes'),
        supabaseRequest('expenses?select=id,category,amount,expense_date,notes&order=expense_date.asc'),
        supabaseRequest('cash_movements?select=id,movement_type,amount,movement_date,notes&order=movement_date.asc'),
        supabaseRequest('suppliers?select=id,name,phone,balance,notes,created_at&order=created_at.asc'),
        supabaseRequest('supplier_payments?select=id,supplier_id,amount_jod,payment_date,notes,created_at&order=payment_date.asc')
      ]);

      res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma','no-cache');
      res.set('Expires','0');
      res.json({
        fast:true,
        shipments:(shipments||[]).map(x=>({
          id:x.id,supplier:x.supplier,supplierId:x.supplier_id,container:x.container_name,
          purchaseDate:x.purchase_date,arrivalDate:x.arrival_date,createdAt:x.created_at,
          fx:num(x.fx),season:x.season,customs:num(x.customs),clearance:num(x.clearance),
          otherCost:num(x.other_cost),notes:x.notes
        })),
        bales:(bales||[]).map(x=>({id:x.id,shipmentId:x.shipment_id,status:x.status})),
        customers:(customers||[]).map(x=>({id:x.id,name:x.name,phone:x.phone,debt:num(x.debt)})),
        payments:(payments||[]).map(x=>({id:x.id,customerId:x.customer_id,amount:num(x.amount),date:x.paid_at,isReturn:false})),
        sales:(sales||[]).map(x=>({id:x.id,customerId:x.customer_id,amount:num(x.total_jod),date:x.sale_date||x.created_at||null,notes:x.notes||''})),
        expenses:(expenses||[]).map(x=>({id:x.id,category:x.category||'',amount:num(x.amount),date:x.expense_date||null,notes:x.notes||''})),
        cashMovements:(cashMovements||[]).map(x=>({id:x.id,type:x.movement_type,amount:num(x.amount),date:x.movement_date||null,notes:x.notes||''})),
        suppliers:(suppliers||[]).map(x=>({id:x.id,name:x.name,phone:x.phone,balance:num(x.balance),notes:x.notes||''})),
        supplierPayments:(supplierPayments||[]).map(x=>({id:x.id,supplierId:x.supplier_id,amount:num(x.amount_jod),date:x.payment_date||null,notes:x.notes||'',createdAt:x.created_at||null}))
      });
    }catch(e){
      res.status(500).json({error:e.message});
    }
  });
};
