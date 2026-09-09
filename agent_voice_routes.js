module.exports = function registerAgentVoiceRoutes(ctx){
  const app = ctx.app;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  app.post('/api/v8/agent/transcribe', async function(req,res){
    try{
      if(!GEMINI_API_KEY) throw new Error('خدمة الصوت غير مفعلة على الخادم.');
      const mimeType=String(req.body?.mime_type||'audio/mp4').split(';')[0].trim();
      const data=String(req.body?.audio_base64||'').trim();
      if(!data) throw new Error('لم يصل تسجيل صوتي.');
      if(data.length>10*1024*1024) throw new Error('التسجيل طويل جدًا. جرّب تسجيلًا أقصر.');

      const instruction=[
        'حوّل هذا التسجيل الصوتي إلى نص عربي دقيق فقط، بدون شرح أو مقدمة.',
        'المتحدث تاجر أردني ويستخدم لهجة أردنية وأسماء أصناف ألبسة وبالات.',
        'حافظ على أسماء الزبائن والأصناف كما نطقها، وحافظ على المصطلحات الإنجليزية مثل EX و A و B و Cream و WCR إن وُجدت.',
        'حوّل الأرقام المنطوقة إلى أرقام 0-9 لتسهيل المحاسبة، مثل ميتين = 200 وثلاث بالات = 3 بالات وأربعين كيلو = 40 كيلو.',
        'لا تخمّن كلمة غير مسموعة ولا تضف معلومات غير منطوقة.',
        'أعد النص المنطوق فقط.'
      ].join('\n');

      const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(GEMINI_MODEL)+':generateContent?key='+encodeURIComponent(GEMINI_API_KEY);
      const response=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contents:[{role:'user',parts:[
            {text:instruction},
            {inlineData:{mimeType,data}}
          ]}],
          generationConfig:{temperature:0}
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok){
        const msg=body?.error?.message||'تعذر تحويل الصوت إلى نص.';
        throw new Error(msg);
      }
      const text=(body?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join(' ').trim();
      if(!text) throw new Error('لم أستطع سماع كلام واضح. جرّب مرة أخرى.');
      res.json({ok:true,text});
    }catch(e){
      res.status(400).json({error:e.message});
    }
  });
};
