import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {ADVANCED_TOOLS,ADVANCED_NAMES,advancedCall} from "../src/advanced-suite.mjs";
import {stateCall} from "../src/state-suite.mjs";
import {repoCall} from "../src/repo-suite.mjs";
import {discordCall} from "../src/discord-suite.mjs";

const owner="123456789012345678";
const me={id:owner,username:"test_owner",display_name:"Ninja",membership:{member:true,guild_id:"1515877468299595919"}};
const ctx={me,creds:{access:"test-only-oauth-access"}};
const base="https://bushin-test-owner.workers.dev";
const minimal={PUBLIC_BASE_URL:base,DB:{prepare(){throw Error("DB should not be queried")}},
 DISCORD_CLIENT_SECRET:"fake-discord-client-secret-only-for-testing",
 BUSHIN_OWNER_DISCORD_ID:owner,ENCRYPTION_KEY_BASE64:"testing"};
test("All new tool names are unique and have callable MCP schemas",async()=>{
 const names=ADVANCED_TOOLS.map(t=>t.name);
 assert.ok(names.length>=44,names.length);
 assert.equal(names.length,new Set(names).size);
 for(const n of ["bushin_browser_start","bushin_browser_tabs","bushin_discord_read_messages",
    "bushin_task_start","bushin_task_logs","bushin_files_upload",
    "bushin_github_run_tests","bushin_save_state","bushin_load_state",
    "bushin_auth_status","bushin_audit_log","bushin_ui_live_panel"]){
   assert.ok(ADVANCED_NAMES.has(n),n);
 }
 for(const t of ADVANCED_TOOLS){
   assert.equal(t.inputSchema.type,"object");
   assert.equal(t.inputSchema.additionalProperties,false);
   assert.ok(typeof t.description==="string"&&t.description.length>10);
 }
 const list=await worker.fetch(new Request(base+"/mcp",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({jsonrpc:"2.0",id:12,method:"tools/list"})
 }),minimal);
 assert.equal(list.status,200);
 const namesReturned=(await list.json()).result.tools.map(t=>t.name);
 assert.equal(namesReturned.length,new Set(namesReturned).size);
 assert.ok(namesReturned.includes("bushin_browser_tabs"));
 assert.ok(namesReturned.includes("bushin_discord_profile"));
 const unauth=await worker.fetch(new Request(base+"/mcp",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({jsonrpc:"2.0",id:13,method:"tools/call",params:{name:"bushin_task_start",arguments:{title:"Test"}}})
 }),minimal);
 assert.equal(unauth.status,401);
});
test("No browser session/token means unavailable rather than falsely successful actions",async()=>{
 const noGh=await advancedCall(minimal,"bushin_browser_screenshot",{},ctx);
 assert.equal(noGh.configured,false);
 assert.equal(noGh.connected,false);
 const noBot=await discordCall(minimal,"discord_read_messages",{channel_id:"222222222222222222"},ctx);
 assert.equal(noBot.state,"unavailable");
 const noDm=await discordCall(minimal,"discord_send_dm",{recipient_id:owner,confirmed:true,content:"oi"},ctx);
 assert.equal(noDm.state,"unavailable");
 const noWorkspace=await repoCall(minimal,"files_list",{});
 assert.equal(noWorkspace.state,"unavailable");
});
test("Personal Discord OAuth guild listing uses Bearer and emits only basic metadata",async t=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original});
 let calls=0;
 globalThis.fetch=async (url,options)=>{
  calls++;assert.equal(String(url),"https://discord.com/api/v10/users/@me/guilds");
  assert.equal(options.headers.authorization,"Bearer test-only-oauth-access");
  return Response.json([{id:"111111111111111111",name:"Naruto Project RP",owner:false,
    permissions:"123456",features:["SECRET"],icon:"dont-care"}]);
 };
 const r=await discordCall(minimal,"discord_list_servers",{},ctx);
 assert.equal(calls,1);
 assert.deepEqual(r.servers,[{id:"111111111111111111",name:"Naruto Project RP",owner:false}]);
 assert.equal(JSON.stringify(r).includes("permissions"),false);
});
class FakeD1 {
 constructor(){this.tasks=new Map();this.events=[];this.mem=new Map();}
 prepare(sql){
  const db=this;
  return {bind(...p){
   return {
    async first(){
     if(sql.startsWith("SELECT * FROM bushin_tasks")){const task=db.tasks.get(p[0]);return task?.owner_id===p[1]?task:null;}
     if(sql.startsWith("SELECT key,value_json"))return db.mem.get(p[0]+"|"+p[1])||null;
     return null;
    },
    async all(){
     if(sql.includes("FROM bushin_events")){
      let rows=db.events.filter(e=>e.owner_id===p[0]);
      if(sql.includes("task_id=?"))rows=rows.filter(e=>e.task_id===p[1]);
      return {results:rows.slice().reverse()};
     }
     return {results:[]};
    },
    async run(){
     if(sql.startsWith("INSERT INTO bushin_tasks")){
      db.tasks.set(p[0],{id:p[0],owner_id:p[1],title:p[2],description:p[3],
        steps_json:p[4],status:p[5],created_at:p[6],updated_at:p[7],approval_summary:null});
     }else if(sql.startsWith("UPDATE bushin_tasks")){
      const row=db.tasks.get(p[3]);assert.equal(row.owner_id,p[4]);
      Object.assign(row,{status:p[0],updated_at:p[1],approval_summary:p[2]});
     }else if(sql.startsWith("INSERT INTO bushin_events")){
      db.events.push({id:db.events.length+1,owner_id:p[0],task_id:p[1],
         action:p[2],summary:p[3],created_at:p[4]});
     }else if(sql.startsWith("INSERT INTO bushin_project_state")){
      db.mem.set(p[0]+"|"+p[1],{key:p[1],value_json:p[2],updated_at:p[3]});
     }else throw Error("Unexpected SQL statement "+sql);
     return {success:true};
    }
   };
  }};
 }
}
test("Owner-scoped task planning, pause/approval/resume and memory persist without executing external actions",async()=>{
 const env={...minimal,DB:new FakeD1()};
 const created=await stateCall(env,"task_start",{title:"Treinar em Konoha",
  steps:["Consultar a ficha","Preparar resposta"]},ctx);
 assert.equal(created.state,"planned");
 assert.match(created.note,/não executada em segundo plano/);
 const tid=created.task_id;
 const a=await stateCall(env,"task_status",{task_id:tid},ctx);
 assert.equal(a.task.status,"planned");
 const request=await stateCall(env,"task_request_approval",{task_id:tid,summary:"Publicar mensagem"},ctx);
 assert.equal(request.state,"awaiting_approval");
 await assert.rejects(()=>stateCall(env,"task_resume",{task_id:tid},ctx),/confirmed:true/);
 assert.equal((await stateCall(env,"task_resume",{task_id:tid,confirmed:true},ctx)).state,"planned");
 assert.equal((await stateCall(env,"task_pause",{task_id:tid},ctx)).state,"paused");
 assert.equal((await stateCall(env,"task_cancel",{task_id:tid},ctx)).state,"cancelled");
 const logs=await stateCall(env,"task_logs",{task_id:tid},ctx);
 assert.ok(logs.events.length>=5);
 await assert.rejects(()=>stateCall(env,"bushin_save_state",{key:"naruto",value:{level:1}},ctx),/confirmação/);
 assert.equal((await stateCall(env,"bushin_save_state",{key:"naruto",value:{rank:"Genin"},confirmed:true},ctx)).saved,true);
 assert.deepEqual((await stateCall(env,"bushin_load_state",{key:"naruto"},ctx)).value,{rank:"Genin"});
 const audit=await stateCall(env,"audit_log",{},ctx);
 assert.ok(audit.events.length>=6);
 await assert.rejects(()=>stateCall(env,"task_status",{task_id:tid},{me:{id:"999999999999999999"}}),/não encontrada/);
});
test("GitHub writes/launches require confirmation and fixed paths",async t=>{
 const env={...minimal,BUSHIN_GITHUB_TOKEN:"fake-token-for-ci-only-123456789"};
 let count=0;
 const previous=globalThis.fetch;
 t.after(()=>{globalThis.fetch=previous});
 globalThis.fetch=async (url,options)=>{
  count++;
  assert.match(String(url),/^https:\/\/api\.github\.com\/repos\/educacaomggovbr00-web\/shinobi-ai-agent/);
  assert.match(options.headers.authorization,/^Bearer /);
  if(String(url).includes("dispatches"))return new Response(null,{status:204});
  throw Error("Unexpected request "+url);
 };
 await assert.rejects(()=>repoCall(env,"github_run_tests",{confirmed:false}),/Confirme/);
 assert.equal(count,0);
 const run=await repoCall(env,"github_run_tests",{confirmed:true});
 assert.equal(run.state,"requested");
 assert.equal(count,1);
 await assert.rejects(()=>repoCall(env,"files_upload",{path:"../secret",content:"x",confirmed:true}),/inválido/);
 assert.equal(count,1);
 await assert.rejects(()=>repoCall(env,"files_upload",{path:"bushin_workspace/readme.txt",content:"ok",confirmed:false}),/confirmação/);
 assert.equal(count,1);
});

