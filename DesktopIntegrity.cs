using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Pure boundary checks shared by the desktop and its isolated regression harness.
static class DesktopIntegrity {
    static JavaScriptSerializer Serializer(){return new JavaScriptSerializer{MaxJsonLength=16777216};}
    internal static string MergePreferences(string baseline,string current,string latest){
        var json=Serializer();
        var before=json.Deserialize<Dictionary<string,object>>(baseline??"{}")??new Dictionary<string,object>();
        var desired=json.Deserialize<Dictionary<string,object>>(current??"{}")??new Dictionary<string,object>();
        var result=json.Deserialize<Dictionary<string,object>>(latest??"{}")??new Dictionary<string,object>();
        MergeChanges(before,desired,result,json);return json.Serialize(result);
    }
    static void MergeChanges(Dictionary<string,object> before,Dictionary<string,object> desired,Dictionary<string,object> latest,JavaScriptSerializer json){
        foreach(string key in before.Keys.Union(desired.Keys).ToArray()){
            object oldValue,newValue,currentValue;bool had=before.TryGetValue(key,out oldValue),has=desired.TryGetValue(key,out newValue);
            if(!has){latest.Remove(key);continue;}
            if(had&&json.Serialize(oldValue)==json.Serialize(newValue))continue;
            if(oldValue is Dictionary<string,object> && newValue is Dictionary<string,object>){
                if(!latest.TryGetValue(key,out currentValue)||!(currentValue is Dictionary<string,object>))currentValue=new Dictionary<string,object>();
                MergeChanges((Dictionary<string,object>)oldValue,(Dictionary<string,object>)newValue,(Dictionary<string,object>)currentValue,json);latest[key]=currentValue;
            }else latest[key]=newValue;
        }
    }
    internal static string FileHash(string file){using(var stream=File.OpenRead(file))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    internal static string TextHash(string text){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    sealed class PreferenceLease:IDisposable {
        FileStream stream;readonly string file,owner;
        internal PreferenceLease(FileStream handle,string path,string pid){stream=handle;file=path;owner=pid;}
        public void Dispose(){
            if(stream==null)return;stream.Dispose();stream=null;
            try{if(File.Exists(file)&&File.ReadAllText(file,Encoding.UTF8).Trim()==owner)File.Delete(file);}
            catch(FileNotFoundException){}catch(DirectoryNotFoundException){}
        }
    }
    internal static IDisposable AcquirePreferenceLock(string preferenceFile,int timeoutMs){
        string file=preferenceFile+".write.lock",pid=Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file)));
        var timer=Stopwatch.StartNew();
        while(true){
            try{
                var stream=new FileStream(file,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.Read);
                try{var bytes=Encoding.UTF8.GetBytes(pid);stream.Write(bytes,0,bytes.Length);stream.Flush(true);return new PreferenceLease(stream,file,pid);}
                catch{stream.Dispose();throw;}
            }catch(IOException){}catch(UnauthorizedAccessException){}
            TryReclaimPreferenceLock(file);
            if(timer.ElapsedMilliseconds>=timeoutMs)throw new TimeoutException("다른 작업이 설정을 저장하고 있습니다. 잠시 후 다시 저장하세요.");
            System.Threading.Thread.Sleep(25);
        }
    }
    static void TryReclaimPreferenceLock(string file){
        try{
            // No writer can change this file while checked. Delete sharing lets us
            // mark this exact stale handle delete-pending before releasing it.
            using(var stream=new FileStream(file,FileMode.Open,FileAccess.ReadWrite,FileShare.Read|FileShare.Delete)){
                if(stream.Length>64)return;
                var bytes=new byte[(int)stream.Length];int count=stream.Read(bytes,0,bytes.Length);string value=Encoding.UTF8.GetString(bytes,0,count).Trim();
                bool stale=false;int pid;
                if(value.Length==0)stale=DateTime.UtcNow-File.GetLastWriteTimeUtc(file)>TimeSpan.FromSeconds(60);
                else if(value.All(Char.IsDigit)&&Int32.TryParse(value,out pid)&&pid>0){
                    try{using(var process=Process.GetProcessById(pid))stale=process.HasExited;}
                    catch(ArgumentException){stale=true;}
                }
                if(stale)File.Delete(file);
            }
        }catch(IOException){}catch(UnauthorizedAccessException){}catch(System.ComponentModel.Win32Exception){}
    }
    internal static void NoReparse(string target){
        string current=Path.GetFullPath(target);
        while(!String.IsNullOrEmpty(current)){
            try{if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("연결 경로는 실행 취소 대상이 될 수 없습니다: "+current);}
            catch(FileNotFoundException){}catch(DirectoryNotFoundException){}
            current=Path.GetDirectoryName(current);
        }
    }
    internal static void CheckUndoCurrent(Dictionary<string,object> entry){
        string file=(string)entry["path"],status=(string)entry["status"];NoReparse(file);
        object value;if(!entry.TryGetValue("afterSha256",out value))throw new IOException("이전 형식의 기록은 자동 복원할 수 없습니다. 백업을 직접 확인하세요.");
        if(status=="deleted") {if(value!=null||File.Exists(file)||Directory.Exists(file))throw new IOException("삭제 후 같은 경로에 새 항목이 생겼습니다: "+file);return;}
        string hash=value as string;
        if(String.IsNullOrEmpty(hash)||hash.Length!=64||!File.Exists(file)||!String.Equals(FileHash(file),hash,StringComparison.OrdinalIgnoreCase))throw new IOException("작업 이후 파일이 바뀌었습니다. 현재 내용을 덮어쓰지 않았습니다: "+file);
    }
    internal static List<Dictionary<string,object>> ReadUndoManifest(string manifest,string recoveryRoot){
        string root=Path.GetFullPath(recoveryRoot).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        string full=Path.GetFullPath(manifest);
        if(!full.StartsWith(root,StringComparison.OrdinalIgnoreCase)||Path.GetFileName(full)!="기록.json")throw new IOException("이 앱의 실행 취소 기록이 아닙니다.");
        NoReparse(full);
        if(new FileInfo(full).Length>4*1024*1024)throw new IOException("실행 취소 기록이 너무 큽니다.");
        var data=Serializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(full,Encoding.UTF8));
        object version,run;
        if(!data.TryGetValue("version",out version)||Convert.ToInt32(version)!=2||!data.TryGetValue("runId",out run)||Convert.ToString(run)!=Path.GetFileName(Path.GetDirectoryName(full)))throw new IOException("검증 가능한 실행 취소 기록이 아닙니다. 백업을 직접 확인하세요.");
        var list=((System.Collections.IEnumerable)data["files"]).Cast<Dictionary<string,object>>().ToList();
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var entry in list){
            string file=Convert.ToString(entry["path"]),status=Convert.ToString(entry["status"]);
            if(!Path.IsPathRooted(file)||!seen.Add(Path.GetFullPath(file))||!new[]{"created","modified","deleted"}.Contains(status))throw new IOException("실행 취소 대상 형식이 올바르지 않습니다.");
            CheckUndoCurrent(entry);
            if(status!="created"){
                string backup=Convert.ToString(entry["backup"]);object hash;
                if(String.IsNullOrEmpty(backup)||!String.Equals(Path.GetDirectoryName(Path.GetFullPath(backup)),Path.GetDirectoryName(full),StringComparison.OrdinalIgnoreCase))throw new IOException("백업 경로가 작업 기록 밖에 있습니다.");
                NoReparse(backup);
                if(!entry.TryGetValue("backupSha256",out hash)||!File.Exists(backup)||!String.Equals(FileHash(backup),Convert.ToString(hash),StringComparison.OrdinalIgnoreCase))throw new IOException("백업 무결성을 확인하지 못했습니다.");
            }
        }
        return list;
    }
    internal static async Task KillTree(Process process){
        if(process==null)return;
        try{
            if(process.HasExited)return;int id=process.Id;
            var info=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"taskkill.exe"),"/T /F /PID "+id){UseShellExecute=false,CreateNoWindow=true};
            using(var kill=Process.Start(info)){if(kill!=null)await Task.Run(()=>{if(!kill.WaitForExit(5000))try{kill.Kill();}catch(InvalidOperationException){}});}
            if(!process.HasExited)process.Kill();
        }catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
    }
    internal static void ObserveFailure(Task task,TaskCompletionSource<bool> failure){
        task.ContinueWith(t=>{var observed=t.Exception;failure.TrySetResult(true);},TaskContinuationOptions.OnlyOnFaulted);
    }
    internal static async Task WriteRequest(Process process,byte[] bytes){
        try{await process.StandardInput.BaseStream.WriteAsync(bytes,0,bytes.Length).ConfigureAwait(false);}
        finally{try{process.StandardInput.Close();}catch(ObjectDisposedException){}}
    }
}
