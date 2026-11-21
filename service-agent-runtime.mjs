// Per-turn service registry. Execution and authorization stay in agent.mjs.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateArguments(value,schema={},at='args',depth=0){
  if(depth>30)return [at+': 입력이 너무 깊습니다'];
  if(schema===false)return [at+': 허용되지 않는 입력'];
  if(!object(schema))return [];
  const errors=[];
  const matches=type=>type==='null'?value===null:type==='object'?object(value):type==='array'?Array.isArray(value):type==='integer'?Number.isInteger(value):type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===type;
  if(schema.type&&!(Array.isArray(schema.type)?schema.type:[schema.type]).some(matches))return [at+': 입력 형식 '+JSON.stringify(schema.type)+' 필요'];
  if(schema.enum&&!schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)))errors.push(at+': 허용된 값이 아닙니다');
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum)errors.push(at+': 최소값 '+schema.minimum);
    if(schema.maximum!==undefined&&value>schema.maximum)errors.push(at+': 최대값 '+schema.maximum);
  }
  if(object(value)){
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))errors.push(at+'.'+key+': 필수 입력');
    for(const [key,item] of Object.entries(value)){
      if(Object.hasOwn(schema.properties||{},key))errors.push(...validateArguments(item,schema.properties[key],at+'.'+key,depth+1));
      else if(schema.additionalProperties===false)errors.push(at+'.'+key+': 허용되지 않는 입력');
    }
  }
  if(Array.isArray(value)&&schema.items)value.forEach((item,i)=>errors.push(...validateArguments(item,schema.items,at+'['+i+']',depth+1)));
  for(const sub of schema.allOf||[])errors.push(...validateArguments(value,sub,at,depth+1));
  if(schema.anyOf&&!schema.anyOf.some(s=>!validateArguments(value,s,at,depth+1).length))errors.push(at+': 입력 조건 불일치');
  if(schema.oneOf&&schema.oneOf.filter(s=>!validateArguments(value,s,at,depth+1).length).length!==1)errors.push(at+': 입력 조건 불일치');
  return errors;
}

export function createServiceRuntime(){
  const aliases=new Map(),names=new Map(),results=new Map();let counter=0;
  return {
    register(result){
      if(typeof result==='string'){try{result=JSON.parse(result);}catch{return;}}
      if(!Array.isArray(result))return;
      for(const spec of result){
        if(!spec?.name||!object(spec.inputSchema)||(aliases.size>=32&&!names.has(spec.name)))continue;
        const alias=names.get(spec.name)||'connected_service_'+(aliases.size+1);
        names.set(spec.name,alias);aliases.set(alias,structuredClone(spec));
      }
    },
    tools(){return [...aliases].map(([alias,spec])=>({type:'function',function:{name:alias,description:spec.name+': '+(spec.description||''),parameters:spec.inputSchema}}));},
    resolve(alias){return aliases.get(alias);},
    describe(value){
      const text=typeof value==='string'?value:JSON.stringify(value)??'';
      if(text.length<=5000)return text;
      const id='result_'+(++counter);results.set(id,text);
      return JSON.stringify({result_id:id,total_chars:text.length,truncated:true,offset:0,next_offset:4000,content:text.slice(0,4000),instruction:'read_tool_result로 나머지를 읽으세요. 원래 도구를 반복 실행하지 마세요.'});
    },
    read({result_id,offset=0}){
      const text=results.get(result_id);
      if(text===undefined)throw Error('현재 작업에 없는 결과입니다.');
      if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('offset 입력 범위를 확인하세요.');
      const end=Math.min(offset+4000,text.length);
      return JSON.stringify({result_id,total_chars:text.length,offset,next_offset:end<text.length?end:null,content:text.slice(offset,end)});
    }
  };
}
