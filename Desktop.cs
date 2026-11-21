using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using Microsoft.Win32;
using Map = System.Collections.Generic.Dictionary<string,object>;

partial class DesktopChat {
    readonly Window window;
    readonly TextBox input, search;
    readonly ListBox chats;
    readonly StackPanel messages;
    readonly TextBlock status, welcome;
    readonly Button send, attach, newChat;
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength=16777216 };
    List<Map> history=new List<Map>();
    List<Map> searchResults;
    string appliedSearch="";
    string id=Guid.NewGuid().ToString(), attachment="";
    bool busy, updating, loading=true, stopping;
    Process worker;
    bool closed;
    readonly HashSet<Process> ownedProcesses=new HashSet<Process>();
    System.Windows.Threading.DispatcherTimer maintenanceTimer;
    bool compact;
    Rect normal;
    WindowState previousState;
    bool previousSidebar;
    readonly Dictionary<string,ComposerDraft> drafts=new Dictionary<string,ComposerDraft>();
    int view;
    int searchVersion;
    readonly List<string> trail=new List<string>();
    int trailIndex=-1;
    readonly HashSet<string> pins=new HashSet<string>();
    readonly string pinPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"고정된채팅.json");
    string lastChanges="";
    string submittedImage="";
    string submittedAttachment="";
    const string imagePrefix="\n\n첨부 이미지\n";
    T Find<T>(string name) where T:class {return (T)window.FindName(name);}
    DesktopChat(bool startBlank=false,string requestedChat=null){
        using(var stream=typeof(DesktopChat).Assembly.GetManifestResourceStream("Desktop.xaml"))window=(Window)XamlReader.Load(stream);
        input=Find<TextBox>("Input");search=Find<TextBox>("Search");chats=Find<ListBox>("Chats");
        messages=Find<StackPanel>("Messages");status=Find<TextBlock>("Status");welcome=Find<TextBlock>("Welcome");
        send=Find<Button>("Send");attach=Find<Button>("Attach");newChat=Find<Button>("NewChat");
        try{if(File.Exists(pinPath))foreach(string pin in json.Deserialize<string[]>(File.ReadAllText(pinPath)))pins.Add(pin);}
        catch(Exception e){status.Text="고정 목록을 읽지 못했습니다. "+e.Message;}
        LoadPreferences();ApplyFont();BindControls();Side(prefs.sidebarOpen);UpdateModelChip();UpdateProjectChip();EnableFileDrop();window.ContentRendered+=async(sender,args)=>{RefreshPlans();await RefreshModelStatus();};BindFind();BindChatKeys();BindMotion();BindTurnRail();
        newChat.Click+=(s,e)=>New();search.TextChanged+=async(s,e)=>{try{await Refresh(true);}catch(Exception x){status.Text=x.Message;}};
        chats.SelectionChanged+=async(s,e)=>{if(!updating && chats.SelectedItem is ListBoxItem)await Open((string)((ListBoxItem)chats.SelectedItem).Tag);};
        input.TextChanged+=(s,e)=>{Find<TextBlock>("Placeholder").Visibility=input.Text.Length==0?Visibility.Visible:Visibility.Hidden;SyncControls();};
        BindSlash();BindComposer();
        input.PreviewKeyDown+=async(s,e)=>{
            if(e.Key!=Key.Enter || composingText)return;
            var modifiers=Keyboard.Modifiers;
            if(prefs.ctrlEnterSend && !busy && modifiers==ModifierKeys.None)return;
            if(modifiers==ModifierKeys.Shift || (modifiers!=ModifierKeys.None && modifiers!=ModifierKeys.Control))return;
            e.Handled=true;
            if(e.IsRepeat)return;
            if(!busy)await Send();
            else if((modifiers==ModifierKeys.Control)==prefs.queueFirst)SendNowFromInput();
            else Enqueue();
        };
        Find<Button>("QueueSend").MouseRightButtonUp+=(s,e)=>{if(!busy||String.IsNullOrWhiteSpace(input.Text))return;e.Handled=true;var sendMenu=new ContextMenu();
            var nowItem=new MenuItem{Header="⚡ 지금 보내기 (진행 중인 작업에 바로 추가)"};nowItem.Click+=(o1,x1)=>SendNowFromInput();sendMenu.Items.Add(nowItem);
            var laterItem=new MenuItem{Header="⏳ 대기열에 추가 (작업이 끝나면 보냄)"};laterItem.Click+=(o2,x2)=>Enqueue();sendMenu.Items.Add(laterItem);
            sendMenu.PlacementTarget=Find<Button>("QueueSend");sendMenu.IsOpen=true;};
        window.PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Space && Keyboard.Modifiers==(ModifierKeys.Control|ModifierKeys.Shift)){ToggleCompact();e.Handled=true;}
            if(Keyboard.Modifiers==ModifierKeys.Control && e.Key==Key.N){New();e.Handled=true;return;}if(Keyboard.Modifiers==ModifierKeys.Control && !busy){if(e.Key==Key.OemComma){ShowPreferences();e.Handled=true;}if(e.Key==Key.K){ShowSearch();e.Handled=true;}}};
        send.Click+=async(s,e)=>{if(busy){Stop();return;}await Send();};
        attach.Click+=(s,e)=>{AddMenu();};
        selectFile=()=>{try{var d=new CardPicker{Filter="지원하는 파일|*.png;*.jpg;*.jpeg;*.txt;*.md;*.js;*.json;*.csv;*.py;*.html;*.css;*.ts"};if(d.ShowDialog(window)==true){if(Regex.IsMatch(d.FileName,@"\.(png|jpe?g)$",RegexOptions.IgnoreCase)){if(new FileInfo(d.FileName).Length>8000000)throw new Exception("8MB 이하 이미지를 선택하세요.");attachment=imagePrefix+d.FileName;}else{if(new FileInfo(d.FileName).Length>24000)throw new Exception("더 작은 파일을 선택하세요.");attachment="\n\n첨부 파일 "+Path.GetFileName(d.FileName)+"\n"+File.ReadAllText(d.FileName);}status.Text="";SyncControls();}}catch(Exception x){status.Text=x.Message;}};
        On("RemoveAttachment",()=>{attachment="";SyncControls();input.Focus();});
        SyncControls();
        window.Loaded+=async(s,e)=>{try{await Refresh();var requested=requestedChat??Environment.GetCommandLineArgs().Skip(1).FirstOrDefault();var first=history.FirstOrDefault(r=>requested==null?!Convert.ToBoolean(r["archived"]):(string)r["id"]==requested);if((!startBlank||requestedChat!=null) && first!=null){archiveView=Convert.ToBoolean(first["archived"]);await Open((string)first["id"]);}input.Focus();}catch(Exception x){status.Text=x.Message;}finally{loading=false;SyncControls();}};
        // 처음 설치해 대화가 하나도 없고 첫 설정을 아직 안 했으면, 채팅으로 첫 설정 안내(/첫설정)를 시작합니다.
        window.Loaded+=(s2,e2)=>window.Dispatcher.BeginInvoke(new Action(async()=>{try{
            for(int i=0;i<50 && loading;i++)await Task.Delay(200); // 대화 목록을 다 불러온 뒤에 판단
            if(loading||busy||history.Count>0||File.Exists(Path.Combine(DataDir(),"setup-done.json")))return;
            await Task.Delay(600);input.Text="/첫설정";await Send();}catch{}}));
        window.Closed+=async(s,e)=>{closed=true;view++;if(maintenanceTimer!=null)maintenanceTimer.Stop();StopReading();CancelVoice();await Task.WhenAll(ownedProcesses.ToArray().Select(process=>DesktopIntegrity.KillTree(process)));};
    }
    async void Stop(){if(worker==null||stopping)return;var process=worker;stopping=true;SyncControls();try{await DesktopIntegrity.KillTree(process);if(!closed&&!process.HasExited){stopping=false;status.Text="작업 중지를 확인하지 못했습니다.";SyncControls();}}catch(InvalidOperationException){}}
    void SyncControls(){
        UpdateModelActivity();
        Find<FrameworkElement>("ActivityDot").Visibility=busy||Find<FrameworkElement>("ProjectDot").Visibility==Visibility.Visible?Visibility.Visible:Visibility.Collapsed;
        if(findChat!=null&&findChat!=id)CloseFind(false);
        bool idle=!busy&&!loading;
        newChat.IsEnabled=!loading;attach.IsEnabled=!loading;chats.IsEnabled=Find<ListBox>("Pinned").IsEnabled=idle;
        Find<Button>("HeadNew").IsEnabled=Find<MenuItem>("MenuNew").IsEnabled=!loading;Find<Button>("ThreadMore").IsEnabled=idle && history.Any(x=>(string)x["id"]==id);
        Find<Button>("Back").IsEnabled=idle&&trailIndex>0;
        Find<Button>("Forward").IsEnabled=idle&&trailIndex+1<trail.Count;
        Find<Button>("Sidebar").IsEnabled=Find<MenuItem>("MenuSide").IsEnabled=!compact;
        Find<Button>("Details").IsEnabled=true;
        input.IsReadOnly=loading;
        SyncSendButton();
        var chip=Find<Button>("RemoveAttachment");
        chip.Visibility=attachment.Length>0?Visibility.Visible:Visibility.Collapsed;
        if(attachment.StartsWith(imagePrefix)){
            var path=attachment.Substring(imagePrefix.Length);
            var preview=new StackPanel{Orientation=Orientation.Horizontal};
            try{var bitmap=new System.Windows.Media.Imaging.BitmapImage();bitmap.BeginInit();bitmap.DecodePixelWidth=80;bitmap.CacheOption=System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;bitmap.UriSource=new Uri(path);bitmap.EndInit();preview.Children.Add(new Image{Source=bitmap,Width=65,Height=42});}catch(IOException){}
            preview.Children.Add(new TextBlock{Text=Path.GetFileName(path)+"  ×",VerticalAlignment=VerticalAlignment.Center,Margin=new Thickness(6,0,0,0)});chip.Content=preview;
        }else if(attachment.Length>0)chip.Content=attachment.Split('\n')[2]+"   ×";
        chip.IsEnabled=idle;
    }
    void Folder(string folder){string p=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,folder);Directory.CreateDirectory(p);Process.Start("explorer.exe","\""+p+"\"");}
    void On(string name,Action action){Find<Button>(name).Click+=(s,e)=>action();}
    double sideWidth=290;
    void Side(bool show,bool persist=true){
        Find<Grid>("Workspace").ColumnDefinitions[1].Width=new GridLength(show?sideWidth:0);
        Find<FrameworkElement>("PanelSide").Visibility=show?Visibility.Visible:Visibility.Collapsed;
        string label=show?"사이드바 닫기":"사이드바 열기";
        var toggle=Find<Button>("Sidebar");
        toggle.ToolTip=label;PositionInfoPane();
        AutomationProperties.SetName(toggle,label);
        Find<MenuItem>("MenuSide").Header=label;
        if(persist && prefs.sidebarOpen!=show){
            prefs.sidebarOpen=show;
            try{SavePreferences();}catch(IOException x){status.Text=x.Message;}
        }
    }
    Border webPane;
    ChromePanel webView;
    readonly System.Threading.SemaphoreSlim panelNavigation=new System.Threading.SemaphoreSlim(1,1);
    async void OpenWebPanel(string address){
        Uri url;if(!Uri.TryCreate(address,UriKind.Absolute,out url)||(url.Scheme!="https"&&url.Scheme!="http"))return;
        await panelNavigation.WaitAsync();
        try{
            var info=Find<Border>("InfoPane");
            info.Visibility=Visibility.Collapsed;
            if(webPane==null){
                var panel=new DockPanel();
                var header=new DockPanel{Margin=new Thickness(8,4,8,4)};
                var close=new Button{Content="숨기기",ToolTip="브라우저 숨기기"};
                close.Click+=(s,e)=>webPane.Visibility=Visibility.Collapsed;
                DockPanel.SetDock(close,Dock.Right);header.Children.Add(close);
                var pop=new Button{Content="팝업으로 열기",Margin=new Thickness(0,0,6,0)};
                pop.Click+=(s,e)=>{try{webView.Detach();webPane.Visibility=Visibility.Collapsed;if(workBrowserButton!=null)workBrowserButton.Content="브라우저 보기";}catch(Exception x){status.Text=x.Message;}};
                DockPanel.SetDock(pop,Dock.Right);header.Children.Add(pop);
                header.Children.Add(new TextBlock{Text="브라우저",FontWeight=FontWeights.SemiBold,VerticalAlignment=VerticalAlignment.Center});
                DockPanel.SetDock(header,Dock.Top);panel.Children.Add(header);
                webView=new ChromePanel();
                panel.Children.Add(new System.Windows.Forms.Integration.WindowsFormsHost{Child=webView});
                webPane=new Border{Child=panel,Background=Brushes.White,Margin=new Thickness(4,0,4,4),HorizontalAlignment=HorizontalAlignment.Right};
                System.Windows.Controls.Panel.SetZIndex(webPane,3);((Grid)info.Parent).Children.Add(webPane);
            }
            webPane.Visibility=Visibility.Visible;PositionInfoPane();
            BindBrowserButton(()=>{webPane.Visibility=Visibility.Visible;if(!webView.RestorePanel())OpenWebPanel(address);},()=>webPane.Visibility=Visibility.Collapsed);
            keepBrowserButton=true;
            await webView.Open(url);

        }catch(Exception ex){status.Text="브라우저 열기 실패 · "+ex.Message;}finally{panelNavigation.Release();}
    }
    void PositionInfoPane(){
        bool overlay=compact || window.ActualWidth-(Find<FrameworkElement>("PanelSide").IsVisible?sideWidth:0)<930;
        if(toolsPane!=null)Grid.SetColumn(toolsPane,overlay?2:3);Grid.SetColumn(Find<Border>("InfoPane"),overlay?2:3);
        if(webPane!=null){Grid.SetColumn(webPane,overlay?2:3);webPane.Width=Math.Max(260,Math.Min(560,window.ActualWidth*.42));}
    }
    void SetInfoVisible(bool show){
        var pane=Find<Border>("InfoPane");
        PositionInfoPane();
        pane.Visibility=show?Visibility.Visible:Visibility.Collapsed;
        if(show && webPane!=null)webPane.Visibility=Visibility.Collapsed;
        Find<TextBlock>("InfoProject").Text=String.IsNullOrEmpty(prefs.projectDir)?"기본 작업공간":prefs.projectDir;
        if(show)Find<Button>("CloseInfo").Focus();else Find<Button>("Details").Focus();
    }
    void ShowSearch(){if(compact)ToggleCompact();Side(true);search.Visibility=Visibility.Visible;search.Focus();search.SelectAll();}
    void Pin(){if(!history.Any(x=>(string)x["id"]==id))return;if(!pins.Remove(id))pins.Add(id);File.WriteAllText(pinPath,json.Serialize(pins.ToArray()));Filter();}
    void Record(string chat){if(trailIndex>=0&&trail[trailIndex]==chat)return;trail.RemoveRange(trailIndex+1,trail.Count-trailIndex-1);trail.Add(chat);trailIndex=trail.Count-1;}
    void Menu(string source,params Tuple<string,Action>[] items){var menu=new ContextMenu();foreach(var entry in items){var item=new MenuItem{Header=entry.Item1,IsEnabled=entry.Item2!=null};item.Click+=(s,e)=>entry.Item2();menu.Items.Add(item);}var anchor=Find<Button>(source);menu.PlacementTarget=anchor;if(Find<DockPanel>("NavRail").IsAncestorOf(anchor))menu.Placement=System.Windows.Controls.Primitives.PlacementMode.Right;menu.IsOpen=true;}
    void Info(){ShowPreferences();}
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
    void BindControls(){
        On("HeadNew",New);
        Action sidebar=()=>Side(Find<FrameworkElement>("PanelSide").Visibility!=Visibility.Visible);
        On("Sidebar",sidebar);On("Min",()=>window.WindowState=WindowState.Minimized);On("Max",()=>window.WindowState=window.WindowState==WindowState.Maximized?WindowState.Normal:WindowState.Maximized);On("CloseApp",window.Close);
        On("Home",()=>{CloseRailPage();SetArchive(false);search.Clear();search.Visibility=Visibility.Collapsed;chats.Focus();});On("HistoryIcon",()=>RailPage("예약"));On("AgentPicker",()=>{if(railName=="플러그인")CloseRailPage();else OpenPluginManager();});On("Files",()=>RailPage("스페이스"));On("SearchBtn",ShowSearch);
        On("HeadFolder",()=>ShowFile(SpaceDir));BindProjectList();PaintRail();
        On("Access",AccessMenu);On("Model",EffortPopup);
        On("HomeProject",ProjectMenu);
        Action homeHeader=()=>{var show=welcome.Visibility==Visibility.Visible?Visibility.Collapsed:Visibility.Visible;foreach(string n in new[]{"HeadFolder","ThreadTitle","ThreadMore","Options"})Find<FrameworkElement>(n).Visibility=show;};
        welcome.IsVisibleChanged+=(s,e)=>homeHeader();homeHeader();
        On("Changes",()=>Menu("Changes",Tuple.Create("이 대화의 작업 결과",Find<Button>("ChangeChip").Visibility==Visibility.Visible?(Action)ShowEditedFiles:null),Tuple.Create("파일 변경 기록",(Action)(()=>Folder("복구기록")))));On("ChangeChip",ShowEditedFiles);On("MyDot",Info);On("Brand",BrainMenu);
        On("Activity",()=>{if(activeLog!=null){activeLog.IsExpanded=true;activeLog.BringIntoView();}else status.Text="진행 중인 작업이 없습니다."; });On("Details",ToggleToolsPane);
        On("CloseInfo",()=>SetInfoVisible(false));On("InfoChanges",ShowEditedFiles);
        window.SizeChanged+=(s,e)=>PositionInfoPane();
        On("ThreadMore",()=>{var row=history.FirstOrDefault(x=>(string)x["id"]==id);if(row!=null){var m=RowMenu(row);OpenThreadMenu(m,Find<Button>("ThreadMore"));}});
        On("More",()=>Menu("More",Tuple.Create("새 채팅",loading?null:(Action)New),Tuple.Create("채팅 검색    Ctrl+K",(Action)ShowSearch),Tuple.Create("보관된 채팅",(Action)(()=>SetArchive(true)))));
        On("AppTools",()=>Menu("AppTools",Tuple.Create("작업공간 열기",(Action)(()=>Folder("작업공간"))),Tuple.Create("모델 선택",(Action)(()=>ShowEffortPopup(Find<Button>("AppTools"),true))),Tuple.Create(compact?"기본 창으로":"작은 창으로",(Action)ToggleCompact),Tuple.Create("설정",(Action)Info)));
        On("RailDownload",()=>ModelMenu("RailDownload"));
        On("RailProfile",ShowProfileMenu);
        On("RailStatus",()=>Menu("RailStatus",
            Tuple.Create(busy?(stopping?"작업 중지 중":"작업 중"):loading?"대화 여는 중":"대기 중",(Action)null),
            Tuple.Create("대기 메시지 "+queue.Count+"개",(Action)null),
            Tuple.Create("현재 작업 중지",busy&&!stopping?(Action)Stop:null)));
        On("Options",ShowPreferences);
        On("Back",async()=>await Navigate(-1));On("Forward",async()=>await Navigate(1));
        Find<ListBox>("Pinned").SelectionChanged+=async(s,e)=>{var item=Find<ListBox>("Pinned").SelectedItem as ListBoxItem;if(!updating&&item!=null)await Open((string)item.Tag);};
        Find<MenuItem>("MenuNew").Click+=(s,e)=>New();Find<MenuItem>("MenuFolder").Click+=(s,e)=>Folder("작업공간");Find<MenuItem>("MenuSide").Click+=(s,e)=>sidebar();Find<MenuItem>("MenuCompact").Click+=(s,e)=>ToggleCompact();Find<MenuItem>("About").Click+=(s,e)=>Info();
        // 예약 작업·하트비트·드리밍: 앱이 켜져 있는 동안 1분마다 확인 (사용자 작업 중에는 건너뜀)
        var ticker=maintenanceTimer=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromSeconds(60)};
        ticker.Tick+=async(s,e)=>{if(closed||busy||ticking)return;ticking=true;try{var r=await Rpc("tick","",Guid.Empty.ToString()) as Map;if(!closed&&r!=null&&r.ContainsKey("ran")&&Convert.ToInt32(r["ran"])>0)await Refresh();}catch{}finally{ticking=false;}};
        ticker.Start();
    }
    bool ticking;
    void ToggleCompact(){
        if(!compact){previousState=window.WindowState;previousSidebar=Find<FrameworkElement>("PanelSide").IsVisible;normal=window.RestoreBounds;window.WindowState=WindowState.Normal;window.MinWidth=400;window.Width=520;window.Height=480;}
        else{window.MinWidth=690;window.Left=normal.Left;window.Top=normal.Top;window.Width=normal.Width;window.Height=normal.Height;window.WindowState=previousState;}
        compact=!compact;Side(!compact && previousSidebar,false);SyncControls();input.Focus();
    }
    async Task<object> Rpc(string method,string text="",string targetId=null,bool textOnly=false){
        if(closed)throw new OperationCanceledException("창을 닫아 작업을 중지했습니다.");
        var info=new ProcessStartInfo("node.exe","agent.mjs --rpc"){WorkingDirectory=AppDomain.CurrentDomain.BaseDirectory,CreateNoWindow=true,UseShellExecute=false,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
        using(var proc=Process.Start(info))using(var deadline=new System.Threading.CancellationTokenSource()){
            ownedProcesses.Add(proc);
            if(method=="ask"){worker=proc;SyncControls();}
            try{
                var stdout=proc.StandardOutput.ReadToEndAsync();var stderr=ReadDiagnostics(proc.StandardError,method=="ask");
                var bytes=Encoding.UTF8.GetBytes(json.Serialize(new {method,id=targetId??id,text,textOnly,permission,planning,webGrant=method=="ask"?webGrant:"",image=method=="ask"?submittedImage:"",attachment=method=="ask"?submittedAttachment:"",files=method=="ask"?submittedFiles:new string[0],targetWindow=targetHandle.ToString(),targetPid=targetProcess}));
                var sendInput=DesktopIntegrity.WriteRequest(proc,bytes);
                var exit=Task.Run(()=>proc.WaitForExit());
                var limit=Task.Delay(method=="ask"?30*60*1000:method=="tick"?10*60*1000:120000,deadline.Token);
                // Observe reader failures immediately, rather than waiting behind a child blocked on its pipe.
                var all=Task.WhenAll(exit,stdout,stderr,sendInput);
                var failedReader=new TaskCompletionSource<bool>();
                DesktopIntegrity.ObserveFailure(stdout,failedReader);
                DesktopIntegrity.ObserveFailure(stderr,failedReader);
                DesktopIntegrity.ObserveFailure(sendInput,failedReader);
                DesktopIntegrity.ObserveFailure(all,failedReader);
                var done=await Task.WhenAny(all,limit,failedReader.Task);
                if(done!=all){await DesktopIntegrity.KillTree(proc);if(done==failedReader.Task)throw new IOException("작업 응답을 읽지 못해 실행을 중지했습니다.");throw new TimeoutException("작업 응답 제한 시간을 넘어 실행을 중지했습니다. 진행 내역을 확인하세요.");}
                await all;
                if(closed)throw new OperationCanceledException("창을 닫아 작업을 중지했습니다.");
                var output=await stdout;var error=await stderr;
                if(proc.ExitCode!=0)throw new Exception(error.Trim().Length>0?error.Trim():"작업을 중단했습니다.");
                if(method=="pluginManager")return new System.Web.Script.Serialization.JavaScriptSerializer{MaxJsonLength=64000000}.DeserializeObject(output);
                return json.DeserializeObject(output);
            }finally{deadline.Cancel();ownedProcesses.Remove(proc);if(worker==proc){worker=null;if(!closed)SyncControls();}}
        }
    }
    async Task Refresh(bool debounce=false){int version=++searchVersion;if(debounce)await Task.Delay(180);if(version!=searchVersion)return;
        string query=search.Text.Trim();
        if(!debounce || query.Length==0){
            var rows=((object[])await Rpc("list","")).Cast<Map>().ToList();
            if(version!=searchVersion)return;
            history=rows;
        }
        var matches=query.Length==0?null:((object[])await Rpc("list",query)).Cast<Map>().ToList();
        if(version!=searchVersion)return;
        appliedSearch=query;searchResults=matches;Filter();
    }
    void Filter(){updating=true;try{
        chats.Items.Clear();var pinned=Find<ListBox>("Pinned");pinned.Items.Clear();
        if(!archiveView && String.IsNullOrEmpty(appliedSearch)){
            foreach(var draft in drafts.Where(d=>!history.Any(r=>(string)r["id"]==d.Key))){
                var preview=draft.Value.Text.Trim();
                if(preview.Length==0)preview="새 채팅";
                var item=new ListBoxItem{Tag=draft.Key,Content=new TextBlock{Text="작성 중 · "+preview.Replace("\r"," ").Replace("\n"," "),TextTrimming=TextTrimming.CharacterEllipsis}};
                chats.Items.Add(item);if(draft.Key==id)item.IsSelected=true;
            }
        }
        foreach(var row in (searchResults??history).Where(r=>Convert.ToBoolean(r["archived"])==archiveView)){
            var labels=new StackPanel();labels.Children.Add(new TextBlock{Text=(string)row["title"],TextTrimming=TextTrimming.CharacterEllipsis});
            if(row.ContainsKey("snippet") && !String.IsNullOrEmpty((string)row["snippet"]))labels.Children.Add(new TextBlock{Text=(string)row["snippet"],Foreground=Brushes.Silver,FontSize=13,TextTrimming=TextTrimming.CharacterEllipsis});
            var rowPanel=new DockPanel();
            if(Convert.ToBoolean(row["unread"])){var dot=new System.Windows.Shapes.Ellipse{Width=7,Height=7,Fill=new SolidColorBrush(Color.FromRgb(50,134,232)),Margin=new Thickness(8,0,0,0),ToolTip="읽지 않음"};DockPanel.SetDock(dot,Dock.Right);rowPanel.Children.Add(dot);}
            rowPanel.Children.Add(labels);
            var item=new ListBoxItem{Tag=row["id"],Content=rowPanel,ToolTip=(string)row["title"]};if(!String.IsNullOrEmpty((string)row["section"]))labels.Children.Add(new TextBlock{Text=(string)row["section"],FontSize=12,Foreground=Brushes.Gray});item.ContextMenu=RowMenu(row);BindChatContextMenu(item);(pins.Contains((string)row["id"])?pinned:chats).Items.Add(item);if((string)row["id"]==id)item.IsSelected=true;
        }
        DrawProjects();
        var unread=history.Any(r=>Convert.ToBoolean(r["unread"])&&!Convert.ToBoolean(r["archived"]));
        Find<FrameworkElement>("ProjectDot").Visibility=unread?Visibility.Visible:Visibility.Collapsed;
        Find<FrameworkElement>("ActivityDot").Visibility=unread||busy?Visibility.Visible:Visibility.Collapsed;
        Find<TextBlock>("PinHeading").Visibility=Visibility.Visible;
        bool searching=!String.IsNullOrEmpty(appliedSearch);
        Find<TextBlock>("ListHeading").Text=searching?"검색 결과":archiveView?"보관된 채팅":"최근";
        var empty=Find<TextBlock>("EmptyHistory");
        empty.Visibility=chats.Items.Count+pinned.Items.Count==0?Visibility.Visible:Visibility.Collapsed;
        empty.Text=searching?"검색 결과가 없습니다.":archiveView?"보관된 채팅이 없습니다.":"최근 채팅이 없습니다.";
        var current=history.FirstOrDefault(x=>(string)x["id"]==id);if(current!=null)Find<TextBlock>("ThreadTitle").Text=(string)current["title"];
    }finally{updating=false;SyncControls();}}
    void New(){if(loading)return;if(busy){var draft=new DesktopChat(true);draft.window.Show();draft.window.Activate();return;}ClearEdited();targetHandle=0;targetProcess=0;targetTitle="";KeepDraft();Record(id);view++;id=Guid.NewGuid().ToString();ShowUsage();Record(id);RestoreDraft();status.Text="";messages.Children.Clear();welcome.Visibility=Visibility.Visible;Find<TextBlock>("ThreadTitle").Text="새 채팅";Find<Button>("ChangeChip").Visibility=Visibility.Collapsed;Filter();input.Focus();}
    async Task Open(string chat){if(busy)return;ClearEdited();targetHandle=0;targetProcess=0;targetTitle="";KeepDraft();int version=++view;id=chat;ShowUsage();Record(id);loading=true;RestoreDraft();SyncControls();Find<TextBlock>("ThreadTitle").Text="새 채팅";Find<Button>("ChangeChip").Visibility=Visibility.Collapsed;
        try{var rows=(object[])await Rpc("load");if(version!=view)return;messages.Children.Clear();welcome.Visibility=Visibility.Visible;status.Text="";
            int rendered=0;foreach(Map m in rows){
                if(closed||version!=view)return;
                if(m.ContainsKey("activity"))RestoreActivity(m);
                if(Equals(m["role"],"assistant"))Find<Button>("ChangeChip").Visibility=Visibility.Collapsed;
                Add((string)m["role"],(string)m["content"],m.ContainsKey("retryable")&&Equals(m["retryable"],true),m.ContainsKey("previewImages")?((object[])m["previewImages"]).OfType<string>():null,m.ContainsKey("image")?m["image"] as string:null,m.ContainsKey("sourceOutput")&&Equals(m["sourceOutput"],true),m.ContainsKey("createdAt")?Convert.ToString(m["createdAt"]):"",m.ContainsKey("undoManifest")?Convert.ToString(m["undoManifest"]):null);
                if(Equals(m["role"],"assistant"))ShowTurnResults(m);
                if(++rendered%8==0)await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
            }
            Filter();}
        catch(Exception x){if(version==view)status.Text=x.Message;}finally{if(version==view){loading=false;SyncControls();}}
    }
    TextBox Readable(string text){return new TextBox{Text=text,IsReadOnly=true,TextWrapping=TextWrapping.Wrap,Background=Brushes.Transparent,Foreground=Brushes.Black,BorderThickness=new Thickness(0),FontSize=15,Padding=new Thickness(4),IsReadOnlyCaretVisible=false};}
    Button Copy(string text,string label){
        bool icon=label=="응답 복사"||label=="답변 복사"||label=="메시지 복사";
        var b=icon?MessageAction(label,"\uE8C8"):new Button{Content=label,FontSize=13,Padding=new Thickness(7,3,7,3),Foreground=Brushes.DimGray};
        b.HorizontalAlignment=HorizontalAlignment.Left;
        object normal=b.Content;
        b.Click+=async(s,e)=>{try{if(text.Length==0)return;Clipboard.SetText(text);b.Content=icon?"\uE73E":"복사됨";await Task.Delay(1200);b.Content=normal;}catch(System.Runtime.InteropServices.COMException){status.Text="클립보드가 사용 중입니다. 다시 복사해 주세요.";}};
        return b;
    }
    void ShowFiles(object[] files){
        if(files==null||files.Length==0)return;
        var rows=files.Cast<Map>().ToArray();
        lastChanges=String.Join("\n",rows.Select(f=>f["relative"]+(f["added"]==null?"":"   +"+f["added"]+"  −"+f["removed"])));
        var label=new StackPanel{Orientation=Orientation.Horizontal};
        label.Children.Add(new TextBlock{Text=rows.Length+"개 파일 변경됨"});
        if(rows.All(f=>f["added"]!=null)){
            label.Children.Add(new TextBlock{Text="  +"+rows.Sum(f=>Convert.ToInt32(f["added"])),Foreground=Brushes.SeaGreen});
            label.Children.Add(new TextBlock{Text="  −"+rows.Sum(f=>Convert.ToInt32(f["removed"])),Foreground=Brushes.Firebrick});
        }
        var chip=Find<Button>("ChangeChip");chip.Content=label;chip.Visibility=Visibility.Visible;
    }
    static Map[] TurnEvents(Map turn){
        object value;
        return turn.TryGetValue("events",out value) && value is object[]
            ? ((object[])value).OfType<Map>().ToArray() : new Map[0];
    }
    static bool Flag(Map turn,string key,bool expected){
        object value;
        return turn.TryGetValue(key,out value) && Equals(value,expected);
    }
    static string TurnOutcome(Map turn,Map[] events){
        if(Flag(turn,"needsInput",true))return "사용자 확인 필요";
        if(Flag(turn,"complete",false) || Flag(turn,"scriptComplete",false))return "미완료";
        bool verified=Flag(turn,"complete",true) || Flag(turn,"scriptComplete",true);
        if(!verified && events.Any(e=>Flag(e,"ok",false)))return "실행 실패";
        if(verified)return events.Any(e=>Flag(e,"ok",true) && !Equals(e["tool"],"look"))?"작업 완료":"답변 완료";
        return events.Any(e=>Flag(e,"ok",true))?"실행 기록":"";
    }
    static bool NeedsAttention(string outcome){
        return outcome=="사용자 확인 필요" || outcome=="미완료" || outcome=="실행 실패";
    }
    void ShowTurnResults(Map turn){
        var events=TurnEvents(turn);
        string outcome=TurnOutcome(turn,events);
        object files;
        var changed=turn.TryGetValue("files",out files)?files as object[]:null;
        if(changed!=null && changed.Length>0)ShowFiles(changed);
        if(events.Length==0 && !NeedsAttention(outcome))return;
        var chip=Find<Button>("ChangeChip");
        if(events.Length==0 && (changed==null || changed.Length==0) && chip.Visibility!=Visibility.Visible)return;
        string log=String.Join("\n",events.Select(e=>String.Format("{0} {1} · {2}",
            e.ContainsKey("tool")?e["tool"]:"실행",e.ContainsKey("path")?e["path"]:"",Flag(e,"ok",true)?"실행됨":"실패")));
        lastChanges=String.Join("\n",new[]{outcome,log,changed!=null && changed.Length>0?lastChanges:""}.Where(s=>!String.IsNullOrEmpty(s)));
        if(NeedsAttention(outcome))chip.Content=outcome+" · 기록 보기";
        else if(changed==null || changed.Length==0)chip.Content="실행 내역 "+events.Length+"건 · 보기";
        chip.ToolTip="이 작업의 실행 기록";
        chip.Visibility=Visibility.Visible;
    }
    Button MessageAction(string name,string glyph){
        var button=new Button{Content=glyph,Width=27,Height=27,Padding=new Thickness(0),
            FontSize=14,FontFamily=new FontFamily("Segoe MDL2 Assets"),Foreground=Brushes.DimGray,ToolTip=name};
        AutomationProperties.SetName(button,name);
        return button;
    }
    sealed class UserMessageRow:StackPanel{
        public string Original;
        public int Index;
    }
    async Task SendFromHistory(UserMessageRow row,string revised,bool textOnly){
        if(busy||loading||String.IsNullOrWhiteSpace(revised))return;
        if(textOnly&&prefs.brain=="gemini")return;
        revised=revised.Trim();
        if(revised.Length>12000){status.Text="메시지를 12,000자 이내로 줄여 주세요.";return;}
        string source=id;int version=view;
        loading=true;SyncControls();
        try{
            var op=json.Serialize(new{action="forkBeforeMessage",value=json.Serialize(new{userIndex=row.Index,content=row.Original})});
            var fork=(Map)await Rpc("manage",op,source);
            if(view!=version||id!=source)return;
            string next=(string)fork["id"];
            await Open(next);
            if(id!=next||busy||loading)return;
            input.Text=revised;input.CaretIndex=revised.Length;
            await Send(textOnly);
        }catch(Exception x){status.Text=x.Message;}
        finally{if(view==version){loading=false;SyncControls();}}
    }
    void AddUserMessage(string text,IEnumerable<string> pictures=null){
        bool hasPhotos=pictures!=null && pictures.Any(p=>!String.IsNullOrEmpty(p) && FileIcon(p)=="🖼");
        bool hasAttachments=hasPhotos || Regex.IsMatch(text,@"(?m)^(?:📎|\[첨부 자료\]|첨부 (?:파일 |폴더 |이미지))");
        if(hasPhotos){
            var label=Regex.Match(text,@"(?:\r?\n)+📎 (?:첨부: )?(?<files>[^\r\n]+)\z");
            if(label.Success){
                string entries=label.Groups["files"].Value;
                var kept=Regex.Replace(entries,@"(?:^|(?<=, ))붙여넣은 그림 [0-9]{6}\.png(?: \([^\r\n]*?\.png\))?(?=, |$)(?:, )?","",RegexOptions.IgnoreCase);
                kept=Regex.Replace(kept,@", \z","");
                text=text.Substring(0,label.Index)+(kept.Length==0?"":"\n📎 "+kept);
            }
            if(text=="(파일만 보냄)")text="";
        }
        var message=new TextBox{
            Text=text,FontFamily=window.FontFamily,FontWeight=FontWeights.Normal,FontSize=14,
            IsReadOnly=true,IsReadOnlyCaretVisible=false,TextWrapping=TextWrapping.Wrap,
            TextAlignment=TextAlignment.Left,Background=Brushes.Transparent,Foreground=Brushes.White,
            BorderThickness=new Thickness(0),Padding=new Thickness(0),
            HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled,VerticalScrollBarVisibility=ScrollBarVisibility.Disabled
        };
        var row=new UserMessageRow{Original=text,Index=messages.Children.OfType<UserMessageRow>().Count(),Margin=new Thickness(0,8,-4,7)};
        var bubble=new Border{Child=message,Background=Brushes.Black,Padding=new Thickness(15,10,15,10),
            HorizontalAlignment=HorizontalAlignment.Right,MaxWidth=516,CornerRadius=new CornerRadius(16)};
        AddPhotoStrip(row,pictures);
        if(text.Length>0)row.Children.Add(bubble);
        var actions=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right,Margin=new Thickness(0,3,0,0)};
        if(text.Length>0)actions.Children.Add(Copy(text,"메시지 복사"));

        var edit=MessageAction("메시지 편집","\uE70F");
        // Older conversations store attachment labels inside the text and cannot replay their files.
        if(!hasAttachments){
            actions.Children.Add(edit);
            edit.Click+=(s,e)=>{
                if(busy||loading){status.Text="진행 중인 작업이 끝나면 편집할 수 있어요.";return;}
                if(row.Children.Count>2)return;
                var editor=new TextBox{Text=text,TextWrapping=TextWrapping.Wrap,AcceptsReturn=true,MaxHeight=180,
                    VerticalScrollBarVisibility=ScrollBarVisibility.Auto,FontSize=14.5,Padding=new Thickness(8)};
                var panel=new StackPanel();
                panel.Children.Add(editor);
                var buttons=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};
                var cancel=new Button{Content="취소",Margin=new Thickness(0,0,6,0)};
                var submit=new Button{Content="새 대화로 보내기",ToolTip="여기까지의 대화를 복사하고 수정한 메시지를 보냅니다."};
                buttons.Children.Add(cancel);buttons.Children.Add(submit);panel.Children.Add(buttons);
                var frame=new Border{Background=new SolidColorBrush(Color.FromRgb(245,245,245)),BorderBrush=Brushes.LightGray,BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(12),Padding=new Thickness(8),Child=panel};
                Action close=()=>{row.Children.Remove(frame);bubble.Visibility=actions.Visibility=Visibility.Visible;edit.Focus();};
                cancel.Click+=(a,b)=>close();
                editor.PreviewKeyDown+=(a,b)=>{if(b.Key==Key.Escape){b.Handled=true;close();}};
                editor.TextChanged+=(a,b)=>submit.IsEnabled=!String.IsNullOrWhiteSpace(editor.Text);
                submit.Click+=async(a,b)=>await SendFromHistory(row,editor.Text,false);
                bubble.Visibility=actions.Visibility=Visibility.Collapsed;
                row.Children.Add(frame);editor.Focus();editor.CaretIndex=editor.Text.Length;
            };
        }
        row.Background=Brushes.Transparent;
        Action reveal=()=>{bool show=row.IsMouseOver||row.IsKeyboardFocusWithin;actions.Opacity=show?1:0;actions.IsHitTestVisible=show;};
        row.MouseEnter+=(s,e)=>reveal();row.MouseLeave+=(s,e)=>reveal();
        row.IsKeyboardFocusWithinChanged+=(s,e)=>reveal();reveal();
        row.Children.Add(actions);
        messages.Children.Add(row);Appear(row);FollowMessage(true);
    }
    void Add(string role,string text,bool retryable=false,IEnumerable<string> pictures=null,string imagePath=null,bool sourceOutput=false,string createdAt=null,string trustedUndoManifest=null){
        welcome.Visibility=Visibility.Collapsed;bool user=role=="user";
        if(user){AddUserMessage(text,pictures);return;}
        string originalAnswer=text;
        var body=new StackPanel();
        {
            var outputs=new System.Collections.Generic.List<OutFile>();string undo="";
            if(!sourceOutput)text=StripFileLines(text,outputs,ref undo);
            undo=trustedUndoManifest??""; // Prose is never authority to delete or restore files.
            if(sourceOutput)body.Children.Add(Readable(text));
            else if(text.Length>0)body.Children.Add(FormattedAnswer(text));
            if(!String.IsNullOrEmpty(imagePath) && File.Exists(imagePath)){
                try{var preview=new Image{Source=ChatBitmap(imagePath,1000),MaxWidth=560,MaxHeight=400,Stretch=Stretch.Uniform,HorizontalAlignment=HorizontalAlignment.Left};
                    System.Windows.Automation.AutomationProperties.SetName(preview,"답변에 첨부된 캡처");body.Children.Add(preview);}
                catch(IOException){}catch(NotSupportedException){}catch(FileFormatException){}
            }
            var png=Regex.Match(text,@"(?im)([A-Z]:[\\/][^\r\n<>""|]*?\.png)(?=\s|$)");
            if(!sourceOutput && png.Success){
                string file=png.Groups[1].Value;
                var open=new Button{Content="저장된 이미지 열기",HorizontalAlignment=HorizontalAlignment.Left,IsEnabled=File.Exists(file),ToolTip=file};
                open.Click+=(s,e)=>{try{Process.Start(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"GemmaImageViewer.exe"),"\""+file+"\"");}catch(Exception error){open.IsEnabled=File.Exists(file);status.Text=error.Message;}};
                body.Children.Add(open);
            }
            if(outputs.Count>0){body.Children.Add(ChangesCard(outputs,undo));TrackEdited(outputs);RefreshEditedChip();}
            var actions=AnswerActions(body,text,originalAnswer,createdAt);
            var question=messages.Children.OfType<UserMessageRow>().LastOrDefault();
            if(retryable&&question!=null){
                var again=MessageAction("로컬로 다시 답변 받기","\uE72C");
                again.Style=(Style)window.FindResource("LocalReplyAction");
                again.ToolTip="새 대화에서 로컬 모델로 텍스트 답변을 다시 생성합니다.";
                again.Click+=async(s,e)=>await SendFromHistory(question,question.Original,true);
                actions.Children.Add(again);
            }
            body.Children.Add(actions);
        }
        var border=new AnswerBorder{Child=body,Tag=text,Margin=new Thickness(0,8,0,20)};
        messages.Children.Add(border);Appear(border);FollowMessage(false);
    }
    async Task Send(bool textOnly=false){
        if(busy||loading)return;
        submittedImage=attachment.StartsWith(imagePrefix)?attachment.Substring(imagePrefix.Length):"";
        submittedAttachment=submittedImage.Length==0?attachment:"";
        submittedFiles=attachedFiles.ToArray();
        string text=input.Text.Trim();if(text.Length+attachment.Length+submittedFiles.Length==0)return;
        if(text.Length+submittedAttachment.Length>12000){status.Text="입력과 첨부를 합쳐 12,000자 이내로 줄여 주세요.";return;}
        // 화면 조작은 에이전트가 직접 화면을 보고 처리하므로 대상 창을 미리 고르게 하지 않습니다(＋ 메뉴에서 고르는 것은 계속 가능).
        string draft=input.Text,attached=attachment;
        if(!prefs.chatFolders.ContainsKey(id)){prefs.chatFolders[id]=ProjectPath;SavePreferences();}
        webGrant="";
        if(!planning && !textOnly && Regex.IsMatch(text,@"웹에서|웹\s*검색|인터넷에서|검색해|검색해서|https?://",RegexOptions.IgnoreCase)){
            if(!prefs.webEnabled||prefs.webMode=="off"){status.Text="설정 → 일반에서 인터넷 사용을 켜세요.";return;}
            webGrant=text;
        }
        try{File.Delete(InboxPath());}catch{}
        busy=true;stopping=false;SyncControls();send.Content="■";StartEscWatch();send.ToolTip="응답 중지";AutomationProperties.SetName(send,"응답 중지");
        status.Text="";input.Clear();attachment="";var sentFiles=attachedFiles.ToList();attachedFiles.Clear();RenderAttachList();Add("user",(text.Length>0?text:"(파일만 보냄)")+(sentFiles.Count>0?"\n📎 "+String.Join(", ",sentFiles.Select(Path.GetFileName)):""),false,sentFiles.Concat(new[]{submittedImage}));
        BeginActivity();
        var elapsed=Stopwatch.StartNew();var timer=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromSeconds(1)};
        timer.Tick+=(s,e)=>UpdateActivityTime(elapsed);timer.Start();
        Find<Button>("ChangeChip").Visibility=Visibility.Collapsed;
        bool delivered=false;
        try{var reply=(Map)await Rpc("ask",text,null,textOnly);timer.Stop();
            string outcome=TurnOutcome(reply,TurnEvents(reply));
            EndActivity(elapsed,outcome.Length>0?outcome:"응답");
            bool notifyWhenDone=prefs.notify && !window.IsActive && (outcome=="작업 완료" || outcome=="답변 완료");
            Add("assistant",(string)reply["answer"],reply.ContainsKey("retryable")&&Equals(reply["retryable"],true),null,reply.ContainsKey("image")?reply["image"] as string:null,reply.ContainsKey("sourceOutput")&&Equals(reply["sourceOutput"],true),null,reply.ContainsKey("undoManifest")?Convert.ToString(reply["undoManifest"]):null);delivered=true;status.Text="";
            ShowTurnResults(reply);
            if(notifyWhenDone)System.Media.SystemSounds.Asterisk.Play();
            // 작업이 끝나는 순간에 들어와서 반영되지 못한 '지금 보내기'는 대기열 맨 앞으로 되돌립니다.
            if(reply.ContainsKey("late")&&reply["late"] is object[]){var lateList=((object[])reply["late"]).Select(lateObj=>Convert.ToString(lateObj)).Where(lateText=>lateText.Length>0).ToList();for(int lateIndex=lateList.Count-1;lateIndex>=0;lateIndex--)queue.Insert(0,lateList[lateIndex]);if(lateList.Count>0)status.Text="작업이 끝나는 순간에 보낸 메시지 "+lateList.Count+"개는 대기열로 옮겼어요.";}
            await Refresh();}
        catch(Exception x){if(!delivered){
                if(!stopping){
                    CrashLog("요청 처리",x);
                    string reason=x.Message;
                    if(reason.IndexOf("CUDA error",StringComparison.OrdinalIgnoreCase)>=0)
                        reason="GPU 초기화에 실패해 모델을 실행하지 못했어요.";
                    else if(reason.Contains("응답 실패") || reason.Contains("llama-server") || reason.Contains("{\"error\""))
                        reason="모델이 응답하지 못했어요. 자세한 내용은 앱 오류 로그에서 확인할 수 있어요.";
                    if(activeLines!=null)LogLine(activeLines,reason);
                }
                EndActivity(elapsed,stopping?"응답 중지":"작업 중단");
                if(!stopping && input.Text.Length==0 && attachedFiles.Count==0 && attachment.Length==0){
                    input.Text=draft;attachment=attached;attachedFiles.AddRange(submittedFiles);RenderAttachList();input.CaretIndex=input.Text.Length;
                }
            }
            status.Text=stopping?"응답을 중지했어요.":"";}
        finally{timer.Stop();StopEscWatch();HideAsk(null);if(stopping&&queue.Count>0)queuePaused=true;busy=false;stopping=false;targetHandle=0;targetProcess=0;targetTitle="";SyncControls();if(window.IsActive)input.Focus();RenderQueue();RunQueue();}
    }
    // 예상 못한 오류가 나도 앱이 꺼지지 않게 막고, 원인을 작업로그\앱오류.log 에 남깁니다.
    static void CrashLog(string where,Exception e){
        try{string dir=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"작업로그");Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir,"앱오류.log"),DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")+" ["+where+"] "+e+"\r\n\r\n",new UTF8Encoding(false));}catch{}
    }
    internal static void RunApplication(){
        var app=new Application();
        app.DispatcherUnhandledException+=(s,e)=>{CrashLog("화면",e.Exception);e.Handled=true;
            try{CardNotice.Show("오류가 났지만 앱은 계속 켜 둘게요.\n\n"+e.Exception.Message+"\n\n자세한 내용: 작업로그\\앱오류.log","로컬 Gemma",MessageBoxButton.OK,MessageBoxImage.Warning);}catch{}};
        AppDomain.CurrentDomain.UnhandledException+=(s,e)=>CrashLog("앱",e.ExceptionObject as Exception??new Exception(Convert.ToString(e.ExceptionObject)));
        System.Threading.Tasks.TaskScheduler.UnobservedTaskException+=(s,e)=>{CrashLog("작업",e.Exception);e.SetObserved();};
        try{app.Run(new DesktopChat().window);}catch(Exception e){CrashLog("시작",e);CardNotice.Show(e.Message,"로컬 Gemma");}
    }
}

