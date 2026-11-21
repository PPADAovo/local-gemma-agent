using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Web.WebView2.Wpf;

partial class DesktopChat {
    static SolidColorBrush Tone(byte gray){return new SolidColorBrush(Color.FromRgb(gray,gray,gray));}
    Button PaneButton(string label,string tip,Action click){
        var b=RailButton(label,click);b.ToolTip=tip;
        var paths=new System.Collections.Generic.Dictionary<string,string>{
            {"뒤로","M13,8 H2 M7,3 L2,8 L7,13"},{"앞으로","M3,8 H14 M9,3 L14,8 L9,13"},
            {"새로고침","M14,2 V6 H10 M2,14 V10 H6 M3,6 A6,6 0 0 1 13.5,5.5 M13,10 A6,6 0 0 1 2.5,10.5"},
            {"새 탭","M8,2 V14 M2,8 H14"},{"탭 닫기","M4,4 L12,12 M12,4 L4,12"},
            {"패널 닫기","M3,2 H13 Q15,2 15,4 V12 Q15,14 13,14 H3 Q1,14 1,12 V4 Q1,2 3,2 Z M10,2 V14"},
            {"다운로드","M8,1 V10 M4,6 L8,10 L12,6 M2,10 V13 Q2,15 4,15 H12 Q14,15 14,13 V10"}
        };string path;if(paths.TryGetValue(tip,out path))b.Content=RailGlyph(path,Tone(63),null,12);b.Padding=new Thickness(6,3,6,3);b.MinHeight=27;b.HorizontalContentAlignment=HorizontalAlignment.Center;b.Foreground=Tone(53);
        System.Windows.Automation.AutomationProperties.SetName(b,tip);return b;
    }
    Border Pill(UIElement content,int radius,bool outline){
        return new Border{Child=content,CornerRadius=new CornerRadius(radius),Background=Brushes.White,BorderBrush=Tone(228),BorderThickness=new Thickness(outline?1:0),Margin=new Thickness(2)};
    }
    // The mobile web player reflows as the dock is resized, including during playback.
    static Uri PanelYouTubeUrl(Uri url,double width){
        if(width<=0 || width>=760)return url;
        var host=url.Host.ToLowerInvariant();
        if(host!="www.youtube.com" && host!="youtube.com" && host!="m.youtube.com" && host!="youtu.be")return url;
        var target=new UriBuilder(url){Host="m.youtube.com"};
        var kept=new System.Collections.Generic.List<string>();
        if(host=="youtu.be"){
            string video=url.AbsolutePath.Trim('/');
            if(video.Length==0||video.Contains("/"))return url;
            target.Path="/watch";kept.Add("v="+Uri.EscapeDataString(video));
        }
        foreach(var field in url.Query.TrimStart('?').Split('&')){
            string key=Uri.UnescapeDataString(field.Split('=')[0]);
            if(field.Length>0 && !key.Equals("app",StringComparison.OrdinalIgnoreCase) && !(host=="youtu.be" && key=="v"))kept.Add(field);
        }
        kept.Add("app=m");target.Query=String.Join("&",kept);return target.Uri;
    }
    void ToggleToolsPane(){
        if(toolsPane!=null){toolsPane.Visibility=toolsPane.IsVisible?Visibility.Collapsed:Visibility.Visible;PositionInfoPane();return;}
        var grid=new Grid();var dock=new DockPanel{Margin=new Thickness(5)};grid.Children.Add(dock);
        toolsPane=new Border{Child=grid,Width=396,MaxWidth=Math.Max(215,window.ActualWidth-55),HorizontalAlignment=HorizontalAlignment.Right,Background=Tone(250),CornerRadius=new CornerRadius(12),Margin=new Thickness(0,0,4,4)};
        window.SizeChanged+=(s,e)=>toolsPane.MaxWidth=Math.Max(215,window.ActualWidth-55);
        System.Windows.Controls.Panel.SetZIndex(toolsPane,4);Find<Grid>("Workspace").Children.Add(toolsPane);PositionInfoPane();AddPaneGrip(grid,false);
        var header=new DockPanel{Background=Brushes.White,Height=48};DockPanel.SetDock(header,Dock.Top);dock.Children.Add(header);
        var hide=PaneButton("◧","패널 닫기",()=>toolsPane.Visibility=Visibility.Collapsed);hide.Style=(Style)window.FindResource("PanelToggleDetail");hide.Width=32;hide.Height=32;hide.VerticalAlignment=VerticalAlignment.Center;DockPanel.SetDock(hide,Dock.Right);header.Children.Add(hide);
        double restoreWidth=396;bool expanded=false;var expand=PaneButton("⛶","패널 크기 전환",()=>{if(!expanded)restoreWidth=toolsPane.ActualWidth;expanded=!expanded;toolsPane.Width=expanded?toolsPane.MaxWidth:restoreWidth;});DockPanel.SetDock(expand,Dock.Right);header.Children.Add(expand);
        var strip=new StackPanel{Orientation=Orientation.Horizontal};var scroll=new ScrollViewer{Content=strip,VerticalScrollBarVisibility=ScrollBarVisibility.Disabled,HorizontalScrollBarVisibility=ScrollBarVisibility.Hidden};header.Children.Add(scroll);
        var pages=new Grid();dock.Children.Add(pages);
        Action create=null;var plus=PaneButton("＋","새 탭",()=>create());strip.Children.Add(plus);
        create=()=>{
            var body=new DockPanel();pages.Children.Add(body);
            var tabRow=new DockPanel{Width=148,Height=30,VerticalAlignment=VerticalAlignment.Center};var tab=Pill(tabRow,8,true);tab.VerticalAlignment=VerticalAlignment.Center;strip.Children.Insert(strip.Children.Count-1,tab);
            Action select=()=>{foreach(UIElement p in pages.Children)p.Visibility=p==body?Visibility.Visible:Visibility.Collapsed;foreach(var item in strip.Children.OfType<Border>())item.Background=item==tab?Brushes.White:Tone(244);tab.BringIntoView();};
            var title=PaneButton("","탭 선택",select);var caption=new StackPanel{Orientation=Orientation.Horizontal};caption.Children.Add(RailGlyph("M8,1 A7,7 0 1 1 7.99,1 Z M8,1 C3.5,4 3.5,12 8,15 C12.5,12 12.5,4 8,1 M1,8 H15",Tone(52),null,13));caption.Children.Add(new TextBlock{Text="새 탭",VerticalAlignment=VerticalAlignment.Center,Margin=new Thickness(6,0,0,0)});title.Content=caption;title.HorizontalContentAlignment=HorizontalAlignment.Left;
            var web=new WebView2{Visibility=Visibility.Collapsed,CreationProperties=new CoreWebView2CreationProperties{UserDataFolder=Path.Combine(Path.GetDirectoryName(prefPath),"side-browser")}};
            var native=new ChromePanel();var host=new System.Windows.Forms.Integration.WindowsFormsHost{Child=native,Visibility=Visibility.Collapsed};
            var close=PaneButton("×","탭 닫기",()=>{bool selected=body.Visibility==Visibility.Visible;pages.Children.Remove(body);strip.Children.Remove(tab);web.Dispose();host.Dispose();if(pages.Children.Count==0){create();toolsPane.Visibility=Visibility.Collapsed;}else if(selected)((Button)((DockPanel)strip.Children.OfType<Border>().Last().Child).Children[1]).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));});DockPanel.SetDock(close,Dock.Right);tabRow.Children.Add(close);tabRow.Children.Add(title);
            var bar=new DockPanel{Background=Brushes.White,Height=48,LastChildFill=true};DockPanel.SetDock(bar,Dock.Top);body.Children.Add(bar);
            var nav=new StackPanel{Orientation=Orientation.Horizontal};nav.Children.Add(PaneButton("←","뒤로",()=>{if(host.Visibility==Visibility.Visible)native.NavigateCommand(1);else if(web.CoreWebView2!=null&&web.CanGoBack)web.GoBack();}));nav.Children.Add(PaneButton("→","앞으로",()=>{if(host.Visibility==Visibility.Visible)native.NavigateCommand(2);else if(web.CoreWebView2!=null&&web.CanGoForward)web.GoForward();}));nav.Children.Add(PaneButton("⟳","새로고침",()=>{if(host.Visibility==Visibility.Visible)native.NavigateCommand(3);else if(web.CoreWebView2!=null)web.Reload();}));bar.Children.Add(Pill(nav,16,true));
            Uri original=null;Action external=()=>{var url=original??web.Source;if(url!=null)ShowFile(url.AbsoluteUri);};
            var options=PaneButton("⋯","브라우저 메뉴",()=>{});var menu=new ContextMenu();var open=new MenuItem{Header="기본 브라우저에서 열기"};open.Click+=(s,e)=>external();menu.Items.Add(open);options.Click+=(s,e)=>{menu.PlacementTarget=options;menu.IsOpen=true;};var opt=Pill(options,16,true);DockPanel.SetDock(opt,Dock.Right);bar.Children.Add(opt);
            var downloads=Pill(PaneButton("↓","다운로드",()=>ShowFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads"))),16,true);DockPanel.SetDock(downloads,Dock.Right);bar.Children.Add(downloads);
            var addrGrid=new Grid();var addr=new TextBox{TextAlignment=TextAlignment.Center,VerticalContentAlignment=VerticalAlignment.Center,Padding=new Thickness(8,0,8,0),BorderThickness=new Thickness(0),Background=Brushes.Transparent};var hint=new TextBlock{Text="검색어 또는 URL 입력",Foreground=Tone(130),HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center,IsHitTestVisible=false};addrGrid.Children.Add(addr);addrGrid.Children.Add(hint);addr.TextChanged+=(s,e)=>hint.Visibility=addr.Text.Length==0?Visibility.Visible:Visibility.Collapsed;bar.Children.Add(Pill(addrGrid,16,true));
            var area=new Grid();body.Children.Add(area);var list=new StackPanel{Margin=new Thickness(14,24,14,12)};var landing=new ScrollViewer{Content=list,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};area.Children.Add(landing);area.Children.Add(web);area.Children.Add(host);
            Func<Uri,bool> isYouTube=url=>url.Host=="youtube.com"||url.Host.EndsWith(".youtube.com",StringComparison.OrdinalIgnoreCase)||url.Host=="youtu.be"; Action<string> go=async value=>{value=value.Trim();if(value.Length==0)return;Uri url;if(!Uri.TryCreate(value,UriKind.Absolute,out url)||(url.Scheme!="https"&&url.Scheme!="http")){if(!value.Contains(".")||value.Contains(" ")||!Uri.TryCreate("https://"+value,UriKind.Absolute,out url))url=new Uri("https://www.google.com/search?q="+Uri.EscapeDataString(value));}if(url.Scheme!="https"&&url.Scheme!="http")return;
                original=url;landing.Visibility=Visibility.Collapsed;addr.Text=url.Host.Replace("www.","");Keyboard.ClearFocus();
                if(isYouTube(url)){
                    web.Visibility=Visibility.Collapsed;host.Visibility=Visibility.Visible;
                    var logo=new Grid{Width=16,Height=12};logo.Children.Add(new Border{Background=Brushes.Red,CornerRadius=new CornerRadius(4)});logo.Children.Add(new System.Windows.Shapes.Path{Data=Geometry.Parse("M0,0 L6,3 L0,6 Z"),Fill=Brushes.White,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center});
                    var tabLabel=new StackPanel{Orientation=Orientation.Horizontal};tabLabel.Children.Add(logo);tabLabel.Children.Add(new TextBlock{Text="YouTube",Margin=new Thickness(6,0,0,0)});title.Content=tabLabel;
                    try{await native.Open(PanelYouTubeUrl(url,toolsPane.ActualWidth));}catch(Exception ex){status.Text=ex.Message;host.Visibility=Visibility.Collapsed;landing.Visibility=Visibility.Visible;}return;
                }
                host.Visibility=Visibility.Collapsed;web.Visibility=Visibility.Visible;web.Source=url;};
            web.NavigationStarting+=(s,e)=>{Uri url;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out url))return; if(isYouTube(url)&&(url.Scheme=="https"||url.Scheme=="http")){e.Cancel=true;web.Dispatcher.BeginInvoke(new Action(()=>go(url.AbsoluteUri)));return;} if(url.Host=="accounts.google.com"){e.Cancel=true;ShowFile(original!=null&&original.Host!="accounts.google.com"?original.AbsoluteUri:"https://accounts.google.com/");status.Text="기본 브라우저에서 Google 로그인을 계속하세요."; }};
            web.NavigationCompleted+=(s,e)=>{if(e.IsSuccess&&web.Source!=null){original=web.Source;addr.Text=web.Source.Host.Replace("www.","");title.Content=new TextBlock{Text=web.Source.Host,TextTrimming=TextTrimming.CharacterEllipsis};}};
            addr.GotKeyboardFocus+=(s,e)=>{if(original!=null){addr.Text=original.AbsoluteUri;addr.SelectAll();}};addr.LostKeyboardFocus+=(s,e)=>{if(original!=null)addr.Text=original.Host.Replace("www.","");};
            addr.KeyDown+=(s,e)=>{if(e.Key==Key.Enter){string value=addr.Text;go(value);e.Handled=true;}};
            var toolsHeading=RailLabel("도구");toolsHeading.Margin=new Thickness(2,7,0,14);list.Children.Add(toolsHeading);Action<string,string,string,Action> tool=(icon,name,key,act)=>{var b=PaneButton("",name,act);b.Height=40;b.Padding=new Thickness(6,0,10,0);b.HorizontalContentAlignment=HorizontalAlignment.Stretch;var line=new DockPanel();var shortcut=RailLabel(key,11);shortcut.Foreground=Tone(135);DockPanel.SetDock(shortcut,Dock.Right);if(key=="⌄"){var arrow=ChevronLabel("",true,shortcut.Foreground,0);DockPanel.SetDock(arrow,Dock.Right);line.Children.Add(arrow);}else if(key.Length>0){shortcut.Margin=new Thickness(5,0,5,0);var badge=new Border{Child=shortcut,CornerRadius=new CornerRadius(8),Background=Tone(241),VerticalAlignment=VerticalAlignment.Center};if(name=="터미널"){var more=PaneButton("⋯","터미널 옵션",()=>{});var choices=new ContextMenu();var launch=new MenuItem{Header="터미널 열기"};launch.Click+=(a,z)=>act();choices.Items.Add(launch);more.Click+=(a,z)=>{choices.PlacementTarget=more;choices.IsOpen=true;};DockPanel.SetDock(more,Dock.Right);line.Children.Add(more);}DockPanel.SetDock(badge,Dock.Right);line.Children.Add(badge);}string shape=name=="파일"?"M1,5 H6 L8,7 H14 V14 H1 Z M4,4 V2 H9 L11,4 H15 V11":name=="사이드 채팅"?"M3,13 L1,15 V10 A6,6 0 1 1 3,13 M6,8 H11 M8.5,5.5 V10.5":name=="터미널"?"M2,2 H14 V14 H2 Z M4,6 L6,8 L4,10 M8,10 H11":name=="새 페이지"?"M3,1 H13 V15 H3 Z M5,6 H11 M5,9 H9":"M1,1 H6 V6 H1 Z M9,1 H14 V6 H9 Z M1,9 H6 V14 H1 Z M9,9 H14 V14 H9 Z";
                var glyph=RailGlyph(shape,Tone(92),null,13);glyph.Margin=new Thickness(6,0,0,0);line.Children.Add(glyph);line.Children.Add(RailLabel(name));b.Content=line;list.Children.Add(Pill(b,8,false));
                if(key.Length>0 && key!="⌄")body.PreviewKeyDown+=(sender,args)=>{bool file=name=="파일"&&args.Key==Key.P&&Keyboard.Modifiers==ModifierKeys.Control;bool side=name=="사이드 채팅"&&args.Key==Key.S&&(Keyboard.Modifiers==(ModifierKeys.Control|ModifierKeys.Alt));bool shell=name=="터미널"&&args.Key==Key.Oem3&&Keyboard.Modifiers==ModifierKeys.Control;if(file||side||shell){args.Handled=true;act();}};};
            tool("▱","파일","Ctrl+P",()=>ShowFile(SpaceDir));tool("⊕","사이드 채팅","Ctrl+Alt+S",()=>Separate(null));tool("▣","터미널","Ctrl+`",()=>Process.Start(new ProcessStartInfo("powershell.exe"){WorkingDirectory=Directory.Exists(SpaceDir)?SpaceDir:BaseDir,UseShellExecute=true}));
            tool("▤","새 페이지","",()=>{Directory.CreateDirectory(SpaceDir);string f=Path.Combine(SpaceDir,"페이지-"+Guid.NewGuid().ToString("N").Substring(0,8)+".txt");File.WriteAllText(f,"");ShowFile(f);});
            var extra=PaneButton("플러그인 관리","플러그인 관리",OpenPluginManager);extra.Visibility=Visibility.Collapsed;tool("⊞","도구 더 보기...","⌄",()=>extra.Visibility=extra.IsVisible?Visibility.Collapsed:Visibility.Visible);list.Children.Add(extra);
            var heading=RailLabel("추천");heading.Margin=new Thickness(8,30,8,10);list.Children.Add(heading);var links=new StackPanel{Orientation=Orientation.Horizontal};list.Children.Add(new ScrollViewer{Content=links,HorizontalScrollBarVisibility=ScrollBarVisibility.Auto,VerticalScrollBarVisibility=ScrollBarVisibility.Disabled});
            foreach(var site in new[]{"YouTube|youtube.com|▶","Drive|drive.google.com|△","Calendar|calendar.google.com|▦"}){var parts=site.Split('|');var b=PaneButton("",parts[0],()=>go("https://"+parts[1]));b.Width=138;b.Height=88;var stack=new StackPanel();stack.Children.Add(new TextBlock{Text=parts[2],FontSize=22,Foreground=Tone(88),HorizontalAlignment=HorizontalAlignment.Center});stack.Children.Add(RailLabel(parts[0],12));b.Content=stack;links.Children.Add(b);}
            select();
        };create();
    }
}
