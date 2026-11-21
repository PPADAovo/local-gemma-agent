using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

// 질문·승인 카드 (ChatGPT·Codex식): 작업을 끝내지 않고 입력창 위에 카드를 띄워 답을 받습니다.
// 에이전트가 stderr로 "@ask {...}"를 보내면 카드를 띄우고, 고른 답을 우편함(inbox)에 {askId, answer}로 적어 돌려줍니다.
partial class DesktopChat {
    string pendingAsk="";
    // 지금 떠 있는 카드가 글로 답할 수 있는 질문 카드인지(승인·비밀번호·버튼 전용 카드는 아님).
    // 이런 카드가 떠 있을 때 아래 입력창에 쓴 메시지는 그 질문의 답으로 보냅니다.
    bool pendingAskAcceptsText,pendingAskSecret;
    Window askNotice;

    static void TextElementFont(DependencyObject element){System.Windows.Documents.TextElement.SetFontFamily(element,new FontFamily("Malgun Gothic"));}
    static void CardButton(Button button,bool outline=false){
        var border=new FrameworkElementFactory(typeof(Border));
        border.SetValue(Border.CornerRadiusProperty,new CornerRadius(7));
        border.SetValue(Border.BorderThicknessProperty,new Thickness(outline?1:0));
        border.SetValue(Border.BorderBrushProperty,new SolidColorBrush(Color.FromRgb(223,225,229)));
        border.SetValue(Border.BackgroundProperty,new TemplateBindingExtension(Control.BackgroundProperty));
        var presenter=new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(FrameworkElement.MarginProperty,new TemplateBindingExtension(Control.PaddingProperty));
        presenter.SetValue(FrameworkElement.HorizontalAlignmentProperty,new TemplateBindingExtension(Control.HorizontalContentAlignmentProperty));
        presenter.SetValue(FrameworkElement.VerticalAlignmentProperty,VerticalAlignment.Center);
        border.AppendChild(presenter);
        var template=new ControlTemplate(typeof(Button)){VisualTree=border};
        var hover=new Trigger{Property=UIElement.IsMouseOverProperty,Value=true};
        hover.Setters.Add(new Setter(Control.BackgroundProperty,new SolidColorBrush(Color.FromRgb(244,245,247))));
        template.Triggers.Add(hover);button.Template=template;button.Background=Brushes.White;button.Cursor=Cursors.Hand;
    }
    System.Threading.Tasks.TaskCompletionSource<bool> localApproval;
    string localApprovalId;
    System.Threading.Tasks.Task<bool> AskLocal(string title,string message){
        if(!String.IsNullOrEmpty(pendingAsk))return System.Threading.Tasks.Task.FromResult(false);
        var result=new System.Threading.Tasks.TaskCompletionSource<bool>();
        localApprovalId=Guid.NewGuid().ToString();localApproval=result;
        ShowAsk(new Dictionary<string,object>{{"askId",localApprovalId},{"kind","approve"},{"title",title},{"question",message},{"options",new[]{"승인","거부"}},{"choicesOnly",true}});
        return result.Task;
    }
    void ShowAsk(Dictionary<string,object> q){
        string askId=Convert.ToString(q["askId"]);
        if(localApproval!=null && askId!=localApprovalId)HideAsk(localApprovalId);
        string kind=q.ContainsKey("kind")?Convert.ToString(q["kind"]):"question";
        bool approve=kind=="approve";
        string title=q.ContainsKey("title")?Convert.ToString(q["title"]):(approve?"승인이 필요해요":"질문");
        string question=q.ContainsKey("question")?Convert.ToString(q["question"]):"";
        var options=new List<string>();
        if(q.ContainsKey("options")&&q["options"] is System.Collections.IEnumerable)foreach(var o in (System.Collections.IEnumerable)q["options"])options.Add(Convert.ToString(o));
        pendingAsk=askId;

        var panel=Find<StackPanel>("AskPanel");panel.Children.Clear();
        var line=new SolidColorBrush(Color.FromRgb(0xE2,0xE5,0xE8));
        var accent=approve?new SolidColorBrush(Color.FromRgb(0xC2,0x41,0x0C)):new SolidColorBrush(Color.FromRgb(0x5F,0x63,0x68));
        var card=new Border{CornerRadius=new CornerRadius(16),BorderBrush=approve?new SolidColorBrush(Color.FromRgb(0xF5,0xC2,0x9B)):line,BorderThickness=new Thickness(1),Background=Brushes.White,Padding=new Thickness(14,10,10,10),Margin=new Thickness(4,0,4,8)};
        card.Effect=new System.Windows.Media.Effects.DropShadowEffect{Color=Color.FromRgb(0x33,0x45,0x59),BlurRadius=16,ShadowDepth=2,Opacity=.12};
        var root=new StackPanel();TextElementFont(root);card.Child=root;

        // 머리: ⓘ 질문 / ⚠ 승인  ·  ✕(건너뛰기·거부)
        var head=new DockPanel{Margin=new Thickness(0,0,0,6)};
        var close=new Button{Content="✕",FontSize=12,Padding=new Thickness(7,2,7,2),ToolTip=approve?"거부":"건너뛰기",Foreground=Brushes.Gray};
        CardButton(close);close.Click+=(s,e)=>AnswerAsk(askId,approve?"거부":"",approve?"✋ 거부":"↷ 질문 건너뜀");
        DockPanel.SetDock(close,Dock.Right);head.Children.Add(close);
        head.Children.Add(new TextBlock{Text=(approve?"⚠ 승인 · ":"ⓘ 질문 · ")+title,Foreground=accent,FontSize=12.5,VerticalAlignment=VerticalAlignment.Center});
        root.Children.Add(head);

        // 질문 본문(선택지 줄은 아래 버튼으로 따로 보여 주므로 뺌)
        var body=String.Join("\n",question.Replace("\r\n","\n").Split('\n').Where(l=>!options.Any(o=>l.Trim().EndsWith(o)&&System.Text.RegularExpressions.Regex.IsMatch(l.Trim(),@"^(\d+[.)]|[-•])\s*")))).Trim();
        // ```코드``` 부분(직접 실행할 PowerShell 등)은 고정폭 글꼴의 선택 가능한 칸과 [코드 복사] 버튼으로 보여 줍니다.
        var bodyPanel=new StackPanel();
        int at=0;
        foreach(System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(body,"```[\\w-]*\\n([\\s\\S]*?)```")){
            string before=body.Substring(at,m.Index-at).Trim();
            if(before.Length>0)bodyPanel.Children.Add(new TextBlock{Text=before,TextWrapping=TextWrapping.Wrap,FontWeight=FontWeights.Medium,FontSize=14,Margin=new Thickness(2,0,0,6)});
            string code=m.Groups[1].Value.TrimEnd();
            var codeBox=new TextBox{Text=code,IsReadOnly=true,FontFamily=new FontFamily("Consolas, D2Coding, Malgun Gothic"),FontSize=12.5,MaxHeight=220,
                VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Auto,TextWrapping=TextWrapping.NoWrap,
                Background=new SolidColorBrush(Color.FromRgb(0xF6,0xF8,0xFA)),BorderBrush=line,Padding=new Thickness(6),Margin=new Thickness(2,0,0,4)};
            var copy=new Button{Content="코드 복사",HorizontalAlignment=HorizontalAlignment.Left,Padding=new Thickness(10,3,10,3),Margin=new Thickness(2,0,0,8)};
            CardButton(copy);
            copy.Click+=(s,e)=>{try{Clipboard.SetText(code);copy.Content="복사했어요 ✓";}catch{copy.Content="복사 실패 — 칸을 눌러 Ctrl+A, Ctrl+C";}};
            bodyPanel.Children.Add(codeBox);bodyPanel.Children.Add(copy);
            at=m.Index+m.Length;
        }
        string rest=body.Substring(at).Trim();
        if(rest.Length>0)bodyPanel.Children.Add(new TextBlock{Text=rest,TextWrapping=TextWrapping.Wrap,FontWeight=FontWeights.Medium,FontSize=14,Margin=new Thickness(2,0,0,8)});
        // 긴 안내도 카드가 화면을 덮지 않게 스크롤합니다.
        root.Children.Add(new ScrollViewer{Content=bodyPanel,MaxHeight=420,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});

        if(q.ContainsKey("showBrowser") && Equals(q["showBrowser"],true) && showBrowser!=null){
            var open=new Button{Content="로그인 창 열기",HorizontalAlignment=HorizontalAlignment.Left,Padding=new Thickness(12,5,12,5),Margin=new Thickness(0,0,0,5)};
            CardButton(open,true);open.Click+=(s,e)=>showBrowser();root.Children.Add(open);
        }
        // 선택지: [1] 네, 잘 보여요   →
        for(int i=0;i<options.Count;i++){
            string option=options[i];int n=i+1;
            var row=new DockPanel();
            var badge=new Border{Width=22,Height=22,CornerRadius=new CornerRadius(6),Background=new SolidColorBrush(Color.FromRgb(0xF1,0xF3,0xF4)),Margin=new Thickness(0,0,10,0),
                Child=new TextBlock{Text=n.ToString(),FontSize=12,Foreground=Brushes.DimGray,HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center}};
            DockPanel.SetDock(badge,Dock.Left);row.Children.Add(badge);
            var arrow=new TextBlock{Text="→",Foreground=Brushes.Silver,VerticalAlignment=VerticalAlignment.Center};DockPanel.SetDock(arrow,Dock.Right);row.Children.Add(arrow);
            Brush color=Brushes.Black;
            if(approve&&option.StartsWith("승인"))color=new SolidColorBrush(Color.FromRgb(0x1A,0x7F,0x37));
            if(approve&&option.StartsWith("거부"))color=new SolidColorBrush(Color.FromRgb(0xCF,0x22,0x2E));
            row.Children.Add(new TextBlock{Text=option,Foreground=color,FontWeight=FontWeights.SemiBold,VerticalAlignment=VerticalAlignment.Center,TextTrimming=TextTrimming.CharacterEllipsis});
            var b=new Button{Content=row,HorizontalContentAlignment=HorizontalAlignment.Stretch,Padding=new Thickness(6,6,10,6),Margin=new Thickness(0,1,0,1),ToolTip=n+"번 고르기"};
            CardButton(b);
            string shown=approve?(option.StartsWith("거부")?"✋ 거부":"✅ "+option):"💬 "+option;
            b.Click+=(s,e)=>AnswerAsk(askId,option,shown);
            root.Children.Add(b);
        }

        // 직접 답하기 + 건너뛰기/보내기
        var bottom=new DockPanel{Margin=new Thickness(2,8,0,0)};
        var send=new Button{Content="보내기",Padding=new Thickness(12,5,12,5),Background=new SolidColorBrush(Color.FromRgb(0x17,0x1A,0x1E)),Foreground=Brushes.White,Margin=new Thickness(6,0,0,0),IsEnabled=false};
        var skip=new Button{Content=approve?"거부":"건너뛰기",Padding=new Thickness(12,5,12,5),BorderBrush=line,BorderThickness=new Thickness(1),Background=Brushes.White};
        DockPanel.SetDock(send,Dock.Right);DockPanel.SetDock(skip,Dock.Right);bottom.Children.Add(send);bottom.Children.Add(skip);
        bool secret=q.ContainsKey("secret")&&Convert.ToString(q["secret"]).ToLowerInvariant()=="true";
        pendingAskAcceptsText=!approve && !secret && !(q.ContainsKey("choicesOnly") && Equals(q["choicesOnly"],true));
        pendingAskSecret=secret;
        var box=CreateAnswerField(secret);
        Func<string> answerText=()=>secret?((PasswordBox)box).Password:((TextBox)box).Text.Trim();
        var hint=new TextBlock{Text=approve?"✎  거부하고 다르게 지시하기 (예: 빈파일.txt만 지워)":"✎  또는 직접 답변을 작성하세요",Foreground=Brushes.Silver,IsHitTestVisible=false,Margin=new Thickness(4,0,0,0),VerticalAlignment=VerticalAlignment.Center};
        var field=new Grid();field.Children.Add(box);field.Children.Add(hint);bottom.Children.Add(field);
        Action updateField=()=>{hint.Visibility=answerText().Length>0?Visibility.Collapsed:Visibility.Visible;send.IsEnabled=answerText().Length>0;};
        if(secret)((PasswordBox)box).PasswordChanged+=(s,e)=>updateField();else ((TextBox)box).TextChanged+=(s,e)=>updateField();
        // 비밀번호를 묻는 카드(secret=true)의 답은 작업 기록에 글자 그대로 남기지 않습니다.
        Action submit=()=>{string t=answerText();if(t.Length==0)return;AnswerAsk(askId,approve?"거부: "+t:t,secret?"🔒 비밀번호 입력함":approve?"✋ 거부 · "+t:"💬 "+t);if(secret)((PasswordBox)box).Clear();};
        send.Click+=(s,e)=>submit();
        box.KeyDown+=(s,e)=>{if(e.Key==Key.Enter){e.Handled=true;submit();}};
        skip.Click+=(s,e)=>AnswerAsk(askId,approve?"거부":"",approve?"✋ 거부":"↷ 질문 건너뜀");
        if(!(q.ContainsKey("choicesOnly") && Equals(q["choicesOnly"],true)))root.Children.Add(bottom);

        // 숫자키 1~4로 바로 고르기(입력칸이 비어 있을 때)
        card.PreviewKeyDown+=(s,e)=>{
            if(box.IsKeyboardFocusWithin)return;
            int k=e.Key>=Key.D1&&e.Key<=Key.D9?e.Key-Key.D1:e.Key>=Key.NumPad1&&e.Key<=Key.NumPad9?e.Key-Key.NumPad1:-1;
            if(k>=0&&k<options.Count){e.Handled=true;string o=options[k];AnswerAsk(askId,o,approve?(o.StartsWith("거부")?"✋ 거부":"✅ "+o):"💬 "+o);}
        };

        panel.Children.Add(card);panel.Visibility=Visibility.Visible;
        if(localApproval==null){liveAction=title;RefreshLiveHeader();}
        if(askNotice!=null){askNotice.Close();askNotice=null;}
        if(kind=="login" && window.IsLoaded && !window.IsActive){
            var notice=new Window{Title=title,Width=320,SizeToContent=SizeToContent.Height,WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,ShowActivated=false,ShowInTaskbar=false,Topmost=true};
            var link=new Button{Content="로컬 Gemma · "+title+"  →",Padding=new Thickness(14,10,14,10)};
            link.Click+=(s,e)=>{if(window.WindowState==WindowState.Minimized)window.WindowState=WindowState.Normal;window.Activate();notice.Close();askNotice=null;};
            notice.Content=link;var area=SystemParameters.WorkArea;notice.Left=area.Right-332;notice.Top=area.Bottom-62;askNotice=notice;notice.Show();
        }
        if(localApproval==null)FollowMessage(false);
    }

