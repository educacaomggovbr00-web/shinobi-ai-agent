import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";

const base="https://bushin-ci.workers.dev";
const id="123456789012345678";
const cookieToken="B".repeat(53);
const hash=createHash("sha256").update(cookieToken).digest("base64url");
class MobileD1 {
 constructor(){this.tasks=new Map();this.mem=new Map();this.events=[];this.sid=0;}
 prepare(sql) {
  const db=this;
  return {bind(...params){
   return {
    async first(){
     if(sql.startsWith("SELECT user_id,creds_encrypted FROM mobile_user_sessions"))
       return params[0]===hash?{user_id:id,creds_encrypted:"fake-encrypted-test-only"}:null;
     throw Error("Unexpected first query "+sql);
    },
    async all(){
     if(sql.startsWith("SELECT id,title,status"))
       return {results:[...db.tasks.values()].map(x=>({id:x.id,title:x.title,status:x.status,approval_summary:null,updated_at:x.updated_at}))};
     if(sql.startsWith("SELECT key,value_json"))
       return {results:[...db.mem.entries()].map(([key,value_json])=>({key,value_json,updated_at:Date.now()}))};
     if(sql.startsWith("SELECT action,summary"))
       return {results:db.events.map(x=>({...x}))};
     throw Error("Unexpected all query "+sql);
    },
    async run(){
     if(sql.startsWith("INSERT INTO bushin_tasks")){
       db.tasks.set(params[0],{id:params[0],owner_id:params[1],title:params[2],status:params[5],updated_at:params[7]});
     }else if(sql.startsWith("UPDATE bushin_tasks SET")){
       const t=db.tasks.get(params[3]);assert.equal(t.owner_id,params[4]);t.status=params[0];t.updated_at=params[1];
     }else if(sql.startsWith("INSERT INTO bushin_events")){
       db.events.push({action:params[2],summary:params[3],created_at:params[4]});
     }else if(sql.startsWith("INSERT INTO bushin_project_state")){
       db.mem.set(params[1],params[2]);
     }else throw Error("Unexpected run query "+sql);
     return {success:true};
    }
   };
  }};
 }
}
function instance(){
 const db=new MobileD1();
 const env={PUBLIC_BASE_URL:base,DB:db,DISCORD_CLIENT_SECRET:"nonlive-test-only",
  ENCRYPTION_KEY_BASE64:"nonlive-test-only",BUSHIN_OWNER_DISCORD_ID:id};
 const req=(path,options={})=>worker.fetch(new Request(base+path,{
   headers:{cookie:"__Host-bushin_mobile="+cookieToken,...(options.headers||{})},
   ...options
 }),env);
 return {env,db,req};
}
const form=(data,origin=base)=>({
 method:"POST",headers:{"origin":origin,"content-type":"application/x-www-form-urlencoded"},
 body:new URLSearchParams(data)
});
test("Browser-only workspace requires the existing owner cookie",async()=>{
 const {env}=instance();
 const res=await worker.fetch(new Request(base+"/mobile/workspace"),env);
 assert.equal(res.status,303);
 assert.equal(res.headers.get("location"),"/mobile");
});
test("Owner can render dashboard, create task, pause/resume and save progress",async()=>{
 const {req,db}=instance();
 const home=await req("/mobile/workspace");
 assert.equal(home.status,200);
 assert.match(await home.text(),/Nova tarefa Naruto RP/);
 assert.equal(home.headers.get("cache-control"),"no-store");
 const created=await req("/mobile/workspace",form({op:"create",title:"Treinar com meu time",description:"Planejamento"}));
 assert.equal(created.status,200);
 assert.match(await created.text(),/Treinar com meu time/);
 assert.equal(db.tasks.size,1);
 const taskId=[...db.tasks.keys()][0];
 assert.match(taskId,/^task_[a-f0-9]{32}$/);
 const paused=await req("/mobile/workspace",form({op:"task_pause",task_id:taskId}));
 assert.equal(paused.status,200);
 assert.match(await paused.text(),/paused/);
 const resumed=await req("/mobile/workspace",form({op:"task_resume",task_id:taskId}));
 assert.equal(resumed.status,200);
 assert.match(await resumed.text(),/planned/);
 const saved=await req("/mobile/workspace",form({op:"state_save",key:"naruto_progress",value:"Genin, buscando equipe"}));
 assert.equal(saved.status,200);
 assert.match(await saved.text(),/Genin, buscando equipe/);
 assert.equal(JSON.parse(db.mem.get("naruto_progress")),"Genin, buscando equipe");
 assert.ok(db.events.length>=4);
});
test("Cross-origin CSRF, unauthenticated task posts and unknown actions are denied",async()=>{
 const {req,db,env}=instance();
 const hostile=await req("/mobile/workspace",form({op:"create",title:"Pwned"}, "https://attacker.test"));
 assert.equal(hostile.status,403);
 assert.equal(db.tasks.size,0);
 const bad=await req("/mobile/workspace",form({op:"unexpected"}));
 assert.equal(bad.status,400);
 const noCookie=await worker.fetch(new Request(base+"/mobile/workspace",form({op:"create",title:"Pwned"})),env);
 assert.equal(noCookie.status,303);
 assert.equal(db.tasks.size,0);
});
test("Notes cannot inject HTML and the servers page needs authentication",async()=>{
 const {req,env}=instance();
 const result=await req("/mobile/workspace",form({op:"create",title:"<script>alert(1)</script>"}));
 const html=await result.text();
 assert.ok(!html.includes("<script>alert(1)</script>"));
 assert.ok(html.includes("&lt;script&gt;"));
 const noAuth=await worker.fetch(new Request(base+"/mobile/servers"),env);
 assert.equal(noAuth.status,303);
});
