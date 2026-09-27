// Swappable adapter contract. An adapter implements generate(request).
export const providerKinds=['text','image','video','voice','music'];
const adapters=new Map();
export function registerProvider(kind,adapter){if(!providerKinds.includes(kind)||typeof adapter?.generate!=='function')throw new Error('Invalid provider adapter');adapters.set(kind,adapter)}
export function providerStatus(kind){return adapters.has(kind)?'connected':'AI provider not configured'}
export async function generate(kind,request){const adapter=adapters.get(kind);if(!adapter)throw new Error('AI provider not configured');return adapter.generate(request)}
const settingsId='gemini-key';
const keyDb='cartoonai-private-config';
function configDb(){return new Promise((resolve,reject)=>{let r=indexedDB.open(keyDb,1);r.onupgradeneeded=()=>r.result.createObjectStore('settings',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function configOp(mode,fn){let db=await configDb();return new Promise((resolve,reject)=>{let tx=db.transaction('settings',mode),req=fn(tx.objectStore('settings'));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close()})}
export async function getGeminiKey(){return (await configOp('readonly',store=>store.get(settingsId)))?.key||''}
export async function saveGeminiKey(key){if(!key.trim())throw new Error('Enter a key first');await configOp('readwrite',store=>store.put({id:settingsId,key:key.trim()}));registerProvider('text',{generate:geminiText});if(!await getImageConfig())registerProvider('image',{generate:geminiImage});return true}
export async function clearGeminiKey(){await configOp('readwrite',store=>store.delete(settingsId));adapters.delete('text');if(!await getImageConfig())adapters.delete('image')}
const imageConfigId='cloudflare-images';
export async function getImageConfig(){const row=await configOp('readonly',store=>store.get(imageConfigId));return row?{url:row.url,configured:!!row.passcode}:null}
export async function saveImageConfig(url,passcode){
  const target=new URL(url.trim());
  if(target.protocol!=='https:'||!target.hostname.endsWith('.workers.dev')||target.username||target.password||target.search||target.hash)throw new Error('Enter the exact HTTPS workers.dev address, without a path or parameters.');
  if(passcode.length<24)throw new Error('Use the same image passcode as the Worker, at least 24 characters.');
  await configOp('readwrite',store=>store.put({id:imageConfigId,url:target.origin,passcode}));
  registerProvider('image',{generate:cloudflareImage});registerProvider('voice',{generate:cloudflareVoice});
}
export async function clearImageConfig(){await configOp('readwrite',store=>store.delete(imageConfigId));adapters.delete('voice');if(await getGeminiKey())registerProvider('image',{generate:geminiImage});else adapters.delete('image')}
async function cloudflareVoice({text}){
 const row=await configOp('readonly',store=>store.get(imageConfigId));if(!row?.url||!row.passcode)throw new Error('Free voice provider not configured');
 const response=await fetch(`${row.url}/speech`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${row.passcode}`},body:JSON.stringify({text})});
 let result;try{result=await response.json()}catch{throw new Error(`Voice service returned HTTP ${response.status}`)}
 if(!response.ok)throw new Error(result.error||`Voice service returned HTTP ${response.status}`);
 if(!result.audio||result.mime!=='audio/mpeg')throw new Error('Voice service returned no MP3 audio');
 const bytes=Uint8Array.from(atob(result.audio),character=>character.charCodeAt(0));
 return {blob:new Blob([bytes],{type:'audio/mpeg'}),model:result.model||'Cloudflare Workers AI'};
}
async function cloudflareImage({prompt,onProgress}){
  const row=await configOp('readonly',store=>store.get(imageConfigId));if(!row?.url||!row.passcode)throw new Error('Free image provider not configured');
  onProgress?.('Generating image with Cloudflare free allowance…');
  const response=await fetch(`${row.url}/image`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${row.passcode}`},body:JSON.stringify({prompt})});
  let result;try{result=await response.json()}catch{throw new Error(`Image service returned HTTP ${response.status}`)}
  if(!response.ok)throw new Error(result.error||`Image service returned HTTP ${response.status}`);
  if(!result.image||result.mime!=='image/png')throw new Error('Image service returned no PNG image');
  const bytes=Uint8Array.from(atob(result.image),character=>character.charCodeAt(0));
  return {blob:new Blob([bytes],{type:'image/png'}),mime:'image/png',model:result.model||'Cloudflare Workers AI'};
}
export async function initializeProviders(){if(await getGeminiKey())registerProvider('text',{generate:geminiText});if(await getImageConfig()){registerProvider('image',{generate:cloudflareImage});registerProvider('voice',{generate:cloudflareVoice})}else if(await getGeminiKey())registerProvider('image',{generate:geminiImage})}
const api='https://generativelanguage.googleapis.com/v1beta/';
const textPreference=['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.1-flash-lite'];
const imagePreference=['gemini-3.1-flash-image','gemini-3.1-flash-lite-image'];
function messageFrom(response,payload){return payload?.error?.message||`Gemini request failed (HTTP ${response.status})`}
async function availableModels(key){
  let models=[],pageToken='';
  do {
    const url=new URL(api+'models');url.searchParams.set('pageSize','1000');if(pageToken)url.searchParams.set('pageToken',pageToken);
    const response=await fetch(url,{headers:{'x-goog-api-key':key},cache:'no-store'});
    const payload=await response.json();if(!response.ok)throw new Error(messageFrom(response,payload));
    models.push(...(payload.models||[]));pageToken=payload.nextPageToken||'';
  }while(pageToken&&models.length<5000);
  return models.filter(model=>model.supportedGenerationMethods?.includes('generateContent'));
}
async function candidateModels(key,kind){
  const models=await availableModels(key),preferred=kind==='image'?imagePreference:textPreference;
  const candidates=preferred.filter(id=>models.some(m=>m.name===`models/${id}`));
  if(!candidates.length)throw new Error(`No supported ${kind} generation model was listed for this key. Check your Google AI Studio access.`);
  return candidates;
}
export async function testGeminiKey(){const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');return `models/${(await candidateModels(key,'text'))[0]}`}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function transient(response,payload){
  // Quota exhaustion and bad requests need a user action, not more calls.
  return [500,502,503,504].includes(response.status)&&payload?.error?.status!=='RESOURCE_EXHAUSTED';
}
async function generateWithFallback(key,kind,body,onProgress){
  const models=await candidateModels(key,kind);
  // Two tries on the first model, then one on each of the next two listed models.
  // At most four calls; do not retry credentials, permission or quota errors.
  let attempts=0,lastError;
  for(const model of models.slice(0,3)){
    const repeats=attempts===0?2:1;
    for(let tryNumber=0;tryNumber<repeats&&attempts<4;tryNumber++){
      if(attempts>0){onProgress?.(`Gemini is busy, retrying with models/${model}…`);await pause(Math.min(1000*2**(attempts-1),4000))}
      else onProgress?.(`Generating with models/${model}…`);
      attempts++;
      const response=await fetch(`${api}models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body)
      });
      let data;try{data=await response.json()}catch{data={}};
      if(response.ok)return {data,model};
      if(kind==='image'&&response.status===429&&/limit:\s*0/i.test(messageFrom(response,data))){
        throw new Error("Your Gemini plan doesn't include image generation for this model. Enable billing for your API project in Google AI Studio, then try again. No image was saved.");
      }
      if(response.status===429)throw new Error('Gemini image or text quota is exhausted for this key. Check the project rate limits and billing in Google AI Studio, then try later.');
      lastError=new Error(messageFrom(response,data));
      if(!transient(response,data))throw lastError;
    }
  }
  throw new Error(`Gemini models were busy after ${attempts} attempts. ${lastError?.message||'Try again later.'}`);
}
async function geminiText({prompt,onProgress}){
  const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');
  const {data}=await generateWithFallback(key,'text',{contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}},onProgress);
  const text=data.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('');
  if(!text)throw new Error('Gemini returned no story text. Nothing was saved.');
  try{return JSON.parse(text)}catch{throw new Error('Gemini returned a story that could not be read as JSON. Nothing was saved.')}
}

// Gemini image generation is a separate model from the text-key test.
// A valid text key does not prove this account has image generation access.
export async function geminiImage({prompt,onProgress}){
  const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');
  const {data,model}=await generateWithFallback(key,'image',{
    contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}
  },onProgress);
  const part=data.candidates?.[0]?.content?.parts?.find(part=>part.inlineData?.data);
  if(!part)throw new Error('Gemini returned no image. Nothing was saved.');
  const mime=part.inlineData.mimeType||'image/png';
  if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Unsupported image format from Gemini');
  const bytes=Uint8Array.from(atob(part.inlineData.data),character=>character.charCodeAt(0));
  return {blob:new Blob([bytes],{type:mime}),mime,model};
}
