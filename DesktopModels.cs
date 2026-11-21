using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Map=System.Collections.Generic.Dictionary<string,object>;

// 모델 선택 (ChatGPT의 모델 고르기처럼): 입력창 오른쪽 아래 버튼.
// 자동 = GPU에 맞는 모델 우선, 반복 오류 시 큰 모델 전환 시도. 설치 안 된 추천 모델은 눌러서 바로 내려받을 수 있습니다.
partial class DesktopChat {
    // agent.mjs의 AUTO_RANK와 같은 순서 (RTX 5080 16GB 기준, 모두 화면 이미지를 볼 수 있는 모델)
    static readonly string[] AutoRank={"gemma4:12b","qwen3.5:35b","gemma4:26b","qwen3.5:9b","gemma4:latest","gemma4:e4b","gemma3:27b","gemma3:12b"};
    // 에이전트가 "<모델> 모델이 요청을 처리하고 있습니다."로 알려 준 실제 사용 모델 (자동 모드 표시용)
    string runningModel="";
    // 이 PC(RTX 5080 16GB)에서 이 앱(화면 보기 + 도구 사용) 기준 순위. 공개 벤치마크 기준: Qwen 3.5 35B가 종합·에이전트·문서/화면 읽기에서 앞서고, Gemma 4 26B는 코딩이 살짝 앞서며 더 가볍습니다.
    static readonly string[][] Recommended={
        new[]{"qwen3.5:35b","큰 모델 후보","약 22GB · 16GB GPU에서는 일부 CPU 실행 가능"},
        new[]{"gemma4:26b","큰 모델 후보","약 18GB · 16GB GPU에서는 일부 CPU 실행 가능"},
        new[]{"gemma4:12b","자동 기본 후보","약 8GB · 실제 메모리 사용량은 대화 길이에 따라 증가"},
        new[]{"qwen3.5:9b","작은 모델 후보","약 7GB · 작업 성공률은 별도 검증 필요"},
        new[]{"gemma4:31b","비추천","크지만 이 PC(16GB)에선 많이 느려서 실제로는 26B보다 불편함 · 약 20GB"},
    };
    string pulling="";
    int pullPercent=-1;

