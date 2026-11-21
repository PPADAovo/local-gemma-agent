using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Automation;
using System.Windows.Threading;
using System.Windows.Media.Animation;
using System.Windows.Controls.Primitives;
using System.IO;
using System.Text.RegularExpressions;

partial class DesktopChat {
    void BindTurnRail(){
        var scroll=Find<ScrollViewer>("Scroller");
        var rail=Find<ScrollViewer>("TurnRail");
        var marks=Find<StackPanel>("TurnMarks");
        var lastRows=new UserMessageRow[0];
        int hovered=-1;
        Action<Animatable,DependencyProperty,double> animateTransform=(target,property,value)=>{
            target.BeginAnimation(property,prefs.motion?new DoubleAnimation(value,TimeSpan.FromMilliseconds(155)){EasingFunction=new CubicEase{EasingMode=EasingMode.EaseOut}}:null);
            if(!prefs.motion)target.SetValue(property,value);
        };
        Action<int> expand=index=>{
            hovered=index;
            for(int i=0;i<marks.Children.Count;i++){
                var line=(Border)((Button)marks.Children[i]).Content;
                var distance=Math.Abs(i-index);
                double width=index<0?6:Math.Max(6,26-distance*6);
                animateTransform((ScaleTransform)line.RenderTransform,ScaleTransform.ScaleXProperty,width/6);
                line.Background=i==index?Brushes.Black:Brushes.LightGray;
            }
        };
        var popup=new Popup{Placement=PlacementMode.Custom,AllowsTransparency=true,StaysOpen=true};
        popup.CustomPopupPlacementCallback=(size,target,offset)=>{
            double y=(target.Height-size.Height)/2;
            return new[]{new CustomPopupPlacement(new Point(target.Width+1,y),PopupPrimaryAxis.Vertical),
                         new CustomPopupPlacement(new Point(-size.Width-1,y),PopupPrimaryAxis.Vertical)};
        };
        var stack=new StackPanel();
        var heading=new TextBlock{FontWeight=FontWeights.SemiBold,TextTrimming=TextTrimming.CharacterEllipsis};
        var pin=new Button{FontFamily=new FontFamily("Segoe MDL2 Assets"),Width=26,Height=24,Padding=new Thickness(0),Content="\uE734"};
        var top=new DockPanel();
        DockPanel.SetDock(pin,Dock.Right);top.Children.Add(pin);top.Children.Add(heading);stack.Children.Add(top);
        var excerpt=new TextBlock{TextWrapping=TextWrapping.Wrap,TextTrimming=TextTrimming.CharacterEllipsis,MaxHeight=59,LineHeight=19,LineStackingStrategy=LineStackingStrategy.BlockLineHeight,Foreground=Brushes.Gray};
        stack.Children.Add(excerpt);
        var card=new Border{Width=320,Padding=new Thickness(10,7,8,8),Background=Brushes.White,BorderBrush=Brushes.Gainsboro,BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(10),Child=stack,Margin=new Thickness(4,8,4,8)};
        card.Effect=new System.Windows.Media.Effects.DropShadowEffect{BlurRadius=10,ShadowDepth=2,Opacity=.16};
        popup.Child=card;
        var hide=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(180)};
        hide.Tick+=(s,e)=>{hide.Stop();if(!card.IsMouseOver && !(popup.PlacementTarget!=null && popup.PlacementTarget.IsMouseOver)){popup.IsOpen=false;expand(-1);}};
        card.MouseEnter+=(s,e)=>hide.Stop();card.MouseLeave+=(s,e)=>hide.Start();
        window.Deactivated+=(s,e)=>{popup.IsOpen=false;hide.Stop();expand(-1);};
        string bookmark=null;
        Action refreshPin=()=>{bool marked=File.Exists(bookmark);pin.Content=marked?"\uE735":"\uE734";pin.ToolTip=marked?"북마크 해제":"북마크 추가";AutomationProperties.SetName(pin,(string)pin.ToolTip);};
        pin.Click+=(s,e)=>{try{if(File.Exists(bookmark))File.Delete(bookmark);else{Directory.CreateDirectory(Path.GetDirectoryName(bookmark));File.WriteAllText(bookmark,"");}refreshPin();}catch(Exception err){status.Text=err.Message;}};
        int previousCount=-1,previousView=-1;
        bool pending=false;
        Action update=()=>{
            pending=false;
            if(previousCount!=messages.Children.Count || previousView!=view){
                previousCount=messages.Children.Count;previousView=view;
                var rows=messages.Children.OfType<UserMessageRow>().ToArray();
                if(!rows.SequenceEqual(lastRows)){
                    popup.IsOpen=false;hovered=-1;marks.Children.Clear();
                    foreach(var row in rows){
                        var line=new Border{Width=6,Height=1.5,CornerRadius=new CornerRadius(1),Background=Brushes.LightGray,RenderTransform=new ScaleTransform(1,1)};
                        var button=new Button{Content=line,Width=36,Height=11,Padding=new Thickness(5,0,0,0),HorizontalContentAlignment=HorizontalAlignment.Left,Background=Brushes.Transparent,BorderThickness=new Thickness(0)};
                        button.Style=(Style)window.FindResource("TurnMarkButton");
                        button.MouseEnter+=(s,e)=>{
                            hide.Stop();expand(marks.Children.IndexOf(button));heading.Text=Regex.Replace(row.Original,@"\s+"," ").Trim();
                            var answer=messages.Children.Cast<UIElement>().SkipWhile(el=>el!=row).Skip(1).TakeWhile(el=>!(el is UserMessageRow)).OfType<Border>().Select(b=>b.Tag as string).FirstOrDefault(t=>!String.IsNullOrWhiteSpace(t));
                            excerpt.Text=answer==null?"답변 대기 중":Regex.Replace(answer.Replace("**",""),@"\s+"," ").Trim();
                            bookmark=Path.Combine(Path.GetDirectoryName(prefPath),"turn-bookmarks",id,row.Index+".mark");
                            popup.PlacementTarget=button;popup.IsOpen=true;refreshPin();
                        };
                        button.MouseLeave+=(s,e)=>hide.Start();
                        AutomationProperties.SetName(button,"사용자 메시지 "+(row.Index+1)+"로 이동");
                        button.Click+=(s,e)=>{followingLatest=false;scroll.ScrollToVerticalOffset(scroll.VerticalOffset+row.TranslatePoint(new Point(0,0),scroll).Y-8);};
                        marks.Children.Add(button);
                    }
                    lastRows=rows;
                }
            }
            rail.MaxHeight=Math.Max(44,scroll.ViewportHeight-24);
            rail.Visibility=lastRows.Length>0 && scroll.ScrollableHeight>24 && scroll.ActualWidth>420 ? Visibility.Visible:Visibility.Collapsed;
            if(rail.Visibility!=Visibility.Visible)return;
            int current=0;
            for(int i=1;i<lastRows.Length;i++){
                if(lastRows[i].TranslatePoint(new Point(0,0),scroll).Y>scroll.ViewportHeight*.35)break;
                current=i;
            }
            for(int i=0;i<marks.Children.Count;i++){
                var mark=(Border)((Button)marks.Children[i]).Content;
                mark.Background=i==hovered?Brushes.Black:hovered<0 && i==current?Brushes.DimGray:Brushes.LightGray;
            }
        };
        Action schedule=()=>{if(pending)return;pending=true;window.Dispatcher.BeginInvoke(DispatcherPriority.Loaded,update);};
        scroll.ScrollChanged+=(s,e)=>{if(e.OriginalSource==scroll)schedule();};
        messages.SizeChanged+=(s,e)=>schedule();scroll.SizeChanged+=(s,e)=>schedule();
    }
}
