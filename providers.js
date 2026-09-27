// Provider adapters are intentionally unconfigured. Future stages can plug in
// text, image, video, voice, or music services without changing project storage.
export const providerKinds = ['text', 'image', 'video', 'voice', 'music'];
const adapters = new Map();
export function registerProvider(kind, adapter) {
  if (!providerKinds.includes(kind) || typeof adapter?.generate !== 'function') throw new Error('Invalid provider adapter');
  adapters.set(kind, adapter);
}
export function providerStatus(kind) { return adapters.has(kind) ? 'connected' : 'AI provider not configured'; }
export async function generate(kind, request) {
  const adapter = adapters.get(kind);
  if (!adapter) throw new Error('AI provider not configured');
  return adapter.generate(request);
}
