(function(){
  const oldCatalog = [
    'بولو طاقية',
    'بولو ولادي',
    'داخلي رجالي',
    'بنطلون قطن مكس',
    'بولو مدور ستاتي',
    'بولو مدور رجالي',
    'جاكيت بيبي A',
    'جاكيت جلد',
    'جاكيت جينز',
    'جاكيت دويبلانكا',
    'جاكيت رجالي خفيف',
    'جاكيت رجالي موديل',
    'جاكيت رجالي نفخ',
    'جاكيت سبور رجالي شتوي',
    'جاكيت سبور ستاتي شتوي',
    'جاكيت ولادي نفخ',
    'عباي رجالي',
    'عباي شتوي',
    'عباي مخمل',
    'فروة رجالي',
    'جاكيت فرو ستاتي',
    'فستان ستاتي شتوي',
    'فيزن شتوي',
    'قبة حنق قطن',
    'قميص جينز رجالي',
    'قميص رجالي شتوي',
    'قميص ستاتي شتوي',
    'قميص نوم شتوي',
    'مخمل مكس ستاتي',
    'بدي تيشيرت ستاتي كم',
    'جرزة ستاتي صوف',
    'جاكيت ستاتي نفخ',
    'تنورة ستاتي شتوي',
    'جاكيت صوف ستاتي',
    'جاكيت جوج ستاتي',
    'جرزة ستاتي طويل',
    'رمع أطفال شتوي',
    'جاكيت جوج رجالي',
    'دشداش ستاتي شتوي',
    'دشداش ستاتي مخمل',
    'دشداش كريم'
  ];

  function installCatalog(){
    const nameAr = document.getElementById('nameAr');
    if(!nameAr || document.getElementById('oldBaleCatalogSelect')) return;

    const select = document.createElement('select');
    select.id = 'oldBaleCatalogSelect';
    select.innerHTML = '<option value="">اختر صنفًا من القائمة القديمة</option>' +
      oldCatalog.map(name => `<option value="${name}">${name}</option>`).join('');
    select.style.marginBottom = '8px';

    nameAr.parentNode.insertBefore(select, nameAr);
    nameAr.placeholder = 'أو اكتب صنفًا جديدًا';
    nameAr.removeAttribute('list');
    nameAr.setAttribute('autocomplete','off');

    select.addEventListener('change', ()=>{
      if(select.value) nameAr.value = select.value;
    });

    nameAr.addEventListener('input', ()=>{
      if(nameAr.value !== select.value) select.value = '';
    });

    const form = document.getElementById('baleForm');
    if(form && !document.getElementById('catalogHint')){
      const hint = document.createElement('div');
      hint.id = 'catalogHint';
      hint.className = 'small';
      hint.style.marginTop = '6px';
      hint.textContent = 'اختر من القائمة القديمة أو اكتب صنفًا جديدًا. لا تُضاف كميات أو أسعار تلقائيًا.';
      nameAr.insertAdjacentElement('afterend', hint);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', installCatalog);
  }else{
    installCatalog();
  }
})();
