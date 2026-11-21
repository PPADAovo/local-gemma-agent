// Bound small control decisions, not user-authored documents or code carried by tools.
// Planning still produces explicit goals, ordered steps, skill choices and verification criteria.
export function structuredInferencePolicy(format){
  const p=format?.properties;
  if(!p||p.tool||p.tool_calls)return null;
  if(p.kind&&p.steps&&p.criteria&&p.done_when)return {purpose:'task-spec',tokens:2048,maxTokens:4096,timeoutMs:60000,attempts:2};
  if(p.checks&&p.missing)return {purpose:'completion-audit',tokens:3072,maxTokens:6144,timeoutMs:90000,attempts:2};
  const evidence=(p.verified&&p.quote&&p.gap)||(p.located&&p.elementId)||(p.allow&&p.reason)||(p.done&&p.gap)||(p.matches&&Object.keys(p).length===1);
  const screenIntent=Object.keys(p).length===1&&Array.isArray(p.intent?.enum)&&p.intent.enum.length===3&&['inspect','operate','other'].every(value=>p.intent.enum.includes(value));
  const routing=screenIntent||p.actionQuote||(p.mode&&p.links)||(p.quote&&Object.keys(p).length===1);
  if(evidence||routing)return {purpose:evidence?'evidence-check':'request-routing',tokens:1024,maxTokens:2048,timeoutMs:60000,attempts:2};
  return null;
}
