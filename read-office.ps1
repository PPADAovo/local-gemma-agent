param([string]$File)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($File)
function XmlEntry($entry){
    if($entry.Length -gt 16MB){throw 'Office XML part exceeds 16 MB'}
    $stream=$entry.Open()
    try{$doc=New-Object Xml.XmlDocument;$doc.XmlResolver=$null;$doc.Load($stream);return ,$doc}finally{$stream.Dispose()}
}
try{
    $shared=@()
    $strings=$archive.GetEntry('xl/sharedStrings.xml')
    if($strings){$shared=@((XmlEntry $strings).GetElementsByTagName('si') | ForEach-Object {$_.InnerText})}
    foreach($entry in $archive.Entries){
        if($entry.FullName -match '^xl/worksheets/sheet\d+\.xml$'){
            $entry.FullName
            foreach($cell in (XmlEntry $entry).GetElementsByTagName('c')){
                $value=$cell.InnerText
                if($cell.GetAttribute('t') -eq 's'){$value=$shared[[int]$value]}
                $cell.GetAttribute('r')+' '+$value
            }
        }elseif($entry.FullName -match '^ppt/slides/slide\d+\.xml$'){
            $entry.FullName
            (XmlEntry $entry).GetElementsByTagName('t','http://schemas.openxmlformats.org/drawingml/2006/main') | ForEach-Object {$_.InnerText}
        }
    }
}finally{$archive.Dispose()}
