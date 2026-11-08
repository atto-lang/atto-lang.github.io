#!/usr/bin/env node
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
const port=Number(process.env.PORT||8088);
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://localhost');
  let decoded=decodeURIComponent(url.pathname);
  if(decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')){res.writeHead(400);res.end();return;}
  const target=path.resolve(root,'.'+decoded,(decoded.endsWith('/')?'index.html':''));
  if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);res.end();return;}
  const info=await stat(target);
  if(!info.isFile()||info.size>3_000_000){res.writeHead(404);res.end();return;}
  const content=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?null:content);
 }catch(_){res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Atto architecture preview: http://127.0.0.1:${port}/`));
