using System;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Xml.Linq;
using System.Text.RegularExpressions;
using Markdig;
using WpfMath.Controls;

partial class DesktopChat {
    static readonly MarkdownPipeline answerPipeline=new MarkdownPipelineBuilder().UsePipeTables().UseMathematics().DisableHtml().Build();
    static readonly Brush codeTint=new SolidColorBrush(Color.FromRgb(242,244,247));
    static readonly FontFamily CodeFont=new FontFamily("Consolas, Noto Sans KR, Malgun Gothic");
    static FrameworkElement Equation(string value){
        string tex=Regex.Replace(value.Trim(),@"^(?:\\\[|\\\(|\$\$)|(?:\\\]|\\\)|\$\$)$","");
        try{
            var formula=new FormulaControl{Formula=tex,Scale=17,VerticalAlignment=VerticalAlignment.Center};
            if(!formula.HasError)return formula;
        }catch(ArgumentException){}
        return new TextBlock{Text=tex,TextWrapping=TextWrapping.Wrap,FontFamily=new FontFamily("Cambria Math")};
    }
    static bool IsEquation(XElement e){return ((string)e.Attribute("class")??"").Split(' ').Contains("math");}
    static string TableClipboard(XElement table){
        return String.Join("\r\n",table.Descendants("tr").Select(r=>String.Join("\t",r.Elements().Select(c=>Regex.Replace(c.Value,@"[\r\n\t]+"," ").Trim()))));
    }
    void AddInlines(InlineCollection target,XElement parent){
        foreach(var node in parent.Nodes()){
            var e=node as XElement;
            if(e==null){
                var t=node as XText;
                if(t==null)continue;
                string value=parent.Name.LocalName=="p" && node==parent.FirstNode
                    ? Regex.Replace(t.Value,@"^\[([ xX])\]\s+",m=>m.Groups[1].Value==" "?"☐ ":"☑ ") : t.Value;
                int offset=0;
                if(!parent.AncestorsAndSelf().Any(x=>x.Name.LocalName=="code")){
                    // Markdown can leave quoted emphasis literal before a Korean particle.
                    foreach(Match match in Regex.Matches(value,@"\*\*([^*\r\n]+?[\p{P}])\*\*(?=[가-힣])")){
                        target.Add(new Run(value.Substring(offset,match.Index-offset)));
                        target.Add(new Bold(new Run(match.Groups[1].Value)));
                        offset=match.Index+match.Length;
                    }
                }
                target.Add(new Run(value.Substring(offset)));
                continue;
            }
            string tag=e.Name.LocalName;
            if(IsEquation(e)){target.Add(new InlineUIContainer(Equation(e.Value)));continue;}
            if(tag=="br"){target.Add(new LineBreak());continue;}
            Uri uri;
            if(tag=="a" && Uri.TryCreate((string)e.Attribute("href"),UriKind.Absolute,out uri) &&
                (uri.Scheme==Uri.UriSchemeHttp||uri.Scheme==Uri.UriSchemeHttps)){
                var link=new Hyperlink{NavigateUri=uri,ToolTip=uri.AbsoluteUri,
                    Foreground=new SolidColorBrush(Color.FromRgb(45,73,103))};
                link.RequestNavigate+=(sender,args)=>{
                    args.Handled=true;
                    try{Process.Start(new ProcessStartInfo(args.Uri.AbsoluteUri){UseShellExecute=true});}
                    catch(Exception ex){status.Text="링크를 열 수 없습니다. "+ex.Message;}
                };
                AddInlines(link.Inlines,e);target.Add(link);continue;
            }
            Span span=tag=="strong"?(Span)new Bold():tag=="em"?new Italic():new Span();
            if(tag=="code"){span.FontFamily=CodeFont;span.Background=codeTint;}
            AddInlines(span.Inlines,e);target.Add(span);
        }
    }
    void AddBlocks(BlockCollection blocks,XElement root){
        foreach(var e in root.Elements()){
            string tag=e.Name.LocalName;
            if(tag=="pre"){
                var source=e.Element("code");
                string language=source==null?"":((string)source.Attribute("class")??"").Replace("language-","");
                string code=(source??e).Value;
                var panel=new StackPanel();
                var header=new DockPanel{Margin=new Thickness(0,0,0,6)};
                var copy=Copy(code,"코드 복사");DockPanel.SetDock(copy,Dock.Right);header.Children.Add(copy);
                var wrap=new Button{Content="줄 바꿈",ToolTip="긴 코드 줄을 창 너비에 맞춰 보기",FontSize=13,Padding=new Thickness(7,3,7,3),Foreground=Brushes.DimGray};
                DockPanel.SetDock(wrap,Dock.Right);header.Children.Add(wrap);
                header.Children.Add(new TextBlock{Text=language.Length>0?language:"코드",Foreground=Brushes.DimGray,FontSize=13,VerticalAlignment=VerticalAlignment.Center});
                panel.Children.Add(header);
                var box=Readable(code.EndsWith("\n")?code.Substring(0,code.Length-1):code);
                box.FontSize=13;box.FontFamily=CodeFont;box.Padding=new Thickness(0);
                box.TextWrapping=TextWrapping.NoWrap;box.HorizontalScrollBarVisibility=ScrollBarVisibility.Auto;
                wrap.Click+=(s,args)=>{
                    bool enable=box.TextWrapping==TextWrapping.NoWrap;
                    box.HorizontalScrollBarVisibility=enable?ScrollBarVisibility.Disabled:ScrollBarVisibility.Auto;
                    box.TextWrapping=enable?TextWrapping.Wrap:TextWrapping.NoWrap;
                    wrap.Content=enable?"줄 바꿈 해제":"줄 바꿈";
                    wrap.ToolTip=enable?"코드를 원래 줄 길이로 보기":"긴 코드 줄을 창 너비에 맞춰 보기";
                };
                panel.Children.Add(box);
                blocks.Add(new BlockUIContainer(new Border{Child=panel,Padding=new Thickness(12),CornerRadius=new CornerRadius(9),Background=codeTint}){Margin=new Thickness(0,6,0,10)});
                continue;
            }
            if(tag=="ul"||tag=="ol"){
                System.Windows.Documents.List list=null;
                int next;if(!Int32.TryParse((string)e.Attribute("start"),out next)||next<1)next=1;
                foreach(var li in e.Elements("li")){
                    var marker=tag=="ol"?TextMarkerStyle.Decimal:
                        Regex.IsMatch(li.Value,@"^\s*\[[ xX]\]\s")?TextMarkerStyle.None:TextMarkerStyle.Disc;
                    if(list==null||list.MarkerStyle!=marker){
                        list=new System.Windows.Documents.List{MarkerStyle=marker,Padding=new Thickness(marker==TextMarkerStyle.None?4:24,0,0,0),Margin=new Thickness(0,2,0,6),StartIndex=next};
                        blocks.Add(list);
                    }
                    if(next<Int32.MaxValue)next++;
                    var item=new ListItem();list.ListItems.Add(item);
                    var group=new XElement("root");var line=new XElement("p");
                    foreach(var n in li.Nodes()){
                        var child=n as XElement;
                        if(child!=null&&new[]{"ul","ol","p","blockquote","pre","table"}.Contains(child.Name.LocalName)){
                            if(!String.IsNullOrWhiteSpace(line.Value)){group.Add(line);line=new XElement("p");}
                            group.Add(new XElement(child));
                        }else line.Add(n);
                    }
                    if(!String.IsNullOrWhiteSpace(line.Value))group.Add(line);
                    AddBlocks(item.Blocks,group);foreach(var paragraph in item.Blocks.OfType<Paragraph>())paragraph.Margin=new Thickness(0,1,0,3);
                }
                continue;
            }
            if(tag=="table"){
                var table=new Table{CellSpacing=0,Margin=new Thickness(0,5,0,4)};
                var group=new TableRowGroup();table.RowGroups.Add(group);
                foreach(var row in e.Descendants("tr")){
                    var tr=new TableRow();group.Rows.Add(tr);
                    foreach(var cell in row.Elements()){
                        var p=new Paragraph{Margin=new Thickness(0)};AddInlines(p.Inlines,cell);
                        string alignment=((string)cell.Attribute("align")??"")+" "+((string)cell.Attribute("style")??"");
                        if(alignment.IndexOf("right",StringComparison.OrdinalIgnoreCase)>=0)p.TextAlignment=TextAlignment.Right;
                        else if(alignment.IndexOf("center",StringComparison.OrdinalIgnoreCase)>=0)p.TextAlignment=TextAlignment.Center;
                        var c=new TableCell(p){Padding=new Thickness(10,7,10,7),BorderBrush=Brushes.LightGray,BorderThickness=new Thickness(0,0,0,1)};
                        if(cell.Name.LocalName=="th"){c.Background=codeTint;c.FontWeight=FontWeights.Medium;}
                        tr.Cells.Add(c);
                    }
                }
                blocks.Add(table);
                var copyTable=Copy(TableClipboard(e),"표 복사");
                copyTable.ToolTip="행과 열을 유지해 복사";copyTable.HorizontalAlignment=HorizontalAlignment.Right;
                blocks.Add(new BlockUIContainer(copyTable){Margin=new Thickness(0,0,0,8)});continue;
            }
            if(tag=="blockquote"){var quote=new Section{BorderBrush=Brushes.Silver,BorderThickness=new Thickness(3,0,0,0),Padding=new Thickness(10,0,0,0)};AddBlocks(quote.Blocks,e);blocks.Add(quote);continue;}
            var para=new Paragraph{Margin=new Thickness(0,0,0,9)};
            if(Regex.IsMatch(tag,"^h[1-6]$")){para.FontSize=tag=="h1"?20:tag=="h2"?17:15;para.FontWeight=FontWeights.Medium;para.LineHeight=para.FontSize*1.4;para.Margin=new Thickness(0,14,0,6);}
            if(IsEquation(e))para.Inlines.Add(new InlineUIContainer(Equation(e.Value)));
            else if(tag=="hr"){para.BorderBrush=Brushes.LightGray;para.BorderThickness=new Thickness(0,0,0,1);}
            else AddInlines(para.Inlines,e);
            blocks.Add(para);
        }
    }
    FrameworkElement FormattedAnswer(string text){
        try{
            // Normalize common LaTeX delimiters outside Markdown code spans.
            text=Regex.Replace(text,@"(`+)[\s\S]*?\1|\\\[([\s\S]*?)\\\]|\\\(([^\n]*?)\\\)",m=>m.Groups[1].Success?m.Value:m.Groups[2].Success?"\n\n$$\n"+m.Groups[2].Value.Trim()+"\n$$\n\n":"$"+m.Groups[3].Value+"$");
            string html=Markdown.ToHtml(text,answerPipeline);
            var root=XElement.Parse("<root>"+html+"</root>",LoadOptions.PreserveWhitespace);
            var doc=new FlowDocument{PagePadding=new Thickness(0),FontFamily=window.FontFamily,FontSize=14,LineHeight=22,Foreground=new SolidColorBrush(Color.FromRgb(36,36,36))};
            AddBlocks(doc.Blocks,root);
            return new RichTextBox(doc){IsReadOnly=true,IsDocumentEnabled=true,BorderThickness=new Thickness(0),Background=Brushes.Transparent,VerticalScrollBarVisibility=ScrollBarVisibility.Disabled,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled};
        }catch{return Readable(text);}
    }
}
