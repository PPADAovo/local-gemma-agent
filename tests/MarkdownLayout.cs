using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Xml.Linq;

// Runs the shipped renderer without starting the agent, accessing a model or changing a user's clipboard.
class MarkdownLayout {
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    static void Check(bool condition, string description) {
        if (!condition) throw new Exception(description);
        Console.WriteLine(description);
    }
    [STAThread] static int Main(string[] args) {
        var app = new Application();
        var window = new Window { Width=550, Height=440, WindowStartupLocation=WindowStartupLocation.Manual, Left=-30000, Top=-30000, ShowInTaskbar=false, ShowActivated=false };
        try {
            var type = Assembly.LoadFrom(args[0]).GetType("DesktopChat", true);
            var renderer = FormatterServices.GetUninitializedObject(type);
            type.GetField("window", Private).SetValue(renderer, window);
            string message = "~~~js\n" + new string('a',340) + "\n~~~\n\n| 작업 | 시간 |\n| :--- | ---: |\n| **개발** | 12 |\n";
            var answer = (RichTextBox)type.GetMethod("FormattedAnswer", Private).Invoke(renderer, new object[]{message});
            window.Content=answer; window.Show(); window.UpdateLayout();
            var embedded=answer.Document.Blocks.OfType<BlockUIContainer>().ToList();
            var panel=(StackPanel)((Border)embedded[0].Child).Child;
            var code=panel.Children.OfType<TextBox>().Single();
            var wrap=((DockPanel)panel.Children[0]).Children.OfType<Button>().Single(b=>Equals(b.Content,"줄 바꿈"));
            Check(code.ExtentWidth>code.ViewportWidth+80 && code.Text.Length==340, "Long lines scroll inside the code block");
            wrap.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); window.UpdateLayout();
            Check(code.TextWrapping==TextWrapping.Wrap && code.LineCount>1 && code.ExtentWidth<=code.ViewportWidth+3, "Wrap reveals long code at narrow widths");
            wrap.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); window.UpdateLayout();
            Check(code.TextWrapping==TextWrapping.NoWrap && code.Text.Length==340, "Switching back preserves source text");
            var row=answer.Document.Blocks.OfType<Table>().Single().RowGroups[0].Rows[1];
            Check(((Paragraph)row.Cells[1].Blocks.FirstBlock).TextAlignment==TextAlignment.Right, "Markdown numeric column respects alignment");
            Check(((Paragraph)row.Cells[0].Blocks.FirstBlock).Inlines.OfType<Span>().Any(), "Nested emphasis renders inside table cells");
            var cellData=XElement.Parse("<table><tr><th>작업</th><th>시간</th></tr><tr><td><strong>개발</strong></td><td>12</td></tr></table>");
            var copyText=(string)type.GetMethod("TableClipboard",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{cellData});
            Check(copyText=="작업\t시간\r\n개발\t12" && embedded.Any(b=>b.Child is Button), "Table copy preserves rows and columns for spreadsheets");
            string mathList="- 첫 번째 항목\n  - 하위 항목\n\n수식: \\(x^2+y^2\\)\n\n\\[\\frac{a}{b}\\]\n\n`\\(코드\\)`";
            var more=(RichTextBox)type.GetMethod("FormattedAnswer",Private).Invoke(renderer,new object[]{mathList});
            window.Content=more; window.UpdateLayout();
            Check(more.Document.Blocks.OfType<List>().Single().ListItems.FirstListItem.Blocks.OfType<List>().Any(), "Nested lists retain their hierarchy");
            var formulas=more.Document.Blocks.OfType<Paragraph>().SelectMany(x=>x.Inlines.OfType<InlineUIContainer>()).Select(x=>x.Child).ToArray();
            Check(formulas.Length==2 && formulas.All(x=>x.GetType().Name=="FormulaControl" && x.RenderSize.Height>6 && x.RenderSize.Height<96), "Inline and display math render with a readable height");
            Check(new TextRange(more.Document.ContentStart,more.Document.ContentEnd).Text.Contains(@"\(코드\)"), "Math delimiters inside inline code remain literal");
            return 0;
        }catch(Exception ex){ Console.Error.WriteLine(ex.GetBaseException().Message); return 1; }
        finally{window.Close();}
    }
}
