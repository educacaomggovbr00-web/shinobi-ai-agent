import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {fileURLToPath} from "node:url";

async function port(){
 return new Promise((resolve,reject)=>{
   const server=createServer().listen(0,"127.0.0.1",()=>{
     const p=server.address().port;server.close(()=>resolve(p));
   });
   server.once("error",reject);
 });
}
async function retryFetch(url){
 for(let tries=0;tries<35;tries++){
   try {return await fetch(url,{signal:AbortSignal.timeout(1000)});}
   catch{await new Promise(r=>setTimeout(r,150));}
 }
 throw new Error("Bushin MCP server did not start in time");
}
test("Real MCP server boots, declares native visual tools and challenges OAuth",async()=>{
 const dir=fileURLToPath(new URL("../",import.meta.url));
 const p=await port();
 const server=spawn(process.execPath,["src/server.mjs"],{
   cwd:dir,env:{...process.env,PORT:String(p),PUBLIC_BASE_URL:"https://bushin.example",BUSHIN_OWNER_DISCORD_ID:"123456789012345678",DISCORD_CLIENT_SECRET:"fake-secret-used-only-in-github-tests"},
   stdio:["ignore","pipe","pipe"]
 });
 let stderr="";
 server.stderr.on("data",x=>stderr+=String(x).slice(0,1200));
 try{
   const h=await retryFetch("http://127.0.0.1:"+p+"/health");
   assert.equal(h.status,200,stderr);
   const health=await h.json();
   assert.equal(health.connected,false,"Health endpoint must not lie about OAuth status");
   assert.equal(health.login_required,true);
   const meta=await (await fetch("http://127.0.0.1:"+p+"/.well-known/oauth-protected-resource")).json();
   assert.equal(meta.resource,"https://bushin.example/mcp");
   assert.deepEqual(meta.authorization_servers,["https://bushin.example"]);
   const as=await (await fetch("http://127.0.0.1:"+p+"/.well-known/oauth-authorization-server")).json();
   assert.deepEqual(as.code_challenge_methods_supported,["S256"]);
   assert.ok(as.registration_endpoint.endsWith("/oauth/register"));
   const badRegistration=await fetch("http://127.0.0.1:"+p+"/oauth/register",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({redirect_uris:["https://evil.example/token"]})
   });
   assert.equal(badRegistration.status,400);
   const dcr=await fetch("http://127.0.0.1:"+p+"/oauth/register",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({redirect_uris:["https://chatgpt.com/connector_platform_oauth_redirect"],
         token_endpoint_auth_method:"none"})
   });
   assert.equal(dcr.status,201);
   assert.ok((await dcr.json()).client_id);
   const challenge=await fetch("http://127.0.0.1:"+p+"/oauth/token",{
      method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"invalid",client_id:"fake",resource:"https://bushin.example/mcp"})
   });
   assert.ok(challenge.status>=400);
   const req=async(method,params,id)=>fetch("http://127.0.0.1:"+p+"/mcp",{
     method:"POST",
     headers:{"content-type":"application/json","accept":"application/json, text/event-stream"},
     body:JSON.stringify({jsonrpc:"2.0",id,method,params})
   });
   const init=await req("initialize",{
     protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"bushin-ci",version:"1.0"}
   },1);
   assert.equal(init.status,200,await init.text().catch(()=>""));
   const list=await req("tools/list",{},2);
   assert.equal(list.status,200);
   const body=await list.text();
   assert.match(body,/bushin_browser_screenshot/);
   assert.match(body,/bushin_open_browser_console/);
   assert.match(body,/bushin_discord_whoami/);
   const unauth=await req("tools/call",{name:"bushin_browser_status",arguments:{}},3);
   assert.equal(unauth.status,401,"User data must require Discord OAuth");
   assert.match(unauth.headers.get("www-authenticate")||"",/resource_metadata=/);
 }finally{
   server.kill("SIGTERM");
   await new Promise(resolve=>{server.once("exit",resolve);setTimeout(resolve,1500);});
 }
});
