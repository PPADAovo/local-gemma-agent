using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using Map=System.Collections.Generic.Dictionary<string,object>;

partial class DesktopChat {
    static readonly Dictionary<string,string> SkillExamples=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){
        {"automate","매주 월요일 오전 9시에 이번 주 작업 일정을 정리해줘."},
        {"autopilot","이 PR의 리뷰 의견과 실패한 검사를 확인하고 수정해줘."},
        {"canvas","이 데이터의 월별 변화와 상세 항목을 볼 수 있는 캔버스를 만들어줘."},
        {"computer-use:computer-use","선택한 창에서 새 일정을 입력하고 저장된 화면을 확인해줘."},
        {"create-hook","작업이 끝나면 포맷 검사를 실행하는 훅을 만들어줘."},
        {"create-rule","이 프로젝트의 오류 처리 방식을 작업 규칙에 추가해줘."},
        {"create-skill","매달 반복하는 보고서 작성 절차를 스킬로 만들어줘."},
        {"create-subagent","회귀 오류를 찾아내는 코드 검토용 에이전트를 구성해줘."},
        {"documents:documents","첨부 자료로 두 쪽 분량의 Word 안내문을 만들어줘."},
        {"goal","이 버전의 배포 준비를 목표로 설정하고 완료 조건을 정리해줘."},
        {"hatch-pet","내 캐릭터 스케치로 움직이는 펫을 만들어줘."},
        {"loop","이 작업이 끝날 때까지 주기적으로 상태를 확인해줘."},
        {"migrate-to-skills","이 저장소의 기존 규칙과 명령을 스킬로 옮겨줘."},
        {"new-repo","이 프로젝트의 원격 저장소를 만들고 현재 버전을 올려줘."},
        {"onboard","내 작업 방식을 바탕으로 첫 프로젝트를 시작하도록 도와줘."},
        {"origin","이 저장소의 origin CLI 연결 상태를 확인해줘."},
        {"pdf:pdf","이 PDF에서 일정을 추출하고 원본 페이지와 대조해줘."},
        {"presentations:presentations","이 회의 자료로 다섯 장짜리 발표 자료를 만들어줘."},
        {"rename-chat","현재 대화의 내용을 반영해 제목을 바꿔줘."},
        {"review","이번 변경에서 사용자에게 영향을 줄 오류를 찾아줘."},
        {"review-bugbot","현재 변경 사항에서 재현 가능한 버그를 검토해줘."},
        {"review-security","이 PR에서 인증과 권한 처리 문제를 검토해줘."},
        {"sdk","Python 앱에서 에이전트를 실행하고 결과를 읽는 예제를 만들어줘."},
        {"share","현재 프로젝트 버전을 저장하고 공유 방법을 알려줘."},
        {"shell","지정한 폴더에서 내가 제공한 명령을 실행해줘."},
        {"split-to-prs","이 변경을 독립적으로 검토할 수 있는 PR로 나눠줘."},
        {"spreadsheets:spreadsheets","이 지출 내역을 월별로 집계한 스프레드시트를 만들어줘."},
        {"spreadsheets:excel-live-control","현재 열어 둔 Excel 문서의 선택 범위에 합계를 넣어줘."},
        {"statusline","상태 표시줄에 현재 프로젝트와 세션 정보를 표시해줘."},
        {"systematic-debugging","이 오류를 재현하고 원인을 확인한 뒤 수정해줘."},
        {"template-creator:template-creator","첨부한 보고서의 레이아웃을 재사용할 템플릿으로 만들어줘."},
        {"test-driven-development","예상 동작을 테스트로 정의한 뒤 기능을 구현해줘."},
        {"update-cli-config","CLI에서 사용할 편집 모드와 표시 옵션을 변경해줘."},
        {"update-cursor-settings","이 저장소의 들여쓰기와 저장 시 서식 설정을 맞춰줘."},
        {"verification-before-completion","이 수정이 요청을 충족하는지 빌드와 실행 결과로 검증해줘."},
        {"visualize:visualize","입력 값을 바꾸면 결과가 어떻게 달라지는지 시각화해줘."},
        {"writing-plans","지금 요구 사항을 구현 순서와 검증 조건으로 정리해줘."},
        {"imagegen","참고 이미지의 분위기를 살려 앱 배경 이미지를 만들어줘."},
        {"openai-docs","공식 문서에서 이 모델의 API 사용 예제를 찾아줘."},
        {"review-agent","변경된 코드를 검토하고 수정할 위치와 이유를 알려줘."},
        {"skill-creator","이 스킬이 언제 쓰이는지 분명하게 설명을 고쳐줘."},
        {"skill-installer","설치할 수 있는 스킬을 찾아 내가 지정한 항목을 추가해줘."}
    };
    static readonly Dictionary<string,string> SkillInstructions=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){
        {"autopilot","대상 PR을 지정하세요. 미해결 리뷰, 충돌과 검사 실패를 확인하고 같은 검사를 다시 실행하세요."},
        {"canvas","원본 데이터와 바꿔 보고 싶은 값을 알려주세요. 필터나 입력값을 바꿨을 때 표와 차트가 어떻게 변해야 하는지 지정하세요."},
        {"computer-use:computer-use","대상 앱과 창을 지정하세요. 입력할 값과 작업 후 확인할 화면을 알려주면 조작 결과까지 점검할 수 있어요."},
        {"create-hook","실행을 시작할 이벤트와 호출할 스크립트를 지정하세요. 설정한 후 같은 이벤트로 동작을 확인하세요."},
        {"create-rule","규칙을 적용할 폴더나 파일을 알려주세요. 원하는 코드 예시와 함께 규칙을 정하세요."},
        {"create-skill","반복할 작업의 입력, 절차와 완료 조건을 설명하세요. 만든 스킬을 사용해야 할 대표 요청으로 점검하세요."},
        {"create-subagent","담당할 일, 접근할 자료와 돌려줄 결과 형식을 정하세요. 어떤 상황에서 일을 맡길지도 알려주세요."},
        {"documents:documents","문서의 용도와 독자, 원하는 파일 형식을 알려주세요. 편집할 파일과 유지할 서식을 함께 지정하세요."},
        {"goal","달성할 결과와 실제 확인 방법을 지정하세요. 여러 단계가 있다면 필요한 산출물도 적으세요."},
        {"hatch-pet","캐릭터 특징이나 참고 이미지를 제공하세요. 동작과 방향별 모습을 확인한 뒤 패키지를 사용하세요."},
        {"loop","반복할 요청과 간격을 적으세요. 언제 반복을 끝내고 보고할지 조건을 함께 정하세요."},
        {"migrate-to-skills","변환할 규칙이나 명령의 위치를 지정하세요. 기존 호출 방식과 적용 조건을 정리한 뒤 변환 결과를 확인하세요."},
        {"new-repo","프로젝트 폴더와 저장소 이름을 지정하세요. 원격 연결과 최초 푸시 결과를 확인하세요."},
        {"onboard","시작하려는 프로젝트와 선호하는 작업 방식을 설명하세요. 첫 목표에 맞게 필요한 환경을 설정하세요."},
        {"origin","연결할 저장소와 명령 오류를 알려주세요. CLI 설치, 인증과 원격 주소를 점검하고 다시 시도하세요."},
        {"pdf:pdf","대상 파일과 읽거나 수정할 페이지를 지정하세요. 표나 양식은 추출한 값과 원본 배치를 함께 확인하세요."},
        {"presentations:presentations","주제, 청중, 슬라이드 수와 참고 디자인을 알려주세요. 결과의 글자 잘림과 이미지 위치를 점검하세요."},
        {"rename-chat","제목에 담을 주제나 키워드를 적으세요. 변경 후 채팅 목록에서 새 제목을 확인하세요."},
        {"review","검토할 변경이나 PR을 지정하세요. 문제를 일으키는 조건, 영향과 수정 위치를 확인하세요."},
        {"review-bugbot","검토할 커밋이나 변경 파일을 지정하세요. 버그를 재현할 입력과 기대 동작을 확인하세요."},
        {"review-security","검토할 코드 범위를 지정하세요. 변경된 경로에서 입력 처리, 권한 검사와 민감 정보 처리를 점검하세요."},
        {"sdk","언어와 호출 환경을 알려주세요. 에이전트 입력, 실행 이벤트와 오류 처리까지 예제로 확인하세요."},
        {"share","저장하거나 공유할 폴더를 지정하세요. 현재 버전이 원격에 보관됐는지 확인하고 공유 대상을 정하세요."},
        {"shell","실행할 명령과 작업 디렉터리를 정확히 적으세요. 실행 출력과 종료 상태를 확인하세요."},
        {"split-to-prs","분리할 브랜치와 관련 변경을 알려주세요. 각 PR의 의존 관계와 테스트 순서를 정하세요."},
        {"spreadsheets:spreadsheets","원본 파일, 집계할 열과 계산식을 지정하세요. 수식 결과와 표에 포함된 행 범위를 확인하세요."},
        {"spreadsheets:excel-live-control","열려 있는 통합 문서와 시트, 셀 범위를 지정하세요. 변경 전후의 값과 수식을 비교하세요."},
        {"statusline","표시할 항목과 순서를 정하세요. 새 CLI 세션에서 필요한 상태 정보가 표시되는지 확인하세요."},
        {"systematic-debugging","재현 순서와 기대 동작을 알려주세요. 원인 가설을 검증하고 같은 조건에서 수정 결과를 확인하세요."},
        {"template-creator:template-creator","참고 파일과 반복할 구조를 알려주세요. 유지할 서식과 작업마다 바뀔 내용을 나눠 지정하세요."},
        {"test-driven-development","입력과 기대 결과를 정하세요. 실패하는 테스트를 먼저 확인한 뒤 구현하고 관련 검사를 실행하세요."},
        {"update-cli-config","바꿀 CLI 옵션과 원하는 값을 지정하세요. 설정 후 새 세션에서 적용 여부를 확인하세요."},
        {"update-cursor-settings","사용자 전체 또는 프로젝트 중 적용 범위를 정하세요. 바꿀 글꼴, 테마나 저장 동작을 알려주세요."},
        {"verification-before-completion","완료 조건과 검사할 결과물을 알려주세요. 빌드, 테스트, 저장 파일이나 실제 화면을 확인하세요."},
        {"visualize:visualize","비교할 항목과 변화시킬 변수를 지정하세요. 입력 범위와 보고 싶은 결과를 함께 알려주세요."},
        {"writing-plans","작업 범위와 제약을 알려주세요. 수정할 위치, 실행 순서와 단계별 검증 방법을 정리하세요."},
        {"imagegen","피사체, 구도와 용도를 알려주세요. 편집할 때는 참고 이미지를 첨부하고 보존할 부분도 지정하세요."},
        {"openai-docs","제품과 버전, 해결할 문제를 적으세요. 공식 문서에서 관련 예제와 요구 조건을 확인하세요."},
        {"review-agent","변경 범위와 특히 확인할 동작을 지정하세요. 재현 조건과 코드 위치를 근거로 문제를 점검하세요."},
        {"skill-creator","목표나 기존 스킬의 문제를 알려주세요. 사용 조건과 입력 예시를 다듬은 뒤 대표 요청으로 검증하세요."},
        {"skill-installer","설치할 이름이나 저장소를 지정하세요. 설치 경로와 목록에 추가된 항목을 확인하세요."},
    };
    static TextBlock SkillText(string text,double size,Brush brush,bool bold=false){
        return new TextBlock{Text=text,FontSize=size,Foreground=brush,TextWrapping=TextWrapping.Wrap,FontWeight=bold?FontWeights.SemiBold:FontWeights.Normal};
    }
    static Border SkillCube(){
        var canvas=new Canvas{Width=18,Height=20};
        foreach(var part in new[]{new[]{"M1,5 L9,0.5 L17,5 L9,10 Z","#FFA739"},new[]{"M1,5 L9,10 V19 L1,14.5 Z","#FFCD27"},new[]{"M9,10 L17,5 V14.5 L9,19 Z","#AB56ED"}})
            canvas.Children.Add(new System.Windows.Shapes.Path{Data=Geometry.Parse(part[0]),Fill=(Brush)new BrushConverter().ConvertFromString(part[1])});
        return new Border{Child=new Grid{Children={canvas}},Width=40,Height=40,CornerRadius=new CornerRadius(20),BorderBrush=Tone(228),BorderThickness=new Thickness(1)};
    }
    static Button SkillButton(string label,string hint,Brush foreground,Brush background,double radius){
        var button=new Button{Content=label,ToolTip=hint,Foreground=foreground,Background=background,BorderThickness=new Thickness(0),Padding=new Thickness(11,5,11,5),MinHeight=29,Cursor=Cursors.Hand};
        var border=new FrameworkElementFactory(typeof(Border));border.SetValue(Border.CornerRadiusProperty,new CornerRadius(radius));
        border.SetBinding(Border.BackgroundProperty,new System.Windows.Data.Binding("Background"){RelativeSource=System.Windows.Data.RelativeSource.TemplatedParent});
        border.SetBinding(Border.PaddingProperty,new System.Windows.Data.Binding("Padding"){RelativeSource=System.Windows.Data.RelativeSource.TemplatedParent});
        var present=new FrameworkElementFactory(typeof(ContentPresenter));present.SetValue(FrameworkElement.VerticalAlignmentProperty,VerticalAlignment.Center);
        present.SetValue(FrameworkElement.HorizontalAlignmentProperty,HorizontalAlignment.Center);border.AppendChild(present);
        button.Template=new ControlTemplate(typeof(Button)){VisualTree=border};
        System.Windows.Automation.AutomationProperties.SetName(button,hint);
        return button;
    }
    async Task ShowSkillDetails(Map row,Action<string> update){
        string id=Convert.ToString(row["name"]),name=Convert.ToString(row["displayName"]),summary=Convert.ToString(row["description"]),detail=Convert.ToString(row["details"]);
        string state=row.ContainsKey("state")?Convert.ToString(row["state"]):"enabled";
        string example;if(!SkillExamples.TryGetValue(id,out example))example=name+" 스킬로 이 작업을 도와줘.";
        var shade=new Border{Background=new SolidColorBrush(Color.FromArgb(34,0,0,0)),IsHitTestVisible=true};
        var workspace=Find<Grid>("Workspace");Grid.SetColumnSpan(shade,workspace.ColumnDefinitions.Count);System.Windows.Controls.Panel.SetZIndex(shade,99);workspace.Children.Add(shade);
        var dialog=new Window{Title=name+" · 스킬",Owner=window,WindowStyle=WindowStyle.None,ResizeMode=ResizeMode.NoResize,ShowInTaskbar=false,AllowsTransparency=true,Background=Brushes.Transparent,
            FontFamily=window.FontFamily,FontSize=13,Width=Math.Max(280,Math.Min(620,window.ActualWidth-32)),Height=Math.Max(280,Math.Min(740,window.ActualHeight-44)),WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var grid=new Grid();grid.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});grid.RowDefinitions.Add(new RowDefinition());grid.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});
        var surface=new Border{Margin=new Thickness(8),Padding=new Thickness(20),CornerRadius=new CornerRadius(20),Background=Tone(251),BorderBrush=Tone(220),BorderThickness=new Thickness(1),Child=grid,Effect=new System.Windows.Media.Effects.DropShadowEffect{Opacity=.13,BlurRadius=9,ShadowDepth=2}};
        dialog.Content=surface;
        var head=new StackPanel();grid.Children.Add(head);
        var tools=new DockPanel{LastChildFill=false};head.Children.Add(tools);tools.Children.Add(SkillCube());
        var close=SkillButton("×","닫기",Tone(68),Brushes.Transparent,12);close.FontSize=18;close.Padding=new Thickness(6,0,6,0);DockPanel.SetDock(close,Dock.Right);tools.Children.Add(close);close.Click+=(s,e)=>dialog.Close();
        var more=SkillButton("⋯","추가 옵션",Tone(106),Brushes.Transparent,12);DockPanel.SetDock(more,Dock.Right);tools.Children.Add(more);
        var knob=new Ellipse{Width=14,Height=14,Fill=Brushes.White,Margin=new Thickness(3,0,3,0)};
        var track=new Border{Width=32,Height=20,CornerRadius=new CornerRadius(11),Child=knob};
        var toggle=SkillButton("","스킬 사용 전환",Tone(50),Brushes.Transparent,12);toggle.Content=track;toggle.Padding=new Thickness(6);DockPanel.SetDock(toggle,Dock.Right);tools.Children.Add(toggle);
        var title=new WrapPanel{Margin=new Thickness(0,15,0,0)};title.Children.Add(SkillText(name,20,Tone(27),true));var type=SkillText("스킬",18,Tone(112));type.Margin=new Thickness(7,2,0,0);title.Children.Add(type);head.Children.Add(title);
        var brief=SkillText(summary,14,Tone(103));brief.Margin=new Thickness(0,7,0,20);head.Children.Add(brief);
        var guide=new StackPanel{Margin=new Thickness(15,16,15,16)};var scroll=new ScrollViewer{Content=guide,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled};
        var trackStyle=Find<Border>("PanelSide").Resources[typeof(ScrollBar)] as Style;if(trackStyle!=null)scroll.Resources[typeof(ScrollBar)]=trackStyle;
        Grid.SetRow(scroll,1);var gutter=new Border{CornerRadius=new CornerRadius(10),BorderBrush=Tone(231),BorderThickness=new Thickness(1),Background=Tone(248),Child=scroll};Grid.SetRow(gutter,1);grid.Children.Add(gutter);
        Action<string,string> section=(heading,body)=>{var label=SkillText(heading,14,Tone(32),true);label.Margin=new Thickness(0,guide.Children.Count==0?0:18,0,5);guide.Children.Add(label);var text=SkillText(body,13,Tone(47));text.LineHeight=21;guide.Children.Add(text);};
        section("기능 상세",detail);
        if(id=="automate"){
            section("사용할 때","작업을 실행할 시간이나 반복 주기가 정해져 있을 때 사용하세요. 무엇을 확인하고 결과를 어디에 남길지 함께 적으면 일정을 구체적으로 설정할 수 있습니다.");
            section("실행 순서","1. 실행할 작업과 결과물의 형태를 알려주세요.\n2. 시작 시간, 반복 주기, 시간대를 지정하세요.\n3. 사용할 프로젝트나 서비스가 있으면 대상과 범위를 알려주세요.\n4. 등록한 일정과 다음 실행 시간을 확인하세요.");
            section("시간과 대상","‘매주’처럼 주기만 지정하면 실행할 요일과 시간도 정해 주세요. GitHub 저장소, 캘린더, 폴더처럼 확인할 대상이 여러 개라면 원하는 항목을 지정하세요.");
            section("등록 후 확인","실제로 등록된 작업 이름과 일정이 요청과 같은지 확인하세요. 계정 연결이나 서비스 선택이 필요하면 해당 단계에서 연결을 마친 뒤 계속합니다.");
        }else{string instructions;section("사용 방법",SkillInstructions.TryGetValue(id,out instructions)?instructions:"대상과 원하는 결과를 적고 예시를 수정해 보내세요.");}
        section("요청 예시",example);section("스킬 ID",id);
        var foot=new DockPanel{LastChildFill=false,Margin=new Thickness(0,17,0,0)};Grid.SetRow(foot,2);grid.Children.Add(foot);
        var remove=SkillButton("이 앱에서 제거","이 앱에서 제거",new SolidColorBrush(Color.FromRgb(190,55,53)),new SolidColorBrush(Color.FromRgb(252,231,231)),14);foot.Children.Add(remove);
        var use=SkillButton("지금 사용해 보기","지금 사용해 보기",Brushes.White,Tone(29),15);var tryLabel=new StackPanel{Orientation=Orientation.Horizontal,VerticalAlignment=VerticalAlignment.Center};
        tryLabel.Children.Add(RailGlyph("M4,2 H10 A3,3 0 0 1 13,5 V7 A3,3 0 0 1 10,10 H7 L4,12 V10 H4 A3,3 0 0 1 1,7 V5 A3,3 0 0 1 4,2 Z M11,5 H12 A3,3 0 0 1 15,8 V10 A3,3 0 0 1 12,13 H11 V15 L8,13 H7",Brushes.White,null,13));
        var tryText=SkillText("지금 사용해 보기",12,Brushes.White,true);tryText.Margin=new Thickness(5,0,0,0);tryLabel.Children.Add(tryText);use.Content=tryLabel;
        DockPanel.SetDock(use,Dock.Right);foot.Children.Add(use);
        Action paint=()=>{bool yes=state=="enabled";track.Background=yes?Tone(18):Tone(166);knob.HorizontalAlignment=yes?HorizontalAlignment.Right:HorizontalAlignment.Left;toggle.ToolTip=yes?"스킬 끄기":"스킬 켜기";System.Windows.Automation.AutomationProperties.SetName(toggle,Convert.ToString(toggle.ToolTip));use.IsEnabled=yes;use.Opacity=yes?1:.46;};paint();
        Func<string,Task<bool>> change=async next=>{try{await Rpc("pluginManager",json.Serialize(new{tab="스킬",id,state=next}));state=next;row["state"]=next;update(next);return true;}catch(Exception ex){CardNotice.Show(dialog,ex.Message,"스킬 설정");return false;}};
        toggle.Click+=async(s,e)=>{toggle.IsEnabled=remove.IsEnabled=false;try{await change(state=="enabled"?"disabled":"enabled");paint();}finally{toggle.IsEnabled=remove.IsEnabled=true;}};
        remove.Click+=async(s,e)=>{if(CardNotice.Show(dialog,"이 앱의 스킬 목록과 사용 대상에서 제거할까요? 원본 지침은 보관되며 다시 추가할 수 있습니다.",name,MessageBoxButton.YesNo,MessageBoxImage.Question,MessageBoxResult.No)!=MessageBoxResult.Yes)return;toggle.IsEnabled=remove.IsEnabled=false;if(await change("removed"))dialog.Close();else toggle.IsEnabled=remove.IsEnabled=true;};
        bool tryNow=false;use.Click+=(s,e)=>{tryNow=true;dialog.Close();};
        more.Click+=(s,e)=>{var menu=new ContextMenu{PlacementTarget=more,Placement=PlacementMode.Bottom};var copy=new MenuItem{Header="스킬 ID 복사"};copy.Click+=(a,b)=>Clipboard.SetText(id);menu.Items.Add(copy);if(row.ContainsKey("detail")&&File.Exists(Convert.ToString(row["detail"]))){var original=new MenuItem{Header="원본 지침 열기"};original.Click+=(a,b)=>ShowFile(Convert.ToString(row["detail"]));menu.Items.Add(original);}menu.IsOpen=true;};
        dialog.PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape){dialog.Close();e.Handled=true;}};
        try{dialog.ShowDialog();}finally{workspace.Children.Remove(shade);}
        if(tryNow)ComposeRail("["+id+"] "+example);
        await Task.CompletedTask;
    }
}
