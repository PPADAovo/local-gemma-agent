using System;
using System.Linq;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Automation;

partial class DesktopChat {
    TextBlock ProfileHeading(string text){
        return new TextBlock{Text=text,FontSize=14,FontWeight=FontWeights.SemiBold,Margin=new Thickness(0,32,0,15)};
    }
    void AddInsight(StackPanel page,string label,string value){
        var row=new DockPanel{Margin=new Thickness(0,8,0,8)};
        var v=new TextBlock{Text=value};DockPanel.SetDock(v,Dock.Right);row.Children.Add(v);
        row.Children.Add(new TextBlock{Text=label,Foreground=Brushes.DimGray});page.Children.Add(row);
    }
    static string TokenCount(long n){
        if(n>=100000000)return (n/100000000.0).ToString("0.#")+"억";
        if(n>=10000)return (n/10000.0).ToString("0.#")+"만";
        return n.ToString("N0");
    }
    void AddActivityCalendar(StackPanel parent,SortedDictionary<DateTime,long> days){
        var header=new DockPanel{Margin=new Thickness(0,20,0,12)};
        var modes=new StackPanel{Orientation=Orientation.Horizontal};DockPanel.SetDock(modes,Dock.Right);header.Children.Add(modes);
        header.Children.Add(new TextBlock{Text="토큰 활동",VerticalAlignment=VerticalAlignment.Center,FontWeight=FontWeights.SemiBold});parent.Children.Add(header);
        var heat=new UniformGrid{Columns=52,Rows=7};parent.Children.Add(heat);
        var months=new Grid{Margin=new Thickness(0,6,0,0)};parent.Children.Add(months);
        DateTime today=DateTime.Today, first=today.AddDays(-((int)today.DayOfWeek+51*7));
        for(int c=0;c<52;c++)months.ColumnDefinitions.Add(new ColumnDefinition());
        for(int c=0;c<52;c++){
            var end=first.AddDays(c*7+6);
            if(end.Day>7||end>today.AddDays(6))continue;
            var m=new TextBlock{Text=end.Month+"월",FontSize=11,Foreground=Brushes.Gray};
            Grid.SetColumn(m,c);Grid.SetColumnSpan(m,Math.Min(4,52-c));months.Children.Add(m);
        }
        var palette=new[]{"#F3F3F3","#CBE5FF","#91C9FF","#59AAFA","#0086F7","#005197"}.Select(s=>new SolidColorBrush((Color)ColorConverter.ConvertFromString(s))).ToArray();
        Action<string> paint=mode=>{
            foreach(Button b in modes.Children){bool selected=(string)b.Content==mode;b.FontWeight=selected?FontWeights.SemiBold:FontWeights.Normal;b.Foreground=selected?Brushes.Black:Brushes.DimGray;AutomationProperties.SetItemStatus(b,selected?"선택됨":"");}
            heat.Children.Clear();var values=new long[364];
            long total=days.Where(p=>p.Key<first).Sum(p=>p.Value);
            for(int n=0;n<364;n++){long v;days.TryGetValue(first.AddDays(n),out v);total+=v;values[n]=mode=="누적"?total:v;}
            if(mode=="주간")for(int n=0;n<364;n+=7){long week=values.Skip(n).Take(7).Sum();for(int j=n;j<n+7;j++)values[j]=week;}
            var max=Math.Max(1,values.Max());
            for(int r=0;r<7;r++)for(int c=0;c<52;c++){
                int n=c*7+r;var date=first.AddDays(n);long value=values[n];bool future=date>today;
                var tile=new Border{Height=11,Margin=new Thickness(1.4),CornerRadius=new CornerRadius(3),Background=future?Brushes.Transparent:palette[value==0?0:1+(int)(4*Math.Sqrt((double)value/max))]};
                heat.Children.Add(tile);if(future)continue;
                var weekStart=first.AddDays(c*7);string period=mode=="주간"?weekStart.ToString("M월 d일")+" – "+weekStart.AddDays(6).ToString("M월 d일"):date.ToString("M월 d일")+(mode=="누적"?"까지":"");
                var text=period+"\n"+TokenCount(value)+" 토큰";
                var tip=new ToolTip{Background=Brushes.Transparent,BorderThickness=new Thickness(0),Padding=new Thickness(0),Placement=PlacementMode.Mouse,Content=new Border{CornerRadius=new CornerRadius(14),Padding=new Thickness(12,6,12,6),Background=new SolidColorBrush(Color.FromRgb(25,27,29)),Child=new TextBlock{Text=text,TextAlignment=TextAlignment.Center,Foreground=Brushes.White,FontSize=12}}};
                tile.ToolTip=tip;AutomationProperties.SetName(tile,period+" "+value.ToString("N0")+" 토큰");ToolTipService.SetInitialShowDelay(tile,100);ToolTipService.SetBetweenShowDelay(tile,0);
            }
        };
        foreach(string mode in new[]{"일별","주간","누적"}){var b=RailButton(mode,()=>paint(mode));b.Padding=new Thickness(5,0,2,0);modes.Children.Add(b);}paint("일별");
    }
}
