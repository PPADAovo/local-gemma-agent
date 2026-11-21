using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Text;
using System.Windows.Media.Imaging;

partial class DesktopChat {
    public class Prefs {
        public string[] disabledApps {get;set;} public string[] allowedPrograms {get;set;}
        public bool pluginsDisabled {get;set;} public bool ctrlEnterSend {get;set;} public bool queueFirst {get;set;}
        public string featuredFile {get;set;} public bool sidebarOpen {get;set;}
        public bool webEnabled {get;set;} public bool memoryEnabled {get;set;}
        public string instructions {get;set;} public string memory {get;set;} public string approval {get;set;}
        public bool motion {get;set;} public bool notify {get;set;} public string font {get;set;}
        // ChatGPT 개인 맞춤 설정과 같은 항목
        public string nickname {get;set;} public string occupation {get;set;} public string about {get;set;}
        public string style {get;set;} public string warmth {get;set;} public string enthusiasm {get;set;} public string emoji {get;set;} public string headers {get;set;}
        public bool autoMemory {get;set;} public bool computerUse {get;set;} public bool fullAccess {get;set;}
        public bool? localFirst {get;set;} public string fallbackBrain {get;set;} public object externalFallback {get;set;}
        public void SelectBrain(string key){brain=key;fallbackBrain=null;externalFallback=key=="local"?(object)false:key;}
        public string webMode {get;set;} public string model {get;set;} public bool heartbeat {get;set;} public bool showOverlay {get;set;} public int effort {get;set;} public string brain {get;set;} public string loopMode {get;set;} public string projectDir {get;set;} public string[] recentProjects {get;set;}
        public System.Collections.Generic.Dictionary<string,string> chatFolders {get;set;} public System.Collections.Generic.Dictionary<string,string> projectNames {get;set;} public System.Collections.Generic.Dictionary<string,string> projectSections {get;set;} public string[] hiddenFolders {get;set;} public string[] pinnedFolders {get;set;} public bool foldProjects {get;set;}
        public System.Collections.Generic.Dictionary<string,string> ratings {get;set;}
        public Prefs(){ratings=new System.Collections.Generic.Dictionary<string,string>();chatFolders=new System.Collections.Generic.Dictionary<string,string>();projectNames=new System.Collections.Generic.Dictionary<string,string>();projectSections=new System.Collections.Generic.Dictionary<string,string>();motion=true;webEnabled=true;memoryEnabled=true;instructions="";memory="";approval="auto";nickname="";occupation="";about="";style="기본";warmth="기본";enthusiasm="기본";emoji="기본";headers="기본";autoMemory=true;computerUse=true;fullAccess=false;webMode="ask";model="";heartbeat=true;showOverlay=true;effort=-1;brain="local";projectDir="";}
    }
    Prefs prefs=new Prefs(); string webGrant="";
    // 설정 폴더: 앱 폴더 옆에 "사용자데이터"가 있으면 그곳(따로 쓰는 시험·휴대용 설치), 아니면 %LOCALAPPDATA%\LocalGemmaDesktop.
    // 정한 경로를 GEMMA_DATA_DIR로 넣어 두면 이 앱이 띄우는 node 에이전트도 같은 폴더를 씁니다.
    internal static string DataDir(){
        string set=Environment.GetEnvironmentVariable("GEMMA_DATA_DIR");
        if(!string.IsNullOrEmpty(set))return set;
        string portable=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"사용자데이터");
        string dir=Directory.Exists(portable)?portable:Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")??Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"LocalGemmaDesktop");
        if(Directory.Exists(portable))Environment.SetEnvironmentVariable("GEMMA_DATA_DIR",dir);
        return dir;
    }
    readonly string prefPath=Path.Combine(DataDir(),"preferences.json");
    string preferenceBaseline;
    void LoadPreferences(){try{if(File.Exists(prefPath))prefs=json.Deserialize<Prefs>(File.ReadAllText(prefPath));permission=prefs.approval=="confirm"?"confirm":(prefs.approval=="full"||prefs.fullAccess)?"full":"auto";Find<Button>("Access").Content=permission=="confirm"?"승인 요청":permission=="full"?"전체 액세스":"나 대신 승인";}catch(Exception e){prefs=new Prefs();status.Text=e.Message;}preferenceBaseline=json.Serialize(prefs);}
    void SavePreferences(string baseline=null){
        Directory.CreateDirectory(Path.GetDirectoryName(prefPath));
        string key="LocalGemmaPreferences-"+DesktopIntegrity.TextHash(Path.GetFullPath(prefPath).ToLowerInvariant());
        using(var guard=new System.Threading.Mutex(false,key)){
            bool held=false;try{
                try{held=guard.WaitOne(3000);}catch(System.Threading.AbandonedMutexException){held=true;}
                if(!held)throw new IOException("다른 창이 설정을 저장하고 있습니다. 다시 시도하세요.");
                using(DesktopIntegrity.AcquirePreferenceLock(prefPath,3000)){
                string desired=json.Serialize(prefs),latest=File.Exists(prefPath)?File.ReadAllText(prefPath):"{}";
                string merged=DesktopIntegrity.MergePreferences(baseline??preferenceBaseline??desired,desired,latest);
                string temp=prefPath+"."+Guid.NewGuid();
                try{File.WriteAllText(temp,merged,new UTF8Encoding(false));if(File.Exists(prefPath))File.Replace(temp,prefPath,null);else File.Move(temp,prefPath);}
                finally{if(File.Exists(temp))File.Delete(temp);}
                prefs=json.Deserialize<Prefs>(merged);preferenceBaseline=json.Serialize(prefs);
                }
            }finally{if(held)guard.ReleaseMutex();}
        }
    }
    string ProfilePhotoPath { get { return Path.Combine(Path.GetDirectoryName(prefPath),"profile.png"); } }
    ImageBrush profileBrush;
    static ImageBrush ReadProfilePhoto(string path){
        var image=new BitmapImage();
        using(var stream=File.OpenRead(path)){
            image.BeginInit();
            image.CacheOption=BitmapCacheOption.OnLoad;
            image.DecodePixelWidth=320;
            image.StreamSource=stream;
            image.EndInit();
        }
        var brush=new ImageBrush(image){Stretch=Stretch.UniformToFill};
        brush.Freeze();
        return brush;
    }
    void StoreProfilePhoto(string source){
        var brush=ReadProfilePhoto(source);
        var visual=new DrawingVisual();
        using(var dc=visual.RenderOpen())dc.DrawRectangle(brush,null,new Rect(0,0,160,160));
        var bitmap=new RenderTargetBitmap(160,160,96,96,PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder=new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        string path=ProfilePhotoPath,temp=path+"."+Guid.NewGuid();
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        try{
            using(var stream=File.Create(temp))encoder.Save(stream);
            if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
        }finally{if(File.Exists(temp))File.Delete(temp);}
        profileBrush=ReadProfilePhoto(path);
    }
    void ApplyBadge(Border badge){
        if(profileBrush==null)return;
        badge.Background=profileBrush;
        if(badge.Child!=null)badge.Child.Visibility=Visibility.Collapsed;
    }
    void ChooseProfilePhoto(Border preview){
        var picker=new CardPicker{Title="프로필 사진 선택",Filter="사진 (*.png, *.jpg, *.jpeg, *.bmp)|*.png;*.jpg;*.jpeg;*.bmp"};
        if(picker.ShowDialog(window)!=true)return;
        try{
            StoreProfilePhoto(picker.FileName);
            ApplyBadge((Border)Find<TextBlock>("ProfileInitials").Parent);
            ApplyBadge(preview);
        }catch(Exception){CardNotice.Show(window,"사진을 저장하지 못했습니다. 파일을 확인한 뒤 다시 선택해 주세요.","프로필 사진");}
    }
    void ShowProfileMenu(){
        var anchor = Find<Button>("RailProfile");
        var menu = new ContextMenu {
            PlacementTarget = anchor,
            Placement = System.Windows.Controls.Primitives.PlacementMode.Custom,
            Style = (Style)window.FindResource(typeof(ContextMenu)),
            Width = 286
        };
        menu.CustomPopupPlacementCallback = (popup, target, offset) => new[] {
            new System.Windows.Controls.Primitives.CustomPopupPlacement(
                new Point(target.Width + 2, target.Height - popup.Height),
                System.Windows.Controls.Primitives.PopupPrimaryAxis.Vertical)
        };

        var itemTemplate = (ControlTemplate)System.Windows.Markup.XamlReader.Parse(@"
            <ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
                 xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' TargetType='MenuItem'>
                <Border x:Name='row' Background='Transparent' CornerRadius='7' Padding='{TemplateBinding Padding}'>
                    <ContentPresenter ContentSource='Header' VerticalAlignment='Center'/>
                </Border>
                <ControlTemplate.Triggers>
                    <Trigger Property='IsHighlighted' Value='True'>
                        <Setter TargetName='row' Property='Background' Value='#EDF0F2'/>
                    </Trigger>
                    <Trigger Property='IsEnabled' Value='False'>
                        <Setter TargetName='row' Property='Opacity' Value='0.55'/>
                    </Trigger>
                </ControlTemplate.Triggers>
            </ControlTemplate>");

        string name = String.IsNullOrWhiteSpace(prefs.nickname) ? "로컬 Gemma" : prefs.nickname.Trim();
        var badge = new Border {
            Width = 32, Height = 32, CornerRadius = new CornerRadius(16),
            Background = new SolidColorBrush(Color.FromRgb(186,73,57)),
            Child = new TextBlock {
                Text = Find<TextBlock>("ProfileInitials").Text, Foreground = Brushes.White,
                FontSize = 12, HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        };
        ApplyBadge(badge);
        var identity = new StackPanel { Margin = new Thickness(10,0,0,0) };
        identity.Children.Add(new TextBlock {
            Text = name, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis
        });
        identity.Children.Add(new TextBlock {Text = "로컬 프로필", FontSize = 11, Foreground = Brushes.Gray});
        var header = new DockPanel();
        header.Children.Add(badge);
        header.Children.Add(identity);
        var profile = new MenuItem {
            Header = header, Template = itemTemplate, Padding = new Thickness(10,8,10,8),
            Focusable = false, IsHitTestVisible = false
        };
        System.Windows.Automation.AutomationProperties.SetName(profile, name + ", 로컬 프로필");
        menu.Items.Add(profile);

        var rule = new FrameworkElementFactory(typeof(Border));
        rule.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromRgb(227,230,232)));
        var dividerTemplate = new ControlTemplate(typeof(Separator)) { VisualTree = rule };
        Action divider = () => menu.Items.Add(new Separator {
            Height = 1, Margin = new Thickness(8,4,8,4),
            Template = dividerTemplate
        });
        Action<string,string,string,Action> row = (label, glyph, shortcut, action) => {
            var content = new DockPanel();
            content.Children.Add(new TextBlock {
                Text = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), Width = 27,
                FontSize = 16, VerticalAlignment = VerticalAlignment.Center
            });
            var hint = new TextBlock {
                Text = shortcut, Foreground = Brushes.DimGray, FontSize = 11.5,
                VerticalAlignment = VerticalAlignment.Center
            };
            DockPanel.SetDock(hint, Dock.Right);
            content.Children.Add(hint);
            content.Children.Add(new TextBlock {Text = label, VerticalAlignment = VerticalAlignment.Center});
            var item = new MenuItem {
                Header = content, Template = itemTemplate, Padding = new Thickness(10,8,10,8),
                MinHeight = 34, IsEnabled = action != null
            };
            System.Windows.Automation.AutomationProperties.SetName(item, label);
            System.Windows.Automation.AutomationProperties.SetAcceleratorKey(item, shortcut);
            if (action != null) item.Click += (s,e) => action();
            menu.Items.Add(item);
        };

        divider();
        row("프로필", "\uE77B", "", ()=>{CloseRailPage();ProfilePage();});
        row("설정", "\uE713", "Ctrl+,", ShowPreferences);
        divider();row("도움말", "\uE897", "", ()=>ShowPreferences("키보드 단축키"));
        menu.IsOpen = true;
    }

    void ShowPreferences(){ShowPreferences("일반");}
    void ShowPreferences(string initial){
        string currentPermission=permission;LoadPreferences();permission=currentPermission;
        string dialogBaseline=json.Serialize(prefs);
        var grid=new Grid();
        grid.Resources[typeof(TextBox)]=window.Resources["PrefText"];grid.Resources[typeof(CheckBox)]=window.Resources["PrefCheck"];grid.Resources[typeof(ComboBox)]=window.Resources["PrefCombo"];grid.Resources[typeof(Button)]=window.Resources[typeof(Button)];grid.Resources[typeof(ListBoxItem)]=window.Resources[typeof(ListBoxItem)];
        grid.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(225)});grid.ColumnDefinitions.Add(new ColumnDefinition());
        var side=new DockPanel{Background=new SolidColorBrush(Color.FromRgb(247,249,251)),LastChildFill=true};grid.Children.Add(side);
        var back=RailButton("←  뒤로",()=>{CloseRailPage();input.Focus();});DockPanel.SetDock(back,Dock.Top);side.Children.Add(back);var label=new TextBlock{Text="설정",FontSize=20,FontWeight=FontWeights.SemiBold,Margin=new Thickness(19,18,0,14)};DockPanel.SetDock(label,Dock.Top);side.Children.Add(label);
        var filter=new TextBox{Margin=new Thickness(12,0,12,12),Padding=new Thickness(8),ToolTip="설정 검색"};System.Windows.Automation.AutomationProperties.SetName(filter,"설정 검색");var searchWrap=new Grid();searchWrap.Children.Add(filter);var hint=new TextBlock{Text="설정 검색",Foreground=Brushes.Gray,IsHitTestVisible=false,VerticalAlignment=VerticalAlignment.Center,Margin=new Thickness(23,0,0,12)};searchWrap.Children.Add(hint);filter.TextChanged+=(s,e)=>hint.Visibility=filter.Text.Length==0?Visibility.Visible:Visibility.Collapsed;DockPanel.SetDock(searchWrap,Dock.Top);side.Children.Add(searchWrap);
        var list=new ListBox{BorderThickness=new Thickness(0),Margin=new Thickness(8,0,6,8),Background=Brushes.Transparent};ScrollViewer.SetHorizontalScrollBarVisibility(list,ScrollBarVisibility.Disabled);side.Children.Add(list);
        var body=new StackPanel{Margin=new Thickness(22)};var card=new Border{MaxWidth=850,Child=body,Margin=new Thickness(25,28,25,28),VerticalAlignment=VerticalAlignment.Top,CornerRadius=new CornerRadius(14),BorderThickness=new Thickness(1),BorderBrush=new SolidColorBrush(Color.FromRgb(228,231,234)),Background=Brushes.White};var sc=new ScrollViewer{Content=card,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};Grid.SetColumn(sc,1);grid.Children.Add(sc);
        Action<string> desc=s=>body.Children.Add(new TextBlock{Text=s,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,6,0,10)});
        Action<string,Action> button=(s,a)=>{var b=new Button{Content=s,Background=new SolidColorBrush(Color.FromRgb(235,238,241)),Padding=new Thickness(12,5,12,5),HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,9,0,8)};b.Click+=(o,e)=>a();body.Children.Add(b);};
        var ins=new TextBox{Text=prefs.instructions,AcceptsReturn=true,TextWrapping=TextWrapping.Wrap,Height=85,MaxLength=4000,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
        var mem=new TextBox{Text=prefs.memory,AcceptsReturn=true,TextWrapping=TextWrapping.Wrap,Height=85,MaxLength=4000,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
        var motion=new CheckBox{Content="메뉴·버튼·작업 기록 애니메이션",IsChecked=prefs.motion};
        var notify=new CheckBox{Content="다른 창에서 작업할 때 완료 알림음 재생",IsChecked=prefs.notify};
        var fonts=new ComboBox{ItemsSource=new[]{"시스템","맑은 고딕","Noto Sans KR"},SelectedItem=prefs.font??"시스템",Width=180,HorizontalAlignment=HorizontalAlignment.Left};
        Func<string,TextBox> line=v=>new TextBox{Text=v??"",MaxLength=200,Padding=new Thickness(6,4,6,4),Margin=new Thickness(0,0,0,4)};
        var nick=line(prefs.nickname);var job=line(prefs.occupation);
        var about=new TextBox{Text=prefs.about??"",AcceptsReturn=true,TextWrapping=TextWrapping.Wrap,Height=70,MaxLength=2000,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
        Func<string[],string,ComboBox> pick=(items,v)=>new ComboBox{ItemsSource=items,SelectedItem=items.Contains(v)?v:items[0],Width=180,HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,0,0,6)};
        string[] levels={"기본","낮음","높음"};
        var style=pick(new[]{"기본","전문적","친근함","솔직함","간결함","유쾌함"},prefs.style);
        var warm=pick(levels,prefs.warmth);var enth=pick(levels,prefs.enthusiasm);var emo=pick(levels,prefs.emoji);var head=pick(levels,prefs.headers);
        var autoMem=new CheckBox{Content="대화 중 에이전트가 중요한 사실을 스스로 기억하도록 허용",IsChecked=prefs.autoMemory};
        var cu=new CheckBox{Content="모든 앱 · 컴퓨터 제어 허용",IsChecked=prefs.computerUse};
        var full=new CheckBox{Content="전체 액세스에서 인터넷 검색·주소 읽기와 파일 작업을 개별 승인 없이 실행",IsChecked=prefs.fullAccess};
        var webMode=pick(new[]{"매번 묻기","항상 허용","사용 안 함"},prefs.webMode=="always"?"항상 허용":prefs.webMode=="off"||!prefs.webEnabled?"사용 안 함":"매번 묻기");
        var modelBox=new ComboBox{IsEditable=true,Text=string.IsNullOrEmpty(prefs.model)?"자동":prefs.model,Width=260,HorizontalAlignment=HorizontalAlignment.Left};modelBox.Items.Add("자동");
        foreach(var name in InstalledModels())modelBox.Items.Add(name);
        var hb=new CheckBox{Content="하트비트: 30분마다 HEARTBEAT.md 목록을 점검하고 알릴 일이 있으면 알림",IsChecked=prefs.heartbeat};
        var overlay=new CheckBox{Content="작업 중 화면 위쪽에 진행 상황 배너와 클릭 위치 표시",IsChecked=prefs.showOverlay};
        Action<string> openFolder=name=>{string f=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,name);Directory.CreateDirectory(f);Process.Start("explorer.exe","\""+f+"\"");};
        var enabled=new CheckBox{Content="저장한 메모리 사용",IsChecked=prefs.memoryEnabled};var net=new CheckBox{Content="매번 승인한 뒤 웹 검색·주소 읽기 허용",IsChecked=prefs.webEnabled};var approval=new CheckBox{Content="파일 변경과 앱 조작 전 승인 요청",IsChecked=permission=="confirm"};
        approval.Checked+=(s,e)=>full.IsChecked=false;full.Checked+=(s,e)=>approval.IsChecked=false;
        var plugins=new CheckBox{Content="설치된 플러그인 사용",IsChecked=!prefs.pluginsDisabled};
        var sendKey=pick(new[]{"Enter","Ctrl+Enter"},prefs.ctrlEnterSend?"Ctrl+Enter":"Enter");
        var follow=pick(new[]{"현재 작업 조정","대기열에 추가"},prefs.queueFirst?"대기열에 추가":"현재 작업 조정");
        Action save=()=>{prefs.pluginsDisabled=plugins.IsChecked!=true;prefs.ctrlEnterSend=Equals(sendKey.SelectedItem,"Ctrl+Enter");prefs.queueFirst=Equals(follow.SelectedItem,"대기열에 추가");prefs.font=Convert.ToString(fonts.SelectedItem);prefs.motion=motion.IsChecked==true;prefs.notify=notify.IsChecked==true;prefs.instructions=ins.Text;prefs.memory=mem.Text;prefs.memoryEnabled=enabled.IsChecked==true;prefs.approval=approval.IsChecked==true?"confirm":(full.IsChecked==true?"full":"auto");
            prefs.nickname=nick.Text.Trim();prefs.occupation=job.Text.Trim();prefs.about=about.Text;prefs.style=(string)style.SelectedItem;prefs.warmth=(string)warm.SelectedItem;prefs.enthusiasm=(string)enth.SelectedItem;prefs.emoji=(string)emo.SelectedItem;prefs.headers=(string)head.SelectedItem;
            prefs.autoMemory=autoMem.IsChecked==true;prefs.heartbeat=hb.IsChecked==true;prefs.showOverlay=overlay.IsChecked==true;prefs.computerUse=cu.IsChecked==true;prefs.fullAccess=full.IsChecked==true;
            string wm=(string)webMode.SelectedItem;prefs.webMode=wm=="항상 허용"?"always":wm=="사용 안 함"?"off":"ask";prefs.webEnabled=prefs.webMode!="off";
            string chosen=(modelBox.Text??"").Trim();prefs.model=chosen=="자동"||chosen.Length==0?"":chosen;
            try{SavePreferences(dialogBaseline);LoadPreferences();ApplyFont();UpdateModelChip();SyncSendButton();CloseRailPage();}catch(Exception ex){CardNotice.Show(window,ex.Message);}};
        string[] pages={"일반","알림","가져오기","프로필","모양","계정","보관된 채팅","음성 스타일","저장 공간","개인 맞춤 설정","모델 및 연결","플러그인","컴퓨터 사용","브라우저","데이터 관리","작은 창","키보드 단축키","자동화","스킬","에이전트"};
        Action<string> head2=s=>body.Children.Add(new TextBlock{Text=s,FontSize=17,FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,16,0,4)});
        Action<string,FrameworkElement> row=(name,control)=>{
            var previousParent=control.Parent as Panel;
            if(previousParent!=null)previousParent.Children.Remove(control);
            var field=new Grid{Margin=new Thickness(0,4,0,6)};
            field.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(2,GridUnitType.Star),MaxWidth=150});
            field.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(3,GridUnitType.Star)});
            field.Children.Add(new TextBlock{Text=name,TextWrapping=TextWrapping.Wrap,VerticalAlignment=VerticalAlignment.Center,Margin=new Thickness(0,0,10,0)});
            if(!Double.IsNaN(control.Width)){control.MaxWidth=control.Width;control.Width=Double.NaN;}
            control.HorizontalAlignment=HorizontalAlignment.Stretch;
            System.Windows.Automation.AutomationProperties.SetName(control,name);
            Grid.SetColumn(control,1);
            field.Children.Add(control);
            body.Children.Add(field);
        };
        list.SelectionChanged+=(o,e)=>{body.Children.Clear();var item=list.SelectedItem as ListBoxItem;if(item==null){if(filter.Text.Trim().Length>0)desc("검색 결과 없음");return;}sc.ScrollToTop();string page=(string)item.Content;body.Children.Add(new TextBlock{Text=page,FontSize=24,FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,0,0,17)});
          switch(page){
          case "프로필":button("프로필 열기",()=>{CloseRailPage();CloseRailPage();ProfilePage();});break;
          case "계정":desc("이 PC의 로컬 프로필 · "+(string.IsNullOrWhiteSpace(prefs.nickname)?"로컬 Gemma":prefs.nickname));button("연결된 서비스 보기",()=>{CloseRailPage();CloseRailPage();RailPage("맞춤 설정");});break;

          case "음성 스타일":desc("마이크로 녹음한 한국어를 이 컴퓨터에서 문자로 변환합니다.");break;
          case "일반":
            button("플러그인 설정",()=>list.SelectedItem=list.Items.Cast<ListBoxItem>().First(i=>Equals(i.Content,"플러그인")));
            head2("입력창");row("보내기 단축키",sendKey);row("후속 메시지 처리 방식",follow);
            head2("오픈 소스 라이선스");button("PDF.js 라이선스 보기",()=>ShowFile(Path.Combine(BaseDir,"라이브러리","pdfjs","LICENSE")));

            head2("권한");desc("기본 권한: 작업공간 폴더의 파일은 승인 없이 읽고 고칩니다. 바뀐 파일은 복구 기록으로 되돌릴 수 있습니다.");body.Children.Add(full);body.Children.Add(approval);
            head2("인터넷");row("웹 검색·주소 읽기",webMode);desc("승인 요청 모드에서는 요청별로 확인합니다. 전체 액세스에서는 바로 실행하며, 사용 안 함은 모든 모드에 적용됩니다.");
            head2("모델");row("사용할 모델",modelBox);desc("‘자동’은 현재 메모리로 실행할 수 있는 설치된 모델 중 가장 높은 단계를 사용합니다. 입력창 오른쪽 아래 모델 버튼에서도 고르고 내려받을 수 있습니다. 화면 보기에는 이미지를 이해하는 모델이 필요합니다. 다음 요청부터 적용됩니다.");
            button("저장",save);break;
          case "개인 맞춤 설정":
            head2("메모리");body.Children.Add(enabled);body.Children.Add(autoMem);desc("저장된 메모리 (한 줄에 하나)");body.Children.Add(mem);
            button("메모리 전체 삭제",()=>{if(ConfirmRemoval(window,"메모리를 모두 삭제할까요?","메모리 내용을 모두 지웁니다. 설정을 저장하면 적용됩니다.","메모리 삭제"))mem.Clear();});
            head2("기본 스타일 및 톤");row("기본 스타일",style);row("따뜻함",warm);row("열정",enth);row("이모지 사용",emo);row("제목 및 목록",head);
            head2("사용자 지정 지침");row("호칭",nick);row("직업",job);desc("에이전트가 지켜야 할 요청사항 · 특성");body.Children.Add(ins);desc("나에 대해 알아야 할 점");body.Children.Add(about);
            button("지침.md 열기 (모든 대화에 적용되는 작업 규칙)",()=>{string f=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"지침.md");if(!File.Exists(f))File.WriteAllText(f,"# 작업 지침\n",new UTF8Encoding(false));Process.Start("notepad.exe","\""+f+"\"");});
            button("저장",save);break;
          case "자동화":desc("예약 작업: 채팅에서 \"매일 9시에 날씨 알려줘\"처럼 말하면 만들어집니다. 앱이 켜져 있는 동안 1분마다 확인해 실행하고, 결과는 새 채팅(⏰)과 Windows 알림으로 알려줍니다.");
            try{string tasksPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"기억","예약작업.json");if(File.Exists(tasksPath)){var arr=json.DeserializeObject(File.ReadAllText(tasksPath)) as object[];if(arr!=null)foreach(var ent in arr){var task=ent as System.Collections.Generic.Dictionary<string,object>;if(task!=null)desc("• "+task["name"]+(Convert.ToBoolean(task["enabled"])?"":" (끝남)"));}}else desc("(아직 예약 작업이 없습니다)");}catch{}
            head2("하트비트");body.Children.Add(hb);button("HEARTBEAT.md 열기 (점검 목록 편집)",()=>{string f=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"기억","HEARTBEAT.md");if(File.Exists(f))Process.Start("notepad.exe","\""+f+"\"");else openFolder("기억");});
            head2("기억 파일");desc("MEMORY.md(장기 기억), USER.md(프로필), 노트\\날짜.md(날짜별 노트). 매일 새벽 3시 이후 처음 켜져 있을 때 기억을 정리(드리밍)합니다.");button("기억 폴더 열기",()=>openFolder("기억"));
            button("저장",save);break;
          case "스킬":
            desc("로컬 모델이 요청에 맞는 스킬을 선택합니다. Gmail, Drive 같은 서비스는 연결된 계정의 도구를 사용합니다.");
            button("로컬 스킬 폴더 열기",()=>openFolder("스킬"));
            try{
                var entries=json.Deserialize<System.Collections.Generic.List<System.Collections.Generic.Dictionary<string,object>>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"codex-skill-catalog.json")));
                var own=Directory.GetDirectories(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"스킬")).Where(folder=>File.Exists(Path.Combine(folder,"SKILL.md"))).Select(Path.GetFileName);
                head2("로컬 스킬");desc(string.Join(" · ",own.OrderBy(n=>n)));
                head2("연결된 스킬");desc(string.Join(" · ",entries.Select(entry=>Convert.ToString(entry["name"])).OrderBy(n=>n)));
            }catch(Exception err){desc(err.Message);}
            break;
          case "에이전트":desc("메시지를 \"@이름 요청\"으로 시작하면 해당 에이전트가 처리합니다. 에이전트마다 모델·도구·지침·기억을 따로 둘 수 있습니다. 기본 제공: @코더, @리서처.");button("에이전트 폴더 열기",()=>openFolder("에이전트"));break;
          case "플러그인":button("플러그인 관리 열기",()=>{CloseRailPage();OpenPluginManager();});body.Children.Add(plugins);button("저장",save);break;
          case "컴퓨터 사용":desc("에이전트가 화면을 캡처해 보고, 마우스와 키보드로 앱을 조작합니다. 작업하는 동안 이 창은 잠시 최소화되고 끝나면 돌아옵니다.");head2("제어");body.Children.Add(cu);
            var disabled=new System.Collections.Generic.HashSet<string>(prefs.disabledApps??new string[0],StringComparer.OrdinalIgnoreCase);
            var allowed=new System.Collections.Generic.List<string>(prefs.allowedPrograms??new string[0]);
            foreach(var pair in new[]{"chrome|Google Chrome","msedge|Microsoft Edge","excel|Microsoft Excel","winword|Microsoft Word"}){
                var parts=pair.Split('|');string key=parts[0];
                var toggle=new CheckBox{Content=parts[1],IsChecked=!disabled.Contains(key),Margin=new Thickness(8,5,0,5)};
                toggle.Click+=(sender,args)=>{if(toggle.IsChecked==true)disabled.Remove(key);else disabled.Add(key);};body.Children.Add(toggle);
                if(key=="chrome"||key=="msedge")button(parts[1]+" 확장 관리",()=>{try{Process.Start(new ProcessStartInfo(key+".exe",key=="chrome"?"chrome://extensions":"edge://extensions"){UseShellExecute=true});}catch(Exception ex){CardNotice.Show(window,ex.Message);}});
            }
            head2("항상 허용된 앱");desc("목록에 없는 다른 앱을 제어할 때는 승인을 요청합니다.");
            var programs=new StackPanel();body.Children.Add(programs);
            Action refreshPrograms=()=>{programs.Children.Clear();foreach(string file in allowed.ToArray()){var r=new DockPanel();var del=new Button{Content="삭제",ToolTip=file};del.Click+=(sender,args)=>{if(!ConfirmRemoval(window,"‘"+Path.GetFileName(file)+"’ 허용을 해제할까요?","허용 프로그램 목록에서 제거합니다. 프로그램은 컴퓨터에 남습니다.","목록에서 제거"))return;allowed.Remove(file);programs.Children.Remove(r);};DockPanel.SetDock(del,Dock.Right);r.Children.Add(del);r.Children.Add(new TextBlock{Text=Path.GetFileName(file),ToolTip=file});programs.Children.Add(r);}};refreshPrograms();
            button("앱 추가",()=>{var pickExe=new CardPicker{Filter="앱 (*.exe)|*.exe"};if(pickExe.ShowDialog(window)==true&&!allowed.Contains(pickExe.FileName,StringComparer.OrdinalIgnoreCase)){allowed.Add(pickExe.FileName);refreshPrograms();}});
            body.Children.Add(overlay);
            desc("항상 막는 동작: 비밀번호·카드번호 입력, 결제·송금, 보안 설정 변경, Alt+F4·Ctrl+Alt+Del 같은 단축키.\n멈추려면 채팅 창의 ■ 버튼을 누르세요.");button("저장",()=>{prefs.disabledApps=disabled.ToArray();prefs.allowedPrograms=allowed.ToArray();save();});break;
          case "브라우저":desc("웹 검색·주소 읽기와 연결 서비스의 인터넷 사용을 설정합니다.");row("웹 사용",webMode);button("저장",save);break;
          case "보관된 채팅":button("보관된 채팅 보기",()=>{CloseRailPage();SetArchive(true);});break;
          case "저장 공간":button("작업 폴더 열기",()=>ShowFile(SpaceDir));break;
          case "데이터 관리":button("파일 변경 복구 기록 열기",()=>Folder("복구기록"));button("대화 저장 폴더 열기",()=>Folder("대화기록"));button("지침·메모리 내보내기",()=>{var d=new CardPicker{Save=true,Filter="JSON|*.json",FileName="Gemma 개인 설정.json"};if(d.ShowDialog(window)==true)try{File.WriteAllText(d.FileName,json.Serialize(new{instructions=ins.Text,memory=mem.Text}),new UTF8Encoding(false));}catch(Exception ex){CardNotice.Show(window,ex.Message);}});break;
          case "가져오기":desc("내보낸 JSON 파일에서 지침과 메모리를 불러옵니다. 개인 맞춤 설정에서 검토한 뒤 저장하세요.");button("파일 선택",()=>{var d=new CardPicker{Filter="JSON|*.json"};if(d.ShowDialog(window)!=true)return;try{if(new FileInfo(d.FileName).Length>64000)throw new Exception("파일 크기 제한을 넘었습니다.");var data=json.Deserialize<System.Collections.Generic.Dictionary<string,string>>(File.ReadAllText(d.FileName));if(!data.ContainsKey("instructions")||!data.ContainsKey("memory")||data["instructions"]==null||data["memory"]==null||data["instructions"].Length>4000||data["memory"].Length>4000)throw new Exception("지원하는 개인 설정 파일이 아닙니다.");ins.Text=data["instructions"];mem.Text=data["memory"];filter.Clear();list.SelectedItem=list.Items.Cast<ListBoxItem>().First(i=>(string)i.Content=="개인 맞춤 설정");}catch(Exception ex){CardNotice.Show(window,ex.Message);}});break;
          case "작은 창":button(compact?"기본 창 복원":"작은 창 열기",()=>{CloseRailPage();ToggleCompact();});break;
          case "모양":desc("글꼴");body.Children.Add(fonts);desc("화면 반응");body.Children.Add(motion);desc("Windows에서 애니메이션이 꺼져 있으면 시스템 설정을 따릅니다.");button("저장",save);break;
          case "알림":body.Children.Add(notify);button("저장",save);break;
          case "모델 및 연결":desc("로컬 Ollama · "+(string.IsNullOrEmpty(prefs.model)?"자동 ("+AutoPick(InstalledModels())+")":prefs.model)+"\n127.0.0.1:11434\n앱 폴더: "+AppDomain.CurrentDomain.BaseDirectory);break;
          case "키보드 단축키":desc("Ctrl+N    새 채팅\nCtrl+K    채팅 검색\nCtrl+F    현재 대화에서 찾기\nAlt+← / →    이전·다음 대화\n"+(prefs.ctrlEnterSend?"Ctrl+Enter    보내기\nEnter    줄바꿈":"Enter    보내기\nShift+Enter    줄바꿈")+"\nCtrl+Shift+Space    작은 창 전환");break;}
        };
        Action populate=()=>{list.Items.Clear();foreach(var name in pages.Where(n=>n.Contains(filter.Text))){var it=new ListBoxItem{Content=name,Padding=new Thickness(14,6,8,6),ToolTip=name};list.Items.Add(it);}list.SelectedItem=list.Items.Cast<ListBoxItem>().FirstOrDefault(i=>i.IsEnabled);};filter.TextChanged+=(o,e)=>populate();populate();list.SelectedItem=list.Items.Cast<ListBoxItem>().FirstOrDefault(i=>(string)i.Content==initial);MountRail("설정",grid,true);filter.Focus();
    }
    void ApplyFont(){
        string nick=(prefs.nickname??"").Trim();
        var initials=System.Globalization.StringInfo.GetTextElementEnumerator(nick);
        var letters="";
        for(int i=0;i<2&&initials.MoveNext();i++)letters+=initials.GetTextElement();
        Find<TextBlock>("ProfileInitials").Text=letters.Length>0?letters.ToUpperInvariant():"LG";
        if(profileBrush==null && File.Exists(ProfilePhotoPath)){try{profileBrush=ReadProfilePhoto(ProfilePhotoPath);}catch(Exception){profileBrush=null;}}
        ApplyBadge((Border)Find<TextBlock>("ProfileInitials").Parent);
        window.FontFamily=new FontFamily(prefs.font=="맑은 고딕"?"Malgun Gothic":prefs.font=="Noto Sans KR"?"Noto Sans KR":"Segoe UI Variable Text, Noto Sans KR, Malgun Gothic");}
}
