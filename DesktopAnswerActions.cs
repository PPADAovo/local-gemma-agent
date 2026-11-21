using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Speech.Synthesis;
using System.Collections.Generic;
partial class DesktopChat {
    sealed class AnswerBorder:Border{}
    SpeechSynthesizer reader;
    Button reading;
    void StopReading(){var old=reader;reader=null;if(reading!=null){reading.Content="\uE767";reading.ToolTip="소리 내어 읽기";reading=null;}if(old!=null){old.SpeakAsyncCancelAll();old.Dispose();}}
    StackPanel AnswerActions(StackPanel body,string text,string original,string timestamp){
        string chat=id;int index=messages.Children.OfType<AnswerBorder>().Count();
        string key=chat+"/"+index;
        var actions=new StackPanel{Orientation=Orientation.Horizontal,Margin=new Thickness(0,4,0,0),Opacity=0,IsHitTestVisible=false};
        body.Background=Brushes.Transparent;actions.Children.Add(Copy(text,"응답 복사"));
        var rate=MessageAction("응답 평가","\uE8E1");var speak=MessageAction("소리 내어 읽기","\uE767");var more=MessageAction("더 보기","\uE712");
        var rethink=MessageAction("다시 생각하기","\uE72C");
        foreach(var b in new[]{rate,speak,rethink,more})actions.Children.Add(b);
        rethink.Click+=async(s,e)=>{
            if(busy||loading){status.Text="현재 작업이 끝나면 다시 생각할 수 있습니다.";return;}
            int version=view;
            loading=true;SyncControls();
            try{
                var args=json.Serialize(new{action="forkAnswer",value=json.Serialize(new{index,content=original})});
                var branch=(Dictionary<string,object>)await Rpc("manage",args,chat);
                if(view!=version||id!=chat)return;
                string next=(string)branch["id"];
                await Open(next);
                if(id!=next||busy||loading)return;
                input.Text="직전 사용자 요청과 방금 답변을 다시 검토해 주세요. 누락이나 오류를 바로잡아 새 답변을 작성하고, 이미 실행한 작업과 아직 확인이 필요한 부분을 구분해 주세요. 이미 실행한 작업은 반복하지 마세요.";
                await Send(RethinkTextOnly(prefs.brain));
            }catch(Exception ex){status.Text=ex.Message;}
            finally{if(view==version){loading=false;SyncControls();}}
        };
        var votes=new ContextMenu();var options=new ContextMenu();bool menuOpen=false;
        Action reveal=()=>{bool show=body.IsMouseOver||menuOpen;actions.Opacity=show?1:0;actions.IsHitTestVisible=show;};
        body.MouseEnter+=(s,e)=>reveal();body.MouseLeave+=(s,e)=>reveal();
        Action<Button,ContextMenu> bind=(b,m)=>{m.PlacementTarget=b;m.Placement=System.Windows.Controls.Primitives.PlacementMode.Top;b.Click+=(s,e)=>m.IsOpen=true;m.Opened+=(s,e)=>{menuOpen=true;reveal();};m.Closed+=(s,e)=>{menuOpen=false;reveal();};};bind(rate,votes);bind(more,options);
        Action update=()=>{string val;prefs.ratings.TryGetValue(key,out val);rate.Content=val=="별로예요"?"\uE8E0":"\uE8E1";rate.ToolTip=val??"응답 평가";foreach(MenuItem entry in votes.Items)entry.IsChecked=Equals(entry.Header,val);};
        foreach(string label in new[]{"좋아요","별로예요"}){var opt=new MenuItem{Header=label,IsCheckable=true};opt.Click+=(s,e)=>{if(opt.IsChecked)prefs.ratings[key]=label;else prefs.ratings.Remove(key);SavePreferences();update();};votes.Items.Add(opt);}update();
        speak.Click+=(s,e)=>{bool stop=reading==speak;StopReading();if(stop)return;try{var engine=new SpeechSynthesizer();reader=engine;reading=speak;speak.Content="\uE71A";speak.ToolTip="읽기 중지";engine.SpeakCompleted+=(a,b)=>window.Dispatcher.BeginInvoke(new Action(()=>{if(reader==engine)StopReading();}));engine.SpeakAsync(text);}catch(Exception ex){StopReading();status.Text=ex.Message;}};
        body.Unloaded+=(s,e)=>{if(reading==speak)StopReading();};
        var fork=new MenuItem{Header="새 채팅으로 가지치기"};options.Items.Add(fork);fork.Click+=async(s,e)=>{if(busy||loading){status.Text="작업이 끝나면 가지치기할 수 있습니다.";return;}try{var args=json.Serialize(new{action="forkAnswer",value=json.Serialize(new{index,content=original})});var result=(Dictionary<string,object>)await Rpc("manage",args,chat);await Open((string)result["id"]);}catch(Exception ex){status.Text=ex.Message;}};
        DateTime date;if(timestamp==null)date=DateTime.Now;else if(!DateTime.TryParse(timestamp,out date))return actions;
        var local=date.ToLocalTime();
        actions.Children.Add(new TextBlock{Text=MessageWhen(local,DateTime.Now),ToolTip=local.ToString("yyyy년 M월 d일 dddd tt h:mm:ss",new System.Globalization.CultureInfo("ko-KR")),Foreground=Brushes.Gray,FontSize=12,Margin=new Thickness(8,0,0,0),VerticalAlignment=VerticalAlignment.Center});
        return actions;
    }
    // 항상 날짜까지 표시: "26.11.19. (목요일) 오전 10:15"
    static string MessageWhen(DateTime when,DateTime now){
        return when.ToString("yy.MM.dd. (dddd) tt h:mm",new System.Globalization.CultureInfo("ko-KR"));
    }
    static bool RethinkTextOnly(string brain){return String.IsNullOrEmpty(brain)||brain=="local"||brain=="mix";}
}
