import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";

const BASE="https://bushin-test-account.workers.dev";
const USER="123456789012345678",BOT="987654321098765432";
const COOKIE="a".repeat(52), HASH=createHash("sha256").update(COOKIE).digest("base64url");
const sessionHeader={cookie:"__Host-bushin_mobile="+COOKIE};
function environment({withBot=false,attemptsMinute=0,attemptsDay=0}={}){
 const events=[];
 const env={
  PUBLIC_BASE_URL:BASE,DISCORD_CLIENT_SECRET:"TEST-ONLY-CLIENT-SECRET",
  ENCRYPTION_KEY_BASE64:"TEST-ONLY-ENCRYPTION",BUSHIN_OWNER_DISCORD_ID:USER,
  ...(withBot?{DISCORD_BOT_TOKEN:"test_fake_bot_token_1234567890_qwertyuiop_12345"}:{}),
  DB:{prepare(sql){
   return {bind(...params){
    return {
     async first(){
      if(sql.startsWith("SELECT user_id,creds_encrypted FROM mobile_user_sessions")){
        assert.equal(params[0],HASH);
        return {user_id:USER,creds_encrypted:"test"};
      }
      if(sql.startsWith("SELECT COUNT(*) AS n FROM bushin_events")){
        assert.equal(params[0],USER);
        return {n:params[1]>Date.now()-80000?attemptsMinute:attemptsDay};
      }
      throw Error("Unexpected SQL first: "+sql);
     },
     async run(){
      if(!sql.startsWith("INSERT INTO bushin_events"))throw Error("Unexpected D1 insert "+sql);
      events.push({owner:params[0],task_id:params[1],action:params[2],summary:params[3]});
      return {success:true};
     }
    };
   }};
  }}
 };
 return {env,events};
}
function request(path,options={}){return new Request(BASE+path,options);}
test("Mobile DM requires owner login; landing page never sends anything",async t=>{
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old});
 globalThis.fetch=()=>{throw Error("No Discord call is allowed before login");};
 const {env,events}=environment();
 const a=await worker.fetch(request("/mobile/dm"),env);
 assert.equal(a.status,303);
 assert.equal(a.headers.get("location"),"/mobile");
 const b=await worker.fetch(request("/mobile/dm",{headers:sessionHeader}),env);
 assert.equal(b.status,200);
 const html=await b.text();
 assert.match(html,/Bot oficial ainda não configurado/);
 assert.match(html,/DISCORD_BOT_TOKEN/);
 assert.doesNotMatch(html,/Enviar uma DM de teste/);
 assert.equal(events.length,0);
});
test("Mobile DM POST needs same-origin confirmation and rejects missing Bot Token",async()=>{
 const {env,events}=environment();
 const p=new URLSearchParams({op:"send_test",message:"Olá!",confirmed:"yes"}).toString();
 const bad=await worker.fetch(request("/mobile/dm",{
  method:"POST",headers:{...sessionHeader,"content-type":"application/x-www-form-urlencoded",origin:"https://evil.invalid"},body:p
 }),env);
 assert.equal(bad.status,403);
 const noCheck=await worker.fetch(request("/mobile/dm",{
  method:"POST",headers:{...sessionHeader,"content-type":"application/x-www-form-urlencoded",origin:BASE},
  body:new URLSearchParams({op:"send_test",message:"Olá!"})
 }),env);
 assert.equal(noCheck.status,400);
 const noToken=await worker.fetch(request("/mobile/dm",{
  method:"POST",headers:{...sessionHeader,"content-type":"application/x-www-form-urlencoded",origin:BASE},body:p
 }),env);
 assert.equal(noToken.status,303);
 assert.equal(noToken.headers.get("location"),"/mobile/dm?result=not_configured");
 assert.equal(events.length,0);
});
test("A confirmed bot DM is sent only to verified owner, with mentions disabled; no content in D1",async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous});
 const {env,events}=environment({withBot:true});
 const calls=[];
 globalThis.fetch=async (url,opt={})=>{
  calls.push({url:String(url),method:opt.method||"GET",body:opt.body||""});
  assert.equal(opt.headers.authorization,"Bot "+env.DISCORD_BOT_TOKEN);
  if(String(url).endsWith("/users/@me")&&(!opt.method||opt.method==="GET"))
   return Response.json({id:BOT,bot:true,username:"Bushin"});
  if(String(url).endsWith("/users/@me/channels")){
   const data=JSON.parse(opt.body);
   assert.deepEqual(data,{recipient_id:USER});
   return Response.json({id:"222222222222222222",type:1});
  }
  if(String(url).endsWith("/channels/222222222222222222/messages")){
   const msg=JSON.parse(opt.body);
   assert.equal(msg.content,"Teste privado do Bushin");
   assert.deepEqual(msg.allowed_mentions,{parse:[]});
   return Response.json({id:"333333333333333333"});
  }
  throw Error("Unexpected Discord endpoint "+url);
 };
 const post=await worker.fetch(request("/mobile/dm",{
  method:"POST",headers:{...sessionHeader,"content-type":"application/x-www-form-urlencoded",origin:BASE},
  body:new URLSearchParams({op:"send_test",message:"Teste privado do Bushin",confirmed:"yes"}).toString()
 }),env);
 assert.equal(post.status,303);
 assert.equal(post.headers.get("location"),"/mobile/dm?result=sent");
 assert.equal(calls.length,3);
 assert.deepEqual(events.map(x=>x.action),["mobile_dm_attempt","mobile_dm_sent"]);
 assert.equal(JSON.stringify(events).includes("Teste privado"),false);
 assert.equal(JSON.stringify(events).includes(env.DISCORD_BOT_TOKEN),false);
});
test("DM is not retried when rate limit reached",async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous});
 globalThis.fetch=()=>{throw Error("Rate-limited DM must not call Discord");};
 const {env,events}=environment({withBot:true,attemptsMinute:1});
 const res=await worker.fetch(request("/mobile/dm",{
  method:"POST",headers:{...sessionHeader,"content-type":"application/x-www-form-urlencoded",origin:BASE},
  body:new URLSearchParams({op:"send_test",message:"Teste",confirmed:"yes"})
 }),env);
 assert.equal(res.status,303);
 assert.equal(res.headers.get("location"),"/mobile/dm?result=rate_limited");
 assert.equal(events.length,0);
});
