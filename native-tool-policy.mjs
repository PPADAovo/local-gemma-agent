// Native schemas and normalized executor actions must obey the same capability policy.
const canonical=name=>({service_search:'plugin_search',service_call:'plugin_call'}[name]||name);
const desktop=new Set(['windows','look','focus','click','double_click','right_click','drag','type','key','scroll','open_app','open_file','unlock_app','open_page','show_page']);
const browser=new Set(['browser_open','browser_read','browser_click','browser_type','browser_key','browser_scroll','browser_back','browser_preview','browser_visual_snapshot']);
const services=new Set(['plugin_search','plugin_call']);
const readOnly=new Set(['read_tool_result','read','list','find_file','look','windows','web_read','web_search','browser_read','plugin_search','skill','discover_tools','calc','schedule_list','installed_apps']);

export function createNativeToolPolicy(settings={}){
  const allowed=Array.isArray(settings.toolAllow)&&settings.toolAllow.length?new Set(settings.toolAllow.map(canonical)):null;
  const reason=name=>{
    const tool=canonical(name);
    // Paging an already captured result does not execute the underlying service again.
    if(tool==='read_tool_result')return '';
    if(allowed&&!allowed.has(tool))return '현재 프로필의 허용 목록에 없는 도구입니다';
    if(settings.computerUse===false&&(desktop.has(tool)||browser.has(tool)))return '컴퓨터 사용이 꺼져 있습니다';
    if(settings.readOnly&&!readOnly.has(tool))return '읽기 전용 작업에서는 실행할 수 없는 도구입니다';
    if((settings.webMode==='off'||settings.webEnabled===false)&&(tool==='web_search'||tool==='web_read'||tool==='open_page'||tool==='show_page'||browser.has(tool)||services.has(tool)))return '웹 사용이 꺼져 있습니다';
    if(settings.pluginsDisabled&&services.has(tool))return '연결 서비스 사용이 꺼져 있습니다';
    return '';
  };
  const assert=name=>{
    const denied=reason(name);
    if(denied)throw Object.assign(Error(denied+' ('+String(name)+').'),{code:'PERMISSION_DENIED'});
  };
  const advertise=tools=>tools.flatMap(spec=>{
    const name=spec.function.name;
    if(name!=='click')return reason(name)?[]:[spec];
    const single=!reason('click'),double=!reason('double_click');
    if(!single&&!double)return [];
    if(single&&double)return [spec];
    const parameters=spec.function.parameters;
    return [{...spec,function:{...spec.function,parameters:{...parameters,
      properties:{...parameters.properties,double:{...parameters.properties.double,enum:[double]}},
      required:single?parameters.required:[...new Set([...parameters.required,'double'])]
    }}}];
  });
  const assertVisualCapture=()=>{
    // A visual review opens a target page and reads its rendered screen. Legacy
    // preview profiles and native open/read profiles describe the same capability.
    if(!reason('browser_preview')&&!reason('browser_visual_snapshot'))return;
    assert('browser_open');assert('browser_read');
  };
  return {assert,assertVisualCapture,advertise,allows:name=>!reason(name)};
}
