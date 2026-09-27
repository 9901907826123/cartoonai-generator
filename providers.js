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
const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';
function messageFrom(response,payload){return payload?.error?.message||`Gemini request failed (HTTP ${response.status})`}
export async function testGeminiKey(){const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');const response=await fetch(endpoint,{headers:{'x-goog-api-key':key},cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(messageFrom(response,data));return data.name||'gemini-2.5-flash'}
async function geminiText({prompt}){const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');const response=await fetch(endpoint+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:.75}})});const data=await response.json();if(!response.ok)throw new Error(messageFrom(response,data));const text=data.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('');if(!text)throw new Error('Gemini returned no text. Nothing was saved.');return JSON.parse(text)}

// Gemini image generation is a separate model from the text-key test.
// A valid text key does not prove this account has image generation access.
export async function geminiImage({prompt}){
  const key=await getGeminiKey();if(!key)throw new Error('AI provider not configured');
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}})
  });
  const data=await response.json();if(!response.ok)throw new Error(messageFrom(response,data));
  const part=data.candidates?.[0]?.content?.parts?.find(part=>part.inlineData?.data);
  if(!part)throw new Error('Gemini returned no image. Nothing was saved.');
  const mime=part.inlineData.mimeType||'image/png';
  if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Unsupported image format from Gemini');
  const bytes=Uint8Array.from(atob(part.inlineData.data),character=>character.charCodeAt(0));
  return {blob:new Blob([bytes],{type:mime}),mime,model:'gemini-2.5-flash-image'};
}
