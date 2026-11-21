using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Input;
using Microsoft.Win32;
using Map=System.Collections.Generic.Dictionary<string,object>;

partial class DesktopChat {
    Action selectFile;
    bool planning,archiveView;
    string permission="auto";
    long targetHandle;
    int targetProcess;
    string targetTitle="";
    bool SelectNamedWindow(string goal){
        var matches=new List<Tuple<long,int,string>>();
        var root=System.Windows.Automation.AutomationElement.RootElement;
        foreach(System.Windows.Automation.AutomationElement el in root.FindAll(System.Windows.Automation.TreeScope.Children,System.Windows.Automation.Condition.TrueCondition)){
            try{var w=el.Current;if(w.ProcessId==Process.GetCurrentProcess().Id || w.NativeWindowHandle==0 || String.IsNullOrWhiteSpace(w.Name))continue;
                string process=Process.GetProcessById(w.ProcessId).ProcessName.ToLowerInvariant();
                string alias=process=="notepad"?"메모장":process=="mspaint"?"그림판":process=="chrome"?"크롬":process=="msedge"?"엣지":process=="calculatorapp"?"계산기":null;
                if((alias!=null && goal.Contains(alias)) || (w.Name.Length>=3 && goal.IndexOf(w.Name,StringComparison.OrdinalIgnoreCase)>=0))
                    matches.Add(Tuple.Create((long)w.NativeWindowHandle,w.ProcessId,w.Name));
            }catch(System.Windows.Automation.ElementNotAvailableException){}catch(ArgumentException){}catch(InvalidOperationException){}
        }
        if(matches.Count!=1)return false;targetHandle=matches[0].Item1;targetProcess=matches[0].Item2;targetTitle=matches[0].Item3;return true;
    }
    bool PickInputWindow(){
        var candidates=new List<Process>();
        foreach(var p in Process.GetProcesses()){
            try{if(p.Id!=Process.GetCurrentProcess().Id && p.MainWindowHandle!=IntPtr.Zero && !String.IsNullOrWhiteSpace(p.MainWindowTitle))candidates.Add(p);}catch(InvalidOperationException){}
        }
        var dialog=new CardWindow{Owner=window,Title="마우스·키보드 대상 창",Width=520,Height=380,WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var layout=new DockPanel{Margin=new Thickness(14)};
        var list=new ListBox();
        foreach(var p in candidates.OrderBy(p=>p.ProcessName))list.Items.Add(new ListBoxItem{Content=p.MainWindowTitle+"  ·  "+p.ProcessName,Tag=p});
        var choose=new Button{Content="이 창 조작",IsDefault=true,IsEnabled=false,Margin=new Thickness(0,8,0,0)};
        list.SelectionChanged+=(s,e)=>choose.IsEnabled=list.SelectedItem!=null;
        choose.Click+=(s,e)=>dialog.DialogResult=true;
        DockPanel.SetDock(choose,Dock.Bottom);layout.Children.Add(choose);layout.Children.Add(list);dialog.Content=layout;
        if(dialog.ShowDialog()!=true)return false;
        var selected=(Process)((ListBoxItem)list.SelectedItem).Tag;
        selected.Refresh();
        if(selected.HasExited||selected.MainWindowHandle==IntPtr.Zero){status.Text="선택한 창이 닫혔습니다.";return false;}
        targetProcess=selected.Id;targetHandle=selected.MainWindowHandle.ToInt64();targetTitle=selected.MainWindowTitle;
        status.Text="다음 요청의 조작 대상 · "+targetTitle;input.Focus();return true;
    }
    MenuItem Entry(ItemsControl menu,string label,Func<Task> run,string tip="",string shortcut=""){
        var item=new MenuItem{Header=label,IsEnabled=run!=null,InputGestureText=shortcut,ToolTip=tip.Length==0?null:tip,Padding=new Thickness(10,6,10,6)};
        ToolTipService.SetShowOnDisabled(item,true);
        if(run!=null)item.Click+=async(s,e)=>{e.Handled=true;try{if(busy || loading)return;await run();}catch(Exception x){status.Text=x.Message;}};
        menu.Items.Add(item);return item;
    }
    void Description(MenuItem item,string label,string description){
        var lines=new StackPanel();lines.Children.Add(new TextBlock{Text=label});lines.Children.Add(new TextBlock{Text=description,Foreground=Brushes.Gray,FontSize=13,Margin=new Thickness(0,2,0,1)});item.Header=lines;
        System.Windows.Automation.AutomationProperties.SetName(item,label);
    }
    Func<Task> Do(Action fn){return ()=>{fn();return Task.CompletedTask;};}
    ContextMenu Panel(Button anchor,double width){
        var menu=new ContextMenu{PlacementTarget=anchor,Placement=PlacementMode.Top,MinWidth=width,MaxHeight=Math.Max(240,window.ActualHeight-170),VerticalOffset=-6};
        return menu;
    }
    void ForgetVisit(string chat){
        for(int i=trail.Count-1;i>=0;i--){
            if(trail[i]!=chat)continue;
            trail.RemoveAt(i);
            if(i<=trailIndex)trailIndex--;
        }
    }
    async Task Navigate(int direction){
        int next=trailIndex+direction;
        if(busy||loading||next<0||next>=trail.Count)return;
        trailIndex=next;
        await Open(trail[next]);input.Focus();
    }
    void BindChatKeys(){
        search.PreviewKeyDown+=async(s,e)=>{
            if(e.Key==Key.Escape){e.Handled=true;search.Clear();search.Visibility=Visibility.Collapsed;input.Focus();return;}
            if(e.Key!=Key.Enter||busy||loading)return;
            e.Handled=true;
            string term=search.Text.Trim();
            try{if(term!=appliedSearch)await Refresh();}catch(Exception x){status.Text=x.Message;return;}
            if(term!=appliedSearch||!search.IsKeyboardFocusWithin)return;
            var first=Find<ListBox>("Pinned").Items.Cast<ListBoxItem>().Concat(chats.Items.Cast<ListBoxItem>()).FirstOrDefault();
            if(first!=null){await Open((string)first.Tag);input.Focus();}
        };
        window.PreviewKeyDown+=async(s,e)=>{
            if(e.Key==Key.Escape && Find<Border>("InfoPane").IsVisible){e.Handled=true;SetInfoVisible(false);return;}
            var navKey=e.Key==Key.System?e.SystemKey:e.Key;
            if(Keyboard.Modifiers==ModifierKeys.Alt && (navKey==Key.Left || navKey==Key.Right)){
                e.Handled=true;await Navigate(navKey==Key.Left?-1:1);return;
            }
            if(busy||loading||!history.Any(x=>(string)x["id"]==id))return;
            var mods=Keyboard.Modifiers;
            string label=mods==(ModifierKeys.Alt|ModifierKeys.Control)?(e.Key==Key.R?"이름 변경":e.Key==Key.P?(pins.Contains(id)?"고정 해제":"고정"):null):
                mods==(ModifierKeys.Control|ModifierKeys.Shift)?(e.Key==Key.U?"읽":e.Key==Key.A?(archiveView?"보관 해제":"보관"):null):null;
            if(label==null)return;e.Handled=true;
            var row=history.First(x=>(string)x["id"]==id);
            var entry=RowMenu(row).Items.OfType<MenuItem>().FirstOrDefault(x=>((string)x.Header).StartsWith(label,StringComparison.Ordinal));
            if(entry!=null)entry.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await Task.CompletedTask;
        };
    }
    void Heading(ItemsControl panel,string text){var header=new MenuItem{Header=text,IsEnabled=false,FontSize=13};panel.Items.Add(header);}
    void AccessMenu(){
        var panel=Panel(Find<Button>("Access"),330);
        Heading(panel,"에이전트 작업은 어떻게 승인할까요?");
        string[] keys={"confirm","auto","full"};
        string[] names={"승인 요청","나 대신 승인","전체 권한"};
        // 권한 표(permission-policy.mjs)와 같은 내용입니다. 표를 바꾸면 이 설명도 함께 바꿉니다.
        string[] descs={"파일 변경, 명령 실행, 앱 조작, 인터넷 사용 시 항상 확인합니다","위험할 수 있는 작업만 확인합니다 (원래 있던 파일 수정·삭제, 위험한 명령, 메일 보내기·사이트 공개)","인터넷과 이 PC의 파일·앱을 승인 없이 사용합니다. 되돌릴 수 없는 삭제만 확인합니다"};
        string[] chips={"승인 요청","나 대신 승인","전체 액세스"};
        for(int i=0;i<keys.Length;i++){
            string key=keys[i];string chip=chips[i];
            var item=Entry(panel,names[i],Do(()=>{permission=key;Find<Button>("Access").Content=chip;try{prefs.approval=key;prefs.fullAccess=key=="full";SavePreferences();}catch{}}),descs[i]);
            item.IsChecked=permission==key;
            Description(item,names[i],descs[i]);
        }
        panel.IsOpen=true;
    }
    void AddAttachmentOptions(MenuItem panel){


        
        Entry(panel,"마우스·키보드 대상 창 선택",Do(()=>PickInputWindow()));
        if(targetHandle!=0)Entry(panel,"대상 창 선택 해제",Do(()=>{targetHandle=0;targetProcess=0;targetTitle="";status.Text="";}));
        var files=new MenuItem{Header="첨부 옵션"};panel.Items.Add(files);
        Entry(files,"텍스트·코드 파일 첨부 (예전 방식)",Do(selectFile));Entry(files,"폴더 목록 첨부",Do(()=>{{var d=new CardPicker{Folder=true};if(d.ShowDialog(window)==true){
            attachment="\n\n첨부 폴더 "+Path.GetFileName(d.FileName)+"\n"+String.Join("\n",Directory.EnumerateFileSystemEntries(d.FileName).Take(100).Select(Path.GetFileName));SyncControls();}}}));
        Entry(panel,"화면 캡처 첨부",async()=>{
            string file=ImagePath();
            var info=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-actions.ps1")+"\" capture \""+file+"\""){UseShellExecute=false,CreateNoWindow=true};
            using(var process=Process.Start(info)){await Task.Run(()=>process.WaitForExit());if(process.ExitCode!=0)throw new IOException("화면 캡처 실패");}
            attachment=imagePrefix+file;SyncControls();
        });
        Entry(panel,"프로젝트에서 Work 시작",Do(()=>{New();status.Text="어디서나 작업 · 새 채팅";}));
    }
    async void AddMenu(){
        var frame=Find<Border>("ComposerFrame");
        var menu=Panel(attach,Math.Max(160,frame.ActualWidth+16));
        menu.PlacementTarget=frame;
        menu.HorizontalOffset=-8;
        menu.VerticalOffset=5;
        menu.MaxHeight=Math.Min(340,Math.Max(180,window.ActualHeight-160));
        menu.Style=(Style)window.FindResource(typeof(ContextMenu));
        Action<string> section=label=>menu.Items.Add(new TextBlock{Text=label,Foreground=Tone(140),FontSize=12,Margin=new Thickness(7,4,0,4)});
        Func<string,string,string,Action,MenuItem> row=(icon,label,hint,action)=>{
            var item=new MenuItem{Height=28,Padding=new Thickness(4,2,4,2)};
            var line=new StackPanel{Orientation=Orientation.Horizontal};
            line.Children.Add(new TextBlock{Text=icon,Width=22,Foreground=Tone(95)});
            line.Children.Add(new TextBlock{Text=label});
            line.Children.Add(new TextBlock{Text=hint,Foreground=Tone(160),Margin=new Thickness(8,0,0,0)});
            item.Header=line;
            System.Windows.Automation.AutomationProperties.SetName(item,label);
            if(action!=null)item.Click+=(sender,args)=>{args.Handled=true;try{action();}catch(Exception ex){status.Text=ex.Message;}};
            menu.Items.Add(item);
            return item;
        };
        Action<string> insert=value=>{input.SelectedText=value;input.CaretIndex=input.SelectionStart+input.SelectionLength;input.Focus();};
        section("추가");
        row("📎","파일 및 폴더","",PickFiles);
        var options=row("▣","로컬 Gemma 첨부","",null);
        AddAttachmentOptions(options);
        row("◎","목표","계속 추구할 목표를 설정합니다",()=>insert("목표: "));
        row("♧","계획 모드",planning?"계획 모드 끄기":"계획 모드 켜기",()=>{planning=!planning;status.Text=planning?"계획 모드 · 도구 실행 없이 답합니다.":"";}).IsEnabled=!busy;
        row("〽","스케치","스케치 그리기",Sketch);
        section("플러그인");
        menu.IsOpen=true;
        try{
            var catalog=(Map)await Rpc("pluginManager",json.Serialize(new{tab="플러그인"}));
            if(!menu.IsOpen)return;
            foreach(var plugin in ((object[])catalog["rows"]).Cast<Map>()){
                string name=Convert.ToString(plugin["name"]);
                var item=row("◇",name,Convert.ToString(plugin["description"]),()=>insert("@"+name+" "));
                string icon=Path.Combine(BaseDir,"plugin-icons",Convert.ToString(plugin["slug"])+".png");
                if(File.Exists(icon)){
                    var line=(StackPanel)item.Header;
                    line.Children.RemoveAt(0);
                    line.Children.Insert(0,new Image{Source=new BitmapImage(new Uri(icon)),Width=15,Height=15,Margin=new Thickness(0,0,7,0)});
                }
                item.IsEnabled=Equals(plugin["enabled"],true);
            }
        }catch(Exception ex){if(menu.IsOpen)status.Text=ex.Message;}
    }
    string ImagePath(){var folder=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"작업공간","첨부");Directory.CreateDirectory(folder);return Path.Combine(folder,Guid.NewGuid()+".png");}
    void Sketch(){
        var d=new CardWindow{Owner=window,Title="스케치",Width=580,Height=440,WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var layout=new DockPanel();var bar=new StackPanel{Orientation=Orientation.Horizontal};
        var canvas=new InkCanvas{Background=Brushes.White};var clear=new Button{Content="지우기"};var use=new Button{Content="스케치 첨부"};
        clear.Click+=(s,e)=>{if(canvas.Strokes.Count>0 && ConfirmRemoval(d,"스케치를 지울까요?","지금 그린 선을 모두 지웁니다.","스케치 지우기"))canvas.Strokes.Clear();};use.Click+=(s,e)=>{if(canvas.Strokes.Count==0)return;
            var bitmap=new RenderTargetBitmap((int)canvas.ActualWidth,(int)canvas.ActualHeight,96,96,PixelFormats.Pbgra32);
            bitmap.Render(canvas);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));var path=ImagePath();
            using(var file=File.Create(path))encoder.Save(file);attachment=imagePrefix+path;SyncControls();d.DialogResult=true;};
        bar.Children.Add(clear);bar.Children.Add(use);DockPanel.SetDock(bar,Dock.Bottom);layout.Children.Add(bar);layout.Children.Add(canvas);d.Content=layout;d.ShowDialog();
    }
    string Prompt(string title,string value){
        var d=new CardWindow{Owner=window,Title=title,Width=410,Height=215,ResizeMode=ResizeMode.NoResize,WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var panel=new StackPanel{Margin=new Thickness(16)};var field=new TextBox{Text=value,Padding=new Thickness(6)};var ok=new Button{Content="저장",Margin=new Thickness(0,9,0,0),IsDefault=true};
        ok.Click+=(s,e)=>{if(field.Text.Trim().Length>0)d.DialogResult=true;};panel.Children.Add(field);panel.Children.Add(ok);d.Content=panel;d.Loaded+=(s,e)=>{field.Focus();field.SelectAll();};
        return d.ShowDialog()==true?field.Text.Trim():null;
    }
    async Task<Map> Modify(string chat,string action,string value=""){
        var reply=(Map)await Rpc("manage",json.Serialize(new{action,value}),chat);await Refresh();return reply;
    }
    async Task<string> Transcript(string chat){
        var turns=(object[])await Rpc("load","",chat);return String.Join("\n\n",turns.Cast<Map>().Select(m=>((string)m["role"]=="user"?"사용자":"로컬 Gemma")+"\n"+m["content"]));
    }
    void Separate(string chat){var extra=new DesktopChat(true,chat);extra.window.Show();extra.window.Activate();}
    void SetArchive(bool archived){archiveView=archived;if(compact)ToggleCompact();Side(true);Find<TextBlock>("ListHeading").Text=archived?"보관된 채팅":"최근";Filter();}
    void OpenThreadMenu(ContextMenu menu,Button anchor){
        var surface=(FrameworkElement)window.Content;
        menu.Style=(Style)window.FindResource("ThreadGlass");
        menu.MinWidth=Math.Min(260,surface.ActualWidth);
        menu.MaxWidth=surface.ActualWidth;
        menu.MaxHeight=surface.ActualHeight-8;
        menu.PlacementTarget=anchor;
        menu.Placement=PlacementMode.Custom;
        menu.CustomPopupPlacementCallback=(size,target,offset)=>{
            var at=anchor.TranslatePoint(new Point(),surface);
            double x=surface.ActualWidth-at.X-size.Width;
            double y=Math.Max(0,Math.Min(at.Y+target.Height-3,surface.ActualHeight-size.Height));
            return new[]{new CustomPopupPlacement(new Point(x,y-at.Y),PopupPrimaryAxis.None)};
        };
        menu.Opened+=(s,e)=>{
            var glass=menu.Template.FindName("Backdrop",menu) as Border;
            if(glass==null || glass.ActualWidth<=0 || glass.ActualHeight<=0)return;
            var origin=surface.PointFromScreen(glass.PointToScreen(new Point()));
            glass.Background=new VisualBrush(surface){ViewboxUnits=BrushMappingMode.Absolute,
                Viewbox=new Rect(origin,new Size(glass.ActualWidth,glass.ActualHeight)),Stretch=Stretch.Fill};
        };
        EventHandler moved=(s,e)=>menu.IsOpen=false;
        SizeChangedEventHandler resized=(s,e)=>menu.IsOpen=false;
        window.LocationChanged+=moved;window.SizeChanged+=resized;
        menu.Closed+=(s,e)=>{window.LocationChanged-=moved;window.SizeChanged-=resized;};
        menu.IsOpen=true;
    }
    static bool ConfirmRemoval(Window owner,string title,string detail,string action){
        var dialog=new Window{Title=title,Owner=owner,WindowStyle=WindowStyle.None,AllowsTransparency=true,
            Background=new SolidColorBrush(Color.FromArgb(48,0,0,0)),ShowInTaskbar=false,ResizeMode=ResizeMode.NoResize,
            WindowStartupLocation=WindowStartupLocation.CenterOwner,Width=owner.ActualWidth,Height=owner.ActualHeight,FontFamily=owner.FontFamily};
        var card=(Border)System.Windows.Markup.XamlReader.Parse(@"<Border xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
            HorizontalAlignment='Center' VerticalAlignment='Center' Background='#FFFCFBFC' CornerRadius='20' Padding='20'>
            <Border.Effect><DropShadowEffect BlurRadius='14' ShadowDepth='3' Opacity='0.16'/></Border.Effect>
            <StackPanel>
              <StackPanel.Resources><Style TargetType='Button'><Setter Property='BorderThickness' Value='0'/><Setter Property='Padding' Value='14,6'/>
                <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'><Border Name='Face' Background='{TemplateBinding Background}' CornerRadius='9' Padding='{TemplateBinding Padding}'>
                  <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border><ControlTemplate.Triggers>
                  <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='Face' Property='Opacity' Value='0.75'/></Trigger>
                  <Trigger Property='IsKeyboardFocused' Value='True'><Setter TargetName='Face' Property='BorderBrush' Value='Gray'/><Setter TargetName='Face' Property='BorderThickness' Value='1'/></Trigger>
                  </ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style></StackPanel.Resources>
              <DockPanel><Button Name='CloseAction' DockPanel.Dock='Right' Content='×' ToolTip='닫기' Background='Transparent' Padding='7,2' VerticalAlignment='Top'/>
                <TextBlock Name='Heading' FontSize='19' FontWeight='SemiBold' TextWrapping='Wrap' MaxHeight='80' TextTrimming='CharacterEllipsis'/></DockPanel>
              <TextBlock Name='Detail' Foreground='#676767' TextWrapping='Wrap' Margin='0,8,0,16'/>
              <StackPanel Orientation='Horizontal' HorizontalAlignment='Right'><Button Name='CancelAction' Background='Transparent' Content='취소' Margin='0,0,10,0'/>
                <Button Name='ConfirmAction' Background='#FBDDDD' Foreground='#B02020'/></StackPanel>
            </StackPanel></Border>");
        dialog.Content=card;
        card.Width=Math.Min(420,Math.Max(150,owner.ActualWidth-32));
        ((TextBlock)card.FindName("Heading")).Text=title;
        ((TextBlock)card.FindName("Detail")).Text=detail;
        foreach(string name in new[]{"CloseAction","CancelAction","ConfirmAction"}){
            var button=(Button)card.FindName(name);
            
            bool confirm=name=="ConfirmAction";
            if(confirm)button.Content=action;
            button.Click+=(s,e)=>dialog.DialogResult=confirm;
        }
        dialog.ContentRendered+=(s,e)=>((Button)card.FindName("CancelAction")).Focus();
        dialog.PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape){e.Handled=true;dialog.DialogResult=false;}};
        return dialog.ShowDialog()==true;
    }
    // WPF selects a ListBoxItem on right down; stop that before SelectionChanged opens a chat.
    static void BindChatContextMenu(ListBoxItem item){
        item.PreviewMouseDown+=(s,e)=>{if(e.ChangedButton==MouseButton.Right)e.Handled=true;};
        item.PreviewMouseUp+=(s,e)=>{
            if(e.ChangedButton!=MouseButton.Right || item.ContextMenu==null)return;
            e.Handled=true;
            item.ContextMenu.PlacementTarget=item;
            item.ContextMenu.Placement=PlacementMode.MousePoint;
            item.ContextMenu.IsOpen=true;
        };
    }
    static FrameworkElement ChatMenuIcon(string label){
        string shape;
        switch(label){
            case "이 대화에서 찾기":shape="M11,11 L15,15 M12,7 A5,5 0 1 1 2,7 A5,5 0 1 1 12,7";break;
            case "이름 변경":shape="M3,10 L10.5,2.5 Q11.5,1.5 12.5,2.5 L13.5,3.5 Q14.5,4.5 13.5,5.5 L6,13 L2,14 Z M9.5,3.5 L12.5,6.5";break;
            case "고정":case "고정 해제":shape="M6,2 H12 L11,6 L14,9 L9,10 L5,6 Z M8,9 L2,15";break;
            case "읽음으로 표시":case "읽지 않음으로 표시":shape="M1,8 Q8,-1 15,8 Q8,17 1,8 Z M10,8 A2,2 0 1 1 6,8 A2,2 0 1 1 10,8";break;
            case "프로젝트":shape="M2,5 V3 H6 L8,5 H14 V8 M2,7 V13 H7 M8,10 H15 M12,7 L15,10 L12,13";break;
            case "섹션":shape="M2,3 H14 M2,7 H10 M2,11 H14 M2,15 H10";break;
            case "포크":shape="M4,5 V11 M4,8 H9 Q12,8 12,5 M6,3 A2,2 0 1 1 2,3 A2,2 0 1 1 6,3 M6,13 A2,2 0 1 1 2,13 A2,2 0 1 1 6,13 M14,3 A2,2 0 1 1 10,3 A2,2 0 1 1 14,3";break;
            case "공유 · 파일로 내보내기":shape="M8,11 V1 M5,4 L8,1 L11,4 M2,9 V14 H14 V9";break;
            case "복사":shape="M5,5 H14 V14 H5 Z M2,11 V2 H11";break;
            case "새 창에서 열기":shape="M8,2 H3 Q1,2 1,4 V13 Q1,15 3,15 H12 Q14,15 14,13 V9 M9,1 H15 V7 M15,1 L7,9";break;
            case "보관":case "보관 해제":shape="M2,2 H14 V5 H2 Z M3,5 V14 H13 V5 M6,8 H10";break;
            case "영구 삭제":shape="M2,4 H14 M6,4 V2 H10 V4 M4,4 L5,14 H11 L12,4 M7,7 V11 M9,7 V11";break;
            default:return null;
        }
        var line=new System.Windows.Shapes.Path{Data=Geometry.Parse(shape),StrokeThickness=1.15,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,StrokeLineJoin=PenLineJoin.Round};
        line.SetBinding(System.Windows.Shapes.Shape.StrokeProperty,new System.Windows.Data.Binding("Foreground"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.FindAncestor,typeof(MenuItem),1)});
        var canvas=new Canvas{Width=16,Height=16};canvas.Children.Add(line);
        return new Viewbox{Width=15,Height=15,Child=canvas,IsHitTestVisible=false};
    }
    ContextMenu RowMenu(Map row){
        string chat=(string)row["id"];var m=new ContextMenu{MinWidth=246};
        if(chat==id)Entry(m,"이 대화에서 찾기",Do(OpenFind),"","Ctrl+F");
        Entry(m,"이름 변경",async()=>{var text=Prompt("채팅 이름 변경",(string)row["title"]);if(text!=null)await Modify(chat,"title",text);},"","Alt+Ctrl+R");
        Entry(m,pins.Contains(chat)?"고정 해제":"고정",Do(()=>{if(!pins.Remove(chat))pins.Add(chat);File.WriteAllText(pinPath,json.Serialize(pins.ToArray()));Filter();}),"","Alt+Ctrl+P");
        Entry(m,(bool)row["unread"]?"읽음으로 표시":"읽지 않음으로 표시",async()=>{await Modify(chat,"unread",((bool)row["unread"]?"false":"true"));},"","Ctrl+Shift+U");
        Entry(m,"프로젝트",null,"다른 프로젝트로의 이동은 지원하지 않습니다.");
        var sections=new MenuItem{Header="섹션"};m.Items.Add(sections);Entry(sections,"섹션 지정",async()=>{var name=Prompt("섹션 이름",(string)row["section"]);if(name!=null)await Modify(chat,"section",name);});Entry(sections,"섹션 해제",async()=>{await Modify(chat,"section","");});
        m.Items.Add(new Separator());var fork=new MenuItem{Header="포크"};m.Items.Add(fork);Entry(fork,"이 대화에서 새 채팅",async()=>{var clone=await Modify(chat,"fork");await Open((string)clone["id"]);});
        m.Items.Add(new Separator());Entry(m,"공유 · 파일로 내보내기",async()=>{var d=new CardPicker{Save=true,FileName="대화.txt",Filter="텍스트|*.txt"};if(d.ShowDialog(window)==true)File.WriteAllText(d.FileName,await Transcript(chat));});
        var copy=new MenuItem{Header="복사"};m.Items.Add(copy);Entry(copy,"대화 복사",async()=>Clipboard.SetText(await Transcript(chat)));Entry(copy,"이름 복사",Do(()=>Clipboard.SetText((string)row["title"])));
        m.Items.Add(new Separator());Entry(m,"새 창에서 열기",Do(()=>Separate(chat)));m.Items.Add(new Separator());
        Entry(m,(bool)row["archived"]?"보관 해제":"보관",async()=>{await Modify(chat,"archived",(bool)row["archived"]?"false":"true");if(chat==id)New();},"","Ctrl+Shift+A");
        Entry(m,"영구 삭제",async()=>{if(!ConfirmRemoval(window,"‘"+row["title"]+"’ 채팅을 삭제할까요?","이 채팅의 대화 기록이 영구 삭제됩니다.","채팅 삭제"))return;await Modify(chat,"delete");pins.Remove(chat);File.WriteAllText(pinPath,json.Serialize(pins.ToArray()));if(chat==id)New();drafts.Remove(chat);ForgetVisit(chat);SyncControls();});
        foreach(var item in m.Items.OfType<MenuItem>())item.Icon=ChatMenuIcon(Convert.ToString(item.Header));
        return m;
    }
}


