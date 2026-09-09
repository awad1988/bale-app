(function(){
  const originalFetch=window.fetch.bind(window);
  const digitMap='٠١٢٣٤٥٦٧٨٩';
  const simple={
    'صفر':0,'واحد':1,'وحد':1,'اثنين':2,'اثنان':2,'اتنين':2,'ثلاث':3,'ثلاثه':3,'اربع':4,'اربعه':4,'خمس':5,'خمسه':5,'ست':6,'سته':6,'سبع':7,'سبعه':7,'ثمان':8,'ثمانيه':8,'تمنيه':8,'تسع':9,'تسعه':9,
    'عشر':10,'عشره':10,'احدعش':11,'احدعشر':11,'اثنعش':12,'اتنعش':12,'ثلاثتعش':13,'اربعتعش':14,'خمستعش':15,'ستعش':16,'سبعتعش':17,'ثمانتعش':18,'تسعتعش':19,
    'عشرين':20,'ثلاثين':30,'اربعين':40,'خمسين':50,'ستين':60,'سبعين':70,'ثمانين':80,'تمانين':80,'تسعين':90,
    'ميه':100,'مية':100,'مئه':100,'مئة':100,'مائه':100,'مائة':100,'مايه':100,'ماية':100,
    'ميتين':200,'مئتين':200,'مائتين':200,'مايتين':200,
    'ثلاثميه':300,'ثلاثمية':300,'ثلاثمئه':300,'ثلاثمائة':300,
    'اربعميه':400,'اربعمية':400,'اربعمئه':400,'اربعمائة':400,
    'خمسميه':500,'خمسمية':500,'خمسمئه':500,'خمسمائة':500,
    'ستميه':600,'ستمية':600,'ستمئه':600,'ستمائة':600,
    'سبعميه':700,'سبعمية':700,'سبعمئه':700,'سبعمائة':700,
    'ثمانميه':800,'ثمانمية':800,'تمانميه':800,'تمانمية':800,'ثمانمائة':800,
    'تسعميه':900,'تسعمية':900,'تسعمئه':900,'تسعمائة':900
  };
  function norm(v){return String(v||'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065f\u0670]/g,'').replace(/ـ/g,'').replace(/\s+/g,' ').trim()}
  function tokenVal(t){
    t=norm(t).replace(/^و(?=[\u0600-\u06ff])/,'');
    if(Object.prototype.hasOwnProperty.call(simple,t))return simple[t];
    if(/^\d+(?:\.\d+)?$/.test(t))return Number(t);
    return null;
  }
  function parseWords(text){
    let s=norm(String(text||'').replace(/[٠-٩]/g,d=>String(digitMap.indexOf(d))))
      .replace(/[،,؛;:.!?()\[\]{}]/g,' ')
      .replace(/احد\s+عشر/g,'احدعشر').replace(/اثنا\s+عشر|اثني\s+عشر/g,'اثنعش')
      .replace(/ثلاث(?:ه)?\s+عشر/g,'ثلاثتعش').replace(/اربع(?:ه)?\s+عشر/g,'اربعتعش')
      .replace(/خمس(?:ه)?\s+عشر/g,'خمستعش').replace(/ست(?:ه)?\s+عشر/g,'ستعش')
      .replace(/سبع(?:ه)?\s+عشر/g,'سبعتعش').replace(/ثمان(?:يه)?\s+عشر/g,'ثمانتعش')
      .replace(/تسع(?:ه)?\s+عشر/g,'تسعتعش');
    const tokens=s.split(' ');
    let total=0,current=0,seen=false,start=-1,end=-1;
    for(let i=0;i<tokens.length;i++){
      let raw=tokens[i],t=raw;if(t.length>1&&t[0]==='و')t=t.slice(1);
      if(t==='الف'){if(start<0)start=i;current=(current||1)*1000;total+=current;current=0;seen=true;end=i;continue}
      if(t==='الفين'){if(start<0)start=i;total+=2000;current=0;seen=true;end=i;continue}
      if(t==='الاف'){if(start<0)start=i;current=(current||1)*1000;total+=current;current=0;seen=true;end=i;continue}
      const n=tokenVal(raw);
      if(n!==null){if(start<0)start=i;current+=n;seen=true;end=i;continue}
      if(seen)break;
    }
    return seen?{value:total+current,start,end,tokens}:null;
  }
  function normalizePrompt(prompt){
    const p=String(prompt||'');
    if(/[0-9٠-٩]/.test(p))return p;
    const parsed=parseWords(p);
    if(!parsed||!(parsed.value>0))return p;
    const before=parsed.tokens.slice(0,parsed.start).join(' ');
    const after=parsed.tokens.slice(parsed.end+1).join(' ');
    return [before,String(parsed.value),after].filter(Boolean).join(' ');
  }
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:String(input&&input.url||'');
    if(!url.endsWith('/api/agent')&&!url.includes('/api/v10/agent/')&&!url.includes('/api/v11/agent/'))return originalFetch(input,init);
    if(!init||!init.body)return originalFetch(input,init);
    try{
      const payload=JSON.parse(String(init.body));
      if(payload&&payload.prompt){
        payload.prompt=normalizePrompt(payload.prompt);
        init={...init,body:JSON.stringify(payload)};
      }
    }catch(_){ }
    return originalFetch(input,init);
  };
})();
