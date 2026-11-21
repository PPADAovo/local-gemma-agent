using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

// 결과 파일 카드: 에이전트가 만든 파일을 ChatGPT·Claude처럼 채팅 안에 보여줍니다.
// 답변 끝의 "📄 경로" 줄을 찾아 카드(이름·위치·열기·폴더·경로 복사)와 미리보기(코드/글/이미지)를 띄웁니다.
partial class DesktopChat {
    static readonly string[] PreviewText={".txt",".md",".js",".mjs",".ts",".py",".ps1",".cmd",".bat",".cs",".json",".csv",".html",".htm",".css",".xml",".yml",".yaml",".ini",".log",".java",".c",".cpp",".h",".sql",".sh"};
    class OutFile{public string Path;public string Added="";public string Removed="";public string Status="";}
    static string StripFileLines(string text,System.Collections.Generic.List<OutFile> found,ref string undo){
        foreach(Match m in Regex.Matches(text,@"(?m)^📄 ([^\r\n|]+?)(?:\s*\|\s*(?:\+(\d+)\s+-(\d+)|-)\s*\|\s*(\w+))?\s*$")){
            var f=new OutFile{Path=m.Groups[1].Value.Trim(),Added=m.Groups[2].Value,Removed=m.Groups[3].Value,Status=m.Groups[4].Value};
            if(!found.Any(x=>x.Path==f.Path))found.Add(f);
        }
        var u=Regex.Match(text,@"(?m)^↩ ([^\r\n]+?)\s*$");if(u.Success)undo=u.Groups[1].Value;
        if(found.Count==0)return text;
        text=Regex.Replace(text,@"(?m)^(📄|↩) [^\r\n]*\r?\n?","");
        text=Regex.Replace(text,@"(?m)^결과 파일:\s*\r?\n?","");
        return text.TrimEnd();
    }
    // ChatGPT식 변경 카드: "파일 N개를 편집했습니다 +34 -0" · [실행 취소 ↺] [변경 사항 보기] · 파일별 줄
    FrameworkElement ChangesCard(System.Collections.Generic.List<OutFile> files,string undo){
        var line=new SolidColorBrush(Color.FromRgb(0xE6,0xE8,0xEB));
        var green=new SolidColorBrush(Color.FromRgb(0x1A,0x7F,0x37));var red=new SolidColorBrush(Color.FromRgb(0xCF,0x22,0x2E));
        var card=new Border{CornerRadius=new CornerRadius(14),BorderBrush=line,BorderThickness=new Thickness(1),Background=Brushes.White,Margin=new Thickness(0,8,0,6)};
        var root=new StackPanel();card.Child=root;
        var feedback=new TextBlock{Visibility=Visibility.Collapsed,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(14,0,14,8),FontSize=12};
        bool changed=files.Any(f=>f.Status.Length>0);
        int add=files.Sum(f=>f.Added.Length>0?int.Parse(f.Added):0),rem=files.Sum(f=>f.Removed.Length>0?int.Parse(f.Removed):0);
        bool anyStats=files.Any(f=>f.Added.Length>0);
        var head=new DockPanel{Margin=new Thickness(14,12,14,12)};
        var iconBox=new Border{Width=36,Height=36,CornerRadius=new CornerRadius(10),Background=new SolidColorBrush(Color.FromRgb(0xF3,0xF4,0xF6)),Margin=new Thickness(0,0,12,0),VerticalAlignment=VerticalAlignment.Center,
            Child=new TextBlock{Text=changed?"±":"",FontFamily=new FontFamily(changed?"Segoe UI":"Segoe MDL2 Assets"),FontSize=changed?18:15,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center,Foreground=Brushes.DimGray}};
        DockPanel.SetDock(iconBox,Dock.Left);head.Children.Add(iconBox);
        var actions=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};DockPanel.SetDock(actions,Dock.Right);
        if(changed && !String.IsNullOrEmpty(undo) && File.Exists(undo)){
            var undoBtn=new Button{Content="실행 취소  ↺",Padding=new Thickness(10,5,10,5),ToolTip="이번 작업에서 바꾼 파일을 원래대로 되돌립니다"};
            undoBtn.Click+=(s,e)=>UndoChanges(undo,undoBtn,feedback);
            actions.Children.Add(undoBtn);
            var diffBtn=new Button{Content="변경 사항 보기",Padding=new Thickness(12,5,12,5),Margin=new Thickness(6,0,0,0),BorderBrush=line,BorderThickness=new Thickness(1),Background=Brushes.White};
            diffBtn.Click+=(s,e)=>ShowDiff(undo);
            actions.Children.Add(new Border{Child=diffBtn,CornerRadius=new CornerRadius(9),BorderBrush=line,BorderThickness=new Thickness(1),Margin=new Thickness(6,0,0,0)});
        }
        var editable=files.Where(f=>f.Status!="deleted"&&File.Exists(f.Path)&&IsCodeLike(f.Path)).Select(f=>f.Path).ToList();
        if(editable.Count>1)actions.Children.Add(EditorButton("code",()=>editable,"VS Code로 모두 열기"));
        head.Children.Add(actions);
        var titles=new StackPanel{VerticalAlignment=VerticalAlignment.Center};
        string verb=!changed?"":files.All(f=>f.Status=="created")?"를 만들었습니다":files.All(f=>f.Status=="deleted")?"를 삭제했습니다":"를 편집했습니다";
        titles.Children.Add(new TextBlock{Text="파일 "+files.Count+"개"+verb,FontWeight=FontWeights.SemiBold,FontSize=14});
        if(anyStats){var st=new StackPanel{Orientation=Orientation.Horizontal};st.Children.Add(new TextBlock{Text="+"+add,Foreground=green,FontSize=12});st.Children.Add(new TextBlock{Text="  -"+rem,Foreground=red,FontSize=12});titles.Children.Add(st);}
        head.Children.Add(titles);root.Children.Add(head);root.Children.Add(feedback);
        foreach(var f in files){
            root.Children.Add(new Border{Height=1,Background=line});
            var file=f.Path;
            var row=new DockPanel{Margin=new Thickness(14,9,14,9),Background=Brushes.Transparent,Cursor=System.Windows.Input.Cursors.Hand,ToolTip=file+"\n클릭하면 미리보기와 열기 버튼이 나옵니다"};
            var right=new StackPanel{Orientation=Orientation.Horizontal};DockPanel.SetDock(right,Dock.Right);
            if(f.Added.Length>0){right.Children.Add(new TextBlock{Text="+"+f.Added,Foreground=green});right.Children.Add(new TextBlock{Text="  -"+f.Removed,Foreground=red});}
            else right.Children.Add(new TextBlock{Text=f.Status=="created"?"새 파일":f.Status=="deleted"?"삭제됨":f.Status=="modified"?"바뀜":"",Foreground=Brushes.Gray,FontSize=12});
            row.Children.Add(right);
            row.Children.Add(new TextBlock{Text=Path.GetFileName(file),TextTrimming=TextTrimming.CharacterEllipsis});
            root.Children.Add(row);
            if(f.Status=="deleted"){row.Cursor=System.Windows.Input.Cursors.Arrow;row.ToolTip=file;continue;}
            var detail=new ContentControl{Visibility=Visibility.Collapsed,Margin=new Thickness(12,0,12,10)};root.Children.Add(detail);
            row.MouseLeftButtonUp+=(s,e)=>{if(detail.Content==null)detail.Content=FileCard(file);detail.Visibility=detail.Visibility==Visibility.Visible?Visibility.Collapsed:Visibility.Visible;};
        }
        // 파일 하나면 처음부터 미리보기를 펼쳐 둡니다
        if(files.Count==1 && files[0].Status!="deleted"){var d=root.Children.OfType<ContentControl>().First();d.Content=FileCard(files[0].Path);d.Visibility=Visibility.Visible;}
        return card;
    }
    async void UndoChanges(string manifest,Button button,TextBlock feedback){
        try{
            var list=await System.Threading.Tasks.Task.Run(()=>DesktopIntegrity.ReadUndoManifest(manifest,Path.Combine(BaseDir,"복구기록","실행취소")));
            string names=String.Join("\n",list.Select(x=>"• "+(string)x["path"]+((string)x["status"]=="created"?"  (새로 만든 파일 → 지우기)":(string)x["status"]=="deleted"?"  (지운 파일 → 되살리기)":"  (바뀐 파일 → 이전 내용으로)")));
            if(!await AskLocal("실행 취소","이번 작업에서 바꾼 파일을 원래대로 되돌릴까요?\n\n"+names))return;
            string keep=Path.Combine(Path.GetDirectoryName(manifest),"취소전-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(keep);int n=0;
            int restored=0;var failures=new System.Collections.Generic.List<string>();
            button.IsEnabled=false;
            await System.Threading.Tasks.Task.Run(()=>{
            foreach(var x in list){
                string p=(string)x["path"];try{string backup=x.ContainsKey("backup")?x["backup"] as string:null;
                DesktopIntegrity.CheckUndoCurrent(x);
                if((string)x["status"]!="created"){
                    DesktopIntegrity.NoReparse(backup);
                    if(!String.Equals(DesktopIntegrity.FileHash(backup),Convert.ToString(x["backupSha256"]),StringComparison.OrdinalIgnoreCase))throw new IOException("백업이 변경되었습니다.");
                }
                if(File.Exists(p))File.Copy(p,Path.Combine(keep,(n++)+"-"+Path.GetFileName(p)),true); // 되돌리기 전 상태도 남겨 둠
                if((string)x["status"]=="created"){if(File.Exists(p))File.Delete(p);}
                else if(!String.IsNullOrEmpty(backup)&&File.Exists(backup)){Directory.CreateDirectory(Path.GetDirectoryName(p));File.Copy(backup,p,true);if(DesktopIntegrity.FileHash(p)!=DesktopIntegrity.FileHash(backup))throw new IOException("복원 내용 불일치");}
                else throw new IOException("백업 없음");
                if((string)x["status"]=="created" && File.Exists(p))throw new IOException("파일이 남아 있습니다");
                restored++;}catch(Exception e){failures.Add(p+" ("+e.Message+")");}
            }
            });
            feedback.Visibility=Visibility.Visible;
            if(failures.Count>0){feedback.Text=restored+"/"+list.Count+"개 복원 · 실패: "+String.Join(", ",failures);return;}
            button.Content="실행 취소됨";button.IsEnabled=false;feedback.Text="파일 "+restored+"개를 복원했습니다.";
        }catch(Exception x){feedback.Visibility=Visibility.Visible;feedback.Text="실행 취소 실패: "+x.Message;}
    }
    void ShowDiff(string manifest){
        try{
            var data=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(manifest,Encoding.UTF8));
            var list=((System.Collections.IEnumerable)data["files"]).Cast<System.Collections.Generic.Dictionary<string,object>>().ToList();
            var w=new CardWindow{Owner=window,Title="변경 사항",Width=820,Height=640,WindowStartupLocation=WindowStartupLocation.CenterOwner,Background=Brushes.White};
            var panel=new StackPanel{Margin=new Thickness(16)};
            foreach(var x in list){
                string p=(string)x["path"];string st=(string)x["status"];
                var h=new TextBlock{FontWeight=FontWeights.SemiBold,FontSize=14,Margin=new Thickness(0,10,0,4)};
                h.Inlines.Add(Path.GetFileName(p)+"   ");
                if(x["added"]!=null){h.Inlines.Add(new System.Windows.Documents.Run("+"+x["added"]){Foreground=Brushes.SeaGreen});h.Inlines.Add(new System.Windows.Documents.Run("  -"+x["removed"]){Foreground=Brushes.Firebrick});}
                else h.Inlines.Add(new System.Windows.Documents.Run(st=="created"?"새 파일":st=="deleted"?"삭제됨":"바뀜 (글자 파일이 아니라 줄 비교 없음)"){Foreground=Brushes.Gray});
                panel.Children.Add(h);panel.Children.Add(new TextBlock{Text=p,FontSize=11,Foreground=Brushes.Gray,Margin=new Thickness(0,0,0,6)});
                string diff=x.ContainsKey("diff")?(x["diff"] as string)??"":"";
                if(diff.Length==0)continue;
                var box=new StackPanel{Background=new SolidColorBrush(Color.FromRgb(0xFA,0xFB,0xFC))};
                foreach(var l in diff.Split('\n')){
                    char k=l.Length>0?l[0]:' ';
                    box.Children.Add(new TextBlock{Text=l.Length>1?l.Substring(0,1)+" "+l.Substring(Math.Min(2,l.Length)):l,FontFamily=CodeFont,FontSize=13,Padding=new Thickness(8,1,8,1),TextWrapping=TextWrapping.Wrap,
                        Background=k=='+'?new SolidColorBrush(Color.FromRgb(0xE6,0xF4,0xEA)):k=='-'?new SolidColorBrush(Color.FromRgb(0xFC,0xE8,0xE6)):Brushes.Transparent,
                        Foreground=k=='@'?Brushes.Gray:Brushes.Black});
                }
                panel.Children.Add(new Border{Child=box,BorderBrush=new SolidColorBrush(Color.FromRgb(0xE6,0xE8,0xEB)),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(8),Padding=new Thickness(0,4,0,4)});
            }
            w.Content=new ScrollViewer{Content=panel,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};w.Show();
        }catch(Exception x){status.Text="변경 사항을 열지 못했습니다: "+x.Message;}
    }
    FrameworkElement FileCard(string file){
        bool exists=File.Exists(file);
        string ext=Path.GetExtension(file).ToLowerInvariant();
        var card=new Border{CornerRadius=new CornerRadius(12),BorderBrush=new SolidColorBrush(Color.FromRgb(0xE2,0xE5,0xE8)),BorderThickness=new Thickness(1),Background=new SolidColorBrush(Color.FromRgb(0xF8,0xF9,0xFA)),Padding=new Thickness(12,10,12,10),Margin=new Thickness(0,6,0,4)};
        var root=new StackPanel();card.Child=root;
        var feedback=new TextBlock{Visibility=Visibility.Collapsed,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(14,0,14,8),FontSize=12};
        var head=new DockPanel();
        string glyph=ext==".xlsx"||ext==".csv"?"":ext==".pptx"?"":ext==".png"||ext==".jpg"?"":ext==".html"||ext==".htm"?"":PreviewText.Contains(ext)&&ext!=".txt"&&ext!=".md"?"":"";
        var icon=new TextBlock{Text=glyph,FontFamily=new FontFamily("Segoe MDL2 Assets"),FontSize=20,Foreground=new SolidColorBrush(Color.FromRgb(0x2F,0x6F,0xED)),VerticalAlignment=VerticalAlignment.Center,Margin=new Thickness(0,0,10,0)};
        DockPanel.SetDock(icon,Dock.Left);head.Children.Add(icon);
        var buttons=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};DockPanel.SetDock(buttons,Dock.Right);
        Func<string,string,Action,Button> btn=(label,tip,act)=>{var b=new Button{Content=label,ToolTip=tip,Margin=new Thickness(4,0,0,0),Padding=new Thickness(10,4,10,4),Background=Brushes.White,IsEnabled=exists};b.Click+=(s,e)=>{try{act();}catch(Exception x){status.Text=x.Message;}};return b;};
        buttons.Children.Add(btn("열기","기본 프로그램으로 열기",()=>Process.Start(new ProcessStartInfo(file){UseShellExecute=true})));
        if(exists && IsCodeLike(file)){buttons.Children.Add(EditorButton("code",()=>new[]{file}));buttons.Children.Add(EditorButton("pycharm",()=>new[]{file}));}
        buttons.Children.Add(btn("폴더","파일 탐색기에서 위치 보기",()=>Process.Start("explorer.exe","/select,\""+file+"\"")));
        var pathCopy=btn("경로 복사",file,()=>Clipboard.SetText(file));pathCopy.IsEnabled=true;buttons.Children.Add(pathCopy);
        head.Children.Add(buttons);
        var names=new StackPanel();
        names.Children.Add(new TextBlock{Text=Path.GetFileName(file),FontWeight=FontWeights.SemiBold,FontSize=14,TextTrimming=TextTrimming.CharacterEllipsis});
        string info=exists?Path.GetDirectoryName(file)+"  ·  "+Size(new FileInfo(file).Length):"⚠ 파일이 없습니다 (옮겨졌거나 지워졌어요) · "+file;
        names.Children.Add(new TextBlock{Text=info,FontSize=11,Foreground=exists?Brushes.Gray:Brushes.Firebrick,TextTrimming=TextTrimming.CharacterEllipsis,ToolTip=file});
        head.Children.Add(names);root.Children.Add(head);
        if(!exists)return card;
        try{
            if(ext==".png"||ext==".jpg"||ext==".jpeg"||ext==".gif"||ext==".bmp"){
                var bmp=new BitmapImage();bmp.BeginInit();bmp.CacheOption=BitmapCacheOption.OnLoad;bmp.UriSource=new Uri(file);bmp.DecodePixelWidth=640;bmp.EndInit();
                root.Children.Add(new Image{Source=bmp,MaxHeight=280,HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,10,0,0)});
            }else if(PreviewText.Contains(ext)&&new FileInfo(file).Length<400000){
                string all=File.ReadAllText(file,Encoding.UTF8);
                var lines=all.Replace("\r\n","\n").Split('\n');
                string shown=String.Join("\n",lines.Take(30));if(shown.Length>4000)shown=shown.Substring(0,4000);
                bool isDocument=ext==".txt" || ext==".md";
                var surface=isDocument?Brushes.White:new SolidColorBrush(Color.FromRgb(23,23,23));
                var panel=new StackPanel();
                var bar=new DockPanel{Margin=new Thickness(0,0,0,isDocument?6:0)};
                var copy=Copy(all,"전체 복사");
                copy.Foreground=isDocument?Brushes.DimGray:Brushes.White;
                DockPanel.SetDock(copy,Dock.Right);
                bar.Children.Add(copy);
                bar.Children.Add(new TextBlock{Text=ext.TrimStart('.')+(lines.Length>30?"  ·  처음 30줄 / 전체 "+lines.Length+"줄":"  ·  "+lines.Length+"줄"),Foreground=isDocument?Brushes.DimGray:Brushes.Silver,VerticalAlignment=VerticalAlignment.Center});
                panel.Children.Add(bar);
                var box=Readable(shown);
                box.Background=surface;
                box.Foreground=isDocument?new SolidColorBrush(Color.FromRgb(36,36,36)):Brushes.White;
                box.FontFamily=isDocument?window.FontFamily:CodeFont;
                box.FontSize=isDocument?15:13;
                box.Padding=new Thickness(0);
                if(isDocument)System.Windows.Documents.Block.SetLineHeight(box,24);
                panel.Children.Add(box);
                root.Children.Add(new Border{Child=panel,Padding=new Thickness(isDocument?14:10),CornerRadius=new CornerRadius(8),Background=surface,Margin=new Thickness(0,10,0,0)});
            }
        }catch(Exception x){root.Children.Add(new TextBlock{Text="미리보기를 만들지 못했습니다: "+x.Message,FontSize=11,Foreground=Brushes.Gray,Margin=new Thickness(0,6,0,0)});}
        return card;
    }
    static string Size(long n){return n<1024?n+" B":n<1048576?(n/1024.0).ToString("0.#")+" KB":(n/1048576.0).ToString("0.#")+" MB";}
}
