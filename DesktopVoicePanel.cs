using System;
using System.IO;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Input;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
partial class DesktopChat {
    [DllImport("winmm.dll",CharSet=CharSet.Unicode)] static extern int mciSendString(string command,System.Text.StringBuilder output,int length,IntPtr hwnd);
    string voiceFile; int voiceVersion;
    Process voiceWorker;
    void AudioCommand(string cmd){int code=mciSendString(cmd,null,0,IntPtr.Zero);if(code!=0)throw new IOException("마이크 장치 오류 "+code);}
    void VoiceVisible(bool visible){
        Find<DockPanel>("VoiceBar").Visibility=visible?Visibility.Visible:Visibility.Collapsed;
        foreach(string n in new[]{"TextEntry","ComposerTools"})Find<Grid>(n).Visibility=visible?Visibility.Collapsed:Visibility.Visible;
    }
    async void CancelVoice(){
        voiceVersion++;mciSendString("close gemmamic",null,0,IntPtr.Zero);voiceFile=null;VoiceVisible(false);
        var process=voiceWorker;voiceWorker=null;await DesktopIntegrity.KillTree(process);
    }
    void BindVoice(){
        On("Mic",()=>{
            try{AudioCommand("open new type waveaudio alias gemmamic");
                AudioCommand("set gemmamic time format milliseconds bitspersample 16 channels 1 samplespersec 16000 bytespersec 32000 alignment 2");
                AudioCommand("record gemmamic");voiceFile=Path.Combine(Path.GetTempPath(),"gemma-"+Guid.NewGuid()+".wav");
                Find<TextBlock>("VoiceState").Text="●  녹음 중";VoiceVisible(true);
            }catch(Exception ex){CancelVoice();status.Text=ex.Message;}
        });
        On("VoiceCancel",CancelVoice);On("VoiceStop",()=>FinishVoice(false));On("VoiceSubmit",()=>FinishVoice(true));
        window.Closed+=(s,e)=>CancelVoice();
        AddPaneGrip(Find<Grid>("Workspace"),true);
    }
    async void FinishVoice(bool submit){
        if(voiceFile==null)return;
        string file=voiceFile,chat=id;int version=voiceVersion;voiceFile=null;
        try{
            AudioCommand("stop gemmamic");AudioCommand("save gemmamic \""+file+"\"");AudioCommand("close gemmamic");
            Find<TextBlock>("VoiceState").Text="한국어 인식 중…";
            string dir=Path.Combine(BaseDir,"라이브러리","voice");
            var start=new ProcessStartInfo(Path.Combine(dir,"Release","whisper-cli.exe"),"-ng -m base.bin -f \""+file+"\" -l ko -otxt -of \""+file+"\" -nt"){WorkingDirectory=dir,UseShellExecute=false,CreateNoWindow=true};
            using(var process=Process.Start(start)){
                voiceWorker=process;ownedProcesses.Add(process);
                try{
                    bool ended=await Task.Run(()=>process.WaitForExit(180000));
                    if(!ended){await DesktopIntegrity.KillTree(process);throw new IOException("음성 인식 제한 시간을 넘어 중지했습니다.");}
                    if(process.ExitCode!=0)throw new IOException("음성 인식에 실패했습니다.");
                }finally{ownedProcesses.Remove(process);if(voiceWorker==process)voiceWorker=null;}
            }
            if(version!=voiceVersion||id!=chat)return;
            string text=File.ReadAllText(file+".txt").Trim();if(text.Length==0){status.Text="인식된 음성이 없습니다.";return;}
            input.SelectedText=text;input.CaretIndex=input.SelectionStart+input.SelectionLength;
            VoiceVisible(false);input.Focus();if(submit){if(busy)Enqueue();else await Send();}
        }catch(Exception ex){if(version==voiceVersion)status.Text=ex.Message;}
        finally{if(version==voiceVersion)CancelVoice();foreach(string path in new[]{file,file+".txt"})try{if(File.Exists(path))File.Delete(path);}catch(IOException){}}
    }
    Border toolsPane;
    void AddPaneGrip(Grid host,bool left){
        var grip=new Thumb{Width=6,HorizontalAlignment=left?HorizontalAlignment.Right:HorizontalAlignment.Left,Cursor=Cursors.SizeWE,Background=Brushes.Transparent};
        var shape=new FrameworkElementFactory(typeof(Border));shape.SetValue(Border.BackgroundProperty,Brushes.Transparent);grip.Template=new ControlTemplate(typeof(Thumb)){VisualTree=shape};
        if(left){Grid.SetColumn(grip,1);grip.SetBinding(UIElement.VisibilityProperty,new System.Windows.Data.Binding("Visibility"){Source=Find<FrameworkElement>("PanelSide")});}
        grip.DragDelta+=(s,e)=>{double max=Math.Max(190,window.ActualWidth-160);
            if(left){sideWidth=Math.Max(160,Math.Min(max,sideWidth+e.HorizontalChange));host.ColumnDefinitions[1].Width=new GridLength(sideWidth);PositionInfoPane();}
            else toolsPane.Width=Math.Max(215,Math.Min(max,toolsPane.ActualWidth-e.HorizontalChange));};
        System.Windows.Controls.Panel.SetZIndex(grip,8);host.Children.Add(grip);
    }
}
