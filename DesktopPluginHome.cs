using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Map=System.Collections.Generic.Dictionary<string,object>;
partial class DesktopChat{
    void OpenPluginManager(){OpenPluginManagerPage(false);}
    bool CreateLocalSkill(IEnumerable<string> existing){
        var dialog=new Window{Owner=window,Title="스킬 추가",Width=430,SizeToContent=SizeToContent.Height,WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var panel=new StackPanel{Margin=new Thickness(22)};dialog.Content=panel;
        Func<string,TextBox> field=label=>{
            panel.Children.Add(new TextBlock{Text=label,Margin=new Thickness(0,8,0,4)});
            var box=new TextBox();panel.Children.Add(box);return box;
        };
        var name=field("스킬 이름");var description=field("설명");var guide=field("작업 지침");
        guide.AcceptsReturn=true;guide.Height=130;guide.TextWrapping=TextWrapping.Wrap;guide.VerticalScrollBarVisibility=ScrollBarVisibility.Auto;
        var error=new TextBlock{Foreground=Brushes.Firebrick,TextWrapping=TextWrapping.Wrap};panel.Children.Add(error);
        panel.Children.Add(RailButton("추가",()=>{
            string id=name.Text.Trim(),summary=description.Text.Trim(),body=guide.Text.Trim();
            if(id.Length==0 || summary.Length==0 || body.Length==0){error.Text="이름, 설명, 작업 지침을 모두 입력하세요.";return;}
            if(existing.Contains(id,StringComparer.OrdinalIgnoreCase)){error.Text="이미 등록된 스킬 이름입니다.";return;}
            try{
                string dir=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"스킬","custom-"+Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir,"SKILL.md"),"---\nname: "+id+"\ndescription: "+summary+"\n---\n\n"+body+"\n");
                dialog.DialogResult=true;
            }catch(Exception ex){error.Text=ex.Message;}
        }));
        name.Focus();return dialog.ShowDialog()==true;
    }
    Button PluginNavButton(string label,string shape,Action action){
        var b=RailButton(label,action);
        var row=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};
        if(shape==null)row.Children.Add(new ContentControl{Template=(ControlTemplate)window.FindResource("PluginPlugIcon"),Foreground=Tone(83),Focusable=false});else row.Children.Add(RailGlyph(shape,Tone(83),null,14));
        row.Children.Add(new TextBlock{Text=label,Margin=new Thickness(8,0,0,0),VerticalAlignment=VerticalAlignment.Center});
        b.Content=row;b.Height=32;
        System.Windows.Automation.AutomationProperties.SetName(b,label);
        return b;
    }    async void OpenPluginManagerPage(bool skills){
        string heading=skills?"스킬":"플러그인";
        var shell=new Grid();shell.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(238)});shell.ColumnDefinitions.Add(new ColumnDefinition());
        var railStyle=Find<Border>("PanelSide").Resources[typeof(System.Windows.Controls.Primitives.ScrollBar)] as Style;
        if(railStyle!=null)shell.Resources[typeof(System.Windows.Controls.Primitives.ScrollBar)]=railStyle;
        var nav=new StackPanel{Margin=new Thickness(9,10,9,0)};shell.Children.Add(new Border{Background=new SolidColorBrush(Color.FromRgb(248,250,252)),BorderBrush=Tone(225),BorderThickness=new Thickness(0,0,1,0),Child=new ScrollViewer{Content=nav,VerticalScrollBarVisibility=ScrollBarVisibility.Auto}});
        var page=new DockPanel{MaxWidth=916,Margin=new Thickness(44,26,44,10)};Grid.SetColumn(page,1);shell.Children.Add(page);
        var header=new DockPanel{Height=36};DockPanel.SetDock(header,Dock.Top);page.Children.Add(header);
        var query=new TextBox{Width=190,VerticalContentAlignment=VerticalAlignment.Center,Margin=new Thickness(8,0,8,0),ToolTip=heading+" 검색"};
        var search=new Grid{Height=30};query.Margin=new Thickness(29,0,9,0);search.Children.Add(query);var lens=RailGlyph("M11.3,11.3 L15,15 M12.5,7 A5.5,5.5 0 1 1 1.5,7 A5.5,5.5 0 1 1 12.5,7",Tone(122),null,13);lens.HorizontalAlignment=HorizontalAlignment.Left;lens.Margin=new Thickness(10,0,0,0);lens.IsHitTestVisible=false;search.Children.Add(lens);var hint=RailLabel(heading+" 검색");hint.VerticalAlignment=VerticalAlignment.Center;hint.Margin=new Thickness(29,0,0,0);hint.IsHitTestVisible=false;hint.Foreground=Tone(140);search.Children.Add(hint);
        var reload=PaneButton("⟳","새로고침",()=>{});var settings=PaneButton("⚙","설정",()=>ShowPreferences(heading));var add=PaneButton("추가",heading+" 추가",()=>{});add.Background=Tone(28);add.Foreground=Brushes.White;
        settings.Content=RailGlyph("M6.4,2 L6.8,1 H9.2 L9.6,2.7 L11,3.4 L12.7,2.9 L14,5 L12.9,6.4 V8.5 L14.2,10 L13,12.2 L11.2,12 L9.7,13 L9.2,15 H6.8 L6.3,13 L4.8,12 L3,12.2 L1.8,10 L3.1,8.5 V6.4 L2,5 L3.3,2.9 L5,3.4 Z M8,5.3 A2.7,2.7 0 1 1 7.99,5.3 Z",Tone(63),null,15);
        reload.Margin=settings.Margin=new Thickness(2,0,2,0);add.Margin=new Thickness(4,0,0,0);
        add.Width=skills?42:62;add.Content=skills?(object)"추가":ChevronLabel("추가",true,Brushes.White);add.Padding=new Thickness(0);add.Height=settings.Height=reload.Height=32;settings.Width=reload.Width=32;add.VerticalAlignment=settings.VerticalAlignment=reload.VerticalAlignment=VerticalAlignment.Center;
        var searchBox=Pill(search,16,true);searchBox.Height=32;searchBox.VerticalAlignment=VerticalAlignment.Center;
        foreach(var item in new UIElement[]{add,settings,reload,searchBox}){DockPanel.SetDock(item,Dock.Right);header.Children.Add(item);}header.Children.Add(new TextBlock{Text=heading,FontSize=24,VerticalAlignment=VerticalAlignment.Center,FontWeight=FontWeights.SemiBold,Margin=new Thickness(8,0,0,0)});
        var desc=RailLabel(skills?"작업에 사용할 스킬을 찾아보세요.":"사용 중인 여러 도구에서 작업할 수 있도록 플러그인을 연결하세요.");desc.Foreground=Tone(110);DockPanel.SetDock(desc,Dock.Top);page.Children.Add(desc);
        var content=new StackPanel{Margin=new Thickness(0,24,0,0)};page.Children.Add(new ScrollViewer{Content=content,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});MountRail("플러그인",shell,true);
        var data=new List<Map>();var installedPlugins=new List<Map>();string[] order={"gmail","google-drive","google-calendar","github","slack","outlook-email"};Action draw=null;Func<Task> refresh=null;
        Func<Map,string> name=r=>Convert.ToString(r[skills && r.ContainsKey("displayName")?"displayName":"name"]);
        Action<Map,FrameworkElement> show=async(r,anchor)=>{
            if(skills && r.ContainsKey("displayName")){await ShowSkillDetails(r,state=>draw());return;}
            var menu=new ContextMenu{PlacementTarget=anchor};bool installed=Equals(r["installed"],true),enabled=Equals(r["enabled"],true);
            Func<string,Task<Map>> request=async action=>(Map)await Rpc("pluginManager",json.Serialize(new{tab="홈",id=r["id"],action,enable=!enabled}));
            if(installed){
                Entry(menu,"서비스 로그인 열기",async()=>{var info=await request("connection");Uri link;if(Uri.TryCreate(Convert.ToString(info["url"]),UriKind.Absolute,out link)&&link.Scheme=="https")ShowFile(link.AbsoluteUri);});
                Entry(menu,"로컬 도구 상태 확인",async()=>{var info=await request("connection");CardNotice.Show(window,Equals(info["available"],true)?"로컬 브라우저 도구가 켜져 있습니다. 계정 로그인 상태는 서비스에서 확인하세요.":"로컬 브라우저 도구가 꺼져 있습니다.",name(r));});
                Entry(menu,"채팅에서 사용",Do(()=>ComposeRail(name(r)+" 도구로 ")));
                Entry(menu,enabled?"사용 끄기":"사용 켜기",async()=>{await request("toggle");await refresh();});
            }else Entry(menu,"플러그인 설치",async()=>{await request("install");await refresh();});
            menu.IsOpen=true;
        };
        Func<Map,bool,Button> card=(r,small)=>{
            var b=RailButton(name(r),()=>{});System.Windows.Automation.AutomationProperties.SetName(b,name(r));b.HorizontalContentAlignment=HorizontalAlignment.Stretch;
            b.Height=small?31:68;var line=new DockPanel{Margin=new Thickness(0,small?0:8,0,small?0:8)};
            if(!small&&!skills){var action=RailLabel(Equals(r["installed"],true)?"⋯":"＋",16);action.VerticalAlignment=VerticalAlignment.Center;action.Margin=new Thickness(5,0,8,0);DockPanel.SetDock(action,Dock.Right);line.Children.Add(action);}
            bool skillCard=skills&&r.ContainsKey("displayName");string asset=skillCard?"":Path.Combine(BaseDir,"plugin-icons",Convert.ToString(r["slug"])+".png");string icon=File.Exists(asset)?asset:(skillCard?null:PluginIcon(name(r)));if(icon!=null){try{line.Children.Add(new Image{Source=new BitmapImage(new Uri(icon)),Width=small?15:36,Height=small?15:36,Margin=new Thickness(0,0,12,0)});}catch(IOException){}}
            var label=new StackPanel{VerticalAlignment=VerticalAlignment.Center};label.Children.Add(new TextBlock{Text=name(r),TextTrimming=TextTrimming.CharacterEllipsis,FontWeight=small?FontWeights.Normal:FontWeights.SemiBold});
            if(skillCard && Convert.ToString(r["state"])=="disabled")label.Children.Add(SkillText("사용 꺼짐",11,Tone(117)));if(!small)label.Children.Add(new TextBlock{Text=Convert.ToString(r["description"]),FontSize=12,Foreground=Tone(111),TextTrimming=TextTrimming.CharacterEllipsis,Margin=new Thickness(0,5,0,0)});line.Children.Add(label);b.Content=line;b.Click+=(s,e)=>show(r,b);return b;
        };
        draw=()=>{nav.Children.Clear();nav.Children.Add(RailLabel("맞춤 설정",17));var home=PluginNavButton("플러그인",null,()=>{if(skills)OpenPluginManagerPage(false);else query.Clear();});if(!skills)home.Background=Tone(235);nav.Children.Add(home);var skillTab=PluginNavButton("스킬","M8,1 L14,4.5 V11.5 L8,15 L2,11.5 V4.5 Z",()=>{if(!skills)OpenPluginManagerPage(true);});if(skills)skillTab.Background=Tone(235);nav.Children.Add(skillTab);nav.Children.Add(RailLabel("설치됨"));
            foreach(var r in installedPlugins.OrderBy(name))nav.Children.Add(card(r,true));
            content.Children.Clear();string term=query.Text.Trim();hint.Visibility=term==""?Visibility.Visible:Visibility.Collapsed;
            if(term!="")content.Children.Add(RailLabel("검색 결과",16));var cards=new System.Windows.Controls.Primitives.UniformGrid{Columns=2};content.Children.Add(cards);
            var list=!skills&&term==""?order.Select(key=>data.FirstOrDefault(x=>Equals(x["slug"],key))).Where(x=>x!=null):data.Where(x=>(!x.ContainsKey("state")||!Equals(x["state"],"removed")) && (name(x)+" "+x["name"]+" "+x["description"]+" "+(skills&&x.ContainsKey("details")?x["details"]:"")).IndexOf(term,StringComparison.CurrentCultureIgnoreCase)>=0);
            foreach(var r in list)cards.Children.Add(card(r,false));if(!skills&&term==""){
                foreach(var group in new[]{new[]{"새롭고 주목할 만한 플러그인","icloud-mail","icloud-calendar","elevenlabs","tripsy","sonos","hevy"},new[]{"소규모 기업","dropbox","hubspot"}}){
                    var items=group.Skip(1).Select(key=>data.FirstOrDefault(x=>Equals(x["slug"],key))).Where(x=>x!=null).ToList();
                    if(items.Count==0)continue;var section=RailLabel(group[0],16);section.Margin=new Thickness(8,28,0,12);content.Children.Add(section);
                    var grid=new System.Windows.Controls.Primitives.UniformGrid{Columns=2};content.Children.Add(grid);foreach(var item in items)grid.Children.Add(card(item,false));
                }
            }
            if(cards.Children.Count==0){if(skills)content.Children.Add(RailLabel("일치하는 스킬이 없습니다."));else content.Children.Add(RailButton("디렉터리에서 찾아보기",()=>PluginDirectory("디렉터리")));}
            if(skills){
                var removed=data.Where(x=>x.ContainsKey("state")&&Equals(x["state"],"removed")&&(name(x)+" "+x["name"]).IndexOf(term,StringComparison.CurrentCultureIgnoreCase)>=0).ToList();
                if(removed.Count>0){var listPanel=new StackPanel();var exp=new Expander{Header="제거한 스킬 ("+removed.Count+")",Content=listPanel,Margin=new Thickness(7,18,7,6)};content.Children.Add(exp);
                    foreach(var entry in removed){var button=RailButton(name(entry)+" 다시 추가",()=>{});button.Click+=async(a,b)=>{button.IsEnabled=false;try{await Rpc("pluginManager",json.Serialize(new{tab="스킬",id=entry["name"],state="enabled"}));entry["state"]="enabled";draw();}catch(Exception ex){button.IsEnabled=true;CardNotice.Show(window,ex.Message);}};listPanel.Children.Add(button);}
                }
            }
        };
        refresh=async()=>{reload.IsEnabled=false;try{var result=(Map)await Rpc("pluginManager",json.Serialize(new{tab=skills?"스킬":"홈",withSidebar=skills}));data=((object[])result["rows"]).Cast<Map>().ToList();installedPlugins=skills?((object[])result["installedPlugins"]).Cast<Map>().ToList():data.Where(x=>Equals(x["installed"],true)).ToList();draw();}catch(Exception ex){content.Children.Clear();content.Children.Add(RailLabel(ex.Message));content.Children.Add(RailButton("다시 시도",async()=>await refresh()));}finally{reload.IsEnabled=true;}};
        add.Template=(ControlTemplate)System.Windows.Markup.XamlReader.Parse("<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'><Border Background='{TemplateBinding Background}' CornerRadius='16'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border></ControlTemplate>");
        add.Click+=async(sender,args)=>{
            if(skills){
                if(CreateLocalSkill(data.Select(x=>Convert.ToString(x["name"])))){query.Clear();await refresh();}
            }else{
                var menu=new ContextMenu{PlacementTarget=add,Placement=System.Windows.Controls.Primitives.PlacementMode.Bottom};
                Entry(menu,"플러그인 찾아보기",()=>{PluginDirectory("디렉터리");return Task.FromResult(0);});menu.IsOpen=true;
            }
        };
        query.TextChanged+=(s,e)=>draw();reload.Click+=async(s,e)=>await refresh();shell.SizeChanged+=(s,e)=>{shell.ColumnDefinitions[0].Width=new GridLength(e.NewSize.Width<760?145:238);page.Margin=new Thickness(e.NewSize.Width<760?12:44,26,e.NewSize.Width<760?12:44,10);query.Width=e.NewSize.Width<760?96:220;};draw();content.Children.Clear();content.Children.Add(RailLabel(heading+" 불러오는 중…"));await refresh();
    }
}
