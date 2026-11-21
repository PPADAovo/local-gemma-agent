using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

// 에디터로 열기: 에이전트가 고친 파일을 VS Code·PyCharm으로 바로 엽니다.
// - 파일 카드에 [VS Code] [PyCharm] 버튼
// - 변경 카드 위에 [VS Code로 모두 열기]
// - 입력창 위 칩 "✎ 수정한 파일 N개 · 열기" → 이 채팅에서 고친 파일 목록 창
partial class DesktopChat {
    readonly List<string> editedFiles=new List<string>();
    static readonly string[] CodeLike={".txt",".md",".js",".mjs",".cjs",".ts",".tsx",".jsx",".py",".ps1",".cmd",".bat",".cs",".xaml",".json",".csv",".html",".htm",".css",".xml",".yml",".yaml",".ini",".log",".java",".c",".cpp",".h",".hpp",".sql",".sh",".toml",".kt",".go",".rs",".php",".rb",".lua"};
    static bool IsCodeLike(string file){return CodeLike.Contains(Path.GetExtension(file).ToLowerInvariant());}

    // 설치 위치에서 실행 파일을 찾습니다(PATH에 없어도 동작). 못 찾으면 null.
    static string FindEditor(string editor){
        string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string pf=Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var found=new List<string>();
        if(editor=="code"){
            found.Add(Path.Combine(local,@"Programs\Microsoft VS Code\Code.exe"));
            found.Add(Path.Combine(pf,@"Microsoft VS Code\Code.exe"));
        }else{
            foreach(var root in new[]{Path.Combine(pf,"JetBrains"),Path.Combine(local,"Programs")}){
                try{
                    if(!Directory.Exists(root))continue;
                    foreach(var d in Directory.GetDirectories(root,"PyCharm*").OrderByDescending(x=>x))found.Add(Path.Combine(d,@"bin\pycharm64.exe"));
                }catch{}
            }
        }
        return found.FirstOrDefault(File.Exists);
    }
    static string EditorName(string editor){return editor=="code"?"VS Code":"PyCharm";}

