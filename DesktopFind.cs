using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;

partial class DesktopChat {
    sealed class FindHit {
        public TextBox plain;
        public RichTextBox rich;
        public int start, length;
        public TextPointer from, to;
        public Rect Select(){
            if(plain!=null){
                plain.IsInactiveSelectionHighlightEnabled=true;
                plain.Select(start,length);
                return plain.GetRectFromCharacterIndex(start);
            }
            rich.IsInactiveSelectionHighlightEnabled=true;
            rich.Selection.Select(from,to);
            return from.GetCharacterRect(LogicalDirection.Forward);
        }
        public void Clear(){
            if(plain!=null)plain.Select(plain.SelectionStart,0);
            else rich.Selection.Select(from,from);
        }
    }
    readonly List<FindHit> findHits=new List<FindHit>();
    int findIndex=-1,findMessageCount;
    string findChat;
    void BindFind(){
        Find<TextBox>("FindQuery").TextChanged+=(s,e)=>RefreshFind(0);
        On("FindPrevious",()=>MoveFind(-1));On("FindNext",()=>MoveFind(1));On("CloseFind",()=>CloseFind(true));
        window.PreviewKeyDown+=(s,e)=>{
            if(e.Key==Key.F&&Keyboard.Modifiers==ModifierKeys.Control){e.Handled=true;OpenFind();return;}
            if(Find<Border>("FindBar").Visibility!=Visibility.Visible)return;
            if(e.Key==Key.Escape){e.Handled=true;CloseFind(true);return;}
            if(e.Key==Key.F3||(e.Key==Key.Enter&&Find<TextBox>("FindQuery").IsKeyboardFocusWithin)){
                e.Handled=true;MoveFind((Keyboard.Modifiers&ModifierKeys.Shift)==0?1:-1);
            }
        };
    }
    void OpenFind(){
        var field=Find<TextBox>("FindQuery");
        Find<Border>("FindBar").Visibility=Visibility.Visible;findChat=id;
        field.Focus();field.SelectAll();RefreshFind(0);
    }
    void CloseFind(bool focusInput){
        if(findIndex>=0)findHits[findIndex].Clear();
        findHits.Clear();findIndex=-1;findChat=null;
        Find<Border>("FindBar").Visibility=Visibility.Collapsed;
        Find<TextBox>("FindQuery").Clear();
        if(focusInput)input.Focus();
    }
    void MoveFind(int direction){
        if(findMessageCount!=messages.Children.Count){RefreshFind(direction);return;}
        if(findHits.Count==0)return;
        findHits[findIndex].Clear();findIndex=(findIndex+direction+findHits.Count)%findHits.Count;
        RevealFind();
    }
    void RefreshFind(int direction){
        if(Find<Border>("FindBar").Visibility!=Visibility.Visible)return;
        if(findIndex>=0)findHits[findIndex].Clear();
        findHits.Clear();findIndex=-1;findMessageCount=messages.Children.Count;
        string query=Find<TextBox>("FindQuery").Text;
        if(query.Length>0)foreach(UIElement row in messages.Children)CollectFind(row,query);
        Find<Button>("FindPrevious").IsEnabled=Find<Button>("FindNext").IsEnabled=findHits.Count>0;
        if(findHits.Count==0){Find<TextBlock>("FindCount").Text=query.Length==0?"":"결과 없음";return;}
        findIndex=direction<0?findHits.Count-1:0;RevealFind();
    }
    static IEnumerable<int> FindOffsets(string text,string query){
        for(int i=0;(i=text.IndexOf(query,i,StringComparison.OrdinalIgnoreCase))>=0;i+=query.Length)yield return i;
    }
    void CollectFind(DependencyObject node,string query){
        var ui=node as UIElement;
        if(ui!=null && ui.Visibility!=Visibility.Visible)return;
        var box=node as TextBox;
        if(box!=null){
            if(box.IsReadOnly)foreach(int i in FindOffsets(box.Text,query))findHits.Add(new FindHit{plain=box,start=i,length=query.Length});
            return;
        }
        var rich=node as RichTextBox;
        if(rich!=null){foreach(Block b in rich.Document.Blocks)CollectBlock(b,rich,query);return;}
        var panel=node as Panel;if(panel!=null){foreach(UIElement child in panel.Children)CollectFind(child,query);return;}
        var border=node as Border;if(border!=null&&border.Child!=null)CollectFind(border.Child,query);
    }
    void CollectBlock(DependencyObject node,RichTextBox owner,string query){
        var embedded=node as BlockUIContainer;
        if(embedded!=null){CollectFind(embedded.Child,query);return;}
        var p=node as Paragraph;
        if(p==null){foreach(var child in LogicalTreeHelper.GetChildren(node).OfType<DependencyObject>())CollectBlock(child,owner,query);return;}
        var text=new StringBuilder();
        var runs=new List<Tuple<int,TextPointer>>();
        for(var pos=p.ContentStart;pos!=null&&pos.CompareTo(p.ContentEnd)<0;pos=pos.GetNextContextPosition(LogicalDirection.Forward)){
            var kind=pos.GetPointerContext(LogicalDirection.Forward);
            if(kind==TextPointerContext.Text){runs.Add(Tuple.Create(text.Length,pos));text.Append(pos.GetTextInRun(LogicalDirection.Forward));}
            else if(kind==TextPointerContext.EmbeddedElement||pos.GetAdjacentElement(LogicalDirection.Forward) is LineBreak)text.Append('\n');
        }
        int run=0;
        foreach(int i in FindOffsets(text.ToString(),query)){
            while(run+1<runs.Count&&runs[run+1].Item1<=i)run++;
            var first=runs[run];
            while(run+1<runs.Count&&runs[run+1].Item1<i+query.Length)run++;
            var last=runs[run];
            findHits.Add(new FindHit{rich=owner,from=first.Item2.GetPositionAtOffset(i-first.Item1),to=last.Item2.GetPositionAtOffset(i+query.Length-last.Item1)});
        }
    }
    void RevealFind(){
        var hit=findHits[findIndex];
        var scroller=Find<ScrollViewer>("Scroller");
        followingLatest=false;scroller.UpdateLayout();
        Rect rect=hit.Select();
        if(!rect.IsEmpty){
            FrameworkElement editor=(FrameworkElement)hit.plain??hit.rich;
            double y=editor.TranslatePoint(rect.TopLeft,scroller).Y;
            scroller.ScrollToVerticalOffset(scroller.VerticalOffset+y-scroller.ViewportHeight/3);
        }
        Find<TextBlock>("FindCount").Text=(findIndex+1)+" / "+findHits.Count;
    }
}
