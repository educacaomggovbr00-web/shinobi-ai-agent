import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createSign} from "node:crypto";
import worker from "../src/worker.mjs";
import {verifyGitHubOidc,validateMobileAction,visualRunner,visualMobile,visualTakeover} from "../src/visual-bridge.mjs";

const origin="https://bushin-cloudflare-visual-tests.workers.dev";
const owner="123456789012345678";
const envBase={PUBLIC_BASE_URL:origin,DISCORD_CLIENT_SECRET:"fake-ci-only",
  ENCRYPTION_KEY_BASE64:"fake-ci-only",BUSHIN_OWNER_DISCORD_ID:owner};

function form(action,extra={}){
 return new URLSearchParams({action,...extra});
}
test("Only Naruto RP channel URLs, confirmation, and bounded commands permitted",()=>{
 const channel="https://discord.com/channels/1515877468299595919/1520116350360617154";
 assert.deepEqual(validateMobileAction(form("read_page_text")),{action:"read_page_text",args:{}});
 assert.deepEqual(validateMobileAction(form("open_url",{url:channel})),{action:"open_url",args:{url:channel}});
 assert.deepEqual(validateMobileAction(form("compose_message",{url:channel,text:"Olá"})),{action:"compose_message",args:{channel_url:channel,text:"Olá"}});
 assert.equal(validateMobileAction(form("send_message",{url:channel,text:"Oi",confirmed:"yes"})).args.confirm,true);
 for(const url of ["https://discord.com/channels/@me/123456789012345678",
   "https://discord.com/channels/999999999999999999/1520116350360617154",
   "https://evil.test/channels/1515877468299595919/1520116350360617154",
   channel+"?token=private"]){
   assert.throws(()=>validateMobileAction(form("open_url",{url})));
 }
 assert.throws(()=>validateMobileAction(form("send_message",{url:channel,text:"Oi"})),/confirmação/);
 for(const text of ["Oi @everyone","Oi @here","xx\nzzz","   "])
   assert.throws(()=>validateMobileAction(form("send_message",{url:channel,text,confirmed:"yes"})));
 assert.throws(()=>validateMobileAction(form("press",{key:"Control+V"})));
 assert.throws(()=>validateMobileAction(form("click",{x:"-1",y:"100"})));
 assert.equal(validateMobileAction(form("tabs",{tab_index:"1"})).args.tab_index,1);
});