    void OpenInEditor(string editor,IEnumerable<string> files){
        var list=files.Where(File.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if(list.Count==0){status.Text="열 파일이 없습니다 (옮겨졌거나 지워졌어요).";return;}
        string exe=FindEditor(editor);
        if(exe==null){status.Text=EditorName(editor)+" 설치 위치를 찾지 못했습니다.";return;}
        try{
            Process.Start(new ProcessStartInfo(exe,String.Join(" ",list.Select(f=>"\""+f+"\""))){UseShellExecute=false});
            status.Text=EditorName(editor)+"로 "+(list.Count==1?Path.GetFileName(list[0]):"파일 "+list.Count+"개")+"를 열었습니다.";
        }catch(Exception x){status.Text=EditorName(editor)+" 실행 실패: "+x.Message;}
    }

    // 작은 알약 버튼(카드·목록에서 공통 사용)
    Button EditorButton(string editor,Func<IEnumerable<string>> files,string label=null){
        bool installed=FindEditor(editor)!=null;
        var b=new Button{Content=label??EditorName(editor),Margin=new Thickness(4,0,0,0),Padding=new Thickness(10,4,10,4),FontSize=12,
            Background=editor=="code"?new SolidColorBrush(Color.FromRgb(0xE8,0xF1,0xFD)):new SolidColorBrush(Color.FromRgb(0xEA,0xF6,0xEC)),
            Foreground=editor=="code"?new SolidColorBrush(Color.FromRgb(0x0B,0x5C,0xC4)):new SolidColorBrush(Color.FromRgb(0x1A,0x7F,0x37)),
            IsEnabled=installed,ToolTip=installed?EditorName(editor)+"로 열기":EditorName(editor)+"가 설치되어 있지 않아요"};
        b.Click+=(s,e)=>OpenInEditor(editor,files());
        return b;
    }

    // 답변의 변경 카드에 나온 파일을 이 채팅의 '수정한 파일' 목록에 모읍니다(최근 것이 위).
    void TrackEdited(IEnumerable<OutFile> outputs){
        foreach(var f in outputs){
            if(f.Status=="deleted"){editedFiles.RemoveAll(x=>String.Equals(x,f.Path,StringComparison.OrdinalIgnoreCase));continue;}
            if(f.Status.Length==0)continue;
            editedFiles.RemoveAll(x=>String.Equals(x,f.Path,StringComparison.OrdinalIgnoreCase));
            editedFiles.Insert(0,f.Path);
        }
        if(editedFiles.Count>30)editedFiles.RemoveRange(30,editedFiles.Count-30);
    }
    // 입력창 위 칩을 '수정한 파일' 기준으로 다시 그립니다(없으면 그대로 둠).
    void RefreshEditedChip(){
        var alive=editedFiles.Where(File.Exists).ToList();
        if(alive.Count==0)return;
        var chip=Find<Button>("ChangeChip");
        var row=new StackPanel{Orientation=Orientation.Horizontal};
        row.Children.Add(new TextBlock{Text="✎  수정한 파일 "+alive.Count+"개"});
        row.Children.Add(new TextBlock{Text="  ·  열기",Foreground=new SolidColorBrush(Color.FromRgb(0x2F,0x6F,0xED)),FontWeight=FontWeights.SemiBold});
        chip.Content=row;chip.ToolTip="이 채팅에서 고친 파일을 VS Code·PyCharm으로 엽니다";chip.Visibility=Visibility.Visible;
    }
    void ClearEdited(){editedFiles.Clear();}

    // "수정한 파일" 창: 파일마다 [VS Code] [PyCharm] [폴더], 위쪽에 모두 열기
    void ShowEditedFiles(){
        var alive=editedFiles.Where(File.Exists).ToList();
        if(alive.Count==0){if(lastChanges.Length>0)CardNotice.Show(window,lastChanges,"작업 결과");return;}
        var line=new SolidColorBrush(Color.FromRgb(0xE6,0xE8,0xEB));
        var w=new CardWindow{Owner=window,Title="수정한 파일",Width=640,SizeToContent=SizeToContent.Height,MaxHeight=620,WindowStartupLocation=WindowStartupLocation.CenterOwner,Background=Brushes.White,
            FontFamily=new FontFamily("Segoe UI Variable Text, Noto Sans KR, Malgun Gothic"),FontSize=13.5};
        var root=new StackPanel{Margin=new Thickness(18,16,18,16)};
        var head=new DockPanel{Margin=new Thickness(0,0,0,10)};
        var all=new StackPanel{Orientation=Orientation.Horizontal};DockPanel.SetDock(all,Dock.Right);
        all.Children.Add(EditorButton("code",()=>alive,"VS Code로 모두 열기"));
        head.Children.Add(all);
        var titles=new StackPanel();
        titles.Children.Add(new TextBlock{Text="수정한 파일 "+alive.Count+"개",FontWeight=FontWeights.SemiBold,FontSize=15});
        titles.Children.Add(new TextBlock{Text="이 채팅에서 내꺼가 만들거나 고친 파일이에요",FontSize=12,Foreground=Brushes.Gray});
        head.Children.Add(titles);root.Children.Add(head);
        var list=new StackPanel();
        foreach(var file in alive){
            var f=file;
            list.Children.Add(new Border{Height=1,Background=line});
            var row=new DockPanel{Margin=new Thickness(0,8,0,8)};
            var buttons=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};DockPanel.SetDock(buttons,Dock.Right);
            buttons.Children.Add(EditorButton("code",()=>new[]{f}));
            buttons.Children.Add(EditorButton("pycharm",()=>new[]{f}));
            var folder=new Button{Content="폴더",Margin=new Thickness(4,0,0,0),Padding=new Thickness(10,4,10,4),FontSize=12,Background=new SolidColorBrush(Color.FromRgb(0xF3,0xF4,0xF6)),ToolTip="파일 탐색기에서 위치 보기"};
            folder.Click+=(s,e)=>{try{Process.Start("explorer.exe","/select,\""+f+"\"");}catch(Exception x){status.Text=x.Message;}};
            buttons.Children.Add(folder);
            row.Children.Add(buttons);
            var names=new StackPanel{VerticalAlignment=VerticalAlignment.Center};
            names.Children.Add(new TextBlock{Text=Path.GetFileName(f),FontWeight=FontWeights.SemiBold,TextTrimming=TextTrimming.CharacterEllipsis});
            names.Children.Add(new TextBlock{Text=Path.GetDirectoryName(f),FontSize=11,Foreground=Brushes.Gray,TextTrimming=TextTrimming.CharacterEllipsis,ToolTip=f});
            row.Children.Add(names);
            list.Children.Add(row);
        }
        root.Children.Add(new ScrollViewer{Content=list,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,MaxHeight=440});
        if(lastChanges.Length>0){
            var log=new Button{Content="작업 기록 보기",HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,10,0,0),FontSize=12,Foreground=Brushes.Gray};
            log.Click+=(s,e)=>CardNotice.Show(w,lastChanges,"작업 결과");
            root.Children.Add(log);
        }
        w.Content=root;w.Show();
    }
}
