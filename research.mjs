const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',middot:'·',hellip:'…',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',deg:'°',times:'×',copy:'©',bull:'•'};
function plain(source){
  return source.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/&#x([0-9a-f]{1,6});/gi,(m,h)=>{const c=parseInt(h,16);return c>0&&c<0x110000?String.fromCodePoint(c):m;})
    .replace(/&#(\d{1,7});/g,(m,d)=>{const c=Number(d);return c>0&&c<0x110000?String.fromCodePoint(c):m;})
    .replace(/&([a-z]+);/gi,(m,s)=>entities[s.toLowerCase()]??m)
    .replace(/\s+/g,' ').trim();
}
// 리디렉션: 승인받은 주소와 사실상 같은 주소(http→https, www 유무, 끝의 / 차이)만 자동으로 따라갑니다.
// 다른 경로·사이트로 넘기면 따라가지 않고 새 주소를 알려 줍니다(그 주소는 따로 요청·승인받아 읽음).
// 예전에는 모든 리디렉션이 "fetch failed"라는 알 수 없는 오류로 끝나서 모델이 원인을 몰랐습니다.
const sameTarget=(a,b)=>{const h=u=>u.hostname.replace(/^www\./,'').toLowerCase(),p=u=>(u.pathname.replace(/\/+$/,'')||'/')+u.search;return h(a)===h(b)&&p(a)===p(b)&&(a.port||'')===(b.port||'');};
export const isLoginPage=u=>/^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|nid\.naver\.com|accounts\.kakao\.com|github\.com)$/i.test(u.hostname)&&
  (u.hostname!=='github.com'||/^\/(login|session)/i.test(u.pathname)) || /\/(login|signin|sign-in|servicelogin)(\/|$|\?)/i.test(u.pathname);
const HEADERS={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'ko-KR,ko;q=0.9,en;q=0.8'};
async function download(url){
  let r;
  for(let hop=0;;hop++){
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('HTTP(S) 주소가 필요합니다.');
    try{r=await fetch(url,{redirect:'manual',headers:HEADERS,signal:AbortSignal.timeout(15000)});}
    catch(e){throw Error('웹 페이지에 연결하지 못했습니다: '+(e.cause?.code||e.cause?.message||e.message)+' ('+url.hostname+')');}
    const next=r.status>=300 && r.status<400 && r.headers.get('location');
    if(!next)break;
    if(hop>=5)throw Error('리디렉션이 너무 많습니다: '+url.href);
    const target=new URL(next,url);
    // 로그인 페이지로 넘기면 web_read(쿠키 없는 단순 요청)로는 절대 읽을 수 없습니다. 사용자에게 로그인을 부탁해도 소용없으므로
    // 사용자의 로그인 상태가 있는 브라우저 창(browser_open)이나 연결된 서비스로 가라고 알려 줍니다.
    if(isLoginPage(target)){
      const original=new URL(target.searchParams.get('continue')||url.href);
      throw Object.assign(Error('로그인이 필요한 개인 페이지입니다: '+original.href+' — web_read는 로그인 상태를 쓸 수 없어 사용자가 로그인해도 읽지 못합니다. '+
        '사용자에게 로그인을 부탁하지 말고, 연결된 서비스 도구가 있으면 그것을 쓰고(plugin_search), 없으면 browser_open으로 이 주소를 여세요(사용자 브라우저의 로그인 상태를 쓰고 화면에 보입니다).'),
        {code:'LOGIN_REQUIRED',url:original.href});
    }
    if(!sameTarget(url,target))throw Error('이 주소는 다른 주소로 넘겨 줍니다: '+target.href+' — 그 페이지가 필요하면 web_read로 그 주소를 다시 요청하세요.');
    url=target;
  }
  if(!r.ok)throw Error('웹 요청 실패 '+r.status+' ('+url.hostname+')');
  const type=r.headers.get('content-type')||'';
  if(!/text|html|xml|json/i.test(type))throw Error('텍스트 페이지가 아닙니다.');
  const chunks=[];
  let length=0;
  for await(const chunk of r.body){length+=chunk.length;if(length>3000000)throw Error('페이지 크기 한도 초과');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  // 한국 사이트에 남아 있는 EUC-KR 페이지도 글자가 깨지지 않게 문자셋을 따릅니다.
  const charset=(type.match(/charset=([\w-]+)/i)?.[1]||bytes.subarray(0,2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]||'utf-8').toLowerCase();
  let body;try{body=new TextDecoder(charset).decode(bytes);}catch{body=bytes.toString('utf8');}
  return {url:url.href,body};
}
export async function research(action){
  if(action.tool==='web_read'){
    const page=await download(new URL(action.path));
    const main=page.body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]??page.body;
    return {url:page.url,text:plain(main).slice(0,10000)};
  }
  if(action.provider==='both'){
    // Bing RSS는 긴 한국어 검색어를 받으면 단어 대부분을 버리고 엉뚱한 결과(예: "OO대 비교과포털 … 참여 현황" → 같은 이름의 지역 문서)를 돌려줍니다.
    // 그래서 DuckDuckGo와 Bing을 함께 검색해 합치고, 검색어 단어가 많이 들어간 결과를 앞에 둡니다.
    const settled=await Promise.allSettled(['duckduckgo','bing'].map(provider=>research({...action,provider:provider==='bing'?'bing-only':provider})));
    const merged=[],seen=new Set();
    for(const r of settled)if(r.status==='fulfilled')for(const item of r.value){
      const key=String(item.url).replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');
      if(!seen.has(key)){seen.add(key);merged.push(item);}
    }
    if(!merged.length)throw Error('검색 결과를 읽지 못했습니다.');
    const terms=String(action.text||'').toLowerCase().split(/\s+/).filter(w=>w.length>=2);
    const score=item=>{const hay=(item.title+' '+(item.snippet||'')+' '+decodeURIComponent(item.url)).toLowerCase();return terms.filter(t=>hay.includes(t)).length;};
    return merged.map((item,i)=>({item,i,s:score(item)})).sort((a,b)=>b.s-a.s||a.i-b.i).slice(0,8).map(x=>x.item);
  }
  if(action.provider==='duckduckgo'){
    const query=new URL('https://html.duckduckgo.com/html/');
    query.search=new URLSearchParams({q:action.text});
    try {
      const {body}=await download(query);
      const results=[];
      for(const match of body.matchAll(/<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
        const link=new URL(plain(match[1]),query);
        const url=link.hostname==='duckduckgo.com'?link.searchParams.get('uddg'):link.href;
        if(url && /^https?:\/\//i.test(url))results.push({title:plain(match[2]),url});
        if(results.length===6)break;
      }
      if(results.length)return results;
    } catch { /* Fall back to the RSS provider when HTML search is unavailable. */ }
  }
  const url=new URL('https://www.bing.com/search');
  url.search=new URLSearchParams({format:'rss',q:action.text});
  const {body}=await download(url);
  const results=[...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,6).map(([,item])=>{
    const field=name=>plain(item.match(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>','i'))?.[1]??'');
    return {title:field('title'),url:field('link'),snippet:field('description')};
  }).filter(item=>/^https?:\/\//.test(item.url));
  if(!results.length)throw Error('검색 결과를 읽지 못했습니다.');
  return results;
}
