using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

// 파일 첨부 (ChatGPT·Claude·Gemini처럼): 사진·동영상·PDF·문서·압축·코드 등 모든 종류, 여러 개(최대 10개).
// 넣는 방법: + 메뉴 '파일 올리기', 창에 끌어다 놓기, Ctrl+V(복사한 파일·캡처한 그림 붙여넣기).
partial class DesktopChat {
    readonly List<string> attachedFiles=new List<string>();
    string[] submittedFiles=new string[0];
    const long MaxFileBytes=2L*1024*1024*1024; // 파일 하나 2GB까지
    void AddFiles(IEnumerable<string> paths){
        int added=0;var skipped=new List<string>();
        foreach(var p in paths){
            if(attachedFiles.Count>=10){skipped.Add(Path.GetFileName(p)+"(10개 초과)");continue;}
            if(Directory.Exists(p)){ // 폴더를 넣으면 안의 파일들을 (최대 10개까지) 첨부
                foreach(var f in Directory.EnumerateFiles(p).Take(10-attachedFiles.Count)){
                    if(new FileInfo(f).Length>MaxFileBytes){skipped.Add(Path.GetFileName(f)+"(2GB 초과)");continue;}
                    if(!attachedFiles.Contains(f)){attachedFiles.Add(f);added++;}
                }
                continue;
            }
            if(!File.Exists(p)){skipped.Add(Path.GetFileName(p));continue;}
            if(new FileInfo(p).Length>MaxFileBytes){skipped.Add(Path.GetFileName(p)+"(2GB 초과)");continue;}
            if(!attachedFiles.Contains(p)){attachedFiles.Add(p);added++;}
        }
        RenderAttachList();SyncControls();
        status.Text=(added>0?"파일 "+added+"개를 붙였어요.":"")+(skipped.Count>0?" 못 붙인 파일: "+String.Join(", ",skipped):"");
        input.Focus();
    }
    void PickFiles(){
        var d=new CardPicker{Multiselect=true,Title="올릴 파일 고르기 (여러 개 가능)",
            Filter="모든 파일|*.*|사진|*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp;*.heic|동영상|*.mp4;*.mov;*.avi;*.mkv;*.webm|문서|*.pdf;*.docx;*.xlsx;*.pptx;*.hwpx;*.hwp;*.txt;*.md;*.csv|코드|*.js;*.ts;*.py;*.html;*.css;*.json;*.cs;*.java"};
        if(d.ShowDialog(window)==true)AddFiles(d.FileNames);
    }
    static string FileIcon(string f){
        string e=Path.GetExtension(f).ToLowerInvariant();
        if(new[]{".png",".jpg",".jpeg",".gif",".bmp",".webp",".heic"}.Contains(e))return "🖼";
        if(new[]{".mp4",".mov",".avi",".mkv",".webm",".wmv"}.Contains(e))return "🎬";
        if(new[]{".mp3",".wav",".m4a",".flac",".ogg"}.Contains(e))return "🎵";
        if(e==".pdf")return "📕";
        if(new[]{".xlsx",".xls",".csv",".cell"}.Contains(e))return "📊";
        if(new[]{".pptx",".ppt",".show"}.Contains(e))return "📽";
        if(new[]{".docx",".doc",".hwp",".hwpx",".txt",".md"}.Contains(e))return "📄";
        if(new[]{".zip",".7z",".rar"}.Contains(e))return "🗜";
        return "📎";
    }
    void RenderAttachList(){
        var panel=Find<WrapPanel>("AttachList");if(panel==null)return;panel.Children.Clear();
        panel.Visibility=attachedFiles.Count>0?Visibility.Visible:Visibility.Collapsed;
        foreach(var f in attachedFiles.ToList()){
            string file=f;
            var chip=new Border{CornerRadius=new CornerRadius(10),Background=new SolidColorBrush(Color.FromRgb(0xF1,0xF3,0xF5)),BorderBrush=new SolidColorBrush(Color.FromRgb(0xE2,0xE5,0xE8)),BorderThickness=new Thickness(1),Margin=new Thickness(0,0,6,6),Padding=new Thickness(8,4,4,4),ToolTip=file};
            var row=new StackPanel{Orientation=Orientation.Horizontal};
            // 사진은 작은 미리보기
            if(FileIcon(file)=="🖼"){
                try{var bmp=new System.Windows.Media.Imaging.BitmapImage();bmp.BeginInit();bmp.CacheOption=System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;bmp.UriSource=new Uri(file);bmp.DecodePixelHeight=56;bmp.EndInit();
                    row.Children.Add(new Border{CornerRadius=new CornerRadius(6),ClipToBounds=true,Margin=new Thickness(0,0,6,0),Child=new Image{Source=bmp,Height=28,MaxWidth=48,Stretch=Stretch.UniformToFill}});}
                catch{row.Children.Add(new TextBlock{Text="🖼",Margin=new Thickness(0,0,4,0),VerticalAlignment=VerticalAlignment.Center});}
            }else row.Children.Add(new TextBlock{Text=FileIcon(file),Margin=new Thickness(0,0,4,0),VerticalAlignment=VerticalAlignment.Center});
            string name=Path.GetFileName(file);if(name.Length>28)name=name.Substring(0,25)+"…";
            row.Children.Add(new TextBlock{Text=name,VerticalAlignment=VerticalAlignment.Center,FontSize=12});
            var x=new Button{Content="✕",Padding=new Thickness(6,0,6,0),Margin=new Thickness(4,0,0,0),Background=Brushes.Transparent,BorderThickness=new Thickness(0),Foreground=Brushes.Gray,ToolTip="빼기"};
            x.Click+=(s,e)=>{attachedFiles.Remove(file);RenderAttachList();SyncControls();};
            row.Children.Add(x);chip.Child=row;panel.Children.Add(chip);
        }
    }
    // 창 전체에 끌어다 놓기 + Ctrl+V 붙여넣기
    void EnableFileDrop(){
        window.AllowDrop=true;
        window.PreviewDragOver+=(s,e)=>{if(e.Data.GetDataPresent(DataFormats.FileDrop)&&!loading){e.Effects=DragDropEffects.Copy;e.Handled=true;}};
        window.PreviewDrop+=(s,e)=>{if(e.Data.GetDataPresent(DataFormats.FileDrop)&&!loading){AddFiles((string[])e.Data.GetData(DataFormats.FileDrop));e.Handled=true;}};
        input.PreviewKeyDown+=(s,e)=>{
            if(e.Key==Key.V&&Keyboard.Modifiers==ModifierKeys.Control&&!loading){
                try{
                    if(Clipboard.ContainsFileDropList()){AddFiles(Clipboard.GetFileDropList().Cast<string>());e.Handled=true;}
                    else if(Clipboard.ContainsImage()){ // 캡처한 그림 → 임시 PNG 파일로 저장해서 첨부
                        var img=Clipboard.GetImage();string dir=Path.Combine(Path.GetTempPath(),"LocalGemma");Directory.CreateDirectory(dir);
                        string f=Path.Combine(dir,"붙여넣은 그림 "+DateTime.Now.ToString("HHmmss")+"-"+Guid.NewGuid().ToString("N")+".png");
                        using(var fs=File.Create(f)){var enc=new System.Windows.Media.Imaging.PngBitmapEncoder();enc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(img));enc.Save(fs);}
                        AddFiles(new[]{f});e.Handled=true;
                    }
                }catch(Exception x){status.Text="붙여넣기 실패: "+x.Message;}
            }
        };
    }
}
