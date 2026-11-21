using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Map=System.Collections.Generic.Dictionary<string,object>;

// 슬래시 명령: 입력창의 첫 글자가 "/"이면 입력창 위에 명령과 로컬 스킬 목록을 띄웁니다.
// ↑↓ 이동, Enter·Tab 실행, Esc 닫기. "/" 뒤에 글자를 치면 이름과 설명으로 걸러 냅니다(띄어쓰기 없이 입력).
partial class DesktopChat {
    sealed class SlashItem {
        public string Name,Hint;
        public Func<Task> Run;
        public bool WhileBusy;
    }
    Border slashCard;
    StackPanel slashRows;
    List<SlashItem> slashAll;
    readonly List<SlashItem> slashShown=new List<SlashItem>();
    int slashIndex;
    bool slashDismissed;

    bool SlashOpen{get{return slashCard!=null && slashCard.Visibility==Visibility.Visible;}}

    List<SlashItem> SlashCommands(){
        var list=new List<SlashItem>();
        Action<string,string,Func<Task>,bool> add=(n,h,r,w)=>list.Add(new SlashItem{Name=n,Hint=h,Run=r,WhileBusy=w});
        if(busy)add("중지","진행 중인 작업을 멈춥니다",Do(Stop),true);
        add("계획 모드",planning?"계획 모드 끄기":"계획 모드 켜기 · 도구 실행 없이 답합니다",Do(()=>{
            planning=!planning;attach.ToolTip=planning?"계획 모드 켜짐":"추가";
            status.Text=planning?"계획 모드 · 도구 실행 없이 답합니다.":"계획 모드를 껐습니다.";
        }),false);
        add("메모리","기억 설정과 기억 폴더 열기",Do(()=>ShowPreferences("개인 맞춤 설정")),true);
        add("모델","사용할 모델과 성능 단계 선택",Do(EffortPopup),false);
        add("목표","끝까지 진행할 목표를 정합니다",Do(()=>{input.Text="목표: ";input.CaretIndex=input.Text.Length;}),true);
        add("보관","현재 채팅을 보관합니다",async()=>{
            string chat=id;
            if(!history.Any(x=>(string)x["id"]==chat)){status.Text="보관할 대화가 아직 없습니다.";return;}
            await Modify(chat,"archived","true");New();status.Text="채팅을 보관했습니다.";
        },false);
        add("사이드","이 대화를 복사해 새 창에서 따로 이어갑니다",async()=>{
            string chat=id;
            if(!history.Any(x=>(string)x["id"]==chat)){status.Text="복사할 대화가 아직 없습니다.";return;}
            var clone=await Modify(chat,"fork");Separate((string)clone["id"]);status.Text="사이드 채팅을 새 창으로 열었습니다.";
        },false);
        add("상태","채팅 ID, 모델, 승인 방식, 대기 메시지를 표시합니다",Do(()=>{
            string approval=permission=="confirm"?"승인 요청":permission=="full"?"전체 권한":"나 대신 승인";
            status.Text="채팅 "+id.Substring(0,8)+" · 모델 "+(String.IsNullOrEmpty(prefs.model)?"자동":prefs.model)+" · "+approval+" · 계획 모드 "+(planning?"켜짐":"꺼짐")+" · 대기 메시지 "+queue.Count+"개"+(busy?" · 작업 중":"");
        }),true);
        add("새 채팅","빈 채팅을 시작합니다",Do(New),false);
        add("예약","예약 작업과 자동화 설정 열기",Do(()=>ShowPreferences("자동화")),true);
        add("검색","채팅 검색",Do(ShowSearch),true);
        add("스킬 목록","설치된 스킬 보기",Do(()=>ShowPreferences("스킬")),true);
        add("설정","설정 열기",Do(()=>ShowPreferences("일반")),true);
        try{
            string dir=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"스킬");
            if(Directory.Exists(dir))foreach(string folder in Directory.GetDirectories(dir).OrderBy(x=>x,StringComparer.OrdinalIgnoreCase)){
                string file=Path.Combine(folder,"SKILL.md");
                if(!File.Exists(file))continue;
                string skill=Path.GetFileName(folder),hint="스킬";
                foreach(string line in File.ReadLines(file).Take(8)){
                    if(line.StartsWith("description:",StringComparison.Ordinal)){hint="스킬 · "+line.Substring(12).Trim();break;}
                }
                add(skill,hint,Do(()=>{input.Text=skill+" 스킬로 ";input.CaretIndex=input.Text.Length;}),true);
            }
        }catch(IOException){}catch(UnauthorizedAccessException){}
        return list;
    }

    void BindSlash(){
        var ask=Find<StackPanel>("AskPanel");
        var host=ask==null?null:ask.Parent as System.Windows.Controls.Panel;
        if(host==null)return;
        slashRows=new StackPanel();
        var scroll=new ScrollViewer{Content=slashRows,MaxHeight=318,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,Focusable=false};
        slashCard=new Border{CornerRadius=new CornerRadius(16),BorderBrush=new SolidColorBrush(Color.FromRgb(0xE2,0xE5,0xE8)),BorderThickness=new Thickness(1),Background=Brushes.White,Padding=new Thickness(6),Margin=new Thickness(4,0,4,8),Visibility=Visibility.Collapsed,Child=scroll};
        slashCard.Effect=new System.Windows.Media.Effects.DropShadowEffect{Color=Color.FromRgb(0x33,0x45,0x59),BlurRadius=16,ShadowDepth=2,Opacity=.12};
        TextElementFont(slashCard);
        host.Children.Insert(host.Children.IndexOf(ask),slashCard);
        input.TextChanged+=(s,e)=>RefreshSlash();
        input.LostKeyboardFocus+=(s,e)=>HideSlash();
        input.PreviewKeyDown+=(s,e)=>{
            if(!SlashOpen)return;
            if(e.Key==Key.Down){MoveSlash(1);e.Handled=true;}
            else if(e.Key==Key.Up){MoveSlash(-1);e.Handled=true;}
            else if(e.Key==Key.Escape){slashDismissed=true;HideSlash();e.Handled=true;}
            else if((e.Key==Key.Enter||e.Key==Key.Tab) && Keyboard.Modifiers==ModifierKeys.None && !composingText){
                e.Handled=true;
                if(!e.IsRepeat)RunSlash(slashIndex);
            }
        };
    }

    void HideSlash(){if(slashCard!=null)slashCard.Visibility=Visibility.Collapsed;}

    void RefreshSlash(){
        if(slashCard==null)return;
        string text=input.Text;
        if(text.Length==0||text[0]!='/'){slashDismissed=false;slashAll=null;HideSlash();return;}
        if(slashDismissed||text.IndexOfAny(new[]{' ','\n','\r','\t'})>=0||!String.IsNullOrEmpty(pendingAsk)){HideSlash();return;}
        string filter=text.Substring(1);
        if(slashAll==null||filter.Length==0)slashAll=SlashCommands();
        slashShown.Clear();
        foreach(var item in slashAll){
            if(filter.Length==0||item.Name.Replace(" ","").IndexOf(filter,StringComparison.OrdinalIgnoreCase)>=0||item.Hint.IndexOf(filter,StringComparison.OrdinalIgnoreCase)>=0)slashShown.Add(item);
        }
        if(filter.Length>0){
            var ranked=slashShown.OrderBy(x=>x.Name.Replace(" ","").StartsWith(filter,StringComparison.OrdinalIgnoreCase)?0:x.Name.Replace(" ","").IndexOf(filter,StringComparison.OrdinalIgnoreCase)>=0?1:2).ToList();
            slashShown.Clear();slashShown.AddRange(ranked);
        }
        slashRows.Children.Clear();
        if(slashShown.Count==0){HideSlash();return;}
        var ink=new SolidColorBrush(Color.FromRgb(0x28,0x2B,0x30));
        var soft=new SolidColorBrush(Color.FromRgb(0x8A,0x8F,0x94));
        for(int i=0;i<slashShown.Count;i++){
            var item=slashShown[i];int at=i;
            var line=new DockPanel();
            line.Children.Add(new TextBlock{Text=item.Name,FontSize=13.5,FontWeight=FontWeights.Medium,Foreground=ink,VerticalAlignment=VerticalAlignment.Center});
            line.Children.Add(new TextBlock{Text=item.Hint,FontSize=12.5,Foreground=soft,Margin=new Thickness(10,0,0,0),TextTrimming=TextTrimming.CharacterEllipsis,VerticalAlignment=VerticalAlignment.Center});
            var row=new Button{Content=line,Focusable=false,HorizontalContentAlignment=HorizontalAlignment.Stretch,Padding=new Thickness(10,7,10,7)};
            CardButton(row);
            if((busy||loading)&&!item.WhileBusy)row.Opacity=.45;
            row.Click+=(s,e)=>RunSlash(at);
            row.MouseMove+=(s,e)=>{if(slashIndex!=at){slashIndex=at;PaintSlash(false);}};
            slashRows.Children.Add(row);
        }
        slashIndex=0;
        slashCard.Visibility=Visibility.Visible;
        PaintSlash(true);
    }

    void PaintSlash(bool reveal){
        var chosen=new SolidColorBrush(Color.FromRgb(0xEE,0xF1,0xF4));
        for(int i=0;i<slashRows.Children.Count;i++){
            var row=slashRows.Children[i] as Button;
            if(row!=null)row.Background=i==slashIndex?(Brush)chosen:Brushes.White;
        }
        if(reveal&&slashIndex>=0&&slashIndex<slashRows.Children.Count)((FrameworkElement)slashRows.Children[slashIndex]).BringIntoView();
    }

    void MoveSlash(int step){
        int count=slashShown.Count;
        if(count==0)return;
        slashIndex=(slashIndex+step+count)%count;
        PaintSlash(true);
    }

    async void RunSlash(int index){
        if(index<0||index>=slashShown.Count)return;
        var item=slashShown[index];
        if((busy||loading)&&!item.WhileBusy){status.Text="작업이 끝난 뒤에 쓸 수 있는 명령입니다 · "+item.Name;return;}
        HideSlash();input.Clear();status.Text="";
        try{await item.Run();}catch(Exception x){status.Text=x.Message;}
        if(!input.IsKeyboardFocused&&window.IsActive&&Keyboard.FocusedElement==null)input.Focus();
    }
}