test("Android tool dashboard requires the same secure mobile owner session",async()=>{
 const token="A".repeat(52);
 const hash=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))).toString("base64url");
 let calls=0;
 const env={...minimal,DB:{prepare(sql){
   calls++;
   assert.match(sql,/SELECT user_id FROM mobile_user_sessions/);
   return {bind(actualHash,limit){
      assert.equal(actualHash,hash);
      assert.ok(limit>Date.now()-1000);
      return {first:async()=>({user_id:owner})};
   }};
 }}};
 const unauth=await worker.fetch(new Request(base+"/mobile/features"),env);
 assert.equal(unauth.status,303);
 assert.equal(unauth.headers.get("location"),"/mobile");
 assert.equal(calls,0);
 const logged=await worker.fetch(new Request(base+"/mobile/features",{
   headers:{cookie:"__Host-bushin_mobile="+token}
 }),env);
 assert.equal(logged.status,200);
 const html=await logged.text();
 assert.match(html,/Ferramentas do Bushin/);
 assert.match(html,/browser_tabs/);
 assert.match(html,/task_start/);
 assert.match(html,/arquivos/i);
 assert.match(html,/skill-only/);
 assert.doesNotMatch(html,/fake-discord-client-secret-only-for-testing/);
 assert.equal(logged.headers.get("cache-control"),"no-store");
});