static class DesktopLauncher {
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
    static System.Threading.Mutex single;
    [STAThread] static void Main(){
        // 같은 폴더의 앱이 이미 켜져 있으면 새 창을 만들지 않고 기존 창을 앞으로 가져옵니다.
        // (두 번 켜지면 이전 작업이 화면과 끊긴 채 뒤에서 계속 도는 문제가 생깁니다.)
        bool created;
        string key="LocalGemmaDesktop-"+Convert.ToBase64String(System.Security.Cryptography.SHA1.Create().ComputeHash(Encoding.UTF8.GetBytes(AppDomain.CurrentDomain.BaseDirectory.ToLowerInvariant()))).Replace('/','_').Replace('+','-');
        single=new System.Threading.Mutex(true,key,out created);
        if(!created){
            try{
                var me=Process.GetCurrentProcess();
                foreach(var p in Process.GetProcessesByName(me.ProcessName)){
                    if(p.Id==me.Id||p.MainWindowHandle==IntPtr.Zero)continue;
                    ShowWindow(p.MainWindowHandle,9);SetForegroundWindow(p.MainWindowHandle);break;
                }
            }catch{}
            return;
        }
        // Set the WPF options before the first WPF object or window is created.
        AppContext.SetSwitch("Switch.System.Windows.DoNotScaleForDpiChanges",false);
        AppContext.SetSwitch("Switch.System.Windows.DoNotUsePresentationDpiCapabilityTier2OrGreater",false);
        DesktopChat.RunApplication();
    }
}



