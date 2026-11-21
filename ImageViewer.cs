using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
class ImageViewer {
  [STAThread] static int Main(string[] args) {
    if(args.Length<1||args.Length>2)return 2;
    var json=new JavaScriptSerializer();
    Action<object> report=value=>{if(args.Length==2)File.WriteAllText(args[1],json.Serialize(value),new UTF8Encoding(false));};
    try {
      var bitmap=new BitmapImage();
      bitmap.BeginInit();bitmap.CacheOption=BitmapCacheOption.OnLoad;bitmap.UriSource=new Uri(args[0]);bitmap.EndInit();bitmap.Freeze();
      var image=new Image {Source=bitmap,Stretch=Stretch.Uniform};
      System.Windows.Automation.AutomationProperties.SetName(image,Path.GetFileName(args[0]));
      var win=new Window {Title=Path.GetFileName(args[0])+" · 로컬 Gemma 이미지", Width=960,Height=620,WindowStartupLocation=WindowStartupLocation.CenterScreen,Background=Brushes.Black,Content=image};
      win.ContentRendered+=(s,e)=>report(new {file=args[0],width=bitmap.PixelWidth,height=bitmap.PixelHeight,pid=System.Diagnostics.Process.GetCurrentProcess().Id});
      new Application().Run(win);return 0;
    }catch(Exception e){report(new {error=e.Message});return 1;}
  }
}

