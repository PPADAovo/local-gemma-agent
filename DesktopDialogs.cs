using System;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Markup;

class CardWindow : Window {
    class Shade : Adorner {
        public Shade(UIElement target):base(target){IsHitTestVisible=false;}
        protected override void OnRender(DrawingContext dc){dc.DrawRectangle(new SolidColorBrush(Color.FromArgb(36,0,0,0)),null,new Rect(RenderSize));}
    }
    bool modal; public new bool? ShowDialog(){modal=true;return base.ShowDialog();}
    public CardWindow(){
        WindowStyle=WindowStyle.None; AllowsTransparency=true; ShowInTaskbar=false;
        WindowStartupLocation=WindowStartupLocation.CenterOwner;
        FontFamily=new FontFamily("Segoe UI Variable Text, Malgun Gothic"); FontSize=13;
        Resources[typeof(Button)]=(Style)XamlReader.Parse(@"<Style xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'><Setter Property='Background' Value='#F2F2F2'/><Setter Property='Foreground' Value='#202124'/><Setter Property='Padding' Value='12,6'/><Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'><Border x:Name='b' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' CornerRadius='8' Background='{TemplateBinding Background}' Padding='{TemplateBinding Padding}'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='b' Property='Opacity' Value='.78'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='b' Property='Opacity' Value='.45'/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>");
    }
    protected override void OnSourceInitialized(EventArgs e){
        var body=Content as UIElement;Content=null;Background=Brushes.Transparent;
        var layout=new DockPanel();
        var head=new DockPanel{Margin=new Thickness(0,0,0,12)};
        var close=ButtonFor("×",Close,false);close.Background=Brushes.Transparent;close.Padding=new Thickness(8,2,8,2);
        DockPanel.SetDock(close,Dock.Right);head.Children.Add(close);
        head.Children.Add(new TextBlock{Text=Title,FontSize=20,FontWeight=FontWeights.SemiBold});
        head.MouseLeftButtonDown+=(s,a)=>{if(a.LeftButton==MouseButtonState.Pressed)DragMove();};
        DockPanel.SetDock(head,Dock.Top);layout.Children.Add(head);if(body!=null)layout.Children.Add(body);
        Content=new Border{CornerRadius=new CornerRadius(18),Margin=new Thickness(10),Padding=new Thickness(20),Background=new SolidColorBrush(Color.FromRgb(251,250,251)),Child=layout,Effect=new DropShadowEffect{BlurRadius=10,ShadowDepth=2,Opacity=.16}};
        if(Owner!=null && Owner.Content is UIElement && modal){
            var target=(UIElement)Owner.Content;var layer=AdornerLayer.GetAdornerLayer(target);
            if(layer!=null){var shade=new Shade(target);layer.Add(shade);Closed+=(s,a)=>layer.Remove(shade);}
        }
        base.OnSourceInitialized(e);
    }
    public static Button ButtonFor(string label,Action action,bool primary){
        var b=new Button{Content=label,Margin=new Thickness(4,0,0,0)};
        if(primary){b.Background=new SolidColorBrush(Color.FromRgb(26,27,29));b.Foreground=Brushes.White;}
        b.Click+=(s,e)=>action();return b;
    }
    public static StackPanel Actions(){return new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right,Margin=new Thickness(0,18,0,0)};}
    public static CardWindow Make(Window owner,string title,double width){
        return new CardWindow{Owner=owner,Title=title,Width=width,SizeToContent=SizeToContent.Height,ResizeMode=ResizeMode.NoResize};
    }
}
static class CardNotice {
    public static MessageBoxResult Show(string message,string title,MessageBoxButton buttons=MessageBoxButton.OK,MessageBoxImage icon=MessageBoxImage.None){return Show(null,message,title,buttons,icon);}
    public static MessageBoxResult Show(Window owner,string message,string title="로컬 Gemma",MessageBoxButton buttons=MessageBoxButton.OK,MessageBoxImage icon=MessageBoxImage.None,MessageBoxResult initial=MessageBoxResult.None){
        var w=CardWindow.Make(owner,title,460);var p=new StackPanel();w.Content=p;
        p.Children.Add(new ScrollViewer{MaxHeight=320,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,Content=new TextBlock{Text=message,TextWrapping=TextWrapping.Wrap}});
        var bar=CardWindow.Actions();p.Children.Add(bar);bool yes=buttons==MessageBoxButton.YesNo;
        var result=yes?MessageBoxResult.No:buttons==MessageBoxButton.OK?MessageBoxResult.OK:MessageBoxResult.Cancel;
        if(buttons!=MessageBoxButton.OK){var cancel=CardWindow.ButtonFor(yes?"아니요":"취소",w.Close,false);cancel.IsCancel=true;cancel.IsDefault=initial==MessageBoxResult.No;bar.Children.Add(cancel);}
        var ok=CardWindow.ButtonFor(yes?"예":"확인",()=>{result=yes?MessageBoxResult.Yes:MessageBoxResult.OK;w.Close();},true);
        ok.IsDefault=initial!=MessageBoxResult.No;bar.Children.Add(ok);w.ShowDialog();return result;
    }
}
class CardPicker {
    public bool Multiselect,Save,Folder;
    public string Title,Filter,FileName="",DefaultExt,InitialDirectory;
    public string[] FileNames=new string[0];
    [System.Runtime.InteropServices.ComImport, System.Runtime.InteropServices.Guid("d57c7288-d4ad-4768-be02-9d969532d960"), System.Runtime.InteropServices.InterfaceType(System.Runtime.InteropServices.ComInterfaceType.InterfaceIsIUnknown)]
    interface IFolderDialog {
        [System.Runtime.InteropServices.PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count,IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events,out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }
    [System.Runtime.InteropServices.ComImport, System.Runtime.InteropServices.Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), System.Runtime.InteropServices.InterfaceType(System.Runtime.InteropServices.ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(IntPtr context,ref Guid handler,ref Guid iid,out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind,out IntPtr name);
        void GetAttributes(uint mask,out uint attributes);
        void Compare(IShellItem other,uint hint,out int order);
    }
    [System.Runtime.InteropServices.DllImport("shell32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,PreserveSig=false)]
    static extern void SHCreateItemFromParsingName(string path,IntPtr context,ref Guid iid,out IShellItem item);
    public bool? ShowDialog(Window owner){
        if(Folder){
            var picker=(IFolderDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
            IShellItem initial=null,result=null;
            try {
                uint options;picker.GetOptions(out options);
                // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR
                picker.SetOptions(options|0x20u|0x40u|0x800u|0x8u);
                picker.SetTitle(Title??"폴더 선택");picker.SetOkButtonLabel("폴더 선택");
                if(Directory.Exists(InitialDirectory)){
                    var iid=typeof(IShellItem).GUID;
                    SHCreateItemFromParsingName(Path.GetFullPath(InitialDirectory),IntPtr.Zero,ref iid,out initial);
                    picker.SetFolder(initial);
                }
                int hr=picker.Show(owner==null?IntPtr.Zero:new System.Windows.Interop.WindowInteropHelper(owner).EnsureHandle());
                if(hr==unchecked((int)0x800704C7))return false;
                System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(hr);
                picker.GetResult(out result);
                IntPtr name;result.GetDisplayName(0x80058000u,out name);
                try {FileName=System.Runtime.InteropServices.Marshal.PtrToStringUni(name);}
                finally {System.Runtime.InteropServices.Marshal.FreeCoTaskMem(name);}
                FileNames=new[]{FileName};
                return true;
            } finally {
                if(result!=null)System.Runtime.InteropServices.Marshal.ReleaseComObject(result);
                if(initial!=null)System.Runtime.InteropServices.Marshal.ReleaseComObject(initial);
                System.Runtime.InteropServices.Marshal.ReleaseComObject(picker);
            }
        }
        if(Save){
            var picker=new Microsoft.Win32.SaveFileDialog {
                Title=Title??"다른 이름으로 저장", Filter=Filter??"모든 파일|*.*",
                FileName=FileName??"", DefaultExt=DefaultExt??"",
                InitialDirectory=InitialDirectory??"", AddExtension=true,
                CheckPathExists=true, OverwritePrompt=true
            };
            if(picker.ShowDialog(owner)!=true)return false;
            FileName=picker.FileName;
            FileNames=new[]{FileName};
            return true;
        }
        var open=new Microsoft.Win32.OpenFileDialog {
            Title=Title??"파일 열기", Multiselect=Multiselect,
            Filter=Filter??"모든 파일|*.*", FileName=FileName??"",
            InitialDirectory=InitialDirectory??"", CheckFileExists=true
        };
        if(open.ShowDialog(owner)!=true)return false;
        FileNames=open.FileNames;
        FileName=open.FileName;
        return true;
    }
}
partial class DesktopChat {
    void CreateProjectCard(){
        var w=CardWindow.Make(window,"프로젝트 만들기",540);var p=new StackPanel();w.Content=p;
        var input=new TextBox{BorderThickness=new Thickness(0),VerticalContentAlignment=VerticalAlignment.Center,Background=Brushes.Transparent};
        var row=new DockPanel();row.Children.Add(new TextBlock{Text="▱",Margin=new Thickness(12,0,12,0),VerticalAlignment=VerticalAlignment.Center});
        var entry=new Grid();entry.Children.Add(input);var hint=new TextBlock{Text="프로젝트 이름",Foreground=Brushes.Gray,IsHitTestVisible=false,VerticalAlignment=VerticalAlignment.Center};entry.Children.Add(hint);row.Children.Add(entry);
        p.Children.Add(new Border{Child=row,Height=40,Background=Brushes.White,BorderBrush=Brushes.Black,BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(10)});
        p.Children.Add(new TextBlock{Text="소스 폴더",Margin=new Thickness(0,14,0,8),FontWeight=FontWeights.SemiBold});
        var content=new StackPanel{VerticalAlignment=VerticalAlignment.Center,HorizontalAlignment=HorizontalAlignment.Center};
        var label=new TextBlock{Text="이 컴퓨터에 폴더 추가",TextTrimming=TextTrimming.CharacterEllipsis,MaxWidth=425,HorizontalAlignment=HorizontalAlignment.Center,Margin=new Thickness(4,0,4,8)};content.Children.Add(label);
        string selected=null;var add=CardWindow.ButtonFor("▱  추가",()=>{var pick=new CardPicker{Folder=true,InitialDirectory=ProjectPath};if(pick.ShowDialog(w)==true){selected=pick.FileName;label.Text=selected;label.ToolTip=selected;if(String.IsNullOrWhiteSpace(input.Text))input.Text=new DirectoryInfo(selected).Name;}},false);add.HorizontalAlignment=HorizontalAlignment.Center;content.Children.Add(add);
        p.Children.Add(new Border{Height=105,CornerRadius=new CornerRadius(10),BorderThickness=new Thickness(1),BorderBrush=Brushes.Gainsboro,Background=Brushes.White,Child=content});
        var actions=CardWindow.Actions();actions.Margin=new Thickness(0,30,0,0);p.Children.Add(actions);var cancel=CardWindow.ButtonFor("취소",w.Close,false);cancel.IsCancel=true;actions.Children.Add(cancel);
        var create=CardWindow.ButtonFor("프로젝트 만들기",()=>{if(selected==null){label.Text="추가를 눌러 소스 폴더를 선택하세요";return;}if(String.IsNullOrWhiteSpace(input.Text)){input.Focus();return;}w.DialogResult=true;},true);create.IsDefault=true;actions.Children.Add(create);
        input.TextChanged+=(s,e)=>hint.Visibility=input.Text.Length==0?Visibility.Visible:Visibility.Collapsed;w.Loaded+=(s,e)=>input.Focus();
        if(w.ShowDialog()!=true)return;
        prefs.projectNames[selected]=input.Text.Trim();prefs.hiddenFolders=(prefs.hiddenFolders??new string[0]).Where(x=>!folderComparer.Equals(x,selected)).ToArray();prefs.foldProjects=false;SelectProject(selected);PersistProjects();
    }
}
