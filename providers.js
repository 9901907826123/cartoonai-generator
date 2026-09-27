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
export async function saveGeminiKey(key){if(!key.trim())throw new Error('Enter a key first');await configOp('readwrite',store=>store.put({id:settingsId,key:key.trim()}));registerProvider('text',{generate:geminiText});registerProvider('image',{generate:geminiImage});return true}
export async function clearGeminiKey(){await configOp('readwrite',store=>store.delete(settingsId));adapters.delete('text');adapters.delete('image')}
export async function initializeProviders(){if(await getGeminiKey()){registerProvider('text',{generate:geminiText});registerProvider('image',{generate:geminiImage})}}
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
async function chooseModel(key,kind){
  const models=await availableModels(key),preferred=kind==='image'?imagePreference:textPreference;
  const selected=preferred.find(id=>models.some(m=>m.name===`models/${id}`));
  if(!selected)throw new Error(`No supported ${kind} generation model was listed for this key. Check your Google AI Studio access.`);
  return selected;
}
export async function testGeminiKey(){const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');return `models/${await chooseModel(key,'text')}`}
async function geminiText({prompt}){
  const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');
  const model=await chooseModel(key,'text');
  const response=await fetch(`${api}models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}})});
  const data=await response.json();if(!response.ok)throw new Error(messageFrom(response,data));
  const text=data.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('');
  if(!text)throw new Error('Gemini returned no story text. Nothing was saved.');
  try{return JSON.parse(text)}catch{throw new Error('Gemini returned a story that could not be read as JSON. Nothing was saved.')}
}

// Gemini image generation is a separate model from the text-key test.
// A valid text key does not prove this account has image generation access.
export async function geminiImage({prompt}){
  const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');
  const model=await chooseModel(key,'image');
  const response=await fetch(`${api}models/${model}:generateContent`,{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}})
  });
  const data=await response.json();if(!response.ok)throw new Error(messageFrom(response,data));
  const part=data.candidates?.[0]?.content?.parts?.find(part=>part.inlineData?.data);
  if(!part)throw new Error('Gemini returned no image. Nothing was saved.');
  const mime=part.inlineData.mimeType||'image/png';
  if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Unsupported image format from Gemini');
  const bytes=Uint8Array.from(atob(part.inlineData.data),character=>character.charCodeAt(0));
  return {blob:new Blob([bytes],{type:mime}),mime,model};
}
