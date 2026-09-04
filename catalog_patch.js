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
    if(!nameAr) return;

    let list = document.getElementById('oldBaleCatalog');
    if(!list){
      list = document.createElement('datalist');
      list.id = 'oldBaleCatalog';
      document.body.appendChild(list);
    }

    list.replaceChildren(...oldCatalog.map(name => {
      const option = document.createElement('option');
      option.value = name;
      return option;
    }));

    nameAr.setAttribute('list','oldBaleCatalog');
    nameAr.setAttribute('autocomplete','off');
    nameAr.placeholder = 'اختر من الأصناف القديمة أو اكتب صنفًا جديدًا';

    const form = document.getElementById('baleForm');
    if(form && !document.getElementById('catalogHint')){
      const hint = document.createElement('div');
      hint.id = 'catalogHint';
      hint.className = 'small';
      hint.style.marginTop = '6px';
      hint.textContent = 'قائمة الأصناف القديمة محفوظة للاختيار، بدون إضافة كميات أو أسعار للمخزون.';
      nameAr.insertAdjacentElement('afterend', hint);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', installCatalog);
  }else{
    installCatalog();
  }
})();
