(function(){
  function normalizeStatus(value){
    return String(value||'').trim().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه');
  }

  function availableBales(){
    return (data.bales||[]).filter(b=>!normalizeStatus(b.status).includes('مباع'));
  }

  function baleLabel(b){
    const name=b.nameAr||b.nameEn||'بدون اسم';
    const details=[b.grade,b.weight?b.weight+' كغم':''].filter(Boolean).join(' • ');
    return name+(details?' • '+details:'');
  }

  function chooseBale(){
    const all=availableBales();
    if(!all.length){
      alert('لا توجد بالات متاحة للبيع في المخزون.');
      return null;
    }

    const query=prompt('اكتب جزءًا من اسم البالة المباعة، بالعربي أو الإنجليزي:');
    if(query===null) return null;
    const q=String(query).trim().toLowerCase();
    const matches=all.filter(b=>{
      const hay=[b.nameAr,b.nameEn,b.grade,b.weight].join(' ').toLowerCase();
      return !q || hay.includes(q);
    });

    if(!matches.length){
      alert('لم أجد بالة متاحة بهذا الاسم.');
      return null;
    }
    if(matches.length===1) return matches[0];

    const shown=matches.slice(0,20);
    const menu=shown.map((b,i)=>`${i+1}) ${baleLabel(b)}`).join('\n');
    const answer=Number(prompt('اختر رقم البالة الكاملة:\n\n'+menu+(matches.length>20?'\n\nاكتب اسمًا أدق لعرض نتائج أقل.':''))||0);
    if(answer<1 || answer>shown.length) return null;
    return shown[answer-1];
  }

  async function saveFullBaleSale(cid, presetAmount, presetNotes){
    const bale=chooseBale();
    if(!bale) return false;

    const amount=Number(presetAmount || prompt('قيمة بيع البالة كاملة بالدينار؟') || 0);
    if(amount<=0){
      alert('أدخل قيمة بيع صحيحة.');
      return false;
    }

    const notes=presetNotes!=null
      ? String(presetNotes||'')
      : (prompt('ملاحظات على المبيعة؟')||'');

    const ok=confirm(
      'تأكيد بيع بالة كاملة؟\n\n'+
      'البالة: '+baleLabel(bale)+'\n'+
      'السعر: '+money(amount)+' د.أ'
    );
    if(!ok) return false;

    await api('/api/sales',{
      method:'POST',
      body:JSON.stringify({
        id:uid(),
        customerId:cid,
        baleId:bale.id,
        amount,
        notes
      })
    });

    await refresh();
    alert('تم تسجيل بيع البالة كاملة ونقل حالتها إلى مباعة.');
    return true;
  }

  window.addSale=async function(cid){
    try{
      await saveFullBaleSale(cid,null,null);
    }catch(e){
      alert(e.message);
    }
  };

  window.confirmAgentAction=async function(){
    const action=agentPendingAction;
    if(!action?.requiresConfirmation) return;
    const payload=action.payload||{};

    if(action.type==='record_sale'){
      agentPendingAction=null;
      try{
        const done=await saveFullBaleSale(payload.customerId,payload.amount,payload.notes||'');
        if(done){
          document.getElementById('agentPrompt').value='';
          showAgentMessage('تم تسجيل بيع البالة كاملة بنجاح.');
        }else{
          showAgentMessage('تم إلغاء عملية البيع.');
        }
      }catch(e){
        showAgentMessage('تعذر تسجيل العملية: '+e.message);
      }
      return;
    }

    agentPendingAction=null;
    showAgentMessage('جاري تسجيل العملية...');
    try{
      if(action.type==='record_customer_payment'){
        await api('/api/payments',{method:'POST',body:JSON.stringify({id:uid(),customerId:payload.customerId,amount:payload.amount})});
      }else if(action.type==='record_expense'){
        await api('/api/expenses',{method:'POST',body:JSON.stringify({category:payload.category||'عام',amount:payload.amount,date:new Date().toISOString().slice(0,10),notes:payload.notes||''})});
      }else if(action.type==='record_supplier_payment'){
        await api('/api/supplier-payments',{method:'POST',body:JSON.stringify({supplierId:payload.supplierId,amount:payload.amount,notes:payload.notes||''})});
      }else{
        throw new Error('العملية غير مدعومة.');
      }
      await refresh();
      document.getElementById('agentPrompt').value='';
      showAgentMessage('تم تسجيل العملية بنجاح.');
    }catch(e){
      showAgentMessage('تعذر تسجيل العملية: '+e.message);
    }
  };
})();
