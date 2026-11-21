using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Data;
using Map=System.Collections.Generic.Dictionary<string,object>;

partial class DesktopChat {
    readonly HashSet<string> closedFolders=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    readonly HashSet<string> fullFolders=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static readonly StringComparer folderComparer=StringComparer.OrdinalIgnoreCase;
    string DefaultFolder{get{return BaseDir.TrimEnd(Path.DirectorySeparatorChar);}}
    string ProjectPath{get{return String.IsNullOrEmpty(prefs.projectDir)?DefaultFolder:prefs.projectDir;}}
    FrameworkElement RailGlyph(string geometry,Brush stroke,Brush fill,double size){
        return new System.Windows.Shapes.Path{Data=Geometry.Parse(geometry),Stroke=stroke,Fill=fill,StrokeThickness=1.15,StrokeLineJoin=PenLineJoin.Round,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round,Stretch=Stretch.Uniform,Width=size,Height=size,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center};
    }
    void PaintRail(){
        string selected=railName==""?"Home":railName=="예약"?"HistoryIcon":railName=="스페이스"?"Files":railName=="플러그인"||railName=="맞춤 설정"?"AgentPicker":"";
        foreach(string key in new[]{"Home","Files","HistoryIcon","AgentPicker"}){
            bool on=key==selected;var b=Find<Button>(key);b.Background=on?Tone(226):Brushes.Transparent;
            if(key=="AgentPicker"){b.Foreground=on?Tone(25):Tone(123);continue;}
            Brush ink=on?Tone(25):Tone(123),inside=on?Brushes.White:ink;
            var g=new Grid{Width=36,Height=36};b.HorizontalContentAlignment=HorizontalAlignment.Center;b.VerticalContentAlignment=VerticalAlignment.Center;b.Padding=new Thickness(0);b.Content=g;
            string outline=key=="Home"?"M1,7 L8,1 L15,7 V14 Q15,15 14,15 H10 V10 H6 V15 H2 Q1,15 1,14 Z":key=="HistoryIcon"?"M8,1 A7,7 0 1 1 7.99,1 Z":key=="Files"?"M6,2 L12,1 Q14,1 14.5,3 L15,10 Q15,12 13,12 L11,12 M2,5 L8,4 Q10,4 10.5,6 L11,12 Q11,14 9,14.5 L4,15 Q2,15 2,13 L1,7 Q1,5 2,5 Z":"M3,4 Q4,1 7.5,2 Q11,1 13,4 Q15.8,5 15,8.2 Q16,11.5 13,12.5 Q11,15.4 8,14 Q4.8,15 3.4,12.6 Q.6,12 1.4,9 Q.2,6 3,4 Z M4.5,9 C6,5 10.8,4.6 11,7.8 C11.1,10.5 7,11.6 7.1,8.7 C7.2,6.3 9.2,5.1 11.5,6.2";
            g.Children.Add(RailGlyph(outline,ink,on && key!="AgentPicker"?ink:Brushes.Transparent,16));
            if(key=="HistoryIcon")g.Children.Add(RailGlyph("M4,1 V5 L1,8",inside,null,6));
            if(key=="Home"){var dot=new System.Windows.Shapes.Ellipse{Width=8,Height=8,Fill=Brushes.Black,HorizontalAlignment=HorizontalAlignment.Right,VerticalAlignment=VerticalAlignment.Top,Margin=new Thickness(0,3,3,0)};dot.SetBinding(UIElement.VisibilityProperty,new Binding("Visibility"){Source=Find<FrameworkElement>("ProjectDot")});g.Children.Add(dot);}
        }
    }
    void PersistProjects(){SavePreferences();DrawProjects();}
    void AddFolder(){CreateProjectCard();}
    void BindProjectList(){
        On("Project",()=>{prefs.foldProjects=!prefs.foldProjects;PersistProjects();});
        On("AddProjectFolder",AddFolder);
        On("ProjectOptions",()=>{var menu=new ContextMenu();Entry(menu,"프로젝트 추가",Do(AddFolder));Entry(menu,prefs.foldProjects?"목록 펼치기":"목록 접기",Do(()=>{prefs.foldProjects=!prefs.foldProjects;PersistProjects();}));menu.PlacementTarget=Find<Button>("ProjectOptions");menu.IsOpen=true;});DrawProjects();
    }
    void DrawProjects(){
        var panel=Find<StackPanel>("ProjectRows");panel.Children.Clear();var project=Find<Button>("Project");project.Content=ChevronLabel("프로젝트",!prefs.foldProjects,project.Foreground,0);project.HorizontalContentAlignment=HorizontalAlignment.Center;System.Windows.Automation.AutomationProperties.SetName(project,"프로젝트");if(prefs.foldProjects)return;
        var pins=prefs.pinnedFolders??new string[0];var hidden=prefs.hiddenFolders??new string[0];
        var paths=new[]{DefaultFolder}.Concat(ProjectChoices()).Distinct(folderComparer).Except(hidden,folderComparer).OrderByDescending(x=>pins.Contains(x,folderComparer));
        foreach(var group in paths.GroupBy(x=>prefs.projectSections.ContainsKey(x)?prefs.projectSections[x]:"")){
            if(group.Key!="")panel.Children.Add(RailLabel(group.Key,12));
            foreach(string path in group){
                var turns=history.Where(r=>!Convert.ToBoolean(r["archived"]) && folderComparer.Equals(prefs.chatFolders.ContainsKey((string)r["id"])?prefs.chatFolders[(string)r["id"]]:DefaultFolder,path)).ToList();
                string title=prefs.projectNames.ContainsKey(path)?prefs.projectNames[path]:new DirectoryInfo(path).Name;
                var row=new DockPanel{Margin=new Thickness(8,0,8,0)};panel.Children.Add(row);
                var more=PaneButton("⋯","프로젝트 옵션",()=>{});DockPanel.SetDock(more,Dock.Right);row.Children.Add(more);
                var compose=PaneButton("✎","프로젝트에서 새 채팅",()=>{if(busy||loading)return;SelectProject(folderComparer.Equals(path,DefaultFolder)?"":path);New();});DockPanel.SetDock(compose,Dock.Right);row.Children.Add(compose);
                Action reveal=()=>{bool active=row.IsMouseOver||row.IsKeyboardFocusWithin||more.IsKeyboardFocused;more.Opacity=compose.Opacity=active?1:0;};row.MouseEnter+=(s,e)=>reveal();row.MouseLeave+=(s,e)=>reveal();row.IsKeyboardFocusWithinChanged+=(s,e)=>reveal();reveal();
                var folder=RailButton(title,()=>{if(!closedFolders.Add(path))closedFolders.Remove(path);DrawProjects();});
                var caption=new DockPanel();var glyph=RailGlyph("M1,5 V3 Q1,2 2,2 H6 L8,4 H13 Q15,4 15,6 L13,12 H2 Z M2,6 H14",Tone(68),null,14);glyph.Margin=new Thickness(0,0,8,0);caption.Children.Add(glyph);caption.Children.Add(new TextBlock{Text=title,TextTrimming=TextTrimming.CharacterEllipsis});folder.Content=caption;row.Children.Add(folder);
                var menu=new ContextMenu();bool pinned=pins.Contains(path,folderComparer);
                Action<string,string,Action> option=(label,icon,act)=>{var entry=Entry(menu,label,Do(act));entry.Icon=new TextBlock{Text=icon,FontFamily=new FontFamily("Segoe MDL2 Assets")};};
                option(pinned?"프로젝트 고정 해제":"프로젝트 고정","\uE718",()=>{prefs.pinnedFolders=pinned?pins.Except(new[]{path},folderComparer).ToArray():pins.Concat(new[]{path}).ToArray();PersistProjects();});
                option("프로젝트 설정","\uE713",()=>{var name=Prompt("프로젝트 표시 이름",title);if(!String.IsNullOrWhiteSpace(name)){prefs.projectNames[path]=name.Trim();PersistProjects();}});
                Entry(menu,"모두 읽음으로 표시",async()=>{foreach(var r in turns.Where(r=>Convert.ToBoolean(r["unread"])))await Rpc("manage",json.Serialize(new{action="unread",value="false"}),(string)r["id"]);await Refresh();}).Icon=new TextBlock{Text="✓"};
                menu.Items.Add(new Separator());var sections=new MenuItem{Header="섹션",Icon=new TextBlock{Text="▱"}};menu.Items.Add(sections);
                foreach(string section in prefs.projectSections.Values.Where(v=>v!="").Distinct())Entry(sections,section,Do(()=>{prefs.projectSections[path]=section;PersistProjects();}));
                Entry(sections,"새 섹션",Do(()=>{var value=Prompt("섹션 이름","");if(!String.IsNullOrWhiteSpace(value)){prefs.projectSections[path]=value.Trim();PersistProjects();}}));Entry(sections,"섹션 해제",Do(()=>{prefs.projectSections.Remove(path);PersistProjects();}));
                menu.Items.Add(new Separator());option("로컬 프로젝트 제거","\uE711",()=>{if(!ConfirmRemoval(window,"‘"+title+"’ 프로젝트를 제거할까요?","앱의 프로젝트 목록에서만 제거합니다. 컴퓨터의 파일과 기존 채팅은 그대로 유지됩니다.","프로젝트 제거"))return;prefs.hiddenFolders=hidden.Concat(new[]{path}).ToArray();if(folderComparer.Equals(path,ProjectPath))SelectProject("");PersistProjects();});
                folder.ContextMenu=menu;more.Click+=(s,e)=>{menu.PlacementTarget=more;menu.IsOpen=true;};
                if(closedFolders.Contains(path))continue;
                foreach(var turn in turns.Take(fullFolders.Contains(path)?int.MaxValue:5)){string key=(string)turn["id"];var b=RailButton((string)turn["title"],async()=>await Open(key));b.Content=new TextBlock{Text=(string)turn["title"],TextTrimming=TextTrimming.CharacterEllipsis};b.Margin=new Thickness(32,0,8,0);b.Background=key==id?Tone(237):Brushes.Transparent;b.ContextMenu=RowMenu(turn);panel.Children.Add(b);}
                if(turns.Count>5){var b=RailButton(fullFolders.Contains(path)?"접기":"더 보기",()=>{if(!fullFolders.Add(path))fullFolders.Remove(path);DrawProjects();});b.Margin=new Thickness(32,0,0,0);panel.Children.Add(b);}
            }
        }
    }
}