test("Worker only serves owner's mobile bridge with valid existing session",async()=>{
 const env={...envBase,DB:{prepare(){throw Error("No DB query should occur for cookie-less user")}}};
 const response=await worker.fetch(new Request(origin+"/mobile/visual"),env);
 assert.equal(response.status,303);
 assert.equal(response.headers.get("location"),"/mobile");
 for(const [path,method] of [["/bridge/runner/register","POST"],["/bridge/runner/poll?run_id=39212345678","GET"]]){
   const response=await worker.fetch(new Request(origin+path,{method}),env);
   assert.ok([401,403].includes(response.status),response.status);
 }
});
const kp=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...kp.publicKey.export({format:"jwk"}),kid:"bushin-ci",alg:"RS256",use:"sig"};
const runId="39212345678";
function jwt(overrides={}){
 const now=Math.floor(Date.now()/1000);
 const payload={iss:"https://token.actions.githubusercontent.com",aud:"bushin-cloudflare-visual-v1",
 repository:"educacaomggovbr00-web/shinobi-ai-agent",repository_id:"1424794298",repository_owner_id:"260082480",ref:"refs/heads/main",
 workflow_ref:"educacaomggovbr00-web/shinobi-ai-agent/.github/workflows/bushin-discord-live.yml@refs/heads/main",
 sub:"repo:educacaomggovbr00-web/shinobi-ai-agent:ref:refs/heads/main",
 event_name:"workflow_dispatch",runner_environment:"github-hosted",
 run_id:runId,jti:"safe-jti-123456789101112",exp:now+240,iat:now-10,nbf:now-10,
 ...overrides};
 const header={alg:"RS256",typ:"JWT",kid:"bushin-ci"};
 const encoded=[header,payload].map(x=>Buffer.from(JSON.stringify(x)).toString("base64url")).join(".");
 const signed=createSign("RSA-SHA256").update(encoded).end().sign(kp.privateKey).toString("base64url");
 return encoded+"."+signed;
}
class FakeD1{
 constructor(){this.jtis=new Set();this.sessions=new Map();this.commands=new Map();}
 prepare(sql){
  const db=this;
  return {bind(...args){return {
    async first(){
      if(sql.includes("FROM bushin_visual_jti"))return db.jtis.has(args[0])?{jti_hash:args[0]}:null;
      if(sql.startsWith("SELECT * FROM bushin_visual_sessions")){
       const item=db.sessions.get(args[0]);
       return item&&item.token_hash===args[1]&&item.expires_at>args[2]?item:null;
      }
         if(sql.startsWith("SELECT takeover_encrypted FROM bushin_visual_sessions")){
        return [...db.sessions.values()].find(x=>x.owner_id===args[0]&&x.expires_at>args[1]&&x.last_seen>args[2]&&x.takeover_encrypted)||null;
      }
   if(sql.startsWith("SELECT COUNT(*) AS total FROM bushin_visual_commands"))
       return {total:[...db.commands.values()].filter(x=>x.run_id===args[0]&&x.owner_id===args[1]&&["queued","in_progress"].includes(x.state)).length};
      if(sql.startsWith("SELECT * FROM bushin_visual_commands")){
       return [...db.commands.values()].find(x=>x.run_id===args[0]&&x.owner_id===args[1]&&x.state==="queued")||null;
      }
      return null;
    },
    async all(){
      if(sql.includes("FROM bushin_visual_sessions"))return {results:[...db.sessions.values()].filter(x=>x.owner_id===args[0]&&x.expires_at>args[1]).slice(-1)};
      if(sql.includes("FROM bushin_visual_commands"))return {results:[...db.commands.values()].filter(x=>x.run_id===args[0]&&x.owner_id===args[1]).reverse()};
      return {results:[]};
    },
    async run(){
      if(sql.startsWith("INSERT INTO bushin_visual_jti"))db.jtis.add(args[0]);
      else if(sql.startsWith("INSERT INTO bushin_visual_sessions")){
        db.sessions.set(args[0],{run_id:args[0],owner_id:args[1],token_hash:args[2],created_at:args[3],expires_at:args[4],last_seen:args[5]});
      }else if(sql.startsWith("UPDATE bushin_visual_sessions")){
        const s=db.sessions.get(args[1]);s.last_seen=args[0];
      }else if(sql.startsWith("UPDATE bushin_visual_sessions SET takeover_encrypted")){
        const row=db.sessions.get(args[1]);row.takeover_encrypted=args[0];
      }else if(sql.startsWith("INSERT INTO bushin_visual_commands")){
        db.commands.set(args[0],{id:args[0],run_id:args[1],owner_id:args[2],action:args[3],
          args_json:args[4],state:args[5],result_json:null,created_at:args[6],updated_at:args[7]});
      }else if(sql.startsWith("UPDATE bushin_visual_commands SET state='in_progress'")){
        const c=db.commands.get(args[1]);if(!c||c.state!=="queued")return {meta:{changes:0}};
        c.state="in_progress";
      }else if(sql.startsWith("UPDATE bushin_visual_commands SET state=?")){
        const c=db.commands.get(args[3]);if(!c||c.state!=="in_progress")return {meta:{changes:0}};
        c.state=args[0];c.result_json=args[1];
      }else throw Error("Unmocked SQL: "+sql);
      return {meta:{changes:1},success:true};
    }
  };}};
 }
}
test("Signed GitHub Actions OIDC safely registers runner, exchanges one private command, and confirms result",async t=>{
 const realFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=realFetch});
 globalThis.fetch=async (url,opts)=>{
  assert.equal(String(url),"https://token.actions.githubusercontent.com/.well-known/jwks");
  return Response.json({keys:[jwk]});
 };
 assert.equal(await verifyGitHubOidc(jwt({repository:"attacker/other-repo"})),null);
 assert.equal(await verifyGitHubOidc(jwt({repository_id:"9999999999"})),null);
 assert.equal(await verifyGitHubOidc(jwt({sub:"repo:other-user/other-repo:ref:refs/heads/main"})),null);
 assert.equal((await verifyGitHubOidc(jwt({sub:"repo:educacaomggovbr00-web@260082480/shinobi-ai-agent@1424794298:ref:refs/heads/main"}))).runId,runId);
 assert.equal((await verifyGitHubOidc(jwt())).runId,runId);
 const db=new FakeD1(),env={...envBase,DB:db};
 let reg=await visualRunner(new Request(origin+"/bridge/runner/register",{method:"POST",headers:{authorization:"Bearer "+jwt()}}),env);
 assert.equal(reg.status,200);
 const data=await reg.json();
 assert.equal(data.registered,true);
 assert.equal(data.run_id,runId);
 assert.ok(data.runner_token.length>=45);
 const leak=JSON.stringify([...db.sessions.values()]);
 assert.ok(!leak.includes(data.runner_token),"Runner token must not be stored in plaintext");
 reg=await visualRunner(new Request(origin+"/bridge/runner/register",{method:"POST",headers:{authorization:"Bearer "+jwt()}}),env);
 assert.equal(reg.status,409,"Duplicate GitHub OIDC jti must not replay");
 const req=(path,options={})=>new Request(origin+path,{
   ...options,headers:{authorization:"Bearer "+data.runner_token,...(options.headers||{})}
 });
 const takeoverUrl="https://bushin-test-private.trycloudflare.com/connect?key="+"A".repeat(45);
 const sealed=async value=>"ciphertext."+Buffer.from(value).toString("base64url");
 const unseal=async value=>Buffer.from(value.slice("ciphertext.".length),"base64url").toString();
 const submitted=await visualRunner(req("/bridge/runner/takeover?run_id="+runId,{
   method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:takeoverUrl})
 }),env,{seal:sealed});
 assert.equal((await submitted.json()).secured,true);
 assert.ok(!JSON.stringify([...db.sessions.values()]).includes(takeoverUrl));
 const unauthorized=await visualRunner(new Request(origin+"/bridge/runner/takeover?run_id="+runId,{
   method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:takeoverUrl})
 }),env,{seal:sealed});
 assert.equal(unauthorized.status,401);
 const html=async(title,content)=>new Response("<h1>"+title+"</h1>"+content,{headers:{"content-type":"text/html"}});
 const page=async(a,b)=>html(a,b);
 const redirect=to=>new Response(null,{status:303,headers:{location:to}});
 const mobile={ownerId:owner,escape:String,page,redirect,base:origin};
 let view=await visualMobile(new Request(origin+"/mobile/visual"),env,mobile);
 assert.equal(view.status,200);
 const ownerHtml=await view.text();
 assert.match(ownerHtml,/Navegador temporário conectado/);
 assert.match(ownerHtml,/Assumir navegador visual/);
 const takeoverRedirect=await visualTakeover(new Request(origin+"/mobile/visual/takeover"),env,
   {ownerId:owner,unseal,redirect});
 assert.equal(takeoverRedirect.status,303);
 assert.equal(takeoverRedirect.headers.get("location"),takeoverUrl);
 const queued=await visualMobile(new Request(origin+"/mobile/visual",{
   method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","origin":origin},
   body:new URLSearchParams({action:"rpg_view"})
 }),env,mobile);
 assert.equal(queued.status,303);
 const poll=await visualRunner(req("/bridge/runner/poll?run_id="+runId),env);
 assert.equal(poll.status,200);
 const c=(await poll.json()).command;
 assert.equal(c.action,"rpg_view");
 assert.equal(c.session_id,runId);
 assert.ok(c.id.startsWith("visual_"));
 const confirmed=await visualRunner(req("/bridge/runner/result?run_id="+runId,{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({id:c.id,ok:true,data:{url:"https://discord.com/channels/1515877468299595919/1520116350360617154",messages:[]}})
 }),env);
 assert.equal((await confirmed.json()).stored,true);
 view=await visualMobile(new Request(origin+"/mobile/visual"),env,mobile);
 assert.match(await view.text(),/completed/);
 assert.equal((await (await visualRunner(req("/bridge/runner/poll?run_id="+runId),env)).json()).command,null);
});