    // ===== 모델별 필요한 메모리 표시 =====
    // 설치된 모델 크기, 전용 GPU 메모리, 시스템 RAM·커밋 여유로 선택 가능 여부를 추정합니다.
    readonly Dictionary<string,double> modelSizes=new Dictionary<string,double>();
    static readonly Dictionary<string,double> ApproxSizes=new Dictionary<string,double>{{"qwen3.5:35b",22},{"gemma4:26b",18},{"gemma4:12b",8},{"qwen3.5:9b",7},{"gemma4:31b",20},{"gemma3:12b",8.1},{"gemma3:27b",17}};
    double? ramTotal,vramTotal,availableMemory;
    bool capacityBusy;
    bool? hostReady;
    readonly HashSet<string> residentModels=new HashSet<string>();
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    class MemStatus{public uint dwLength=64;public uint dwMemoryLoad;public ulong ullTotalPhys,ullAvailPhys,ullTotalPageFile,ullAvailPageFile,ullTotalVirtual,ullAvailVirtual,ullAvailExtendedVirtual;}
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx([System.Runtime.InteropServices.In,System.Runtime.InteropServices.Out] MemStatus m);
    static string MemoryArgument(ulong bytes){
        return (bytes/1073741824.0).ToString("R",System.Globalization.CultureInfo.InvariantCulture);
    }
    async Task RefreshCapacity(){
        if(capacityBusy)return;
        capacityBusy=true;
        try{
            var metrics=new MemStatus();
            string numbers=GlobalMemoryStatusEx(metrics)?MemoryArgument(metrics.ullTotalPhys)+" "+MemoryArgument(metrics.ullAvailPhys)+" "+MemoryArgument(metrics.ullAvailPageFile):"unknown unknown unknown";
            string model=prefs.model??"";
            string currentModel=System.Text.RegularExpressions.Regex.IsMatch(model,@"^[a-zA-Z0-9:._/-]+$")?" "+model:"";
            string raw=await Task.Run(()=>{
                var info=new System.Diagnostics.ProcessStartInfo("node.exe","model-capacity.mjs "+numbers+currentModel){WorkingDirectory=AppDomain.CurrentDomain.BaseDirectory,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};
                using(var process=System.Diagnostics.Process.Start(info)){
                    if(!process.WaitForExit(6500)){process.Kill();throw new TimeoutException();}
                    if(process.ExitCode!=0)throw new IOException("메모리 조회 실패");
                    return process.StandardOutput.ReadToEnd().Trim();
                }
            });
            var data=json.Deserialize<Map>(raw);
            ramTotal=data["ramTotal"]==null?(double?)null:Convert.ToDouble(data["ramTotal"]);
            availableMemory=data["available"]==null?(double?)null:Convert.ToDouble(data["available"]);
            vramTotal=data["vramTotal"]==null?(double?)null:Convert.ToDouble(data["vramTotal"]);
            hostReady=data["hostReady"]==null?(bool?)null:Convert.ToBoolean(data["hostReady"]);
            residentModels.Clear();
            foreach(object name in (System.Collections.IEnumerable)data["resident"])residentModels.Add(Convert.ToString(name));
            Environment.SetEnvironmentVariable("LOCAL_GEMMA_MEMORY_SAMPLE",raw);
        }catch{
            ramTotal=null;vramTotal=null;availableMemory=null;hostReady=null;residentModels.Clear();
            Environment.SetEnvironmentVariable("LOCAL_GEMMA_MEMORY_SAMPLE",null);
        }finally{capacityBusy=false;}
    }
    double ModelGB(string name){
        double v;string n=name.EndsWith(":latest")?name.Substring(0,name.Length-7):name;
        if(modelSizes.TryGetValue(name,out v)||modelSizes.TryGetValue(n,out v)||modelSizes.TryGetValue(n+":latest",out v))return v;
        return ApproxSizes.TryGetValue(n,out v)?v:0;
    }
    bool? CapacityFits(string name){
        if(residentModels.Contains(name)||residentModels.Contains(name+":latest"))return true;
        if(hostReady==false)return false;
        double size=ModelGB(name);
        return availableMemory.HasValue&&size>0?(bool?)(size+1.5<=availableMemory.Value):null;
    }
    static string HardwareSize(double? value){return value.HasValue?value.Value.ToString("0")+"GB":"미확인";}
    static string Amount(double? value){return value.HasValue?value.Value.ToString("0.#")+" GiB":"미확인";}
    string MemoryText(string name,out Brush color){
        var fits=CapacityFits(name);
        color=fits==false?Brushes.Firebrick:Brushes.Gray;
        if(residentModels.Contains(name)||residentModels.Contains(name+":latest"))return "현재 로드됨";
        return fits==null?"메모리 미확인":fits.Value?"사용 가능":"예상 메모리 여유 부족";
    }
    readonly List<string> installedNames=new List<string>();
    bool catalogBusy;
    DateTime nextCatalogUpdate;
    async Task RefreshModelCatalog(){
        if(catalogBusy || DateTime.UtcNow<nextCatalogUpdate)return;
        catalogBusy=true;
        try{
            var sizes=await Task.Run(()=>{
                var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:11434/api/tags");
                req.Timeout=2500;req.ReadWriteTimeout=2500;
                using(var res=req.GetResponse())using(var reader=new StreamReader(res.GetResponseStream(),Encoding.UTF8)){
                    var tags=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Map>(reader.ReadToEnd());
                    return ((System.Collections.ArrayList)tags["models"]).Cast<Map>().ToDictionary(m=>(string)m["name"],m=>m.ContainsKey("size")?Convert.ToDouble(m["size"])/1073741824.0:0);
                }
            });
            modelSizes.Clear();installedNames.Clear();
            foreach(var pair in sizes){installedNames.Add(pair.Key);modelSizes[pair.Key]=pair.Value;}
            nextCatalogUpdate=DateTime.UtcNow.AddSeconds(30);
            UpdateModelChip();
        }catch(System.Net.WebException){nextCatalogUpdate=DateTime.UtcNow.AddSeconds(5);}
        catch(Exception ex){CrashLog("모델 목록",ex);nextCatalogUpdate=DateTime.UtcNow.AddSeconds(30);}
        finally{catalogBusy=false;}
    }
    List<string> InstalledModels(){return installedNames;}
    async Task RefreshModelStatus(){
        await Task.WhenAll(RefreshCapacity(),RefreshModelCatalog());
        UpdateModelChip();
    }
    // GPT 기준 대략적인 성능 비교(공개 벤치마크 기준, 2026-11-19 조사). 이 PC에서 실제 작업 성공률을 잰 값은 아닙니다.
    // - Qwen 3.5 35B: Qwen 발표 기준 벤치마크 74개 중 58개에서 GPT-5 mini보다 앞섬(MMLU-Pro 85.3 vs 83.7)
    // - Qwen 3.5 9B: 추론·이미지에서 GPT-OSS-120B 이상(GPQA 81.7 vs 71.5), 코딩은 GPT-OSS-120B가 크게 앞섬
    // - Gemma 4 26B: GPQA 79.2 vs GPT-OSS-120B 76.2 / Gemma 4 31B: GPQA 84.3(GPT-5 mini급)
    // - Gemma 3 27B: MMLU-Pro 67.5·GPQA 42.4로 GPT-4o mini(65·43)와 비슷 / Gemma 3 12B는 그보다 아래
    // - Gemma 4 12B·E4B: 공개된 GPT 비교 없음 → 같은 세대 큰 모델과 이전 세대 결과로 어림
    // 이름이 다른 파생 모델(feedback-qwen, openclaw-gemma4 등)은 이름에 든 기반 모델·크기로 찾습니다.
    // 돌려주는 값: [0] 배지에 쓸 짧은 비교(없으면 ""), [1] 근거 한 줄(작은 글씨)
    static string[] Comparison(string name){
        string n=(name??"").ToLowerInvariant();
        bool qwen35=n.Contains("qwen3.5")||(n.Contains("qwen")&&!n.Contains("qwen3:")&&!n.Contains("qwen3-")&&!n.Contains("qwen2"));
        bool gemma4=n.Contains("gemma4"),gemma3=n.Contains("gemma3");
        bool derived=!(n.StartsWith("qwen3.5:")||n.StartsWith("gemma4:")||n.StartsWith("gemma3:"));
        string[] c=null;
        if(qwen35&&n.Contains("35b"))c=new[]{"≈ GPT-5 mini","벤치마크 대부분에서 비슷하거나 앞섬"};
        else if(qwen35&&n.Contains("9b"))c=new[]{"≈ GPT-OSS-120B","추론·이미지 기준 · 코딩은 그보다 약함"};
        else if(gemma4&&n.Contains("31b"))c=new[]{"≈ GPT-5 mini","추론 벤치마크 기준"};
        else if(gemma4&&n.Contains("26b"))c=new[]{"≈ GPT-OSS-120B","추론 벤치마크 기준"};
        else if(gemma4&&n.Contains("12b"))c=new[]{"> GPT-4o mini","공식 비교 없음 · 어림값"};
        else if(gemma4&&(n.Contains("e4b")||n.Contains("e2b")||n.EndsWith(":latest")))c=new[]{"< GPT-4o mini","작은 모델 · 어림값"};
        else if(gemma3&&n.Contains("27b"))c=new[]{"≈ GPT-4o mini","벤치마크 기준"};
        else if(gemma3&&n.Contains("12b"))c=new[]{"< GPT-4o mini","이전 세대"};
        if(c==null)return new[]{"","GPT 비교 자료 없음"};
        if(derived)c[1]+=" · 기반 모델 기준";
        return c;
    }
    // 모델 메뉴 한 칸: 이름 + 오른쪽 GPT 비교 배지 / 역할·크기 / 메모리 상태(색 점) · 비교 근거
    void ModelDescription(MenuItem item,string title,string code,string role,string memory,bool memoryShort,string name){
        var cmp=Comparison(name);
        var gray=new SolidColorBrush(Color.FromRgb(118,122,126));
        var top=new DockPanel{LastChildFill=true};
        if(cmp[0].Length>0){
            var badge=new Border{Background=new SolidColorBrush(Color.FromRgb(236,242,250)),CornerRadius=new CornerRadius(9),Padding=new Thickness(8,1,8,2),Margin=new Thickness(12,0,0,0),VerticalAlignment=VerticalAlignment.Center,
                Child=new TextBlock{Text=cmp[0],FontSize=12,FontWeight=FontWeights.SemiBold,Foreground=new SolidColorBrush(Color.FromRgb(38,92,160))}};
            DockPanel.SetDock(badge,Dock.Right);top.Children.Add(badge);
        }
        var head=new TextBlock{VerticalAlignment=VerticalAlignment.Center};
        head.Inlines.Add(new System.Windows.Documents.Run(title){FontWeight=FontWeights.SemiBold});
        head.Inlines.Add(new System.Windows.Documents.Run("  "+code){FontSize=11.5,Foreground=gray});
        top.Children.Add(head);
        var lines=new StackPanel{MinWidth=330};
        lines.Children.Add(top);
        lines.Children.Add(new TextBlock{Text=role,FontSize=12.5,Foreground=new SolidColorBrush(Color.FromRgb(72,76,80)),Margin=new Thickness(0,3,0,0),TextWrapping=TextWrapping.Wrap,MaxWidth=420});
        bool loaded=memory=="현재 로드됨";
        var dot=loaded?Color.FromRgb(38,92,160):memoryShort?Color.FromRgb(214,69,65):memory=="사용 가능"?Color.FromRgb(45,140,90):Color.FromRgb(150,154,158);
        var status=new TextBlock{FontSize=12,Margin=new Thickness(0,2,0,1),Foreground=gray,TextWrapping=TextWrapping.Wrap,MaxWidth=420};
        status.Inlines.Add(new System.Windows.Documents.Run("● "){Foreground=new SolidColorBrush(dot)});
        status.Inlines.Add(new System.Windows.Documents.Run(memory){Foreground=new SolidColorBrush(dot)});
        status.Inlines.Add(new System.Windows.Documents.Run("   ·   "+cmp[1]));
        lines.Children.Add(status);
        item.Header=lines;
        System.Windows.Automation.AutomationProperties.SetName(item,title+" "+cmp[0]+" "+memory);
    }
    static string OtherNote(string name){
        if(name.StartsWith("gemma3"))return "이전 세대 · 위 추천 모델이 더 좋음";
        if(name.Contains("coder"))return "화면을 볼 수 없음(글자 전용) · 코드 보조용";
        if(name.Contains("-vl")||name.Contains("vision")||name.Contains("llava"))return "화면 보기 가능 · 이전 세대라 추천 모델보다 약함";
        if(name.Contains("embed"))return "검색용 보조 모델 · 대화용 아님";
        return "순위 밖 · 화면 보기(이미지) 지원 여부를 확인하세요";
    }
    static bool Has(List<string> installed,string name){return installed.Any(n=>n==name||n==name+":latest");}
    static string Pretty(string name){
        if(String.IsNullOrEmpty(name))return "자동";
        string[] p=name.Split(':');string fam=p[0];string size=p.Length>1?p[1]:"";
        string f=fam=="gemma4"?"Gemma 4":fam=="gemma3"?"Gemma 3":fam=="qwen3.5"?"Qwen 3.5":fam=="qwen3"?"Qwen 3":fam;
        if(size=="latest"||size=="")return f;
        return f+" "+size.ToUpperInvariant();
    }
    string AutoPick(List<string> installed){return AutoRank.FirstOrDefault(n=>Has(installed,n)&&CapacityFits(n)==true)??AutoRank.FirstOrDefault(n=>Has(installed,n))??"gemma3:12b";}
    // 예전 5칸 슬라이더에서 저장된 값(예: Max=4)이 지금 4칸 범위를 벗어나면 고쳐서 저장합니다.
    void NormalizeEffort(){
        int fixedLevel=prefs.effort;
        if(fixedLevel>=EffortModels.Length||fixedLevel<-1)fixedLevel=-1;
        if(fixedLevel>=0&&EffortModels[fixedLevel]!=(prefs.model??""))fixedLevel=Array.IndexOf(EffortModels,prefs.model??"");
        if(fixedLevel!=prefs.effort){prefs.effort=fixedLevel;try{SavePreferences();}catch{}}
    }
    // 클라우드 모델은 서비스마다 두 가지: 구독(로그인한 계정, 추가 요금 없음) / API(내 API 키, 사용량 과금)
    static readonly string[] BrainKeys={"local","mix","sub-gemini","api-gemini","sub-gpt","api-gpt","sub-claude","api-claude"};
    static readonly string[] BrainNames={"로컬","로컬 + Gemini API","Gemini 구독","Gemini API","ChatGPT 구독","OpenAI API","Claude 구독","Claude API"};
    static readonly string[] BrainDetails={"이 PC의 모델로 작업","로컬이 실행하고 Gemini API에 계획·분석을 요청","내 Google 계정(agy)으로 작업 · 추가 요금 없음","내 Google API 키로 작업 · 사용량 과금","내 ChatGPT 계정(Codex)으로 작업 · 추가 요금 없음","내 OpenAI API 키로 작업 · 사용량 과금","내 Claude 계정(Claude Code)으로 작업 · 추가 요금 없음","내 Anthropic API 키로 작업 · 사용량 과금"};
    // 구독 등급: plan-tiers.mjs가 로그인한 계정 정보에서 읽어 plans.json에 저장한 값(예: Pro, Pro Lite)을 보여 줍니다.
    static string PlansPath(){return Path.Combine(DataDir(),"plans.json");}
    static string PlanLabel(string id){
        string tier=null;
        try{var data=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(PlansPath(),Encoding.UTF8));object v;if(data.TryGetValue(id,out v)&&v is string&&((string)v).Trim().Length>0)tier=((string)v).Trim();}catch{}
        if(id=="gemini")return tier!=null?"Google AI "+tier:"내 Google 계정";
        if(id=="gpt")return tier!=null?"ChatGPT "+tier:"내 ChatGPT 계정";
        return tier!=null?"Claude "+tier:"내 Claude 계정";
    }
    // 연결 상태: brain-health.mjs가 기록한 health.json. 쓸 수 없는 연결은 빨간색 + "확인 필요 ↗" 링크로 보여 줍니다.
    static readonly SolidColorBrush BrokenBrush=new SolidColorBrush(Color.FromRgb(214,62,58));
    static readonly Dictionary<string,string> FixLinks=new Dictionary<string,string>{
        {"sub-gemini","https://antigravity.google/download"},{"api-gemini","https://aistudio.google.com/apikey"},
        {"sub-gpt","https://chatgpt.com/"},{"api-gpt","https://platform.openai.com/settings/organization/billing/"},
        {"sub-claude","https://claude.ai/settings/billing"},{"api-claude","https://platform.claude.com/settings/billing"}};
    static bool Healthy(string key,out string reason){
        reason="";
        try{
            var data=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string,Dictionary<string,object>>>(File.ReadAllText(Path.Combine(Path.GetDirectoryName(PlansPath()),"health.json"),Encoding.UTF8));
            Dictionary<string,object> h;
            if(data!=null&&data.TryGetValue(key,out h)&&h!=null&&h.ContainsKey("ok")&&!Convert.ToBoolean(h["ok"])){reason=h.ContainsKey("reason")?Convert.ToString(h["reason"]):"";if(reason.Length==0)reason="사용 불가";return false;}
        }catch{}
        return true;
    }
    static IEnumerable<TextBlock> FindLogicalTexts(DependencyObject root){
        if(root is TextBlock){yield return (TextBlock)root;yield break;}
        foreach(var c in LogicalTreeHelper.GetChildren(root))if(c is DependencyObject)foreach(var t in FindLogicalTexts((DependencyObject)c))yield return t;
    }
    // 옵션 글자를 빨간색으로 바꾸고, 설명 줄을 "이유 · 확인 필요 ↗"(밑줄 링크)로 바꿉니다. 링크를 누르면 해당 사이트가 열립니다.
    void MarkBroken(Button button,string reason,string url,Action closeMenus){
        var texts=FindLogicalTexts((DependencyObject)button.Content).ToList();
        if(texts.Count==0)return;
        texts[0].Foreground=BrokenBrush;
        var lines=texts[0].Parent as StackPanel;if(lines==null)return;
        if(texts.Count>1&&texts[1].Parent==lines)lines.Children.Remove(texts[1]);
        var detail=new TextBlock{FontFamily=window.FontFamily,FontSize=12,Foreground=BrokenBrush,Margin=new Thickness(0,2,0,0)};
        detail.Inlines.Add(new System.Windows.Documents.Run(reason+" · "));
        var link=new System.Windows.Documents.Run("확인 필요 ↗"){TextDecorations=TextDecorations.Underline,Cursor=System.Windows.Input.Cursors.Hand,FontWeight=FontWeights.SemiBold};
        link.ToolTip=url;
        // 버튼(연결 선택)이 눌리지 않게 링크에서 마우스 누름을 먼저 처리합니다.
        link.PreviewMouseLeftButtonDown+=(s,e)=>{e.Handled=true;closeMenus();try{System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url){UseShellExecute=true});}catch{}};
        detail.Inlines.Add(link);
        lines.Children.Add(detail);
        System.Windows.Automation.AutomationProperties.SetHelpText(button,reason+" · 확인 필요: "+url);
    }
    static bool plansRefreshing;
    // 6시간마다(또는 처음) 백그라운드로 등급을 다시 확인합니다. 메뉴는 기다리지 않고 저장된 값을 바로 씁니다.
    static void RefreshPlans(){
        try{
            if(plansRefreshing)return;
            var file=PlansPath();
            if(File.Exists(file)&&(DateTime.Now-File.GetLastWriteTime(file)).TotalHours<6)return;
            plansRefreshing=true;
            var p=System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("node.exe","plan-tiers.mjs"){WorkingDirectory=AppDomain.CurrentDomain.BaseDirectory,CreateNoWindow=true,UseShellExecute=false});
            p.EnableRaisingEvents=true;p.Exited+=(s,e)=>plansRefreshing=false;
        }catch{plansRefreshing=false;}
    }
    int BrainIndex(){if(prefs.brain=="gemini"||prefs.brain=="gpt"||prefs.brain=="claude")prefs.brain="api-"+prefs.brain;return Math.Max(0,Array.IndexOf(BrainKeys,prefs.brain));}
    void BrainMenu(){BrainMenu("Brand");}
    // anchorName: "Brand"(위쪽 제목) 아래로 펼치거나, "Model"(입력창 모델 버튼) 위로 펼칩니다.
    void BrainMenu(string anchorName){
        var anchor=Find<Button>(anchorName)??Find<Button>("Brand");
        bool above=anchorName=="Model";
        var popup=new System.Windows.Controls.Primitives.Popup{PlacementTarget=anchor,Placement=above?System.Windows.Controls.Primitives.PlacementMode.Top:System.Windows.Controls.Primitives.PlacementMode.Bottom,VerticalOffset=above?-2:4,AllowsTransparency=true,StaysOpen=false};
        var rows=new StackPanel();
        var card=new Border{Background=Brushes.White,BorderBrush=new SolidColorBrush(Color.FromRgb(228,228,228)),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(16),Padding=new Thickness(6),Width=220,Margin=new Thickness(4,2,8,10),Effect=new System.Windows.Media.Effects.DropShadowEffect{BlurRadius=10,ShadowDepth=2,Opacity=0.14},Child=rows};
        // 첫 화면은 로컬 + 서비스 3개만. 서비스에 마우스를 올리면 오른쪽에 [구독 / API] 두 가지가 펼쳐집니다.
        System.Windows.Controls.Primitives.Popup sub=null;
        Action closeSub=()=>{if(sub!=null){sub.IsOpen=false;rows.Children.Remove(sub);sub=null;}};
        popup.Closed+=(s,e)=>closeSub();
        Func<string,string,bool,string,Button> option=(name,detail,selected,trail)=>{
            var row=new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition());
            row.ColumnDefinitions.Add(new ColumnDefinition{Width=GridLength.Auto});
            var lines=new StackPanel{VerticalAlignment=VerticalAlignment.Center};
            lines.Children.Add(new TextBlock{Text=name,FontFamily=window.FontFamily,FontSize=14,Foreground=new SolidColorBrush(Color.FromRgb(38,39,41))});
            if(detail.Length>0)lines.Children.Add(new TextBlock{Text=detail,FontFamily=window.FontFamily,FontSize=12,Foreground=new SolidColorBrush(Color.FromRgb(145,146,148)),Margin=new Thickness(0,2,0,0)});
            row.Children.Add(lines);
            var right=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center,Margin=new Thickness(8,0,0,0)};
            if(selected){
                var mark=new Border{Width=20,Height=20,CornerRadius=new CornerRadius(10),Background=new SolidColorBrush(Color.FromRgb(45,105,87)),VerticalAlignment=VerticalAlignment.Center};
                mark.Child=new TextBlock{Text="✓",Foreground=Brushes.White,FontSize=13,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center};
                right.Children.Add(mark);
            }
            if(trail.Length>0)right.Children.Add(new TextBlock{Text=trail,FontSize=15,Margin=new Thickness(8,0,2,0),VerticalAlignment=VerticalAlignment.Center,Foreground=new SolidColorBrush(Color.FromRgb(145,146,148))});
            Grid.SetColumn(right,1);row.Children.Add(right);
            var button=new Button{Style=(Style)window.FindResource("BrainOption"),Content=row,Tag=selected?"selected":null,IsEnabled=!busy&&!loading};
            System.Windows.Automation.AutomationProperties.SetName(button,name+(selected?" 선택됨":""));
            return button;
        };
        Action<string> choose=key=>{prefs.SelectBrain(key);SavePreferences();UpdateModelChip();closeSub();popup.IsOpen=false;};
        if(prefs.brain=="mix"){prefs.SelectBrain("sub-gemini");SavePreferences();}
        var local=option("로컬","이 PC에서 처리 · 외부 AI 사용 안 함",prefs.brain=="local"||BrainIndex()==0,"");
        local.Click+=(s,e)=>choose("local");local.MouseEnter+=(s,e)=>closeSub();
        rows.Children.Add(local);
        // 섞어쓰기 메뉴는 없앴습니다. 예전에 골라 둔 설정은 Gemini(로컬 우선 · 해결 못 할 때 도움)로 바꿉니다.
        RefreshPlans();
        foreach(var svc in new[]{new[]{"gemini","Gemini"},new[]{"gpt","ChatGPT"},new[]{"claude","Claude"}}){
            string id=svc[0],label=svc[1];
            bool mine=prefs.brain=="sub-"+id||prefs.brain=="api-"+id;
            var row=option(label,prefs.localFirst==false?"외부 AI 직접 사용":"로컬 우선 · 해결하지 못할 때 도움",mine,"›");
            string ignored;
            // 구독·API 둘 다 쓸 수 없으면 서비스 이름도 빨간색으로
            if(!Healthy("sub-"+id,out ignored)&&!Healthy("api-"+id,out ignored))foreach(var t in FindLogicalTexts((DependencyObject)row.Content))t.Foreground=BrokenBrush;
            Action open=()=>{
                closeSub();
                var list=new StackPanel();
                var subCard=new Border{Background=Brushes.White,BorderBrush=new SolidColorBrush(Color.FromRgb(228,228,228)),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(14),Padding=new Thickness(6),MinWidth=210,Margin=new Thickness(2,0,8,10),Effect=new System.Windows.Media.Effects.DropShadowEffect{BlurRadius=10,ShadowDepth=2,Opacity=0.14},Child=list};
                var subscription=option("구독",PlanLabel(id)+" · 추가 요금 없음",prefs.brain=="sub-"+id,"");
                subscription.Click+=(s,e)=>choose("sub-"+id);
                var api=option("API","내 API 키 · 사용량 과금",prefs.brain=="api-"+id,"");
                api.Click+=(s,e)=>choose("api-"+id);
                string reason;
                if(!Healthy("sub-"+id,out reason))MarkBroken(subscription,reason,FixLinks["sub-"+id],()=>{closeSub();popup.IsOpen=false;});
                if(!Healthy("api-"+id,out reason))MarkBroken(api,reason,FixLinks["api-"+id],()=>{closeSub();popup.IsOpen=false;});
                list.Children.Add(subscription);list.Children.Add(api);
                sub=new System.Windows.Controls.Primitives.Popup{PlacementTarget=row,Placement=System.Windows.Controls.Primitives.PlacementMode.Right,HorizontalOffset=6,VerticalOffset=-6,AllowsTransparency=true,StaysOpen=true,Child=subCard};
                rows.Children.Add(sub);sub.IsOpen=true;  // 메인 창 안에 두어야 클릭해도 메인 메뉴가 먼저 닫히지 않습니다
            };
            row.MouseEnter+=(s,e)=>open();
            row.Click+=(s,e)=>open();
            rows.Children.Add(row);
        }
        var keys=new Button{Content="내 API 키 등록",Margin=new Thickness(4),Padding=new Thickness(5)};
        keys.MouseEnter+=(s,e)=>closeSub();
        keys.Click+=(sender,args)=>{
            popup.IsOpen=false;
            var script=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"API 연결.ps1");
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("powershell.exe","-NoProfile -STA -ExecutionPolicy Bypass -File \""+script+"\""){UseShellExecute=false,CreateNoWindow=true});
        };
        rows.Children.Add(keys);
        popup.Child=card;popup.IsOpen=true;
    }
    // 클라우드 모델(Gemini·GPT·Claude) 컨텍스트 사용량: 채팅별 마지막 값 {쓴 토큰, 한도, 어림값 여부(1/0)}과 서비스 이름
    readonly Dictionary<string,double[]> usageByChat=new Dictionary<string,double[]>();
    readonly Dictionary<string,string> usageProvider=new Dictionary<string,string>();
    void RecordUsage(Map u){
        double used=Convert.ToDouble(u["used"]),limit=Convert.ToDouble(u["limit"]);
        if(!(used>0&&limit>0))return;
        usageByChat[id]=new[]{used,limit,Equals(u.ContainsKey("estimated")?u["estimated"]:null,true)?1.0:0.0};
        usageProvider[id]=u.ContainsKey("provider")?Convert.ToString(u["provider"]):"";
        ShowUsage();
    }
    static string TokenLabel(double n){
        if(n>=1000000)return (n/1000000).ToString(n>=10000000?"0":"0.#",System.Globalization.CultureInfo.InvariantCulture)+"M";
        if(n>=1000)return Math.Round(n/1000).ToString(System.Globalization.CultureInfo.InvariantCulture)+"k";
        return Math.Round(n).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    void ShowUsage(){
        var box=Find<Grid>("ContextUsage");if(box==null)return;
        double[] u;
        if(BrainIndex()<2||!usageByChat.TryGetValue(id,out u)){box.Visibility=Visibility.Collapsed;return;}
        double f=Math.Max(0,Math.Min(1,u[0]/u[1]));
        int pct=(int)Math.Round(f*100);
        // 링: 12시 방향에서 시계 방향으로 쓴 만큼 채웁니다. 꽉 차면 원 전체, 아주 적어도 점 하나는 보이게.
        var ring=Find<System.Windows.Shapes.Path>("ContextRing");
        double a=Math.Max(0.02,Math.Min(0.9999,f))*2*Math.PI,r=6.5;
        var start=new Point(8,8-r);var end=new Point(8+r*Math.Sin(a),8-r*Math.Cos(a));
        var fig=new PathFigure{StartPoint=start,IsClosed=false};
        fig.Segments.Add(new ArcSegment(end,new Size(r,r),0,a>Math.PI,SweepDirection.Clockwise,true));
        var geo=new PathGeometry();geo.Figures.Add(fig);ring.Data=geo;
        ring.Stroke=f>=0.9?new SolidColorBrush(Color.FromRgb(214,69,65)):f>=0.7?new SolidColorBrush(Color.FromRgb(230,140,40)):new SolidColorBrush(Color.FromRgb(131,137,141));
        string who;usageProvider.TryGetValue(id,out who);
        box.ToolTip=new ToolTip{Content=new TextBlock{TextAlignment=TextAlignment.Center,Text="컨텍스트 길이"+(string.IsNullOrEmpty(who)?"":" · "+who)+":\n"+pct+"% 사용 ("+(100-pct)+"% 남음)\n"+TokenLabel(u[0])+"/"+TokenLabel(u[1])+" 개의 토큰 사용"+(u[2]>0?"\n(구독 연결은 글자 수로 어림한 값)":"")}};
        System.Windows.Automation.AutomationProperties.SetName(box,"컨텍스트 사용량 "+pct+"%");
        box.Visibility=Visibility.Visible;
        BindUsageRing(box);
        if(usagePopup!=null&&usagePopup.IsOpen)usagePopup.Child=UsageCard(who,u,f,pct,(SolidColorBrush)ring.Stroke);
    }
    // 링을 누르면 사용량 카드가 위로 열리고, 다시 누르거나 바깥을 누르면 닫힙니다. 마우스를 올리면 링 뒤가 옅게 칠해집니다.
    System.Windows.Controls.Primitives.Popup usagePopup;bool usageBound;
    void BindUsageRing(Grid box){
        if(usageBound)return;usageBound=true;
        var hover=Find<System.Windows.Shapes.Ellipse>("ContextHover");
        Brush idle=Brushes.Transparent,lit=new SolidColorBrush(Color.FromRgb(238,240,242)),down=new SolidColorBrush(Color.FromRgb(226,229,232));
        box.MouseEnter+=(s,e)=>hover.Fill=lit;
        box.MouseLeave+=(s,e)=>hover.Fill=usagePopup!=null&&usagePopup.IsOpen?down:idle;
        box.MouseLeftButtonDown+=(s,e)=>{hover.Fill=down;e.Handled=true;};
        // 자동으로 닫히는 팝업(StaysOpen=false)은 링을 다시 누를 때 닫힘과 열림이 겹쳐 닫히지 않았습니다.
        // 그래서 팝업은 열어 두고, 링 다시 누르기·창의 다른 곳 누르기·Esc·창 전환 때 직접 닫습니다.
        Action close=()=>{if(usagePopup!=null&&usagePopup.IsOpen)usagePopup.IsOpen=false;};
        Action toggle=()=>{
            if(usagePopup!=null&&usagePopup.IsOpen){close();return;}
            double[] u;if(!usageByChat.TryGetValue(id,out u))return;
            string who;usageProvider.TryGetValue(id,out who);
            double f=Math.Max(0,Math.Min(1,u[0]/u[1]));
            usagePopup=new System.Windows.Controls.Primitives.Popup{PlacementTarget=box,Placement=System.Windows.Controls.Primitives.PlacementMode.Top,VerticalOffset=-4,HorizontalOffset=-110,AllowsTransparency=true,StaysOpen=true,
                Child=UsageCard(who,u,f,(int)Math.Round(f*100),(SolidColorBrush)Find<System.Windows.Shapes.Path>("ContextRing").Stroke)};
            usagePopup.Closed+=(s,e)=>{ToolTipService.SetIsEnabled(box,true);hover.Fill=box.IsMouseOver?lit:idle;};
            ToolTipService.SetIsEnabled(box,false);
            usagePopup.IsOpen=true;
        };
        box.MouseLeftButtonUp+=(s,e)=>{e.Handled=true;toggle();};
        box.KeyDown+=(s,e)=>{if(e.Key==System.Windows.Input.Key.Enter||e.Key==System.Windows.Input.Key.Space){toggle();e.Handled=true;}};
        window.PreviewMouseDown+=(s,e)=>{if(!box.IsMouseOver)close();};
        window.PreviewKeyDown+=(s,e)=>{if(e.Key==System.Windows.Input.Key.Escape&&usagePopup!=null&&usagePopup.IsOpen){close();e.Handled=true;}};
        window.Deactivated+=(s,e)=>close();
        window.LocationChanged+=(s,e)=>close();
    }
    UIElement UsageCard(string who,double[] u,double f,int pct,SolidColorBrush color){
        var gray=new SolidColorBrush(Color.FromRgb(110,114,118));
        var stack=new StackPanel();
        stack.Children.Add(new TextBlock{Text="컨텍스트 길이"+(string.IsNullOrEmpty(who)?"":" · "+who),FontSize=12,Foreground=gray});
        var big=new TextBlock{FontSize=20,FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,4,0,6),Foreground=new SolidColorBrush(Color.FromRgb(36,37,40))};
        big.Inlines.Add(new System.Windows.Documents.Run(pct+"%"));big.Inlines.Add(new System.Windows.Documents.Run(" 사용"){FontSize=13,FontWeight=FontWeights.Normal,Foreground=gray});
        stack.Children.Add(big);
        var track=new Border{Height=6,CornerRadius=new CornerRadius(3),Background=new SolidColorBrush(Color.FromRgb(232,234,236))};
        var fill=new Border{Height=6,CornerRadius=new CornerRadius(3),Background=color,HorizontalAlignment=HorizontalAlignment.Left,Width=Math.Max(4,208*f)};
        var bar=new Grid{Width=208};bar.Children.Add(track);bar.Children.Add(fill);stack.Children.Add(bar);
        stack.Children.Add(new TextBlock{Text=TokenLabel(u[0])+" / "+TokenLabel(u[1])+" 토큰 · "+(100-pct)+"% 남음",FontSize=12,Margin=new Thickness(0,8,0,0),Foreground=new SolidColorBrush(Color.FromRgb(64,67,72))});
        stack.Children.Add(new TextBlock{Text=u[2]>0?"구독 연결은 토큰 수를 알려 주지 않아 글자 수로 어림한 값입니다.":"서비스가 알려 준 실제 토큰 수입니다.",FontSize=11,Margin=new Thickness(0,4,0,0),TextWrapping=TextWrapping.Wrap,Width=208,Foreground=gray});
        return new Border{Background=Brushes.White,BorderBrush=new SolidColorBrush(Color.FromRgb(228,228,228)),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(14),Padding=new Thickness(14,12,14,12),Margin=new Thickness(8,4,8,10),Effect=new System.Windows.Media.Effects.DropShadowEffect{BlurRadius=10,ShadowDepth=2,Opacity=0.14},Child=stack};
    }
    void UpdateModelChip(){
        Find<Button>("Brand").Content=BrainNames[BrainIndex()];
        ShowUsage();
        NormalizeEffort();
        var b=Find<Button>("Model");if(b==null)return;b.IsEnabled=true;
        if(BrainIndex()>=2){
            b.Tag="";b.Content=BrainNames[BrainIndex()];b.ToolTip="모델 선택";
            System.Windows.Automation.AutomationProperties.SetName(b,"모델 선택 · "+b.Content);return;
        }
        if(pulling.Length>0){b.Tag="";b.Content="⬇ "+Pretty(pulling)+(pullPercent>=0?" "+pullPercent+"%":" 준비 중");b.ToolTip="모델을 내려받는 중입니다. 끝나면 자동으로 이 모델로 바뀝니다.";return;}
        string chosen=prefs.model??"";
        int lv=prefs.effort;
        string active=chosen.Length>0?chosen:runningModel.Length>0?runningModel:AutoPick(InstalledModels());
        b.Content=Pretty(active);
        b.Tag=chosen.Length==0?" 자동":lv>=0&&lv<EffortModels.Length&&EffortModels[lv]==chosen?" "+EffortNames[lv]:"";
        System.Windows.Automation.AutomationProperties.SetName(b,"모델 선택 · "+b.Content+b.Tag);
        Brush tipColor;
        b.ToolTip=(prefs.brain=="mix"?"섞어쓰기":prefs.brain=="gemini"?"Gemini 우선":"로컬")+" · 모델 선택\n"+Pretty(active)+": "+MemoryText(active,out tipColor);
    }
    void ChooseModel(string name){
        if(name.Length==0||prefs.effort<0||prefs.effort>=EffortModels.Length||EffortModels[prefs.effort]!=name)prefs.effort=Array.IndexOf(EffortModels,name)>=0&&name.Length>0?Array.IndexOf(EffortModels,name):-1;
        prefs.model=name;try{SavePreferences();status.Text="";}catch(Exception x){status.Text=x.Message;}
        UpdateModelChip();
    }
    async void ModelMenu(string anchor="Model"){
        await RefreshModelStatus();
        var installed=InstalledModels();
        var panel=Panel(Find<Button>(anchor),360);
        Heading(panel,"모델");
        string chosen=prefs.model??"";
        var auto=Entry(panel,"자동",Do(()=>ChooseModel("")));
        Description(auto,"자동","GPU에 맞는 빠른 모델 우선 · 반복 오류 시 큰 모델 전환 시도\n"+(chosen.Length>0?"현재 수동 선택: "+Pretty(chosen):runningModel.Length>0?"최근 실행 모델: "+Pretty(runningModel):"실행할 때 모델과 메모리를 확인합니다"));auto.IsChecked=chosen.Length==0;
        if(installed.Count>0){
            panel.Items.Add(new Separator());Heading(panel,"설치된 모델");
            foreach(var n in installed.Where(n=>!n.Contains("embed")).OrderBy(n=>{int i=Array.IndexOf(AutoRank,n.Replace(":latest",""));return i<0?99:i;})){
                string name=n.EndsWith(":latest")&&!n.StartsWith("gemma4")?n.Substring(0,n.Length-7):n;
                var rec=Recommended.FirstOrDefault(r=>r[0]==name);
                var item=Entry(panel,Pretty(name),Do(()=>ChooseModel(name)));
                Brush mc;string mem=MemoryText(name,out mc);
                ModelDescription(item,Pretty(name),name,rec!=null?rec[1]+" · "+rec[2]:OtherNote(name),mem,CapacityFits(name)==false,name);
                item.IsChecked=chosen==name||chosen+":latest"==n;
            }
        }
        var missing=Recommended.Where(r=>!Has(installed,r[0])).ToList();
        if(missing.Count>0){
            panel.Items.Add(new Separator());Heading(panel,"내려받기 (클릭하면 설치 후 자동 선택)");
            foreach(var r in missing){
                string name=r[0];string size=r[2];
                var item=Entry(panel,Pretty(name),pulling.Length>0?null:Do(async()=>{
                    if(await AskLocal("모델 내려받기",Pretty(name)+" ("+name+")을 내려받을까요?\n"+size+"\n\n내려받는 동안에도 앱은 계속 쓸 수 있고, 끝나면 이 모델로 자동으로 바뀝니다."))PullModel(name);
                }),pulling.Length>0?"다른 모델을 내려받는 중입니다.":"");
                Brush mc2;string mem2=MemoryText(name,out mc2);
                ModelDescription(item,"⬇  "+Pretty(name),name,r[1]+" · "+size,mem2,CapacityFits(name)==false,name);
            }
        }
        // 실행 방식: 자율(기본 · 2026-11-20부터) / 단순(OpenClaw 방식) / 기존(규칙·단계 확인이 많은 이전 방식)
        // 저장값: ""(또는 "autonomous") = 자율, "simple" = 단순, "legacy" = 기존. agent.mjs가 빈 값을 자율로 읽습니다.
        panel.Items.Add(new Separator());Heading(panel,"실행 방식");
        bool simple=prefs.loopMode=="simple",legacy=prefs.loopMode=="legacy";
        var autonomousItem=Entry(panel,"자율 (기본)",Do(()=>{prefs.loopMode="";SavePreferences();}));
        Description(autonomousItem,"자율 (기본)","모델이 필요한 도구만 골라 직접 호출하고 결과를 보고 다음 행동을 정함 · 빠름");autonomousItem.IsChecked=!simple&&!legacy;
        var simpleItem=Entry(panel,"단순 (OpenClaw 방식)",Do(()=>{prefs.loopMode="simple";SavePreferences();}));
        Description(simpleItem,"단순 (OpenClaw 방식)","모든 도구를 한 번에 주고 모델이 스스로 끝냄 · 웹 결과 화면 검사 포함");simpleItem.IsChecked=simple;
        var basic=Entry(panel,"기존 (규칙 기반)",Do(()=>{prefs.loopMode="legacy";SavePreferences();}));
        Description(basic,"기존 (규칙 기반)","계획·단계 확인·완료 검증이 많은 이전 방식");basic.IsChecked=legacy;
        panel.Items.Add(new Separator());
        Entry(panel,"설정에서 직접 입력…",Do(ShowPreferences));
        panel.IsOpen=true;
    }
    void PullModel(string name){
        pulling=name;pullPercent=-1;UpdateModelChip();status.Text=Pretty(name)+" 모델을 내려받는 중입니다…";
        Task.Run(()=>{
            string error=null;
            try{
                var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:11434/api/pull");
                req.Method="POST";req.ContentType="application/json";req.Timeout=60000;req.ReadWriteTimeout=600000;
                byte[] body=Encoding.UTF8.GetBytes(json.Serialize(new{model=name,stream=true}));
                using(var s=req.GetRequestStream())s.Write(body,0,body.Length);
                using(var res=req.GetResponse())using(var r=new StreamReader(res.GetResponseStream(),Encoding.UTF8)){
                    string line;
                    while((line=r.ReadLine())!=null){
                        if(line.Trim().Length==0)continue;
                        var m=json.Deserialize<Map>(line);
                        if(m.ContainsKey("error")){error=Convert.ToString(m["error"]);break;}
                        if(m.ContainsKey("total")&&m.ContainsKey("completed")){
                            double total=Convert.ToDouble(m["total"]),done=Convert.ToDouble(m["completed"]);
                            int pct=total>0?(int)(done*100/total):0;
                            if(pct!=pullPercent){pullPercent=pct;window.Dispatcher.BeginInvoke(new Action(UpdateModelChip));}
                        }
                    }
                }
            }catch(Exception x){error=x.Message;}
            window.Dispatcher.BeginInvoke(new Action(async()=>{
                string finished=pulling;pulling="";pullPercent=-1;
                if(error!=null){UpdateModelChip();status.Text="모델 내려받기 실패: "+error+" (Ollama가 켜져 있는지 확인하세요)";}
                else {nextCatalogUpdate=DateTime.MinValue;ChooseModel(finished);await RefreshModelCatalog();}
            }));
        });
    }

    // ===== 추론 수준 슬라이더 (ChatGPT 모델 선택 창처럼) =====
    // 단계가 높을수록 큰 모델 + 더 많은 작업 단계(끝까지 해결할 시간)를 씁니다.
    static readonly string[] EffortNames={"Light","Medium","High","Max"};
    static readonly string[] EffortKo={"가장 빠름 · 간단한 일","빠름 · 보통 일","똑똑함 · 더 빠른 쪽","가장 똑똑함 · 조금 느림"};
    static readonly string[] EffortModels={"qwen3.5:9b","gemma4:12b","gemma4:26b","qwen3.5:35b"};
    static readonly Color EffortBlue=Color.FromRgb(0x2F,0x6F,0xED);
    void EffortPopup(){if(BrainIndex()>=2){BrainMenu("Model");return;}ShowEffortPopup(Find<Button>("Model"),false);}
    async void ShowEffortPopup(Button anchor,bool beside){
        await RefreshModelStatus();
        NormalizeEffort();
        var installed=InstalledModels();
        var popup=new System.Windows.Controls.Primitives.Popup{PlacementTarget=anchor,Placement=beside?System.Windows.Controls.Primitives.PlacementMode.Right:System.Windows.Controls.Primitives.PlacementMode.Top,StaysOpen=false,AllowsTransparency=true,VerticalOffset=beside?-10:-6,HorizontalOffset=beside?2:-150};
        var card=new Border{Width=290,Padding=new Thickness(14,12,14,14),Margin=new Thickness(10),CornerRadius=new CornerRadius(18),Background=Brushes.White,BorderBrush=new SolidColorBrush(Color.FromRgb(0xE6,0xE8,0xEB)),BorderThickness=new Thickness(1)};
        card.Effect=new System.Windows.Media.Effects.DropShadowEffect{BlurRadius=18,ShadowDepth=3,Opacity=.16};
        var root=new StackPanel();card.Child=root;popup.Child=card;
        var top=new Grid();top.ColumnDefinitions.Add(new ColumnDefinition());top.ColumnDefinitions.Add(new ColumnDefinition{Width=GridLength.Auto});
        var title=new TextBlock{FontSize=17,FontWeight=FontWeights.SemiBold,Foreground=new SolidColorBrush(EffortBlue),VerticalAlignment=VerticalAlignment.Center,TextWrapping=TextWrapping.Wrap};
        var reset=new Button{Content="",FontFamily=new FontFamily("Segoe MDL2 Assets"),FontSize=14,Width=30,Height=30,Padding=new Thickness(0),ToolTip="자동으로 되돌리기"};
        Grid.SetColumn(reset,1);top.Children.Add(title);top.Children.Add(reset);root.Children.Add(top);
        var sub=new Button{HorizontalAlignment=HorizontalAlignment.Stretch,HorizontalContentAlignment=HorizontalAlignment.Left,Padding=new Thickness(0,2,0,2),ToolTip="모델 전체 목록"};
        var subText=new TextBlock{FontSize=13,Foreground=Brushes.DimGray,TextWrapping=TextWrapping.Wrap};var subRow=new DockPanel();var subArrow=ChevronLabel("",false,Brushes.DimGray,0);DockPanel.SetDock(subArrow,Dock.Right);subRow.Children.Add(subArrow);subRow.Children.Add(subText);sub.Content=subRow;
        var hint=new TextBlock{FontSize=13,Foreground=Brushes.DimGray,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,6,0,0)};
        var memLine=new TextBlock{FontSize=13,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,4,0,0)};
        root.Children.Add(sub);root.Children.Add(hint);root.Children.Add(memLine);
        // 아래쪽: 5칸 트랙 + 동그란 손잡이
        var track=new Border{Focusable=true,Height=34,CornerRadius=new CornerRadius(17),Background=new SolidColorBrush(Color.FromRgb(0xEC,0xEC,0xEE)),Margin=new Thickness(0,12,0,0),Cursor=System.Windows.Input.Cursors.Hand};
        var cells=new Grid();track.Child=cells;
        var thumbs=new List<System.Windows.Shapes.Ellipse>();
        for(int i=0;i<EffortNames.Length;i++){
            cells.ColumnDefinitions.Add(new ColumnDefinition());
            var cell=new Grid();Grid.SetColumn(cell,i);
            cell.Children.Add(new System.Windows.Shapes.Ellipse{Width=5,Height=5,Fill=Brushes.DarkGray,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center});
            var th=new System.Windows.Shapes.Ellipse{Width=32,Height=32,Fill=Brushes.White,Stroke=new SolidColorBrush(EffortBlue),StrokeThickness=3,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center,Visibility=Visibility.Hidden};
            cell.Children.Add(th);thumbs.Add(th);cells.Children.Add(cell);
        }
        root.Children.Add(track);
        int level=prefs.effort;
        if(level<0){int i=Array.IndexOf(EffortModels,prefs.model!=null&&prefs.model.Length>0?prefs.model:AutoPick(installed));level=i<0?1:i;}
        level=Math.Max(0,Math.Min(EffortModels.Length-1,level));
        Action<int,bool> show=(lv,isAuto)=>{
            for(int i=0;i<thumbs.Count;i++)thumbs[i].Visibility=i==lv?Visibility.Visible:Visibility.Hidden;
            bool custom=isAuto&&!String.IsNullOrEmpty(prefs.model);
            string m=isAuto?(custom?prefs.model:AutoPick(installed)):EffortModels[lv];
            title.Text=isAuto?(custom?"직접 고른 모델":"자동"):EffortNames[lv];
            subText.Text=Pretty(m)+(pulling==m?"  ⬇ "+(pullPercent<0?0:pullPercent)+"%":Has(installed,m)?"":"  · 내려받기 필요");
            Brush memColor;memLine.Text=MemoryText(m,out memColor);memLine.Foreground=memColor;
            double size=ModelGB(m);
            hint.Text="RAM "+HardwareSize(ramTotal)+" · VRAM "+HardwareSize(vramTotal)+"\n모델 필요 추정 "+Amount(size>0?(double?)(size+1.5):null)+"\n할당 여유 추정 "+Amount(availableMemory);
            hint.TextAlignment=TextAlignment.Left;
        };
        show(level,prefs.effort<0);
        bool dragging=false;
        Func<System.Windows.Input.MouseEventArgs,int> at=e=>{double x=e.GetPosition(track).X;int i=(int)(x/Math.Max(1,track.ActualWidth)*EffortNames.Length);return Math.Max(0,Math.Min(EffortNames.Length-1,i));};
        track.MouseLeftButtonDown+=(s,e)=>{dragging=true;track.CaptureMouse();level=at(e);show(level,false);};
        track.MouseMove+=(s,e)=>{if(!dragging)return;int i=at(e);if(i!=level){level=i;show(level,false);}};
        track.MouseLeftButtonUp+=(s,e)=>{if(!dragging)return;dragging=false;track.ReleaseMouseCapture();ApplyEffort(level,installed,popup);};
        System.Windows.Automation.AutomationProperties.SetName(track,"모델 단계");
        track.ToolTip="좌우 방향키로 단계 선택 · Enter로 적용";
        bool keyboardPreview=false;
        track.PreviewKeyDown+=(s,e)=>{
            var key=e.Key;
            if(key==System.Windows.Input.Key.Left || key==System.Windows.Input.Key.Right || key==System.Windows.Input.Key.Home || key==System.Windows.Input.Key.End){
                level=key==System.Windows.Input.Key.Home?0:key==System.Windows.Input.Key.End?EffortNames.Length-1:Math.Max(0,Math.Min(EffortNames.Length-1,level+(key==System.Windows.Input.Key.Left?-1:1)));
                keyboardPreview=true;show(level,false);e.Handled=true;
            }else if(key==System.Windows.Input.Key.Enter || key==System.Windows.Input.Key.Space){
                keyboardPreview=false;ApplyEffort(level,installed,popup);e.Handled=true;
            }
        };
        track.LostKeyboardFocus+=(s,e)=>keyboardPreview=false;
        root.PreviewKeyDown+=(s,e)=>{if(e.Key==System.Windows.Input.Key.Escape){popup.IsOpen=false;anchor.Focus();e.Handled=true;}};
        System.Windows.Input.KeyboardNavigation.SetTabNavigation(root,System.Windows.Input.KeyboardNavigationMode.Cycle);
        popup.Opened+=(s,e)=>{track.Focus();};
        reset.Click+=(s,e)=>{prefs.effort=-1;ChooseModel("");int i=Array.IndexOf(EffortModels,AutoPick(installed));level=i<0?1:i;show(level,true);};
        sub.Click+=(s,e)=>{popup.IsOpen=false;ModelMenu();};
        var monitor=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromSeconds(1)};
        monitor.Tick+=(s,e)=>{if(!dragging && !keyboardPreview){if(prefs.effort>=0)level=prefs.effort;show(level,prefs.effort<0);}};
        popup.Closed+=(s,e)=>monitor.Stop();monitor.Start();
        popup.IsOpen=true;
    }
    static bool GeminiInstalled(){
        string la=Environment.GetEnvironmentVariable("LOCALAPPDATA")??"";
        foreach(var f in new[]{Path.Combine(la,"Antigravity","agy.exe"),Path.Combine(la,"Antigravity","bin","agy.exe")})if(File.Exists(f))return true;
        foreach(var d in (Environment.GetEnvironmentVariable("PATH")??"").Split(';'))foreach(var n in new[]{"agy.exe","agy.cmd","gemini.cmd","gemini.exe"}){try{if(d.Length>0&&File.Exists(Path.Combine(d,n)))return true;}catch{}}
        return false;
    }
    // ===== 프로젝트 폴더 (바이브 코딩 대상) =====
    void UpdateProjectChip(){
        string d=prefs.projectDir??"";
        bool selected=Directory.Exists(d);
        string label=selected?new DirectoryInfo(d).Name:"프로젝트 선택";
        Find<TextBlock>("HomeProjectName").Text=label;
        Find<Button>("HomeProject").ToolTip=selected?d:"프로젝트 선택";
    }
    IEnumerable<string> ProjectChoices(){
        return new[]{prefs.projectDir}.Concat(prefs.recentProjects??new string[0])
            .Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase);
    }
    void SelectProject(string path){
        prefs.recentProjects=new[]{path}.Concat(ProjectChoices()).Where(Directory.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(30).ToArray();
        prefs.projectDir=path;
        SavePreferences();
        UpdateProjectChip();
        status.Text="";
    }
    void ProjectMenu(){
        var home=Find<Button>("HomeProject");
        if(!home.IsVisible)return;
        var panel=Panel(home,280);
        var search=new TextBox{ToolTip="프로젝트 검색",MinWidth=210,Padding=new Thickness(5)};
        Heading(panel,"프로젝트 검색");
        panel.Items.Add(new MenuItem{Header=search,StaysOpenOnClick=true,Focusable=false});
        var rows=new List<MenuItem>();
        foreach(string path in ProjectChoices()){
            rows.Add(Entry(panel,new DirectoryInfo(path).Name,Do(()=>SelectProject(path)),path,
                String.Equals(path,prefs.projectDir,StringComparison.OrdinalIgnoreCase)?"✓":""));
        }
        search.TextChanged+=(s,e)=>{foreach(var row in rows)row.Visibility=((string)row.ToolTip).IndexOf(search.Text,StringComparison.OrdinalIgnoreCase)>=0?Visibility.Visible:Visibility.Collapsed;};
        panel.Items.Add(new Separator());
        Entry(panel,"＋  새 프로젝트",Do(()=>{
            {var dlg=new CardPicker{Folder=true,Title="프로젝트 폴더를 선택하거나 새로 만드세요",InitialDirectory=prefs.projectDir??""};
                if(dlg.ShowDialog(window)==true)SelectProject(dlg.FileName);
            }
        }));
        if(Directory.Exists(prefs.projectDir))
            Entry(panel,"탐색기에서 열기",Do(()=>System.Diagnostics.Process.Start("explorer.exe","\""+prefs.projectDir+"\"")));
        Entry(panel,"프로젝트 없이 작업하기",Do(()=>SelectProject("")),"기본 작업공간 사용",Directory.Exists(prefs.projectDir)?"":"✓");
        panel.IsOpen=true;
    }
    static int EffortSteps(int lv){int[] steps={25,30,40,60};return steps[Math.Max(0,Math.Min(3,lv))];}
    async void ApplyEffort(int lv,List<string> installed,System.Windows.Controls.Primitives.Popup popup){
        string m=EffortModels[lv];
        if(!Has(installed,m)){
            if(pulling.Length>0){status.Text="다른 모델을 내려받는 중입니다. 끝난 뒤 다시 골라 주세요.";return;}
            var rec=Recommended.FirstOrDefault(r=>r[0]==m);
            popup.IsOpen=false;
            if(await AskLocal("모델 내려받기",EffortNames[lv]+" 단계는 "+Pretty(m)+" ("+m+") 모델을 씁니다.\n"+(rec!=null?rec[2]:"")+"\n\n지금 내려받을까요? 내려받는 동안에도 앱은 계속 쓸 수 있고, 끝나면 이 단계로 자동으로 바뀝니다.")){prefs.effort=lv;PullModel(m);}
            return;
        }
        prefs.effort=lv;ChooseModel(m);
    }
}
