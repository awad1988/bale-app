(function(){
  let fullInventory=null;
  function val(obj,a,b){ return obj && (obj[a] != null ? obj[a] : obj[b]); }
  function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function normName(v){
    return String(v||'')
      .trim()
      .toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g,'')
      .replace(/[ـ]/g,'')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }
  function normGrade(v){
    const g=String(v||'').trim().toUpperCase();
    if(['CREAM','CREME','CRÈME','كريم'].includes(g)) return 'Cream';
    if(g==='B') return 'B';
    if(g==='A') return 'A';
    return String(v||'').trim();
  }
  function branchInfo(status){
    const s=String(status||'');
    const m=s.match(/\[BRANCH:(\d+)\]/i);
    const id=m?Number(m[1]):0;
    if(id===2) return {id,label:'الفرع الجديد'};
    if(id===4) return {id,label:'الفرع القديم'};
    return {id,label:s.replace(/\[BRANCH:\d+\]/ig,'').trim()||'متوفر'};
  }

  async function loadFullInventory(){
    try{
      const r=await fetch('/api/v3/inventory/full',{cache:'no-store'});
      const b=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(b.error||'فشل تحميل المخزون الكامل');
      fullInventory=b;
      renderAggregatedInventory();
    }catch(e){
      console.error(e);
      fullInventory=null;
      renderAggregatedInventory();
    }
  }

  function renderAggregatedInventory(){
    const body=document.getElementById('baleRows');
    if(!body || typeof data==='undefined') return;
    const source=fullInventory||data||{};
    const bales=Array.isArray(source.bales)?source.bales:[];
    const shipments=Array.isArray(source.shipments)?source.shipments:[];
    const shipMap=new Map(shipments.map(s=>[String(s.id),s]));
    const groups=new Map();

    for(const b of bales){
      const shipment=shipMap.get(String(val(b,'shipmentId','shipment_id')))||{};
      const season=String(val(shipment,'season','season')||'غير محدد').trim();
      const nameEn=String(val(b,'nameEn','name_en')||'').trim();
      const nameAr=String(val(b,'nameAr','name_ar')||'').trim();
      const grade=normGrade(val(b,'grade','grade'));
      const weight=Number(val(b,'weight','weight_kg')||0);
      const buy=Number(val(b,'buyUsd','buy_usd')||0);
      const landed=Number(val(b,'landedCostJod','landed_cost_jod')||val(b,'costJod','cost_jod')||0);
      const status=String(val(b,'status','status')||'');
      if(/مباع/.test(status)) continue;
      const br=branchInfo(status);
      const key=[normName(nameEn)||normName(nameAr),String(grade).toUpperCase(),weight,normName(season),br.id].join('|');
      let g=groups.get(key);
      if(!g){
        g={nameEn,nameAr,grade,weight,season,branch:br,qty:0,buySum:0,landedSum:0};
        groups.set(key,g);
      }
      g.qty+=1;
      g.buySum+=buy;
      g.landedSum+=landed;
    }

    const rows=Array.from(groups.values()).sort((a,b)=>(a.nameAr||a.nameEn).localeCompare(b.nameAr||b.nameEn,'ar'));
    const table=body.closest('table');
    if(table){
      const hr=table.querySelector('thead tr');
      if(hr && !hr.querySelector('[data-qty-head]')){
        const th=document.createElement('th');
        th.dataset.qtyHead='1';
        th.textContent='الكمية';
        const weightTh=Array.from(hr.children).find(x=>x.textContent.trim()==='الوزن');
        if(weightTh) weightTh.insertAdjacentElement('afterend',th); else hr.appendChild(th);
      }
      let summary=document.getElementById('inventoryDisplaySummary');
      if(!summary){
        summary=document.createElement('div');
        summary.id='inventoryDisplaySummary';
        summary.className='small';
        summary.style.cssText='margin:0 0 10px;padding:9px 10px;border-radius:10px;background:#ecfdf5;color:#166534;font-weight:700';
        table.parentElement.insertBefore(summary,table);
      }
      const totalQty=rows.reduce((sum,g)=>sum+g.qty,0);
      summary.textContent='إجمالي المعروض: '+totalQty.toLocaleString('en-US')+' بالة • '+rows.length.toLocaleString('en-US')+' صنف/تصنيف';
    }

    body.innerHTML=rows.map(g=>{
      const avgBuy=g.qty?g.buySum/g.qty:0;
      const avgLanded=g.qty?g.landedSum/g.qty:0;
      const name='<b>'+esc(g.nameAr||'-')+'</b>'+(g.nameEn?'<div class="small">'+esc(g.nameEn)+'</div>':'');
      return '<tr><td>'+name+'</td><td>'+esc(g.grade)+'</td><td>'+Number(g.weight||0).toFixed(0)+'</td><td><b>'+g.qty+'</b></td><td>'+avgBuy.toFixed(2)+'</td><td>'+avgLanded.toFixed(2)+'</td><td><span class="pill ok">'+esc(g.branch.label)+'</span></td></tr>';
    }).join('') || '<tr><td colspan="7">لا توجد بالات بعد.</td></tr>';
  }

  function install(){
    try{
      if(typeof renderAll==='function' && !renderAll.__inventoryAggregated){
        const original=renderAll;
        const wrapped=function(){
          const r=original.apply(this,arguments);
          setTimeout(renderAggregatedInventory,0);
          return r;
        };
        wrapped.__inventoryAggregated=true;
        renderAll=wrapped;
      }
    }catch(e){}
    renderAggregatedInventory();
    loadFullInventory();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
