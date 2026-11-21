using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Map=System.Collections.Generic.Dictionary<string,object>;

partial class DesktopChat {
    Expander activeLog;
    StackPanel activeLines;
    static DoubleAnimation Ease(double from,double to,int ms){
        return new DoubleAnimation(from,to,TimeSpan.FromMilliseconds(ms)){EasingFunction=new QuadraticEase{EasingMode=EasingMode.EaseOut},FillBehavior=FillBehavior.Stop};
    }
    void Appear(FrameworkElement element){
        if(!prefs.motion || !SystemParameters.ClientAreaAnimation)return;
        var slide=new TranslateTransform();element.RenderTransform=slide;
        slide.BeginAnimation(TranslateTransform.YProperty,Ease(4,0,145));
        element.BeginAnimation(UIElement.OpacityProperty,Ease(.35,1,140));
    }
    void UpdateModelActivity(){
        var icon=Find<System.Windows.Shapes.Path>("ModelActivity");
        bool visible=busy;
        if((icon.Visibility==Visibility.Visible)==visible)return;
        icon.Visibility=visible?Visibility.Visible:Visibility.Collapsed;
        var spin=(RotateTransform)icon.RenderTransform;
        var motion=visible && prefs.motion && SystemParameters.ClientAreaAnimation;
        spin.BeginAnimation(RotateTransform.AngleProperty,motion?new DoubleAnimation(0,360,TimeSpan.FromSeconds(1)){RepeatBehavior=RepeatBehavior.Forever}:null);
    }
    bool followingLatest=true;
    void FollowMessage(bool user){
        if(loading || user)followingLatest=true;
        if(followingLatest)Find<ScrollViewer>("Scroller").ScrollToEnd();
    }
    void BindMotion(){
        var scroller=Find<ScrollViewer>("Scroller");
        var bar=Find<System.Windows.Controls.Primitives.ScrollBar>("ChatScrollBar");
        bar.Scroll+=(s,e)=>scroller.ScrollToVerticalOffset(e.NewValue);
        bar.PreviewMouseWheel+=(s,e)=>{scroller.RaiseEvent(new System.Windows.Input.MouseWheelEventArgs(e.MouseDevice,e.Timestamp,e.Delta){RoutedEvent=UIElement.MouseWheelEvent});e.Handled=true;};
        var jump=Find<Button>("JumpLatest");
        jump.Click+=(s,e)=>{followingLatest=true;scroller.ScrollToEnd();input.Focus();};
        scroller.ScrollChanged+=(s,e)=>{
            if(e.OriginalSource!=scroller)return;
            double gap=scroller.ScrollableHeight-scroller.VerticalOffset;
            if(e.ExtentHeightChange==0 && e.ViewportHeightChange==0 && e.VerticalChange!=0)
                followingLatest=gap<4;
            if(followingLatest && gap>1 && (e.ExtentHeightChange!=0 || e.ViewportHeightChange!=0))
                scroller.ScrollToEnd();
            jump.Visibility=!followingLatest && gap>24 ? Visibility.Visible:Visibility.Collapsed;
        };
        // Window-scoped handlers die with their owner; global class handlers retained closed windows.
        window.AddHandler(ContextMenuService.ContextMenuOpeningEvent,new ContextMenuEventHandler((s,e)=>{
            var element=e.OriginalSource as FrameworkElement;
            if(element!=null&&element.ContextMenu!=null)Appear(element.ContextMenu);
        }));
        window.AddHandler(UIElement.PreviewMouseDownEvent,new System.Windows.Input.MouseButtonEventHandler((s,e)=>{
            if(!prefs.motion || !SystemParameters.ClientAreaAnimation)return;
            var at=e.OriginalSource as DependencyObject;
            while(at is Visual && !(at is Button))at=VisualTreeHelper.GetParent(at);
            var button=at as Button;if(button==null||!button.IsEnabled)return;
            var scale=new ScaleTransform();button.RenderTransformOrigin=new Point(.5,.5);button.RenderTransform=scale;
            scale.BeginAnimation(ScaleTransform.ScaleXProperty,Ease(.95,1,120));scale.BeginAnimation(ScaleTransform.ScaleYProperty,Ease(.95,1,120));
        }),true);
    }
    Expander LogCard(string header, StackPanel lines){
        var template = (ControlTemplate)window.FindResource("ActivityTemplate");
        var card = new Expander {
            Template = template, Header = header, Content = lines,
            Foreground = new SolidColorBrush(Color.FromRgb(111,116,120)),
            FontSize = 14, Margin = new Thickness(0,7,0,10)
        };
        card.Expanded += (sender,e) => {
            if (e.OriginalSource == card) Appear(lines);
        };
        messages.Children.Add(card);
        return card;
    }
    static string ElapsedLabel(long seconds){
        seconds=Math.Max(0,seconds);
        long hours=seconds/3600, minutes=(seconds%3600)/60;
        return (hours>0?hours+"시간 ":"")+(minutes>0?minutes+"분 ":"")+(seconds%60)+"초";
    }
    Button workBrowserButton;
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd,int cmd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
    Action showBrowser;
    bool keepBrowserButton;
    void BindBrowserButton(Action show,Action hide){
        showBrowser=show;
        if(activeLog==null)return;
        if(workBrowserButton!=null)messages.Children.Remove(workBrowserButton);
        var button=new Button{Content="브라우저 숨기기",HorizontalAlignment=HorizontalAlignment.Left,Padding=new Thickness(10,4,10,4),Margin=new Thickness(0,0,0,6)};
        bool visible=true;showBrowser=()=>{show();visible=true;button.Content="브라우저 숨기기";};
        button.Click+=(s,e)=>{if(visible && Equals(button.Content,"브라우저 숨기기")){hide();visible=false;button.Content="브라우저 보기";}else showBrowser();};workBrowserButton=button;
        messages.Children.Insert(messages.Children.IndexOf(activeLog)+1,button);
    }
    void OfferWorkBrowser(int pid,long handle=0,bool side=false){
        var browser=Process.GetProcessById(pid);
        Action show=()=>{
            try{
                if(browser.HasExited){status.Text="종료된 작업 창입니다.";return;}
                browser.Refresh();var hwnd=handle==0?browser.MainWindowHandle:new IntPtr(handle);
                uint actual;GetWindowThreadProcessId(hwnd,out actual);
                if(hwnd==IntPtr.Zero || actual!=pid){status.Text="작업 창을 찾지 못했습니다.";return;}
                var r=System.Windows.Forms.Screen.FromHandle(hwnd).WorkingArea;
                ShowWindowAsync(hwnd,9);SetWindowPos(hwnd,IntPtr.Zero,r.Left+r.Width/2,r.Top,r.Width-r.Width/2,r.Height,0x0014);
                SetForegroundWindow(hwnd);
            }catch(InvalidOperationException){status.Text="작업 창이 종료되었습니다.";}
        };
        Action hide=()=>{if(browser.HasExited)return;browser.Refresh();var hwnd=handle==0?browser.MainWindowHandle:new IntPtr(handle);uint actual;GetWindowThreadProcessId(hwnd,out actual);if(hwnd!=IntPtr.Zero && actual==pid)ShowWindowAsync(hwnd,6);};
        BindBrowserButton(show,hide);show();
    }
    string liveAction;
    long liveSeconds;
    StackPanel livePanel;
    TextBlock liveTime, liveSummary, liveTool, livePlan;
    void RefreshLiveHeader(){
        if(liveAction==null || liveTime==null)return;
        liveTime.Text=ElapsedLabel(liveSeconds)+(String.IsNullOrEmpty(pendingAsk)?" 동안 작업 중입니다":" 동안 사용자 확인을 기다리고 있습니다");
    }
    void UpdateActivityTime(Stopwatch elapsed){
        liveSeconds=(long)elapsed.Elapsed.TotalSeconds;RefreshLiveHeader();
    }
    void BeginActivity(){
        keepBrowserButton=false;workBrowserButton=null;showBrowser=null;
        activeLines=new StackPanel{Margin=new Thickness(1,7,0,2)};
        liveAction="요청을 확인하고 있습니다.";liveSeconds=0;activeLog=LogCard(liveAction,activeLines);activeLog.HorizontalAlignment=HorizontalAlignment.Left;
        livePanel=new StackPanel{Margin=new Thickness(0,10,0,12)};
        liveTime=new TextBlock{FontSize=14,Foreground=Brushes.Gray};
        livePanel.Children.Add(liveTime);
        livePanel.Children.Add(new Border{Height=1,Background=Brushes.Gainsboro,Margin=new Thickness(0,8,0,12)});
        livePlan=new TextBlock{FontSize=14,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,10),Visibility=Visibility.Collapsed};
        System.Windows.Automation.AutomationProperties.SetName(livePlan,"처음 작업 계획");
        livePanel.Children.Add(livePlan);
        liveSummary=new TextBlock{Text=liveAction,TextWrapping=TextWrapping.Wrap,FontSize=14};
        activeLog.Header=liveSummary.Text;
        liveTool=new TextBlock{FontSize=14,Foreground=Brushes.Gray,TextTrimming=TextTrimming.CharacterEllipsis,Margin=new Thickness(0,10,0,0),Visibility=Visibility.Collapsed};
        livePanel.Children.Add(liveTool);messages.Children.Insert(messages.Children.IndexOf(activeLog),livePanel);
        LogLine(activeLines,liveAction);RefreshLiveHeader();FollowMessage(false);
    }
    static FrameworkElement TerminalIcon(){
        var drawing=new System.Windows.Shapes.Path{
            Data=Geometry.Parse("M2,2.5 H12 Q13.5,2.5 13.5,4 V12 Q13.5,13.5 12,13.5 H2 Q0.5,13.5 0.5,12 V4 Q0.5,2.5 2,2.5 Z M3.4,6 L5.4,8 L3.4,10 M7.3,10 H10.2"),
            Stroke=Brushes.Gray,StrokeThickness=1.05,StrokeLineJoin=PenLineJoin.Round,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,
            Width=14,Height=16,Margin=new Thickness(0,0,7,0),VerticalAlignment=VerticalAlignment.Center};
        return drawing;
    }
    static string ActivityIcon(string action){
        if(action.Contains("명령")||action.Contains("코드 실행")||action=="terminal"||action=="run")return "\uE756";
        if(action.Contains("검색")||action=="find_file")return "\uE721";
        if(action.Contains("브라우저")||action.Contains("페이지")||action.Contains("주소"))return "\uE774";
        if(action.Contains("화면")||action.Contains("스크롤")||action.Contains("클릭")||action.Contains("창 "))return "\uE7F4";
        if(action.Contains("파일")||action.Contains("문서")||action.StartsWith("make_"))return "\uE8A5";
        if(action=="생각 중")return "\uE712";
        return "\uE946";
    }
    static bool IsThinkingStatus(string label){
        return label=="생각 중"||label=="요청을 이해하고 있습니다."||label=="다음 행동을 정하고 있습니다."||label=="요청을 정확한 작업 명세로 바꾸고 있습니다.";
    }
    RichTextBox LogDocument(StackPanel panel){
        var existing=panel.Children.OfType<RichTextBox>().FirstOrDefault();
        if(existing!=null)return existing;
        var detail=new RichTextBox(new System.Windows.Documents.FlowDocument{PagePadding=new Thickness(0)}){IsReadOnly=true,IsDocumentEnabled=true,BorderThickness=new Thickness(0),Padding=new Thickness(0),Background=Brushes.Transparent,Foreground=new SolidColorBrush(Color.FromRgb(119,119,119)),FontSize=14,VerticalScrollBarVisibility=ScrollBarVisibility.Disabled,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled};
        var menu=new ContextMenu();
        menu.Items.Add(new MenuItem{Header="선택한 내용 복사",Command=System.Windows.Input.ApplicationCommands.Copy,CommandTarget=detail});
        menu.Items.Add(new MenuItem{Header="전체 선택",Command=System.Windows.Input.ApplicationCommands.SelectAll,CommandTarget=detail});
        var copyAll=new MenuItem{Header="작업 내역 전체 복사"};
        copyAll.Click+=(s,e)=>{try{Clipboard.SetText(new System.Windows.Documents.TextRange(detail.Document.ContentStart,detail.Document.ContentEnd).Text);}catch(Exception err){status.Text="복사 실패: "+err.Message;}};
        menu.Items.Add(copyAll);detail.ContextMenu=menu;panel.Children.Add(detail);
        return detail;
    }
    void RemoveThinkingRow(StackPanel panel){
        if(panel==null)return;
        var detail=panel.Children.OfType<RichTextBox>().FirstOrDefault();
        if(detail==null)return;
        var last=detail.Document.Blocks.LastBlock;
        if(last!=null&&Equals(last.Tag,"생각 중"))detail.Document.Blocks.Remove(last);
    }
    void LogLine(StackPanel panel,string label){
        if(String.IsNullOrWhiteSpace(label))return;
        bool thinking=IsThinkingStatus(label);
        const string modelNotice=" 모델이 요청을 처리하고 있습니다.";
        if(panel==activeLines && label.EndsWith(modelNotice,StringComparison.Ordinal)){
            var used=label.Substring(0,label.Length-modelNotice.Length).Trim();
            if(used.Length>0 && used!=runningModel){runningModel=used;try{UpdateModelChip();}catch{}}
        }
        if(thinking && panel!=activeLines)return;
        if(panel==activeLines && livePlan!=null && label.StartsWith("작업 계획 · ",StringComparison.Ordinal)){
            livePlan.Text=label.Substring("작업 계획 · ".Length);
            livePlan.Visibility=Visibility.Visible;
        }
        if(panel==activeLines && liveAction!=null && !label.StartsWith("작업 계획 · ",StringComparison.Ordinal)){var summary=label.StartsWith("📷 ")?"화면 확인":label.Replace("\r"," ").Replace("\n"," ");liveAction=summary.Length>110?summary.Substring(0,109)+"…":summary;bool command=ActivityIcon(label.Split(new[]{" · "},2,StringSplitOptions.None)[0])=="\uE756";if(command || label.Contains(" · ") || label.StartsWith("📷 ")){if(command){liveTool.Inlines.Clear();liveTool.Inlines.Add(new System.Windows.Documents.InlineUIContainer(TerminalIcon()){BaselineAlignment=BaselineAlignment.Center});liveTool.Inlines.Add(summary);}else liveTool.Text="›  "+summary;liveTool.ToolTip=summary;liveTool.Visibility=Visibility.Visible;}else{liveSummary.Text=summary;}activeLog.Header=liveAction;RefreshLiveHeader();}
        var detail=LogDocument(panel);
        var blocks=detail.Document.Blocks;
        var previous=blocks.LastBlock;
        if(previous!=null&&Equals(previous.Tag,label))return;
        // "… (N초)"처럼 걸린 시간만 바뀌는 줄은 새로 쌓지 않고 같은 줄을 바꿉니다.
        var timed=new System.Text.RegularExpressions.Regex(@"\s\(\d+초\)$");
        if(previous!=null && timed.IsMatch(label) && timed.Replace(Convert.ToString(previous.Tag)??"","")==timed.Replace(label,""))blocks.Remove(previous);
        RemoveThinkingRow(panel);
        if(label.StartsWith("모델 불러오는 중")&&previous!=null&&Convert.ToString(previous.Tag).StartsWith("모델 불러오는 중"))blocks.Remove(previous);
        // 3단계: "📷 경로" 줄은 AI가 본 화면을 작은 그림으로 보여 줍니다(누르면 크게 열림).
        if(label.StartsWith("📷 ")){
            string shotFile=label.Substring(2).Trim();
            if(!File.Exists(shotFile)){blocks.Add(new System.Windows.Documents.Paragraph(new System.Windows.Documents.Run("📷 화면 확인 (캡처 파일은 정리됨)")){Tag=label});return;}
            try{
                var bmp=new System.Windows.Media.Imaging.BitmapImage();bmp.BeginInit();bmp.CacheOption=System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;bmp.UriSource=new Uri(shotFile);bmp.DecodePixelWidth=480;bmp.EndInit();
                var shot=new Border{CornerRadius=new CornerRadius(8),BorderBrush=new SolidColorBrush(Color.FromRgb(0xE2,0xE5,0xE8)),BorderThickness=new Thickness(1),Margin=new Thickness(0,4,0,6),HorizontalAlignment=HorizontalAlignment.Left,Cursor=System.Windows.Input.Cursors.Hand,ToolTip="AI가 본 화면 · 누르면 크게 보기",
                    Child=new Image{Source=bmp,MaxWidth=420,MaxHeight=240,Stretch=Stretch.Uniform}};
                shot.MouseLeftButtonUp+=(s,e)=>{try{Process.Start(new ProcessStartInfo(shotFile){UseShellExecute=true});}catch{}};
                shot.Tag=label;blocks.Add(new System.Windows.Documents.BlockUIContainer(shot){Tag=label});Appear(shot);
                if(panel==activeLines)FollowMessage(false);
            }catch{}
            return;
        }
        var paragraph=new System.Windows.Documents.Paragraph{Tag=thinking?"생각 중":label,Margin=new Thickness(0,4,0,4)};
        paragraph.Inlines.Add(new System.Windows.Documents.Run(label));
        blocks.Add(paragraph);
    }

    void EndActivity(Stopwatch watch,string outcome){
        if(activeLog==null)return;
        if(workBrowserButton!=null){if(!keepBrowserButton)messages.Children.Remove(workBrowserButton);workBrowserButton=null;}
        liveAction=null;messages.Children.Remove(livePanel);activeLog.Visibility=Visibility.Visible;RemoveThinkingRow(activeLines);
        activeLog.HorizontalAlignment=HorizontalAlignment.Stretch;activeLog.Header="작업 내역 · "+outcome+" · "+ElapsedLabel((long)watch.Elapsed.TotalSeconds);
    }
    void RestoreActivity(Map m){
        var lines=new StackPanel{Margin=new Thickness(1,7,0,2)};
        foreach(object label in (object[])m["activity"])LogLine(lines,Convert.ToString(label));
        long seconds;
        var events=TurnEvents(m);
        string outcome=TurnOutcome(m,events);
        if(outcome=="답변 완료" && events.Length==0 && !m.ContainsKey("scriptComplete"))outcome="완료";
        string header="작업 내역"+(outcome.Length>0?" · "+outcome:"");
        if(m.ContainsKey("seconds")&&Int64.TryParse(Convert.ToString(m["seconds"]),out seconds))header+=" · "+ElapsedLabel(seconds);
        LogCard(header,lines);
    }
    async Task<string> ReadDiagnostics(StreamReader reader,bool live){
        var errors=new StringBuilder();string line;
        while((line=await reader.ReadLineAsync())!=null){
            try{
            if(live && line=="@control idle"){if(controlNotice!=null){controlNotice.Close();controlNotice=null;}continue;}
            if(live && line=="@control active"){ShowControlNotice();continue;}
            if(live && line.StartsWith("@panelurl ",StringComparison.Ordinal)){
                OpenWebPanel(json.Deserialize<string>(line.Substring(10)));continue;
            }
            if(line.StartsWith("@usage ",StringComparison.Ordinal)){
                if(live)RecordUsage(json.Deserialize<Map>(line.Substring(7)));continue;
            }
            if(live && line.StartsWith("@progress ",StringComparison.Ordinal)){
                string label=json.Deserialize<string>(line.Substring(10));
                if(activeLines!=null)LogLine(activeLines,label);
            }else if(live && line.StartsWith("@worktab ",StringComparison.Ordinal) && line!="@worktab keep"){
                var parts=line.Split(' ');Guid ticket;
                if(parts.Length==3 && Guid.TryParse(parts[1],out ticket)){
                    string args="work-tab-client.mjs --show "+ticket.ToString()+" "+(parts[2]=="edge"?"edge":"chrome");
                    Action<string> move=verb=>Process.Start(new ProcessStartInfo("node.exe",args.Replace("--show",verb)){WorkingDirectory=AppDomain.CurrentDomain.BaseDirectory,UseShellExecute=false,CreateNoWindow=true});
                    BindBrowserButton(()=>move("--show"),()=>move("--hide"));
                }
            }else if(live && line=="@worktab keep"){keepBrowserButton=true;
            }else if(live && line.StartsWith("@browserwindow ",StringComparison.Ordinal)){
                try{var t=json.Deserialize<Map>(line.Substring("@browserwindow ".Length));OfferWorkBrowser(Convert.ToInt32(t["pid"]),Convert.ToInt64(t["handle"]),Equals(t["side"],true));}catch(ArgumentException){}
            }else if(live && line.StartsWith("@browserpid ",StringComparison.Ordinal)){
                int pid;if(Int32.TryParse(line.Substring(12),out pid))try{OfferWorkBrowser(pid);}catch(ArgumentException){}
            }else if(live && line.StartsWith("@ask ",StringComparison.Ordinal)){
                try{ShowAsk(json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(line.Substring(5)));}catch(Exception x){status.Text="질문 카드를 띄우지 못했습니다: "+x.Message;}
            }else if(live && line.StartsWith("@prefs ",StringComparison.Ordinal)){
                // 첫 설정 등에서 에이전트가 정한 호칭·승인 방식·모델을 앱 설정에 반영하고 저장합니다(앱이 나중에 덮어쓰지 않게).
                try{var p=json.Deserialize<Map>(line.Substring(7));
                    if(p.ContainsKey("nickname"))prefs.nickname=Convert.ToString(p["nickname"]);
                    if(p.ContainsKey("model"))prefs.model=Convert.ToString(p["model"]);
                    if(p.ContainsKey("approval")){string k=Convert.ToString(p["approval"]);if(k=="confirm"||k=="auto"||k=="full"){permission=k;prefs.approval=k;prefs.fullAccess=k=="full";Find<Button>("Access").Content=k=="confirm"?"승인 요청":k=="auto"?"나 대신 승인":"전체 액세스";}}
                    SavePreferences();UpdateModelChip();}catch(Exception x){status.Text="설정을 저장하지 못했습니다: "+x.Message;}
            }else if(live && line.StartsWith("@askdone ",StringComparison.Ordinal)){
                try{HideAsk(json.Deserialize<string>(line.Substring(9)));}catch{}
            }else errors.AppendLine(line);
            }catch(Exception error){
                // Keep draining even when a diagnostic is malformed or its UI handler fails.
                // Otherwise the child can block on a full stderr pipe while Rpc waits for exit.
                if(errors.Length<64000)errors.AppendLine("진행 메시지 처리 오류: "+error.Message);
            }
            if(errors.Length>64000)errors.Remove(0,errors.Length-64000);
        }
        return errors.ToString();
    }
}
