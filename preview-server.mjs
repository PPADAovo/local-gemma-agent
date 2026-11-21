import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Each preview exposes only web assets below the selected page directory.
export async function startPreview(file){
  const directory=await fs.realpath(path.dirname(file));
  const prefix='/'+randomUUID()+'/';
  const types=new Map(Object.entries({'.html':'text/html','.htm':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'}));
  const server=http.createServer(async(req,res)=>{
    const reject=()=>{res.writeHead(404);res.end();};
    try{
      if(!['GET','HEAD'].includes(req.method) || req.headers.host!==server.address().address+':'+server.address().port)return reject();
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(!pathname.startsWith(prefix))return reject();
      const segments=decodeURIComponent(pathname.slice(prefix.length)).split('/');
      if(segments.some(s=>!s || s.startsWith('.') || /[:\\\x00-\x1f]/.test(s)))return reject();
      const requested=await fs.realpath(path.join(directory,...segments));
      const relative=path.relative(directory,requested);
      if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))return reject();
      const mime=types.get(path.extname(requested).toLowerCase());
      if(!mime || !(await fs.stat(requested)).isFile())return reject();
      const body=req.method==='GET'?await fs.readFile(requested):null;
      res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
      res.end(body);
    }catch{reject();}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  server.unref();
  return {url:'http://127.0.0.1:'+server.address().port+prefix+encodeURIComponent(path.basename(file)),close(){server.close();server.closeAllConnections();}};
}
