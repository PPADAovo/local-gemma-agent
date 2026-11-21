using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

partial class DesktopChat {
    static BitmapImage ChatBitmap(string path,int width){
        var b=new BitmapImage();using(var f=File.OpenRead(path)){
            b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.StreamSource=f;
            if(width>0)b.DecodePixelWidth=width;b.EndInit();b.Freeze();
        }return b;
    }
    void AddPhotoStrip(Panel parent,IEnumerable<string> pictures){
        if(pictures==null)return;
        var files=pictures.Where(p=>!String.IsNullOrWhiteSpace(p)&&File.Exists(p)&&FileIcon(p)=="🖼").Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var strip=new WrapPanel{HorizontalAlignment=HorizontalAlignment.Right,MaxWidth=580,Margin=new Thickness(0,0,0,4)};
        for(int n=0;n<files.Length;n++){
            int i=n;
            try{
                var preview=ChatBitmap(files[i],files.Length==1?800:240);double scale=Math.Min((files.Length==1?390d:110d)/preview.PixelWidth,(files.Length==1?320d:110d)/preview.PixelHeight);
                var tile=new Border{Width=preview.PixelWidth*scale,Height=preview.PixelHeight*scale,CornerRadius=new CornerRadius(8),BorderThickness=new Thickness(1),BorderBrush=Brushes.Gainsboro,Background=new ImageBrush(preview){Stretch=Stretch.UniformToFill}};
                var b=new Button{Content=tile,Margin=new Thickness(4,0,0,4),Padding=new Thickness(0),BorderThickness=new Thickness(0),Background=Brushes.Transparent,ToolTip="사진 크게 보기"};
                System.Windows.Automation.AutomationProperties.SetName(b,"첨부 사진 "+(i+1)+" 크게 보기");
                b.Click+=(s,e)=>ShowChatPhoto(files,i,b);strip.Children.Add(b);
            }catch(IOException){}catch(NotSupportedException){}catch(FileFormatException){}
        }
        if(strip.Children.Count>0)parent.Children.Add(strip);
    }
    void ShowChatPhoto(string[] files,int index,Button origin){
        var workspace=Find<Grid>("Workspace");var root=(Grid)workspace.Parent;
        var layer=new Grid{Background=new SolidColorBrush(Color.FromArgb(208,241,242,244)),Focusable=true};
        Grid.SetRowSpan(layer,root.RowDefinitions.Count);System.Windows.Controls.Panel.SetZIndex(layer,100);root.Children.Add(layer);
        var view=new ScrollViewer{Margin=new Thickness(12,51,12,12),HorizontalScrollBarVisibility=ScrollBarVisibility.Auto,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};
        var image=new Image{Stretch=Stretch.Uniform,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center};
        view.Content=image;view.HorizontalContentAlignment=HorizontalAlignment.Center;view.VerticalContentAlignment=VerticalAlignment.Center;layer.Children.Add(view);
        var bar=new DockPanel{VerticalAlignment=VerticalAlignment.Top,Margin=new Thickness(8,4,8,0)};
        var title=new TextBlock{Text="▧  이미지",FontWeight=FontWeights.SemiBold,Margin=new Thickness(8)};bar.Children.Add(title);
        var controls=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};bar.Children.Add(controls);layer.Children.Add(bar);
        var zoom=new ComboBox{ItemsSource=new[]{"화면에 맞춤","50%","100%","150%","200%"},SelectedIndex=0,VerticalContentAlignment=VerticalAlignment.Center};controls.Children.Add(zoom);
        Action close=()=>{root.Children.Remove(layer);origin.Focus();};
        BitmapImage bitmap=null;
        Action resize=()=>{if(bitmap==null)return;double factor=new[]{1d,.5,1,1.5,2}[Math.Max(0,zoom.SelectedIndex)];
            if(zoom.SelectedIndex==0)factor=Math.Min(1,Math.Min(Math.Max(1,view.ActualWidth-6)/bitmap.PixelWidth,Math.Max(1,view.ActualHeight-6)/bitmap.PixelHeight));
            image.Width=bitmap.PixelWidth*factor;image.Height=bitmap.PixelHeight*factor;};
        Action render=()=>{try{bitmap=ChatBitmap(files[index],0);image.Source=bitmap;title.Text="▧  이미지"+(files.Length>1?"   "+(index+1)+" / "+files.Length:"");resize();}catch(Exception err){CardNotice.Show(window,err.Message);close();}};
        Action<string,Action> add=(name,action)=>{var b=RailButton(name,action);b.Background=Brushes.White;b.Margin=new Thickness(3,0,0,0);controls.Children.Add(b);};
        if(files.Length>1){add("‹",()=>{index=(index+files.Length-1)%files.Length;render();});add("›",()=>{index=(index+1)%files.Length;render();});}
        add("열기",()=>ShowFile(files[index]));
        add("다른 이름으로 저장",()=>{var d=new CardPicker{Save=true,FileName=Path.GetFileName(files[index]),DefaultExt=Path.GetExtension(files[index])};if(d.ShowDialog(window)==true && !String.Equals(files[index],d.FileName,StringComparison.OrdinalIgnoreCase)){try{File.Copy(files[index],d.FileName,true);}catch(IOException err){CardNotice.Show(window,err.Message);}}});
        bool side=false;add("사이드 패널",()=>{side=!side;layer.HorizontalAlignment=side?HorizontalAlignment.Right:HorizontalAlignment.Stretch;layer.Width=side?Math.Min(640,root.ActualWidth):Double.NaN;});
        add("✕",close);layer.PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape){close();e.Handled=true;}};
        zoom.SelectionChanged+=(s,e)=>resize();view.SizeChanged+=(s,e)=>resize();layer.MouseLeftButtonDown+=(s,e)=>{if(e.OriginalSource==layer)close();};layer.Focus();render();
    }
}
