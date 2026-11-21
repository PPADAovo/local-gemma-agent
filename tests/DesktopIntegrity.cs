using System;
using System.IO;
using System.Text;
using System.Reflection;
using System.Runtime.Serialization;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
class DesktopIntegrityTest {
 static BindingFlags priv=BindingFlags.Static|BindingFlags.Instance|BindingFlags.NonPublic|BindingFlags.Public;
 static int failures;
 static void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS: "+name);}
 static void Test(string name,Action body){try{body();}catch(Exception e){failures++;Console.WriteLine("FAIL: "+name+" "+(e.InnerException??e).Message);}}
 [STAThread] static int Main(string[] args){
  var assembly=Assembly.LoadFrom(args[0]);var type=assembly.GetType("DesktopChat",true);var helper=assembly.GetType("DesktopIntegrity");
  Test("malformed diagnostics keep draining",()=>{var instance=FormatterServices.GetUninitializedObject(type);type.GetField("json",priv).SetValue(instance,new JavaScriptSerializer());using(var reader=new StreamReader(new MemoryStream(Encoding.UTF8.GetBytes("@progress {broken}\n@progress \"ok\"\nordinary error\n")))){var task=(Task<string>)type.GetMethod("ReadDiagnostics",priv).Invoke(instance,new object[]{reader,true});var result=task.GetAwaiter().GetResult();Check(result.Contains("ordinary error"),"diagnostics drained after malformed progress");}});
  Test("three way preferences preserve other window",()=>{Check(helper!=null,"integrity helper available");var merged=(string)helper.GetMethod("MergePreferences",priv).Invoke(null,new object[]{"{\"model\":\"old\",\"ratings\":{\"a\":\"yes\"}}","{\"model\":\"old\",\"ratings\":{\"a\":\"no\"}}","{\"model\":\"new\",\"ratings\":{\"a\":\"yes\",\"b\":\"yes\"},\"unknown\":5}"});var d=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(merged);var ratings=(Dictionary<string,object>)d["ratings"];Check((string)d["model"]=="new"&&(string)ratings["a"]=="no"&&(string)ratings["b"]=="yes"&&(int)d["unknown"]==5,"merge retains unrelated and unknown fields");});
  Test("secret field is masked",()=>{var field=type.GetMethod("CreateAnswerField",priv).Invoke(null,new object[]{true});Check(field is PasswordBox,"secret answer uses PasswordBox");Check(type.GetMethod("CreateAnswerField",priv).Invoke(null,new object[]{false}) is TextBox,"normal answer uses TextBox");});
  Test("cloud rethink uses normal cloud path",()=>{foreach(string brain in new[]{"api-gemini","api-gpt","api-claude","sub-gemini","sub-gpt","sub-claude"})Check(!(bool)type.GetMethod("RethinkTextOnly",priv).Invoke(null,new object[]{brain}),brain);Check((bool)type.GetMethod("RethinkTextOnly",priv).Invoke(null,new object[]{"local"}),"local text regeneration");});
  Test("undo detects later edits",()=>{Check(helper!=null,"integrity helper available");string dir=Path.Combine(Path.GetTempPath(),"gemma-undo-test-"+Guid.NewGuid());Directory.CreateDirectory(dir);try{string file=Path.Combine(dir,"a.txt");File.WriteAllText(file,"after");string hash=(string)helper.GetMethod("FileHash",priv).Invoke(null,new object[]{file});var entry=new Dictionary<string,object>{{"path",file},{"status","created"},{"afterSha256",hash}};helper.GetMethod("CheckUndoCurrent",priv).Invoke(null,new object[]{entry});File.WriteAllText(file,"user edit");bool rejected=false;try{helper.GetMethod("CheckUndoCurrent",priv).Invoke(null,new object[]{entry});}catch(TargetInvocationException){rejected=true;}Check(rejected,"later edit rejected");}finally{Directory.Delete(dir,true);}});
  Test("manifest authority and backup integrity",()=>{
   string dir=Path.Combine(Path.GetTempPath(),"gemma-manifest-test-"+Guid.NewGuid()),recovery=Path.Combine(dir,"recovery"),run=Path.Combine(recovery,"run-1");Directory.CreateDirectory(run);
   try{
    var serializer=new JavaScriptSerializer();string file=Path.Combine(dir,"document.txt"),backup=Path.Combine(run,"0-document.txt"),manifest=Path.Combine(run,"기록.json");File.WriteAllText(file,"after");File.WriteAllText(backup,"before");
    Func<string,string> hash=p=>(string)helper.GetMethod("FileHash",priv).Invoke(null,new object[]{p});
    var entry=new Dictionary<string,object>{{"path",file},{"status","modified"},{"afterSha256",hash(file)},{"backup",backup},{"backupSha256",hash(backup)}};
    var data=new Dictionary<string,object>{{"version",2},{"runId","run-1"},{"files",new[]{entry}}};Action save=()=>File.WriteAllText(manifest,serializer.Serialize(data));
    Func<string,bool> allowed=p=>{try{helper.GetMethod("ReadUndoManifest",priv).Invoke(null,new object[]{p,recovery});return true;}catch(TargetInvocationException){return false;}};
    save();Check(allowed(manifest),"authentic v2 fixture accepted");
    string outside=Path.Combine(dir,"기록.json");File.WriteAllText(outside,serializer.Serialize(data));Check(!allowed(outside),"outside manifest rejected");
    data["version"]=1;save();Check(!allowed(manifest),"legacy unverified schema rejected");data["version"]=2;
    data["runId"]="other";save();Check(!allowed(manifest),"run identity mismatch rejected");data["runId"]="run-1";
    entry["backup"]=file;entry["backupSha256"]=hash(file);save();Check(!allowed(manifest),"backup outside run rejected");entry["backup"]=backup;entry["backupSha256"]=hash(backup);save();
    File.WriteAllText(backup,"tamper");Check(!allowed(manifest),"tampered backup rejected");
   }finally{Directory.Delete(dir,true);}
  });
  Test("cancellation kills owned process without synchronous wait",()=>{
   using(var process=Process.Start(new ProcessStartInfo("cmd.exe","/d /c ping -n 30 127.0.0.1 >nul"){UseShellExecute=false,CreateNoWindow=true})){
    var clock=Stopwatch.StartNew();var task=(Task)helper.GetMethod("KillTree",priv).Invoke(null,new object[]{process});Check(clock.ElapsedMilliseconds<1000,"kill returns an awaitable without blocking UI");task.GetAwaiter().GetResult();Check(process.WaitForExit(3000),"owned child exits");
   }
  });
  Test("shared preference lock excludes live writer and reclaims dead writer",()=>{
   string dir=Path.Combine(Path.GetTempPath(),"gemma-pref-lock-"+Guid.NewGuid());Directory.CreateDirectory(dir);string file=Path.Combine(dir,"preferences.json");var acquire=helper.GetMethod("AcquirePreferenceLock",priv);
   try{
    Check(acquire!=null,"cross-runtime preference lease exists");
    using(var lease=(IDisposable)acquire.Invoke(null,new object[]{file,3000})){
     using(var input=new FileStream(file+".write.lock",FileMode.Open,FileAccess.Read,FileShare.ReadWrite))using(var reader=new StreamReader(input))Check(reader.ReadToEnd().Trim()==Process.GetCurrentProcess().Id.ToString(),"lock carries owner PID");
     bool blocked=false;try{using(var duplicate=(IDisposable)acquire.Invoke(null,new object[]{file,120})) {}}catch(TargetInvocationException e){blocked=e.InnerException is TimeoutException;}
     Check(blocked,"live writer is never stolen");
    }
    Check(!File.Exists(file+".write.lock"),"lease removes own lock");
    using(var child=Process.Start(new ProcessStartInfo("cmd.exe","/d /c exit 0"){UseShellExecute=false,CreateNoWindow=true})){int pid=child.Id;child.WaitForExit();File.WriteAllText(file+".write.lock",pid.ToString());}
    using(var recovered=(IDisposable)acquire.Invoke(null,new object[]{file,3000}))Check(File.Exists(file+".write.lock"),"dead writer reclaimed");
   }finally{Directory.Delete(dir,true);}
  });
  if(args.Length>1)Test("Node and desktop share the same exclusive preference lease",()=>{
   string dir=Path.Combine(Path.GetTempPath(),"gemma-cross-lock-"+Guid.NewGuid());Directory.CreateDirectory(dir);
   string file=Path.Combine(dir,"preferences.json"),script=Path.Combine(dir,"probe.mjs"),ready=Path.Combine(dir,"ready");var acquire=helper.GetMethod("AcquirePreferenceLock",priv);var serializer=new JavaScriptSerializer();
   string prefix="import {withPreferencesWriteLock} from "+serializer.Serialize(new Uri(Path.GetFullPath(args[1])).AbsoluteUri)+";import fs from 'node:fs/promises';const file="+serializer.Serialize(file)+";";
   Func<Process> start=()=>Process.Start(new ProcessStartInfo("node.exe","\""+script+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true});
   try{
    File.WriteAllText(script,prefix+"try{await withPreferencesWriteLock(file,async()=>{}, {timeoutMs:120});process.exitCode=2;}catch{console.log('blocked');}",new UTF8Encoding(false));
    using(var lease=(IDisposable)acquire.Invoke(null,new object[]{file,3000}))using(var child=start()){
     if(!child.WaitForExit(3000)){((Task)helper.GetMethod("KillTree",priv).Invoke(null,new object[]{child})).GetAwaiter().GetResult();throw new Exception("Node lock timeout harness stalled");}
     Check(child.ExitCode==0&&child.StandardOutput.ReadToEnd().Contains("blocked"),"Node cannot overwrite a desktop lease");
    }
    File.WriteAllText(script,prefix+"await withPreferencesWriteLock(file,async()=>{await fs.writeFile("+serializer.Serialize(ready)+",'ready');await new Promise(r=>setTimeout(r,700));});",new UTF8Encoding(false));
    using(var child=start()){
     try{
      var clock=Stopwatch.StartNew();while(!File.Exists(ready)&&!child.HasExited&&clock.ElapsedMilliseconds<3000)System.Threading.Thread.Sleep(10);
      Check(File.Exists(ready),"Node acquired the shared lease");bool blocked=false;
      try{using(var lease=(IDisposable)acquire.Invoke(null,new object[]{file,120})) {}}catch(TargetInvocationException e){blocked=e.InnerException is TimeoutException;}
      Check(blocked,"desktop cannot overwrite a Node lease");Check(child.WaitForExit(3000)&&child.ExitCode==0,"Node releases its lease");
     }finally{if(!child.HasExited)((Task)helper.GetMethod("KillTree",priv).Invoke(null,new object[]{child})).GetAwaiter().GetResult();}
    }
    using(var lease=(IDisposable)acquire.Invoke(null,new object[]{file,3000}))Check(File.Exists(file+".write.lock"),"desktop resumes after Node release");
   }finally{Directory.Delete(dir,true);}
  });
  Console.WriteLine("Failures: "+failures);return failures==0?0:1;
 }
}
