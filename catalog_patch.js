(function(){
  const oldCatalog = [
    {ar:'بولو طاقية',en:'Polo Cap'},
    {ar:'بولو ولادي',en:'Polo Baby'},
    {ar:'داخلي رجالي',en:'Men Underwear'},
    {ar:'بنطلون قطن مكس',en:'Mix Cotton Trousers'},
    {ar:'بولو مدور ستاتي',en:'Lady Round Neck Polo'},
    {ar:'بولو مدور رجالي',en:'Man Round Neck Polo'},
    {ar:'جاكيت بيبي A',en:'Baby Jacket A'},
    {ar:'جاكيت جلد',en:'Leather Jacket'},
    {ar:'جاكيت جينز',en:'Denim Jacket'},
    {ar:'جاكيت دويبلانكا',en:'Doublyanka Jacket'},
    {ar:'جاكيت رجالي خفيف',en:'Man Light Jacket'},
    {ar:'جاكيت رجالي موديل',en:'Man Fashion Jacket'},
    {ar:'جاكيت رجالي نفخ',en:'Man Anorak'},
    {ar:'جاكيت سبور رجالي شتوي',en:'Man Winter Sport Jacket'},
    {ar:'جاكيت سبور ستاتي شتوي',en:'Lady Winter Sport Jacket'},
    {ar:'جاكيت ولادي نفخ',en:'Boys Anorak'},
    {ar:'عباي رجالي',en:'Men Abaya'},
    {ar:'عباي شتوي',en:'Winter Abaya'},
    {ar:'عباي مخمل',en:'Velvet Abaya'},
    {ar:'فروة رجالي',en:'Men Fur Coat'},
    {ar:'جاكيت فرو ستاتي',en:'Lady Fur Jacket'},
    {ar:'فستان ستاتي شتوي',en:'Lady Winter Dress'},
    {ar:'فيزن شتوي',en:'Winter Vison'},
    {ar:'قبة حنق قطن',en:'Cotton Turtleneck'},
    {ar:'قميص جينز رجالي',en:'Man Denim Shirt'},
    {ar:'قميص رجالي شتوي',en:'Man Winter Shirt'},
    {ar:'قميص ستاتي شتوي',en:'Lady Winter Shirt'},
    {ar:'قميص نوم شتوي',en:'Winter Pajama'},
    {ar:'مخمل مكس ستاتي',en:'Lady Mix Velvet'},
    {ar:'بدي تيشيرت ستاتي كم',en:'Lady Long Sleeve T-Shirt'},
    {ar:'جرزة ستاتي صوف',en:'Lady Wool Sweater'},
    {ar:'جاكيت ستاتي نفخ',en:'Lady Anorak'},
    {ar:'تنورة ستاتي شتوي',en:'Lady Winter Skirt'},
    {ar:'جاكيت صوف ستاتي',en:'Lady Wool Jacket'},
    {ar:'جاكيت جوج ستاتي',en:'Lady Jog Jacket'},
    {ar:'جرزة ستاتي طويل',en:'Lady Long Sweater'},
    {ar:'رمع أطفال شتوي',en:'Kids Winter Romper'},
    {ar:'جاكيت جوج رجالي',en:'Man Jog Jacket'},
    {ar:'دشداش ستاتي شتوي',en:'Lady Winter Dishdash'},
    {ar:'دشداش ستاتي مخمل',en:'Lady Velvet Dishdash'},
    {ar:'دشداش كريم',en:'Dishdash Cream'}
  ];

  function installCatalog(){
    const nameAr = document.getElementById('nameAr');
    const nameEn = document.getElementById('nameEn');
    if(!nameAr || !nameEn || document.getElementById('oldBaleCatalogSelect')) return;

    const select = document.createElement('select');
    select.id = 'oldBaleCatalogSelect';
    select.innerHTML = '<option value="">اختر الصنف العربي</option>' +
      oldCatalog.map((item,index) => `<option value="${index}">${item.ar}</option>`).join('');

    nameAr.parentNode.insertBefore(select, nameAr);
    nameAr.type = 'hidden';
    nameAr.removeAttribute('list');
    nameAr.removeAttribute('placeholder');

    select.addEventListener('change', ()=>{
      if(select.value===''){
        nameAr.value='';
        nameEn.value='';
        return;
      }
      const item = oldCatalog[Number(select.value)];
      if(!item) return;
      nameAr.value = item.ar;
      nameEn.value = item.en || '';
    });

    const form = document.getElementById('baleForm');
    if(form && !document.getElementById('catalogHint')){
      const hint = document.createElement('div');
      hint.id = 'catalogHint';
      hint.className = 'small';
      hint.style.marginTop = '6px';
      hint.textContent = 'اختر الصنف العربي من القائمة وسيتم تعبئة الاسم الإنجليزي تلقائيًا. يمكن تعديل الاسم الإنجليزي يدويًا عند الحاجة.';
      select.insertAdjacentElement('afterend', hint);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', installCatalog);
  }else{
    installCatalog();
  }
})();
