import fs from 'node:fs/promises';
import path from 'node:path';

// Apply a verified local asset to a static page while preserving the page's own layout.
export async function pageWithPhoto(page,file,selector='body',placement='bottom right',credit=null){
  if(!/^(body|main|header|footer|[.#][\w-]+)$/.test(selector))throw Error('실제 HTML의 body, main, header, footer, 클래스 또는 ID 한 개를 지정하세요.');
  if(!['center','top left','top right','bottom left','bottom right','cover'].includes(placement))throw Error('배경 위치는 center, top left/right, bottom left/right, cover 중 하나입니다.');
  const source=await fs.readFile(page,'utf8');
  if(!/<\/head\s*>/i.test(source))throw Error('head가 있는 HTML 파일을 선택하세요.');
  const url=path.relative(path.dirname(page),file).split(path.sep).map(s=>encodeURIComponent(s).replace(/'/g,'%27')).join('/');
  const block='<style id="local-gemma-photo-background">\n'+selector+' { background-image: url("'+url+'"); background-repeat: no-repeat; background-position: '+(placement==='cover'?'center':placement)+'; background-size: '+(placement==='cover'?'cover':'clamp(56px, 24%, 220px) auto')+'; }\n</style>';
  const old=/<style id="local-gemma-photo-background">[\s\S]*?<\/style>/i;
  let html=old.test(source)?source.replace(old,()=>block):source.replace(/<\/head\s*>/i,match=>block+'\n'+match);
  const marker=/<small id="local-gemma-photo-credit">[\s\S]*?<\/small>/i;
  const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valid=url=>{try{return new URL(url).protocol==='https:';}catch{return false;}};
  if(credit && valid(credit.sourceUrl) && valid(credit.licenseUrl)){
    const caption='<small id="local-gemma-photo-credit">사진 <a href="'+escape(credit.sourceUrl)+'">'+escape(credit.title)+'</a> · '+escape(credit.author)+' · <a href="'+escape(credit.licenseUrl)+'">'+escape(credit.license)+'</a>'+(credit.cutout?' · 배경 제거·크롭':'')+'</small>';
    html=marker.test(html)?html.replace(marker,()=>caption):html.replace(/<\/body\s*>/i,match=>caption+'\n'+match);
  }else html=html.replace(marker,'');
  return html;
}
