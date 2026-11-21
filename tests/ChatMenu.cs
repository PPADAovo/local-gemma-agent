using System;
using System.Reflection;
using System.Runtime.Serialization;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
class ChatMenuTest {
 static void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS: "+name);}
 [STAThread] static int Main(string[] args){
  var app=new Application();
  var window=new Window{Width=400,Height=300,Left=-30000,Top=-30000,ShowInTaskbar=false,ShowActivated=false};
  try{
   var assembly=Assembly.LoadFrom(args[0]);var type=assembly.GetType("DesktopChat",true);
   using(var resource=assembly.GetManifestResourceStream("Desktop.xaml"))window.Resources=((Window)System.Windows.Markup.XamlReader.Load(resource)).Resources;
   var flags=BindingFlags.NonPublic|BindingFlags.Static;
   var bind=type.GetMethod("BindChatContextMenu",flags);
   Check(bind!=null,"Context menu has a selection-preserving binding");
   var list=new ListBox();var first=new ListBoxItem{Content="First"};var second=new ListBoxItem{Content="Second",ContextMenu=new ContextMenu()};
   second.ContextMenu.Items.Add(new MenuItem{Header="Rename"});list.Items.Add(first);list.Items.Add(second);list.SelectedItem=first;
   window.Content=list;window.Show();window.UpdateLayout();bind.Invoke(null,new object[]{second});
   int changes=0;list.SelectionChanged+=(s,e)=>changes++;
   var down=new MouseButtonEventArgs(Mouse.PrimaryDevice,0,MouseButton.Right){RoutedEvent=UIElement.PreviewMouseDownEvent};second.RaiseEvent(down);
   Check(down.Handled && list.SelectedItem==first && changes==0,"Right down preserves selected chat");
   var up=new MouseButtonEventArgs(Mouse.PrimaryDevice,0,MouseButton.Right){RoutedEvent=UIElement.PreviewMouseUpEvent};second.RaiseEvent(up);
   Check(second.ContextMenu.IsOpen && second.ContextMenu.PlacementTarget==second && changes==0,"Right up opens the clicked row menu without navigation");second.ContextMenu.IsOpen=false;
   var left=new MouseButtonEventArgs(Mouse.PrimaryDevice,0,MouseButton.Left){RoutedEvent=UIElement.PreviewMouseDownEvent};second.RaiseEvent(left);
   Check(!left.Handled,"Left click is not intercepted");
   var instance=FormatterServices.GetUninitializedObject(type);var priv=BindingFlags.Instance|BindingFlags.NonPublic;
   type.GetField("id",priv).SetValue(instance,"current");type.GetField("pins",priv).SetValue(instance,new HashSet<string>());
   var row=new Dictionary<string,object>{{"id","other"},{"title","Example"},{"unread",false},{"archived",false},{"section",""}};
   var menu=(ContextMenu)type.GetMethod("RowMenu",priv).Invoke(instance,new object[]{row});
   foreach(var item in menu.Items.OfType<MenuItem>())Check(item.Icon is FrameworkElement,"Icon: "+item.Header);
   Check(menu.Items.OfType<MenuItem>().Count()==11,"All eleven row actions remain available");
   second.ContextMenu=menu;menu.PlacementTarget=second;menu.IsOpen=true;menu.UpdateLayout();
   if(args.Length>1){
    var bmp=new System.Windows.Media.Imaging.RenderTargetBitmap((int)Math.Ceiling(menu.ActualWidth),(int)Math.Ceiling(menu.ActualHeight),96,96,System.Windows.Media.PixelFormats.Pbgra32);
    bmp.Render(menu);var png=new System.Windows.Media.Imaging.PngBitmapEncoder();png.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp));
    using(var output=System.IO.File.Create(args[1]))png.Save(output);
   }
   menu.IsOpen=false;
   return 0;
  }catch(Exception ex){Console.Error.WriteLine(ex);return 1;}finally{window.Close();app.Shutdown();}
 }
}
