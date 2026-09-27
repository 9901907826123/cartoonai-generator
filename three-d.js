// Stage 4 is an independent image pipeline for 3D-rendered-look frames.
// It does not generate geometry, rigged assets, animation or a GLB mesh.
export const stylePresets=['Cute 3D','Stylized 3D','Cinematic'];
export const lightingPresets=['Soft studio','Golden hour','Moonlit','Dramatic rim'];
export const cameraPresets=['Wide establishing','Medium shot','Close-up','Low angle'];
const lighting={
  'Soft studio':'soft diffused studio lighting, subtle shadows',
  'Golden hour':'warm golden-hour sunlight with soft long shadows',
  'Moonlit':'cool moonlight with gentle bounce and readable faces',
  'Dramatic rim':'high-contrast dramatic rim lighting with visible subject details'
};
const camera={
  'Wide establishing':'wide establishing shot showing setting and full character',
  'Medium shot':'medium camera framing showing character action and setting',
  'Close-up':'close-up facial expression with shallow depth of field',
  'Low angle':'low-angle cinematic composition showing subject and environment'
};
export function threeDPrompt(project,scene,{style,light,shot}){
  if(!stylePresets.includes(style)||!lighting[light]||!camera[shot])throw new Error('Choose valid 3D style, lighting and camera settings.');
  const references=String(project.story?.characters||'').slice(0,1600);
  return `Create exactly one original still image with the look of a professionally rendered 3D animated cartoon. This is an image, not a 3D model or animation. Visual style: ${style}. Lighting: ${lighting[light]}. Camera: ${camera[shot]}. Age group: ${project.age}. Keep the design appropriate for this age. Project idea: ${String(project.idea||'').slice(0,1200)}. ${references?'Character descriptions to keep visually consistent: '+references+'.':''} Scene: ${scene}. Give characters dimensional forms, coherent materials, perspective, depth and natural shadows. Avoid flat 2D illustration, text and watermarks beyond the model watermark.`;
}
