using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Input;
using Map=System.Collections.Generic.Dictionary<string,object>;

partial class DesktopChat {
    Border railView;
    string railName="";
    static readonly string[] services={"Cloud Environment","GitHub","Gmail","Google Calendar","Google Contacts","Google Drive","Notion","Plugin Creator","Writing Style"};
    string BaseDir {get{return AppDomain.CurrentDomain.BaseDirectory;}}
    string SpaceDir {get{return String.IsNullOrWhiteSpace(prefs.projectDir)?Path.Combine(BaseDir,"작업공간"):prefs.projectDir;}}
    void CloseRailPage(){if(railView!=null)Find<Grid>("Workspace").Children.Remove(railView);railView=null;railName="";PaintRail();}
    void MountRail(string name,UIElement content,bool full){
        CloseRailPage();railName=name;PaintRail();
        railView=new Border{Child=content,Background=Brushes.White,BorderBrush=Brushes.Gainsboro,BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(full?0:9),Width=full?double.NaN:284,HorizontalAlignment=full?HorizontalAlignment.Stretch:HorizontalAlignment.Left};
        Grid.SetColumn(railView,1);Grid.SetColumnSpan(railView,3);System.Windows.Controls.Panel.SetZIndex(railView,9);Find<Grid>("Workspace").Children.Add(railView);
        railView.PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape){CloseRailPage();e.Handled=true;}};
    }
    Button RailButton(string text,Action act){
        var b=new Button{Content=text,HorizontalContentAlignment=HorizontalAlignment.Left,Padding=new Thickness(8,5,8,5),MinHeight=31,ToolTip=text};
        b.Click+=(s,e)=>act();return b;
    }
    static StackPanel ChevronLabel(string label,bool down,Brush ink,double inset=11){
        var row=new StackPanel{Orientation=Orientation.Horizontal,Margin=new Thickness(inset,0,inset,0),VerticalAlignment=VerticalAlignment.Center};
        row.Children.Add(new TextBlock{Text=label,Foreground=ink,VerticalAlignment=VerticalAlignment.Center});
        var icon=new System.Windows.Shapes.Path{
            Data=Geometry.Parse(down?"M1,3 L5,7 L9,3":"M3,1 L7,5 L3,9"),Width=10,Height=10,
            Stroke=ink,StrokeThickness=1.5,StrokeLineJoin=PenLineJoin.Round,
            StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,
            Margin=new Thickness(6,0,0,0),VerticalAlignment=VerticalAlignment.Center};
        row.Children.Add(icon);return row;
    }
    TextBlock RailLabel(string text,int size=13){return new TextBlock{Text=text,FontSize=size,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(8,7,8,5)};}
    void ComposeRail(string message){CloseRailPage();input.SelectedText=message;input.Focus();input.CaretIndex=input.Text.Length;}
    void ShowFile(string f){try{Process.Start(new ProcessStartInfo(f){UseShellExecute=true});}catch(Exception e){CardNotice.Show(window,e.Message);}}
    string PluginIcon(string name){
        var slug=name=="Writing Style"?"write-like-me":name.ToLowerInvariant().Replace(" ","-");
        var dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".codex","plugins","cache","openai-curated-remote",slug);
        if(!Directory.Exists(dir))return null;
        return Directory.GetDirectories(dir).OrderByDescending(Directory.GetLastWriteTimeUtc).Select(v=>Path.Combine(v,"assets")).Where(Directory.Exists).SelectMany(v=>Directory.GetFiles(v,"*.png")).FirstOrDefault();
    }
    Button ServiceButton(string name,Action act){
        var b=RailButton(name,act);var row=new StackPanel{Orientation=Orientation.Horizontal};
        var f=PluginIcon(name);if(f!=null){try{row.Children.Add(new Image{Source=new BitmapImage(new Uri(f)),Width=15,Height=15});}catch{}}
        row.Children.Add(new TextBlock{Text=name,Margin=new Thickness(9,0,0,0)});b.Content=row;System.Windows.Automation.AutomationProperties.SetName(b,name);return b;
    }
    void PluginDirectory(string initial){
        var frame=new DockPanel{Margin=new Thickness(22),MaxWidth=840};
        var header=new DockPanel();DockPanel.SetDock(header,Dock.Top);frame.Children.Add(header);
        var tabs=new WrapPanel();var query=new TextBox{MinHeight=30,Margin=new Thickness(4,8,4,8),ToolTip="이름 또는 설명 검색"};
        var statusLine=RailLabel("");var rows=new StackPanel();
        var scroll=new ScrollViewer{Content=rows,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
        var cache=new Dictionary<string,List<Map>>();var selectors=new Dictionary<string,Button>();
        string tab="플러그인";int visible=50,version=0;
        Action render=null;Func<string,System.Threading.Tasks.Task> load=null;
        render=()=>{
            rows.Children.Clear();List<Map> data;if(!cache.TryGetValue(tab,out data))return;
            string term=query.Text.Trim();
            var matches=data.Where(x=>(Convert.ToString(x["name"])+" "+Convert.ToString(x["description"])).IndexOf(term,StringComparison.CurrentCultureIgnoreCase)>=0).ToList();
            statusLine.Text=matches.Count+"개"+(term.Length>0?" 검색됨":"");
            foreach(var x in matches.Take(visible)){
                var line=new DockPanel{Margin=new Thickness(4,2,4,2)};
                string title=Convert.ToString(x["name"]),note=Convert.ToString(x["description"]),kind=tab;
                if(kind=="플러그인"||kind=="디렉터리"){
                    bool install=kind=="디렉터리",enabled=Convert.ToBoolean(x["enabled"]);
                    var action=RailButton(install?"추가":enabled?"켜짐":"꺼짐",()=>{});
                    action.ToolTip=install?"플러그인 설치":"플러그인 사용 전환";DockPanel.SetDock(action,Dock.Right);line.Children.Add(action);
                    action.Click+=async(s,e)=>{
                        if(install && CardNotice.Show(window,title+" 브라우저 도구를 로컬 에이전트에 추가할까요?","플러그인 추가",MessageBoxButton.OKCancel)!=MessageBoxResult.OK)return;
                        frame.IsEnabled=false;
                        try{await Rpc("pluginManager",json.Serialize(new{tab=kind,id=x["id"],action=install?"install":"toggle",enable=!enabled}));
                            cache.Remove("디렉터리");cache.Remove("플러그인");await load(install?"플러그인":kind);
                        }catch(Exception ex){statusLine.Text=ex.Message;}finally{frame.IsEnabled=true;}
                    };
                }
                var details=ServiceButton(title,()=>{
                    if(kind=="앱"&&x.ContainsKey("slug")&&String.Equals(Convert.ToString(x["slug"]),"gmail",StringComparison.OrdinalIgnoreCase))GmailAppDetails();
                    else CardNotice.Show(window,Convert.ToString(x["detail"])+"\n"+note,title);
                });
                var labels=new StackPanel();labels.Children.Add(details);
                if(note.Length>0)labels.Children.Add(new TextBlock{Text=note,TextTrimming=TextTrimming.CharacterEllipsis,Foreground=Brushes.Gray,Margin=new Thickness(10,0,4,5),ToolTip=note});
                line.Children.Add(labels);rows.Children.Add(line);rows.Children.Add(new Separator());
            }
            if(matches.Count>visible)rows.Children.Add(RailButton("더 보기",()=>{visible+=50;render();}));
        };
        load=async target=>{
            int current=++version;tab=target;visible=50;rows.Children.Clear();scroll.ScrollToTop();
            foreach(var pair in selectors)pair.Value.FontWeight=pair.Key==target?FontWeights.Bold:FontWeights.Normal;
            if(!cache.ContainsKey(target)){
                statusLine.Text=target+" 불러오는 중…";
                try{var result=(Map)await Rpc("pluginManager",json.Serialize(new{tab=target}));
                    if(current!=version)return;
                    cache[target]=((object[])result["rows"]).Cast<Map>().ToList();
                    if(selectors.ContainsKey(target))selectors[target].Content=target+" "+cache[target].Count;
                }catch(Exception ex){if(current==version){statusLine.Text=ex.Message;rows.Children.Add(RailButton("다시 시도",async()=>await load(target)));}return;}
            }
            render();
        };
        var close=RailButton("닫기",CloseRailPage);DockPanel.SetDock(close,Dock.Right);header.Children.Add(close);
        var directory=RailButton("디렉터리 찾아보기",async()=>await load("디렉터리"));DockPanel.SetDock(directory,Dock.Right);header.Children.Add(directory);
        var add=RailButton("＋ 추가",async()=>await load("디렉터리"));DockPanel.SetDock(add,Dock.Right);header.Children.Add(add);
        header.Children.Add(RailLabel("플러그인",24));
        foreach(var key in new[]{"플러그인","앱","MCP","스킬"}){var b=RailButton(key,async()=>await load(key));selectors[key]=b;tabs.Children.Add(b);}
        foreach(var element in new UIElement[]{RailLabel("연결된 Codex의 플러그인, 앱, MCP 및 스킬 관리"),tabs,query,statusLine}){DockPanel.SetDock(element,Dock.Top);frame.Children.Add(element);}
        query.TextChanged+=(s,e)=>{visible=50;render();};System.Windows.Automation.AutomationProperties.SetName(query,"플러그인 검색");
        frame.Children.Add(scroll);MountRail("플러그인",frame,true);var initialLoad=load(initial);
    }
    void GmailAppDetails(){
        var shell=new DockPanel{Background=Brushes.White};
        var header=new DockPanel{Margin=new Thickness(22,16,22,10)};
        var back=RailButton("‹ 앱 목록",()=>PluginDirectory("앱"));DockPanel.SetDock(back,Dock.Left);header.Children.Add(back);
        var close=RailButton("닫기",CloseRailPage);DockPanel.SetDock(close,Dock.Right);header.Children.Add(close);
        header.Children.Add(RailLabel("Gmail",24));DockPanel.SetDock(header,Dock.Top);shell.Children.Add(header);
        var page=new StackPanel{MaxWidth=760,Margin=new Thickness(34,12,34,32)};
        var scroll=new ScrollViewer{Content=page,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled};
        shell.Children.Add(scroll);MountRail("Gmail",shell,true);

        var summary=new TextBlock{TextWrapping=TextWrapping.Wrap,FontSize=14,Foreground=Tone(88),Margin=new Thickness(9,0,9,16)};
        page.Children.Add(summary);
        var stateCard=new Border{Background=Tone(248),BorderBrush=Tone(225),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(12),Padding=new Thickness(16),Margin=new Thickness(0,0,0,14)};
        var statePanel=new StackPanel();
        var state=new TextBlock{Text="연결 상태 확인 중…",FontSize=16,FontWeight=FontWeights.SemiBold,Foreground=Tone(35)};
        var account=new TextBlock{Text="계정 정보를 확인하고 있습니다.",Foreground=Tone(99),Margin=new Thickness(0,7,0,0),TextWrapping=TextWrapping.Wrap};
        statePanel.Children.Add(state);statePanel.Children.Add(account);stateCard.Child=statePanel;page.Children.Add(stateCard);
        var instructions=new TextBlock{Text="처음 연결할 때는 Gmail 연결을 눌러 Google 계정 승인을 완료하세요. 돌아온 뒤 새로고침을 누르면 실제 연결 상태를 확인합니다. 이 앱에 Google 비밀번호나 API 키를 입력할 필요는 없습니다.",TextWrapping=TextWrapping.Wrap,Foreground=Tone(89),Margin=new Thickness(8,0,8,14)};
        page.Children.Add(instructions);
        var error=new TextBlock{Foreground=new SolidColorBrush(Color.FromRgb(170,48,44)),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(8,0,8,10)};
        page.Children.Add(error);
        var actions=new WrapPanel{Margin=new Thickness(0,0,0,20)};
        var connect=RailButton("Gmail 연결",()=>{});connect.Margin=new Thickness(0,0,8,0);connect.Background=Tone(28);connect.Foreground=Brushes.White;actions.Children.Add(connect);
        var toggle=RailButton("사용 켜기",()=>{});toggle.Margin=new Thickness(0,0,8,0);actions.Children.Add(toggle);
        var refresh=RailButton("새로고침",()=>{});actions.Children.Add(refresh);page.Children.Add(actions);
        var capabilities=new StackPanel();var capabilitiesTitle=RailLabel("제공 기능",17);capabilitiesTitle.FontWeight=FontWeights.SemiBold;page.Children.Add(capabilitiesTitle);page.Children.Add(capabilities);
        var suggestionsTitle=RailLabel("추천 요청",17);suggestionsTitle.FontWeight=FontWeights.SemiBold;suggestionsTitle.Margin=new Thickness(8,20,8,7);page.Children.Add(suggestionsTitle);
        var suggestions=new StackPanel();page.Children.Add(suggestions);
        Map details=null;int version=0;
        Func<Task> load=null;
        load=async()=>{
            int current=++version;refresh.IsEnabled=false;connect.IsEnabled=false;toggle.IsEnabled=false;error.Text="";state.Text="연결 상태 확인 중…";
            try{
                details=(Map)await Rpc("pluginManager",json.Serialize(new{source="codex",tab="앱",slug="gmail",action="details"}));
                if(current!=version)return;
                string description=details.ContainsKey("description")?Convert.ToString(details["description"]):"";
                summary.Text=description;
                bool installed=details.ContainsKey("installed")&&Equals(details["installed"],true);
                bool enabled=details.ContainsKey("enabled")&&Equals(details["enabled"],true);
                bool connected=details.ContainsKey("connected")&&Equals(details["connected"],true);
                bool available=details.ContainsKey("available")&&Equals(details["available"],true);
                string url=details.ContainsKey("url")?Convert.ToString(details["url"]):"";
                state.Text=!installed?"Gmail 플러그인 추가 필요":!enabled?"플러그인 사용 꺼짐":connected?"Gmail 연결됨":"Gmail 연결 필요";
                account.Text=available?"계정 정보를 불러오는 중…":"계정 정보는 연결 후 표시됩니다.";
                connect.Content=connected?"연결 관리":installed?"Gmail 연결":"플러그인 추가 및 연결";
                connect.Visibility=url.Length>0?Visibility.Visible:Visibility.Collapsed;
                connect.IsEnabled=url.Length>0;
                toggle.Visibility=installed?Visibility.Visible:Visibility.Collapsed;
                toggle.Content=enabled?"사용 끄기":"사용 켜기";
                toggle.IsEnabled=installed;
                var tools=details.ContainsKey("tools")?details["tools"] as object[]:null;
                capabilities.Children.Clear();
                if(tools==null||tools.Length==0)capabilities.Children.Add(RailLabel("현재 제공되는 Gmail 도구가 없습니다."));
                else foreach(object item in tools){
                    var tool=item as Map;if(tool==null)continue;
                    string toolName=tool.ContainsKey("name")?Convert.ToString(tool["name"]):"";
                    string toolDescription=tool.ContainsKey("description")?Convert.ToString(tool["description"]):"";
                    var row=new StackPanel{Margin=new Thickness(8,3,8,7)};
                    row.Children.Add(new TextBlock{Text=toolName,FontWeight=FontWeights.SemiBold,Foreground=Tone(47)});
                    if(toolDescription.Length>0)row.Children.Add(new TextBlock{Text=toolDescription,Foreground=Tone(106),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,2,0,0)});
                    capabilities.Children.Add(row);
                }
                suggestions.Children.Clear();
                var prompts=details.ContainsKey("suggestions")?details["suggestions"] as object[]:null;
                if(prompts==null||prompts.Length==0)suggestions.Children.Add(RailLabel("추천 요청을 불러오지 못했습니다."));
                else foreach(object item in prompts){
                    string prompt=Convert.ToString(item);
                    var button=RailButton(prompt,()=>ComposeRail(prompt));button.Margin=new Thickness(0,2,0,6);button.Padding=new Thickness(12,9,12,9);button.HorizontalContentAlignment=HorizontalAlignment.Left;
                    System.Windows.Automation.AutomationProperties.SetName(button,"채팅에 요청 작성: "+prompt);suggestions.Children.Add(button);
                }
                if(available){
                    try{
                        var profile=(Map)await Rpc("gmailConnection");
                        string address=profile.ContainsKey("account")?Convert.ToString(profile["account"]):"";
                        account.Text=String.IsNullOrWhiteSpace(address)?"계정 정보를 제공하지 않습니다.":address;
                    }catch(Exception ex){account.Text="계정 정보를 확인하지 못했습니다.";error.Text=ex.Message;}
                }
            }catch(Exception ex){
                if(current==version){details=null;state.Text="연결 상태를 확인하지 못했습니다.";account.Text="계정 정보가 확인되지 않았습니다.";error.Text=ex.Message;connect.Visibility=Visibility.Collapsed;toggle.Visibility=Visibility.Collapsed;}
            }finally{if(current==version)refresh.IsEnabled=true;}
        };
        refresh.Click+=async(s,e)=>await load();
        connect.Click+=async(s,e)=>{
            if(details==null)return;
            connect.IsEnabled=false;error.Text="";
            try{
                string url=details.ContainsKey("url")?Convert.ToString(details["url"]):"";
                if(!Equals(details["installed"],true)){
                    await Rpc("pluginManager",json.Serialize(new{source="codex",tab="앱",id=details["id"],action="install"}));
                    await load();
                    if(details!=null&&details.ContainsKey("url"))url=Convert.ToString(details["url"]);
                }
                if(url.Length==0)throw new InvalidOperationException("Gmail 연결 주소를 제공하지 않습니다.");
                ShowFile(url);
                error.Text="브라우저에서 Google 승인을 마친 뒤 돌아와 새로고침을 눌러 주세요.";
            }catch(Exception ex){error.Text=ex.Message;}finally{connect.IsEnabled=true;}
        };
        toggle.Click+=async(s,e)=>{
            if(details==null)return;
            toggle.IsEnabled=false;error.Text="";
            try{
                bool enabled=details.ContainsKey("enabled")&&Equals(details["enabled"],true);
                await Rpc("pluginManager",json.Serialize(new{source="codex",tab="앱",id=details["id"],action="toggle",enable=!enabled}));
                await load();
            }catch(Exception ex){error.Text=ex.Message;toggle.IsEnabled=true;}
        };
        load();
    }
    void RailPage(string name){
        if(railName==name){CloseRailPage();return;}
        var dock=new DockPanel{Margin=new Thickness(8)};var head=new DockPanel();
        var search=RailButton("⌕",()=>{});search.ToolTip="검색";DockPanel.SetDock(search,Dock.Right);head.Children.Add(search);
        var title=RailLabel(name,17);title.FontWeight=FontWeights.SemiBold;head.Children.Add(title);DockPanel.SetDock(head,Dock.Top);dock.Children.Add(head);
        var query=new TextBox{Visibility=Visibility.Collapsed,Margin=new Thickness(5),ToolTip="메뉴 검색"};DockPanel.SetDock(query,Dock.Top);dock.Children.Add(query);
        var rows=new StackPanel();dock.Children.Add(new ScrollViewer{Content=rows,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});
        string section="",filter="";bool more=false,paused=false;
        Action draw=null;
        draw=()=>{
            rows.Children.Clear();
            Func<string,bool> match=t=>t.IndexOf(query.Text,StringComparison.CurrentCultureIgnoreCase)>=0;
            Action<string,Action> item=(t,a)=>{if(match(t))rows.Children.Add(RailButton(t,a));};
            Action<string> label=t=>{var l=RailLabel(t);l.Foreground=Brushes.Gray;l.Margin=new Thickness(8,18,8,6);rows.Children.Add(l);};
            Action<string> navigate=t=>{section=t;query.Clear();draw();};
            if(section!="")item("‹  "+name,()=>navigate(""));
            if(name=="맞춤 설정"){
                if(section=="스킬"){ShowPreferences("스킬");section="";draw();return;}
                if(section!="플러그인" && section!=""){label(section);
                    if(section=="Gmail"){
                        item("연결·계정 상세",GmailAppDetails);
                        item("채팅에 요청 작성",()=>ComposeRail("Gmail 도구로 "));
                        return;
                    }
                    item("채팅에 요청 작성",()=>ComposeRail(section+" 도구로 "));return;}
                if(section==""){item("◎   플러그인",OpenPluginManager);item("⬡   스킬",()=>navigate("스킬"));}
                
            }else if(name=="스페이스"){
                if(section==""){item("＋   생성",()=>ComposeRail("작업공간에 새 파일을 만들어줘. "));
                    foreach(string group in new[]{"전체","페이지","슬라이드","Sites","이미지"})item("▧   "+group,()=>navigate(group));
                    item("△   Google Drive",()=>ComposeRail("Google Drive에서 파일을 찾아줘. "));}
                label(section==""?"최근":section);
                var extensions=new Dictionary<string,string[]>{{"페이지",new[]{".md",".docx",".pdf",".txt"}},{"슬라이드",new[]{".pptx",".ppt"}},{"Sites",new[]{".html",".htm"}},{"이미지",new[]{".png",".jpg",".jpeg",".webp",".gif"}}};
                if(Directory.Exists(SpaceDir)){
                    var files=new DirectoryInfo(SpaceDir).EnumerateFiles().Where(f=>(!extensions.ContainsKey(section)||extensions[section].Contains(f.Extension.ToLowerInvariant())) && match(f.Name)).OrderByDescending(f=>f.LastWriteTimeUtc).ToList();
                    foreach(var f in files.Take(section==""&&!more?5:int.MaxValue))item("▤   "+f.Name,()=>ShowFile(f.FullName));
                    if(!more && section=="" && files.Count>5)item("더 보기",()=>{more=true;draw();});
                }
                if(section==""){label("스페이스");item(Path.GetFileName(SpaceDir),()=>ShowFile(SpaceDir));}
            }else{
                item("＋   새 작업",()=>ComposeRail("예약 작업을 추가해줘. 시간과 할 일은 "));
                var f=Path.Combine(BaseDir,"기억","예약작업.json");
                var tasks=File.Exists(f)?json.Deserialize<List<Map>>(File.ReadAllText(f)):new List<Map>();
                foreach(var group in new[]{"활성","일시 정지됨","완료"}){
                    if(filter!=""&&filter!=group)continue;
                    if(group=="일시 정지됨"){if(match(group)){var toggle=RailButton(group,()=>{paused=!paused;draw();});toggle.Content=ChevronLabel(group,paused,toggle.Foreground,0);toggle.HorizontalContentAlignment=HorizontalAlignment.Center;rows.Children.Add(toggle);}}else label(group);
                    if(group=="일시 정지됨"&&!paused)continue;
                    foreach(var t in tasks){
                        var sched=(Map)t["schedule"];string kind=Convert.ToString(sched["type"]);
                        string state=Convert.ToBoolean(t["enabled"])?"활성":kind=="once"&&t["lastRun"]!=null?"완료":"일시 정지됨";
                        if(state!=group)continue;
                        string when=kind=="every"?sched["minutes"]+"분마다":kind=="once"?Convert.ToDateTime(sched["at"]).ToLocalTime().ToString("g"):(kind=="weekly"?"매주 "+"일월화수목금토"[Convert.ToInt32(sched["dow"])]+"요일":"매일")+String.Format(" {0:00}:{1:00}",sched["h"],sched["min"]);
                        item(t["name"]+"\n"+when,()=>CardNotice.Show(window,Convert.ToString(t["prompt"]),Convert.ToString(t["name"])));
                    }
                }
            }
        };
        if(name=="예약"){var filters=RailButton("≡",()=>{});filters.ToolTip="예약 필터";DockPanel.SetDock(filters,Dock.Right);head.Children.Insert(1,filters);filters.Click+=(s,e)=>{var menu=new ContextMenu();foreach(var t in new[]{"전체","활성","일시 정지됨","완료"}){var m=new MenuItem{Header=t};m.Click+=(a,b)=>{filter=t=="전체"?"":t;draw();};menu.Items.Add(m);}menu.PlacementTarget=filters;menu.IsOpen=true;};}
        if(name=="스페이스"){var notices=RailButton("♧",()=>RailPage("예약"));notices.ToolTip="예약 보기";DockPanel.SetDock(notices,Dock.Right);head.Children.Insert(1,notices);}
        search.Click+=(s,e)=>{query.Visibility=query.IsVisible?Visibility.Collapsed:Visibility.Visible;if(query.IsVisible)query.Focus();else query.Clear();};
        query.TextChanged+=(s,e)=>draw();MountRail(name,dock,false);draw();
    }
    int profileGeneration;
    async void ProfilePage(){
        if(railName=="프로필"){CloseRailPage();return;}
        int generation=++profileGeneration;
        MountRail("프로필",new TextBlock{Text="프로필 기록을 읽고 있습니다…",Margin=new Thickness(24)},true);
        var days=new SortedDictionary<DateTime,long>();long inputTokens=0,outputTokens=0,peak=0;
        var levels=new Dictionary<string,int>();
        var usage=Path.Combine(BaseDir,"기억","토큰");
        long maxSec=0;
        try{await Task.Run(()=>{
        var reader=new System.Web.Script.Serialization.JavaScriptSerializer{MaxJsonLength=16777216};
        if(Directory.Exists(usage))foreach(var file in Directory.GetFiles(usage,"*.jsonl"))foreach(string line in File.ReadLines(file)){
            try{var entry=reader.Deserialize<Map>(line);long i=Convert.ToInt64(entry["input"]),o=Convert.ToInt64(entry["output"]);
                var day=DateTimeOffset.Parse((string)entry["date"]).LocalDateTime.Date;
                object model;if(entry.TryGetValue("model",out model)){int level=Array.IndexOf(EffortModels,Convert.ToString(model).Replace(":latest",""));if(level>=0){string key=EffortNames[level];if(!levels.ContainsKey(key))levels[key]=0;levels[key]++;}}
                if(!days.ContainsKey(day))days[day]=0;days[day]+=i+o;inputTokens+=i;outputTokens+=o;peak=Math.Max(peak,i+o);
            }catch(ArgumentException){}catch(FormatException){}
        }
        var history=Path.Combine(BaseDir,"대화기록");
        if(Directory.Exists(history))foreach(var f in Directory.GetFiles(history,"*.json")){
            try{var turns=reader.Deserialize<List<Map>>(File.ReadAllText(f));foreach(var t in turns)if(t.ContainsKey("seconds"))maxSec=Math.Max(maxSec,Convert.ToInt64(t["seconds"]));}catch(ArgumentException){}catch(InvalidOperationException){}catch(IOException){}
        }
        });}catch(Exception error){if(!closed&&generation==profileGeneration)status.Text="프로필 기록을 읽지 못했습니다: "+error.Message;return;}
        if(closed||generation!=profileGeneration||railName!="프로필")return;
        int longest=0,streak=0;DateTime prev=DateTime.MinValue;
        foreach(var d in days.Keys){streak=d==prev.AddDays(1)?streak+1:1;longest=Math.Max(longest,streak);prev=d;}
        var frame=new DockPanel{Background=Brushes.White};var top=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};
        top.Children.Add(RailButton("✎  수정",()=>ShowPreferences("개인 맞춤 설정")));top.Children.Add(RailLabel("♙  비공개"));DockPanel.SetDock(top,Dock.Top);frame.Children.Add(top);
        var page=new StackPanel{MaxWidth=736,Margin=new Thickness(24,95,24,50)};
        var photo=new Border{Width=64,Height=64,CornerRadius=new CornerRadius(32),HorizontalAlignment=HorizontalAlignment.Center,
            Background=new SolidColorBrush(Color.FromRgb(186,73,57)),Child=new TextBlock{Text=Find<TextBlock>("ProfileInitials").Text,
            Foreground=Brushes.White,FontSize=22,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center}};
        ApplyBadge(photo);page.Children.Add(photo);
        var changePhoto=RailButton("사진 변경",()=>ChooseProfilePhoto(photo));
        changePhoto.HorizontalAlignment=HorizontalAlignment.Center;page.Children.Add(changePhoto);
        var name=RailLabel(String.IsNullOrWhiteSpace(prefs.nickname)?"로컬 Gemma":prefs.nickname,24);name.HorizontalAlignment=HorizontalAlignment.Center;name.FontWeight=FontWeights.SemiBold;page.Children.Add(name);
        var sub=RailLabel("로컬 프로필");sub.HorizontalAlignment=HorizontalAlignment.Center;sub.Foreground=Brushes.Gray;page.Children.Add(sub);
        var strip=new UniformGrid{Rows=1};var values=new[]{(inputTokens+outputTokens).ToString("N0"),peak.ToString("N0"),maxSec==0?"—":ElapsedLabel(maxSec),longest+"일",(prev>=DateTime.Today.AddDays(-1)?streak:0)+"일"};
        var labels=new[]{"누적 토큰","최대 토큰 수","최장 작업","최장 연속 기록","현재 연속 기록"};
        for(int k=0;k<labels.Length;k++){var t=RailLabel(values[k]+"\n"+labels[k]);t.TextAlignment=TextAlignment.Center;strip.Children.Add(t);}
        var box=new Border{Child=strip,CornerRadius=new CornerRadius(14),BorderThickness=new Thickness(1),BorderBrush=Brushes.Gainsboro,Margin=new Thickness(0,25,0,4)};page.Children.Add(box);
        page.Children.Add(RailLabel("로컬 모델 입력 "+inputTokens.ToString("N0")+" · 출력 "+outputTokens.ToString("N0")+"  |  "+(days.Count==0?"집계 시작 후 기록 없음":days.Keys.First().ToString("yyyy.MM.dd")+"부터 집계")));
        page.Children.Add(ProfileHeading("주요 작품"));
        var feature=new StackPanel{VerticalAlignment=VerticalAlignment.Center,HorizontalAlignment=HorizontalAlignment.Center};
        if(File.Exists(prefs.featuredFile))feature.Children.Add(RailButton(Path.GetFileName(prefs.featuredFile),()=>ShowFile(prefs.featuredFile)));
        var sites=Directory.Exists(SpaceDir)?new DirectoryInfo(SpaceDir).EnumerateFiles().Where(x=>x.Extension.Equals(".html",StringComparison.OrdinalIgnoreCase)||x.Extension.Equals(".htm",StringComparison.OrdinalIgnoreCase)).OrderByDescending(x=>x.LastWriteTimeUtc).ToList():new List<FileInfo>();
        if(!File.Exists(prefs.featuredFile)){
            var cards=new Grid{Height=62,Width=175,HorizontalAlignment=HorizontalAlignment.Center};
            for(int n=0;n<Math.Min(3,sites.Count);n++){
                var preview=new StackPanel{Margin=new Thickness(6)};preview.Children.Add(new TextBlock{Text=sites[n].Name,FontSize=8,TextTrimming=TextTrimming.CharacterEllipsis});
                for(int line=0;line<3;line++)preview.Children.Add(new Border{Background=Brushes.Gainsboro,Height=2,Width=38-line*6,HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,4,0,0)});
                var card=new Border{Width=76,Height=52,Child=preview,Background=Brushes.White,BorderBrush=Brushes.Gainsboro,BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(4),RenderTransformOrigin=new Point(.5,.5),RenderTransform=new RotateTransform((n-1)*6),Margin=new Thickness((n-(Math.Min(3,sites.Count)-1)/2.0)*46,0,0,0)};
                cards.Children.Add(card);
            }
            if(sites.Count>0)feature.Children.Add(cards);
            var note=RailLabel(sites.Count>0?"소개할 수 있는 사이트가 "+sites.Count+"개 있습니다":"소개할 작품을 선택하세요");note.Foreground=Brushes.Gray;feature.Children.Add(note);
        }
        var add=RailButton(File.Exists(prefs.featuredFile)?"작품 변경":"프로필에 추가",()=>{var picker=new CardPicker{Title="프로필에 표시할 작품 선택",InitialDirectory=SpaceDir};if(picker.ShowDialog(window)==true){prefs.featuredFile=picker.FileName;SavePreferences();CloseRailPage();ProfilePage();}});
        add.HorizontalAlignment=HorizontalAlignment.Center;add.Style=(Style)window.FindResource("RoundSend");add.Content=ChevronLabel((string)add.Content,false,Brushes.White);add.Height=36;add.Padding=new Thickness(0);add.Background=Brushes.Black;add.Foreground=Brushes.White;feature.Children.Add(add);
        page.Children.Add(new Border{Child=feature,Height=255,Background=new SolidColorBrush(Color.FromRgb(248,248,248)),CornerRadius=new CornerRadius(14),Margin=new Thickness(0,8,0,16)});
        AddActivityCalendar(page,days);
        page.Children.Add(ProfileHeading("인기 플러그인"));
        var plugins=new WrapPanel();foreach(string p in new[]{"Google Drive","Google Calendar","Gmail","Cloud Environment","Notion"}){
            var action=RailButton(p,()=>ComposeRail(p+" 도구로 "));action.ToolTip=p;action.Padding=new Thickness(8);action.HorizontalContentAlignment=HorizontalAlignment.Center;
            var icon=PluginIcon(p);
            if(icon!=null)action.Content=new Image{Source=new BitmapImage(new Uri(icon)),Width=32,Height=32};
            else action.Content=p.Substring(0,1);
            System.Windows.Automation.AutomationProperties.SetName(action,p);
            plugins.Children.Add(new Border{Child=action,Width=56,Height=56,Margin=new Thickness(0,0,14,0),CornerRadius=new CornerRadius(14),BorderBrush=Brushes.Gainsboro,BorderThickness=new Thickness(1)});
        }page.Children.Add(plugins);
        page.Children.Add(ProfileHeading("인사이트"));
        var catalog=Path.Combine(BaseDir,"codex-skill-catalog.json");
        var skills=new HashSet<string>(Directory.GetDirectories(Path.Combine(BaseDir,"스킬")).Where(d=>File.Exists(Path.Combine(d,"SKILL.md"))).Select(Path.GetFileName));
        if(File.Exists(catalog))foreach(var entry in json.Deserialize<List<Map>>(File.ReadAllText(catalog)))skills.Add(Convert.ToString(entry["name"]));
        var usedDir=Path.Combine(BaseDir,"기억","사용한 스킬");
        AddInsight(page,"패스트 모드","지원하지 않음");
        var topLevel=levels.OrderByDescending(p=>p.Value).FirstOrDefault();
        AddInsight(page,"가장 많이 사용한 추론",levels.Count==0?"기록 없음":topLevel.Key+" · "+((double)topLevel.Value/levels.Values.Sum()).ToString("P0"));
        AddInsight(page,"사용해 본 스킬",Directory.Exists(usedDir)?Directory.GetFiles(usedDir,"*.used").Length.ToString():"기록 없음");
        AddInsight(page,"총 사용할 스킬 수",skills.Count.ToString());
        AddInsight(page,"현재 모델",String.IsNullOrWhiteSpace(prefs.model)?"자동":prefs.model);
        frame.Children.Add(new ScrollViewer{Content=page,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});MountRail("프로필",frame,true);
    }
}
