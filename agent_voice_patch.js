(function(){
  let recorder=null,stream=null,chunks=[],timer=null,recording=false;
  function el(id){return document.getElementById(id)}
  async function call(url,opt){const r=await fetch(url,{cache:'no-store',...(opt||{}),headers:{'Content-Type':'application/json',...((opt&&opt.headers)||{})}});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر تنفيذ العملية');return b}
  function setStatus(text,bad){const s=el('agentVoiceStatus');if(s){s.textContent=text||'';s.style.color=bad?'#fecaca':'#ffffffcc'}}
  function install(){
    const prompt=el('agentPrompt');if(!prompt||el('agentVoiceButton'))return;
    const btn=document.createElement('button');
    btn.id='agentVoiceButton';btn.type='button';btn.className='btn wide';
    btn.style.cssText='margin-top:10px;background:#ecfeff;color:#155e75';
    btn.textContent='🎤 احكي للوكيل';
    const status=document.createElement('div');status.id='agentVoiceStatus';status.style.cssText='font-size:12px;margin-top:7px;opacity:.9';
    prompt.insertAdjacentElement('afterend',btn);btn.insertAdjacentElement('afterend',status);
    btn.onclick=()=>recording?stop():start();
  }
  async function start(){
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined') throw new Error('المتصفح لا يدعم التسجيل المباشر.');
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      const candidates=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
      let mime='';for(const x of candidates){try{if(MediaRecorder.isTypeSupported(x)){mime=x;break}}catch(_){}}
      recorder=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:64000}:{audioBitsPerSecond:64000});chunks=[];recording=true;
      const btn=el('agentVoiceButton');btn.textContent='⏹ إيقاف التسجيل';btn.style.background='#fee2e2';btn.style.color='#991b1b';
      setStatus('🎙️ اسمعك الآن… احكي الأمر بشكل طبيعي.');
      recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
      recorder.onstop=transcribe;
      recorder.start(250);
      timer=setTimeout(()=>stop(),20000);
    }catch(e){setStatus(e.name==='NotAllowedError'?'اسمح للمتصفح باستخدام الميكروفون ثم جرّب مرة ثانية.':e.message,true);cleanup()}
  }
  function stop(){
    if(!recording)return;recording=false;clearTimeout(timer);timer=null;
    try{if(recorder&&recorder.state!=='inactive')recorder.stop()}catch(_){transcribe()}
    const btn=el('agentVoiceButton');if(btn){btn.textContent='🎤 احكي للوكيل';btn.style.background='#ecfeff';btn.style.color='#155e75'}
    setStatus('جاري تحويل الكلام إلى نص…');
  }
  function cleanup(){recording=false;clearTimeout(timer);timer=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
  function toBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.onerror=reject;r.readAsDataURL(blob)})}
  async function transcribe(){
    try{
      const blob=new Blob(chunks,{type:recorder?.mimeType||chunks[0]?.type||'audio/mp4'});cleanup();
      if(blob.size<500)throw new Error('التسجيل قصير جدًا.');
      if(blob.size>650*1024)throw new Error('التسجيل طويل جدًا. جرّب أمرًا أقصر.');
      const audio_base64=await toBase64(blob);
      const r=await call('/api/v8/agent/transcribe',{method:'POST',body:JSON.stringify({mime_type:blob.type||'audio/mp4',audio_base64})});
      const prompt=el('agentPrompt');if(prompt)prompt.value=r.text;
      setStatus('✅ فهمت الصوت: '+r.text);
      if(typeof window.runAgent==='function')await window.runAgent();
    }catch(e){cleanup();setStatus('تعذر فهم الصوت: '+e.message,true)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