    static Control CreateAnswerField(bool secret){
        if(secret)return new PasswordBox{VerticalContentAlignment=VerticalAlignment.Center,Padding=new Thickness(2,4,2,4)};
        return new TextBox{VerticalContentAlignment=VerticalAlignment.Center,Padding=new Thickness(2,4,2,4),AcceptsReturn=false};
    }

    void AnswerAsk(string askId,string answer,string shown){
        if(answer=="Google 로그인 열기")ShowFile("https://accounts.google.com/");
        if(pendingAsk!=askId)return;
        if(localApproval!=null && askId==localApprovalId){
            var result=localApproval;localApproval=null;HideAsk(askId);result.TrySetResult(answer=="승인");return;
        }
        try{
            string f=InboxPath();System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(f));
            System.IO.File.AppendAllText(f,json.Serialize(new{askId,answer,at=DateTime.Now.ToString("s")})+"\n",new System.Text.UTF8Encoding(false));
            if(activeLines!=null)LogLine(activeLines,shown);
            HideAsk(askId);status.Text="";
        }catch(Exception x){status.Text="답을 보내지 못했습니다: "+x.Message;}
    }

    void HideAsk(string askId){
        if(askId!=null&&askId!=pendingAsk)return;
        if(askNotice!=null){askNotice.Close();askNotice=null;}
        var previous=localApproval;localApproval=null;pendingAsk="";pendingAskAcceptsText=false;pendingAskSecret=false;RefreshLiveHeader();
        var panel=Find<StackPanel>("AskPanel");if(panel==null)return;
        panel.Children.Clear();panel.Visibility=Visibility.Collapsed;if(previous!=null)previous.TrySetResult(false);
    }
}
