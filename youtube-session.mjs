export const channelsPage='https://www.youtube.com/feed/channels';
const emailPattern=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const rolePattern=/본\s*계(?:정)?|주\s*계정|부\s*계(?:정)?|보조\s*계정|서브\s*계정/g;
const roleKey=word=>/^(본|주)/.test(word)?'main':'secondary';
const addresses=text=>[...new Set((text.match(emailPattern)||[]).map(email=>email.toLowerCase()))];
const retry=/^(?:다시\s*시도|재시도|이어서|계속|다시)[.!?\s]*$/;

export function googleAccountHint(turns){
  const messages=turns.filter(t=>t.role==='user'&&!t.untrusted)
    .map(t=>String(t.content||'').split(/\r?\n\r?\n첨부 /)[0].trim());
  while(messages.length && retry.test(messages.at(-1)))messages.pop();
  const request=messages.at(-1)||'';
  const roles=text=>[...new Set((text.match(rolePattern)||[]).map(roleKey))];
  const requestedRoles=roles(request);
  const emails=addresses(request);
  if(/말고|제외|아니라|다른\s*계정/.test(request)||requestedRoles.length>1||emails.length>1)return '';
  if(emails.length===1 && (request.toLowerCase()===emails[0] || /아이디|계정|로그인|메일|으로|로\s*(구독|조회)/.test(request)))return emails[0];
  if(requestedRoles.length===1){
    const known=new Set();
    for(const message of messages){
      for(const clause of message.split(/[,;\n]/)){
        const keys=roles(clause), entries=addresses(clause);
        if(keys.length===1 && keys[0]===requestedRoles[0] && entries.length===1 && !/말고|제외|아니|\?|보내/.test(clause))known.add(entries[0]);
      }
    }
    return known.size===1?[...known][0]:'';
  }
  // Carry an immediately supplied login ID into the next request only.
  const prior=messages.at(-2)||'';
  const entries=addresses(prior);
  if(entries.length===1 && (prior.toLowerCase()===entries[0] || /(?:로그인\s*아이디|아이디는|이 계정으로)/.test(prior)) && !roles(prior).length)return entries[0];
  return '';
}

export function googleEntry(email){
  const entry=new URL('https://accounts.google.com/AccountChooser');
  entry.searchParams.set('continue',channelsPage);
  if(email)entry.searchParams.set('Email',email);
  return entry.href;
}
