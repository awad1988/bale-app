(function(){
  let fullInventory=null;
  let inventoryLoading=false;
  let pendingForceRefresh=false;
  let lastInventoryLoad=0;
  let mutationRefreshTimer=null;
  const TOTAL_CUSTOMS_EXPENSES_JOD=48000;
  const CUSTOMS_ALLOCATION_BALES=2773;
  const FIXED_EXPENSE_PER_BALE=TOTAL_CUSTOMS_EXPENSES_JOD/CUSTOMS_ALLOCATION_BALES;

  function val(obj,a,b){ return obj && (obj[a] != null ? obj[a] : obj[b]); }
  function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c])); }
  function normName(v){
    return String(v||'').trim().toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g,'')
      .replace(/[ـ]/g,'')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g,' ')
      .replace(/\s+/g,' ').trim();
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
  function inventoryIsVisible(){
    const body=document.getElementById('baleRows');
    if(!body) return false;
    const rect=body.getBoundingClientRect();
    return !!(body.offsetParent!==null && rect.width>=0 && rect.height>=0);
  }

  async function loadFullInventory(force){
    const now=Date.now();
    if(inventoryLoading){
      if(force) pendingForceRefresh=true;
      return;
    }
    if(!force && now-lastInventoryLoad<1200) return;
    inventoryLoading=true;
    try{
      const r=await fetch('/api/v3/inventory/full?ts='+now,{cache:'no-store'});
      const b=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(b.error||'فشل تحميل المخزون الكامل');
      fullInventory=b;
      lastInventoryLoad=Date.now();
      renderAggregatedInventory();
    }catch(e){
      console.error(e);
      renderAggregatedInventory();
    }finally{
      inventoryLoading=false;
      if(pendingForceRefresh){
        pendingForceRefresh=false;
        setTimeout(()=>loadFullInventory(true),120);
      }
    }
  }

  function scheduleMutationRefresh(){
    if(mutationRefreshTimer) clearTimeout(mutationRefreshTimer);
    mutationRefreshTimer=setTimeout(()=>{
      mutationRefreshTimer=null;
      loadFullInventory(true);
    },180);
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
      const status=String(val(b,'status','status')||'');
      if(/مباع/.test(status)) continue;
      const br=branchInfo(status);
      const key=[normName(nameEn)||normName(nameAr),String(grade).toUpperCase(),weight,normName(season),br.id].join('|');
      let g=groups.get(key);
      if(!g){
        g={nameEn,nameAr,grade,weight,season,branch:br,qty:0,buySum:0};
        groups.set(key,g);
      }
      g.qty+=1;
      g.buySum+=buy;
    }

    const rows=Array.from(groups.values()).sort((a,b)=>(a.nameAr||a.nameEn).localeCompare(b.nameAr||b.nameEn,'ar'));
    const totalQty=rows.reduce((sum,g)=>sum+g.qty,0);
    const expensePerBale=FIXED_EXPENSE_PER_BALE;
    const table=body.closest('table');

    if(table){
      const hr=table.querySelector('thead tr');
      if(hr){
        if(!hr.querySelector('[data-qty-head]')){
          const th=document.createElement('th');
          th.dataset.qtyHead='1';
          th.textContent='الكمية';
          const weightTh=Array.from(hr.children).find(x=>x.textContent.trim()==='الوزن');
          if(weightTh) weightTh.insertAdjacentElement('afterend',th); else hr.appendChild(th);
        }
        const costTh=Array.from(hr.children).find(x=>x.textContent.includes('تكلفة'));
        if(costTh) costTh.textContent='جمرك/مصاريف د.أ';
      }
      let summary=document.getElementById('inventoryDisplaySummary');
      if(!summary){
        summary=document.createElement('div');
        summary.id='inventoryDisplaySummary';
        summary.className='small';
        summary.style.cssText='margin:0 0 10px;padding:9px 10px;border-radius:10px;background:#ecfdf5;color:#166534;font-weight:700';
        table.parentElement.insertBefore(summary,table);
      }
      summary.innerHTML='إجمالي المعروض: '+totalQty.toLocaleString('en-US')+' بالة • '+rows.length.toLocaleString('en-US')+' صنف/تصنيف'
        +'<br>الجمرك والمصاريف: '+TOTAL_CUSTOMS_EXPENSES_JOD.toLocaleString('en-US')+' د.أ • حصة البالة الأصلية: '+expensePerBale.toFixed(2)+' د.أ';
    }

    body.innerHTML=rows.map(g=>{
      const avgBuy=g.qty?g.buySum/g.qty:0;
      const name='<b>'+esc(g.nameAr||'-')+'</b>'+(g.nameEn?'<div class="small">'+esc(g.nameEn)+'</div>':'');
      return '<tr><td>'+name+'</td><td>'+esc(g.grade)+'</td><td>'+Number(g.weight||0).toFixed(0)+'</td><td><b>'+g.qty+'</b></td><td>'+avgBuy.toFixed(2)+'</td><td>'+expensePerBale.toFixed(2)+'</td><td><span class="pill ok">'+esc(g.branch.label)+'</span></td></tr>';
    }).join('') || '<tr><td colspan="7">لا يوجد مخزون متاح.</td></tr>';
  }

  function affectsInventory(url,method){
    if(!url || !method || method==='GET' || method==='HEAD') return false;
    const s=String(url);
    return /\/api\/(?:v\d+\/)?(?:sales|returns?|partial[-_/]?return|inventory|bales|stock|movements?)/i.test(s);
  }

  function installFetchSync(){
    if(window.fetch.__inventoryLiveSync) return;
    const originalFetch=window.fetch.bind(window);
    const wrapped=async function(input,init){
      const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
      const url=typeof input==='string' ? input : (input&&input.url)||'';
      const response=await originalFetch(input,init);
      if(response.ok && affectsInventory(url,method)) scheduleMutationRefresh();
      return response;
    };
    wrapped.__inventoryLiveSync=true;
    window.fetch=wrapped;
  }

  function install(){
    try{
      if(typeof renderAll==='function' && !renderAll.__inventoryAggregated){
        const original=renderAll;
        const wrapped=function(){
          const r=original.apply(this,arguments);
          setTimeout(function(){
            renderAggregatedInventory();
            if(inventoryIsVisible()) loadFullInventory(false);
          },0);
          return r;
        };
        wrapped.__inventoryAggregated=true;
        renderAll=wrapped;
      }
    }catch(e){}

    installFetchSync();
    window.refreshInventoryNow=function(){ return loadFullInventory(true); };
    document.addEventListener('inventory:changed',scheduleMutationRefresh);

    document.addEventListener('click',function(e){
      const el=e.target&&e.target.closest?e.target.closest('button,a,[role="button"]'):null;
      if(el && String(el.textContent||'').trim().includes('المخزون')){
        setTimeout(function(){
          renderAggregatedInventory();
          loadFullInventory(true);
        },0);
      }
    },true);

    renderAggregatedInventory();
    if(inventoryIsVisible()) setTimeout(()=>loadFullInventory(true),0);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
