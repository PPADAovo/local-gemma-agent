using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Input;

// 채팅 대기열: 에이전트가 일하는 동안에도 메시지를 입력해 두면, 지금 작업이 끝난 뒤 차례로 보냅니다.
partial class DesktopChat {
    readonly List<string> queue=new List<string>();
    bool queuePaused,composingText;
    sealed class ComposerDraft {
        public string Text,Attachment;
        public string[] Files,Queued;
    }
    void KeepDraft(){
        if(input.Text.Length+attachment.Length+attachedFiles.Count+queue.Count==0){drafts.Remove(id);return;}
        drafts[id]=new ComposerDraft{Text=input.Text,Attachment=attachment,Files=attachedFiles.ToArray(),Queued=queue.ToArray()};
    }
    void RestoreDraft(){
        ComposerDraft draft;drafts.TryGetValue(id,out draft);
        attachment=draft==null?"":draft.Attachment;
        attachedFiles.Clear();queue.Clear();
        if(draft!=null){attachedFiles.AddRange(draft.Files);queue.AddRange(draft.Queued);}
        queuePaused=queue.Count>0;
        input.Text=draft==null?"":draft.Text;input.CaretIndex=input.Text.Length;
        RenderAttachList();RenderQueue();
    }
    void BindComposer(){
        TextCompositionManager.AddPreviewTextInputStartHandler(input,(s,e)=>composingText=true);
        TextCompositionManager.AddPreviewTextInputHandler(input,(s,e)=>composingText=false);
        input.LostKeyboardFocus+=(s,e)=>composingText=false;
        BindVoice();
        Find<Button>("QueueSend").Click+=(s,e)=>Enqueue();
        var toolbar=Find<Grid>("ComposerTools");
        toolbar.SizeChanged+=(s,e)=>{
            var access=Find<Button>("Access");
            access.Tag=e.NewSize.Width<460 ? Visibility.Collapsed : Visibility.Visible;
            Find<Button>("Model").MaxWidth=Math.Max(70,Math.Min(190,e.NewSize.Width-170));
        };
    }
    string InboxPath(){return System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"대화기록","inbox",id+".jsonl");}
    // 지금 보내기: 진행 중인 작업에 바로 추가 지시를 넣습니다(에이전트가 다음 단계에서 읽고 반영).
    void SendNow(string text){
        text=(text??"").Trim();if(text.Length==0)return;
        // 비밀번호 카드가 떠 있을 때 입력창에 쓴 말은 그 카드의 비밀번호로만 보냅니다. 채팅·대화 기록에는 남기지 않습니다.
        if(busy && pendingAsk.Length>0 && pendingAskSecret){AnswerAsk(pendingAsk,text,"🔒 비밀번호 입력함");return;}
        // 에이전트가 질문 카드를 띄우고 기다리는 중이면, 입력창에 쓴 말은 그 질문의 답입니다.
        // (예전에는 카드가 자기 버튼 답만 기다려서, "2번"이라고 써도 카드가 닫힐 때까지 반영되지 않았습니다.)
        if(busy && pendingAsk.Length>0 && pendingAskAcceptsText && localApproval==null){AnswerAsk(pendingAsk,text,"💬 "+text);return;}
        if(!busy||worker==null||stopping){queue.Insert(0,text);RenderQueue();RunQueue();return;}
        try{
            string f=InboxPath();System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(f));
            System.IO.File.AppendAllText(f,json.Serialize(new{text,at=DateTime.Now.ToString("s")})+"\n",new System.Text.UTF8Encoding(false));
            Add("user","⚡ "+text);status.Text="지금 작업에 추가했어요 · 다음 단계에서 반영합니다.";
        }catch(Exception x){status.Text="지금 보내기 실패: "+x.Message;queue.Insert(0,text);RenderQueue();}
    }
    bool KeepAttachedDraft(){if(attachedFiles.Count==0 && attachment.Length==0)return false;status.Text="첨부한 메시지는 답변이 끝난 후 보낼 수 있어요.";return true;} void SendNowFromInput(){if(KeepAttachedDraft())return;string t=input.Text.Trim();if(t.Length==0)return;input.Clear();SendNow(t);}
    void Enqueue(){if(KeepAttachedDraft())return;
        string text=input.Text.Trim();if(text.Length==0)return;
        if(busy && pendingAsk.Length>0 && pendingAskSecret){input.Clear();SendNow(text);return;}
        if(queue.Count>=10){status.Text="대기열은 10개까지 넣을 수 있습니다.";return;}
        queue.Add(text);input.Clear();queuePaused=false;RenderQueue();status.Text="";
    }
    void RenderQueue(){
        var panel=Find<StackPanel>("QueuePanel");if(panel==null)return;panel.Children.Clear();
        if(queue.Count==0){panel.Visibility=Visibility.Collapsed;SyncSendButton();return;}
        panel.Visibility=Visibility.Visible;
        var line=new SolidColorBrush(Color.FromRgb(0xE2,0xE5,0xE8));
        var box=new Border{CornerRadius=new CornerRadius(14),BorderBrush=line,BorderThickness=new Thickness(1),Background=new SolidColorBrush(Color.FromRgb(0xFF,0xFF,0xFF)),Padding=new Thickness(10,6,6,6),Margin=new Thickness(12,0,12,-2)};
        var list=new StackPanel();box.Child=new ScrollViewer{Content=list,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,MaxHeight=145};
        var head=new DockPanel{Margin=new Thickness(2,0,0,2)};
        if(queuePaused && !busy){
            var resume=new Button{Content="▶ 계속 보내기",Padding=new Thickness(8,2,8,2),Foreground=new SolidColorBrush(Color.FromRgb(0x2F,0x6F,0xED))};
            resume.Click+=(s,e)=>{queuePaused=false;RenderQueue();RunQueue();};
            DockPanel.SetDock(resume,Dock.Right);head.Children.Add(resume);
        }
        var clear=new Button{Content="모두 지우기",Padding=new Thickness(8,2,8,2),Foreground=Brushes.Gray,FontSize=12};
        clear.Click+=(s,e)=>{if(!ConfirmRemoval(window,"대기 중인 요청을 모두 지울까요?","아직 보내지 않은 요청을 대기열에서 모두 제거합니다.","모두 지우기"))return;queue.Clear();RenderQueue();};DockPanel.SetDock(clear,Dock.Right);head.Children.Add(clear);
        head.Children.Add(new TextBlock{Text=(queuePaused&&!busy?"⏸ 멈춘 대기열 · ":"⏳ 대기 중 · ")+queue.Count+"개"+(busy?" · 지금 작업이 끝나면 차례로 보냅니다":queuePaused?" · 중지해서 멈췄어요":""),Foreground=Brushes.DimGray,FontSize=12,VerticalAlignment=VerticalAlignment.Center});
        if(queuePaused && !busy)list.Children.Add(head);
        for(int i=0;i<queue.Count;i++){
            int index=i;
            var row=new DockPanel{Margin=new Thickness(0,3,0,0)};
            var remove=new Button{Content="\uE74D",FontFamily=new FontFamily("Segoe MDL2 Assets"),ToolTip="대기열에서 빼기",Padding=new Thickness(8,2,8,2),Foreground=Brushes.Gray};
            remove.Click+=(s,e)=>{var snapshot=queue.ToArray();if(index<snapshot.Length && ConfirmRemoval(window,"대기 중인 요청을 제거할까요?","이 요청을 대기열에서 제거합니다.","요청 제거") && queue.SequenceEqual(snapshot)){queue.RemoveAt(index);RenderQueue();}};
            var edit=new Button{Content="수정",ToolTip="입력창으로 가져와서 고치기",Padding=new Thickness(8,2,8,2),Foreground=Brushes.Gray,FontSize=12};
            edit.Click+=(s,e)=>{if(index<queue.Count){string t=queue[index];queue.RemoveAt(index);input.Text=input.Text.Length>0?input.Text+"\n"+t:t;input.CaretIndex=input.Text.Length;input.Focus();RenderQueue();}};
            var up=new Button{Content="↑",ToolTip="먼저 보내기",Padding=new Thickness(8,2,8,2),Foreground=Brushes.Gray,IsEnabled=index>0};
            up.Click+=(s,e)=>{if(index>0&&index<queue.Count){string t=queue[index];queue.RemoveAt(index);queue.Insert(index-1,t);RenderQueue();}};
            var now=new Button{Content="↪ 현재 작업 조정",ToolTip="기다리지 않고 지금 하는 작업에 바로 추가",Padding=new Thickness(8,2,8,2),Foreground=new SolidColorBrush(Color.FromRgb(0x2F,0x6F,0xED)),FontSize=12,Visibility=busy?Visibility.Visible:Visibility.Collapsed};
            now.Click+=(s,e)=>{if(index<queue.Count){string t=queue[index];queue.RemoveAt(index);RenderQueue();SendNow(t);}};
            DockPanel.SetDock(remove,Dock.Right);DockPanel.SetDock(edit,Dock.Right);DockPanel.SetDock(up,Dock.Right);DockPanel.SetDock(now,Dock.Right);
            var more=new Button{Content="⋯",ToolTip="메시지 옵션"};
            var options=new ContextMenu();var revise=new MenuItem{Header="메시지 수정"};var earlier=new MenuItem{Header="먼저 보내기",IsEnabled=index>0};
            revise.Click+=(s,e)=>edit.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));earlier.Click+=(s,e)=>up.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            options.Items.Add(revise);options.Items.Add(earlier);more.Click+=(s,e)=>{options.PlacementTarget=more;options.IsOpen=true;};
            DockPanel.SetDock(more,Dock.Right);row.Children.Add(more);row.Children.Add(remove);row.Children.Add(now);
            row.Children.Add(new TextBlock{Text="↳   "+queue[index].Replace("\r"," ").Replace("\n"," "),TextTrimming=TextTrimming.CharacterEllipsis,VerticalAlignment=VerticalAlignment.Center,ToolTip=queue[index]});
            list.Children.Add(row);
        }
        panel.Children.Add(box);SyncSendButton();
    }
    // 작업 중일 때: 입력이 있으면 ↑(대기열에 추가), 없으면 ■(중지)
    void SyncSendButton(){
        var ph=Find<TextBlock>("Placeholder");
        if(ph!=null)ph.Text=busy?"메시지 추가":"무엇이든 요청하세요";
        Find<Button>("Mic").IsEnabled=!loading;
        bool typed=!String.IsNullOrWhiteSpace(input.Text);
        var later=Find<Button>("QueueSend");
        later.Visibility=busy&&typed&&attachedFiles.Count==0&&attachment.Length==0?Visibility.Visible:Visibility.Collapsed;
        send.Content=new System.Windows.Shapes.Path{Data=Geometry.Parse(busy?"M3,3 H11 V11 H3 Z":"M7,1 V13 M2,6 L7,1 L12,6"),Stroke=Brushes.White,StrokeThickness=1.35,Fill=busy?Brushes.White:null,StrokeLineJoin=PenLineJoin.Round,StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round};
        string label=busy?(stopping?"중지 중":"응답 중지"):"보내기";
        send.ToolTip=busy?label:prefs.ctrlEnterSend?"보내기 (Ctrl+Enter) · 줄바꿈 (Enter)":"보내기 (Enter) · 줄바꿈 (Shift+Enter)";
        later.ToolTip=!prefs.queueFirst?"현재 작업 조정 (Enter) · 대기열에 추가 (Ctrl+Enter)":"대기열에 추가 (Enter) · 현재 작업 조정 (Ctrl+Enter)";
        System.Windows.Automation.AutomationProperties.SetName(send,label);
        send.IsEnabled=busy?(worker!=null&&!stopping&&!worker.HasExited):!loading&&(typed||attachment.Length>0||attachedFiles.Count>0);
    }
    async void RunQueue(){
        string owner=id;int version=view;
        await Task.Delay(400);
        if(owner!=id||version!=view||busy||loading||queuePaused||queue.Count==0)return;
        if(!String.IsNullOrWhiteSpace(input.Text)||attachment.Length>0||attachedFiles.Count>0){status.Text="작성 중인 메시지를 보낸 후 대기열에서 계속 보내기를 누르세요.";queuePaused=true;RenderQueue();return;}
        string next=queue[0];queue.RemoveAt(0);RenderQueue();
        input.Text=next;
        try{await Send();}catch(Exception x){status.Text=x.Message;}
    }
}
