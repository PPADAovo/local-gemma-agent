// 한/영 자판 실수 바로잡기: 한글을 치려다 영문 자판으로 친 글자(예: "ektltlehgownj" → "다시시도해줘")를
// 두벌식 자판 기준으로 한글로 바꿉니다. 모든 낱말이 완전한 한글 글자로만 조합될 때만 바꿔서,
// 보통 영어("hello", "retry", "ok")는 그대로 둡니다(바꾸면 홀로 남는 자모가 생기기 때문).

const KEY={q:'ㅂ',w:'ㅈ',e:'ㄷ',r:'ㄱ',t:'ㅅ',y:'ㅛ',u:'ㅕ',i:'ㅑ',o:'ㅐ',p:'ㅔ',a:'ㅁ',s:'ㄴ',d:'ㅇ',f:'ㄹ',g:'ㅎ',h:'ㅗ',j:'ㅓ',k:'ㅏ',l:'ㅣ',z:'ㅋ',x:'ㅌ',c:'ㅊ',v:'ㅍ',b:'ㅠ',n:'ㅜ',m:'ㅡ',
  Q:'ㅃ',W:'ㅉ',E:'ㄸ',R:'ㄲ',T:'ㅆ',O:'ㅒ',P:'ㅖ'};
const INITIAL='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const MEDIAL='ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINAL=['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const VOWEL_PAIR={'ㅗㅏ':'ㅘ','ㅗㅐ':'ㅙ','ㅗㅣ':'ㅚ','ㅜㅓ':'ㅝ','ㅜㅔ':'ㅞ','ㅜㅣ':'ㅟ','ㅡㅣ':'ㅢ'};
const FINAL_PAIR={'ㄱㅅ':'ㄳ','ㄴㅈ':'ㄵ','ㄴㅎ':'ㄶ','ㄹㄱ':'ㄺ','ㄹㅁ':'ㄻ','ㄹㅂ':'ㄼ','ㄹㅅ':'ㄽ','ㄹㅌ':'ㄾ','ㄹㅍ':'ㄿ','ㄹㅎ':'ㅀ','ㅂㅅ':'ㅄ'};
const isVowel=j=>MEDIAL.includes(j);
const syllable=(i,m,f='')=>String.fromCharCode(0xAC00+(INITIAL.indexOf(i)*21+MEDIAL.indexOf(m))*28+FINAL.indexOf(f));

// 자모 나열을 글자로 조합합니다. 완전한 글자로만 조합되지 않으면 null.
function compose(jamo){
  let out='',i=0;
  while(i<jamo.length){
    const ini=jamo[i];
    if(isVowel(ini)||!INITIAL.includes(ini)||i+1>=jamo.length||!isVowel(jamo[i+1]))return null;
    let med=jamo[i+1];i+=2;
    if(i<jamo.length&&VOWEL_PAIR[med+jamo[i]]){med=VOWEL_PAIR[med+jamo[i]];i++;}
    let fin='';
    // 받침: 다음 자음 뒤에 모음이 오면 그 자음은 다음 글자의 첫소리입니다.
    if(i<jamo.length&&!isVowel(jamo[i])&&FINAL.includes(jamo[i])&&!(i+1<jamo.length&&isVowel(jamo[i+1]))){
      fin=jamo[i];i++;
      if(i<jamo.length&&FINAL_PAIR[fin+jamo[i]]&&!(i+1<jamo.length&&isVowel(jamo[i+1]))){fin=FINAL_PAIR[fin+jamo[i]];i++;}
    }
    out+=syllable(ini,med,fin);
  }
  return out;
}

// 반대 방향: 영어를 치려다 한글 자판으로 친 글자(예: "ㅗ디ㅣㅐ" → "hello")를 영문 자판 글자로 되돌립니다.
const JAMO_KEY=Object.fromEntries(Object.entries(KEY).map(([k,j])=>[j,k]));
const SPLIT={'ㅘ':'ㅗㅏ','ㅙ':'ㅗㅐ','ㅚ':'ㅗㅣ','ㅝ':'ㅜㅓ','ㅞ':'ㅜㅔ','ㅟ':'ㅜㅣ','ㅢ':'ㅡㅣ','ㄳ':'ㄱㅅ','ㄵ':'ㄴㅈ','ㄶ':'ㄴㅎ','ㄺ':'ㄹㄱ','ㄻ':'ㄹㅁ','ㄼ':'ㄹㅂ','ㄽ':'ㄹㅅ','ㄾ':'ㄹㅌ','ㄿ':'ㄹㅍ','ㅀ':'ㄹㅎ','ㅄ':'ㅂㅅ'};
export function koreanToQwerty(text){
  let out='';
  for(const ch of String(text??'')){
    const code=ch.charCodeAt(0)-0xAC00;
    let jamo;
    if(code>=0&&code<11172)jamo=INITIAL[Math.floor(code/588)]+MEDIAL[Math.floor(code%588/28)]+FINAL[code%28];
    else if(/[ㄱ-ㅣ]/.test(ch))jamo=ch;
    else{out+=ch;continue;}
    for(const j of [...jamo].flatMap(x=>[...(SPLIT[x]||x)]))out+=JAMO_KEY[j]??j;
  }
  return out;
}

// 오타·자판 실수처럼 보이는 입력인지 판단합니다(언어 판단을 먼저 하도록 스킬을 붙일 때 씀).
// - 영문 자판으로 친 한글(fixKoreanTypo로 바뀜)
// - 홀로 쓴 한글 자모가 섞인 입력(예: "ㅗ디ㅣㅐ", "ㅁㄴㅇㄹ")
// - 모음 없이 자음만 길게 이어진 영문 낱말(예: "qwrtpsd")
export function looksLikeTypo(text){
  const value=String(text??'').trim();
  if(!value||value.length>200)return false;
  if(fixKoreanTypo(value))return true;
  // 한글 자모가 섞인 낱말: 홀로 쓴 모음(ㅏ~ㅣ)이 있거나 자모와 완성 글자가 섞였으면 자판 실수로 봅니다.
  // 단, "ㅋㅋㅋ", "ㅠㅠ", "ㅇㅇ", "ㄱㄱ"처럼 같은 글자 반복이나 자음 줄임말은 채팅 표현이라 제외합니다.
  for(const word of value.split(/\s+/)){
    if(!/[ㄱ-ㅣ]/.test(word)||new Set(word).size===1)continue;
    const loneVowel=/[ㅏ-ㅣ]/.test(word);
    const mixed=/[가-힣]/.test(word);
    if((loneVowel||mixed)&&[...word].length>=3)return true;
  }
  return value.split(/\s+/).some(word=>/^[A-Za-z]{5,}$/.test(word)&&!/[aeiouyAEIOUY]/.test(word));
}

// 영문 자판으로 친 한글이면 바꾼 글을, 아니면 null을 돌려줍니다.
export function fixKoreanTypo(text){
  const value=String(text??'').trim();
  if(!value||value.length>200||!/^[A-Za-z\s.,?!~]+$/.test(value)||!/[A-Za-z]{2,}/.test(value))return null;
  const words=value.split(/(\s+|[.,?!~]+)/);
  let converted='',letters=0;
  for(const word of words){
    if(!/^[A-Za-z]+$/.test(word)){converted+=word;continue;}
    const jamo=[...word].map(ch=>KEY[ch]??KEY[ch.toLowerCase()]);
    if(jamo.some(j=>!j))return null;
    const hangul=compose(jamo);
    if(!hangul)return null;
    converted+=hangul;letters+=word.length;
  }
  return letters>=4?converted:null;
}
