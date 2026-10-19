import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker,{allowedRedirect,validScope,pkceVerify,classifyDiscordTokenFailure,personalCommandsConsentUrl} from "../src/worker.mjs";

test("Only ChatGPT official callback paths accepted",()=>{
  assert.equal(allowedRedirect("https://chatgpt.com/connector_platform_oauth_redirect"),true);
  assert.equal(allowedRedirect("https://chatgpt.com/connector/oauth/abcd1234"),true);
  for(const value of [
    "https://evil.example/connector_platform_oauth_redirect",
    "http://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com.evil.example/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector_platform_oauth_redirect?token=1",
    "https://discord.com/login",
    "https://chatgpt.com/share/abc"
  ]) assert.equal(allowedRedirect(value),false,value);
});
test("Scopes strictly limited to identify, guilds, guilds.members.read",()=>{
  assert.equal(validScope("identify guilds guilds.members.read"),true);
  assert.equal(validScope("guilds.members.read identify guilds"),true);
  for(const item of ["identify guilds","identify guilds bot",
    "identify guilds messages.read","identify guilds guilds.join",
    "identify guilds email","identify guilds guilds.members.read administrator"])
    assert.equal(validScope(item),false,item);
});
test("PKCE rejects plain or mismatched challenges",async()=>{
  const verifier="v".repeat(50);
  const challenge=createHash("sha256").update(verifier).digest("base64url");
  assert.equal(await pkceVerify(verifier,challenge),true);
  assert.equal(await pkceVerify("w".repeat(50),challenge),false);
  assert.equal(await pkceVerify("short",challenge),false);
  assert.equal(await pkceVerify(verifier,"BAD"),false);
});
test("Worker refuses a fake host and does not claim login",async()=>{
  const req=new Request("https://bad.example/health");
  const env={PUBLIC_BASE_URL:"https://bushin-owner.workers.dev"};
  const res=await worker.fetch(req,env);
  assert.equal(res.status,403);
  const health=await worker.fetch(new Request("https://bushin-owner.workers.dev/health"),env);
  assert.equal(health.status,200);
  const data=await health.json();
  assert.equal(data.connected,false);
  assert.equal(data.login_required,true);
  assert.equal(data.no_github_dependency,true);
  assert.equal(data.configuration_ready,false);
});
test("Without secrets, registration and OAuth endpoints refuse to authenticate",async()=>{
 const env={PUBLIC_BASE_URL:"https://bushin-owner.workers.dev"};
 const base="https://bushin-owner.workers.dev";
 const reg=await worker.fetch(new Request(base+"/oauth/register",{method:"POST",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({redirect_uris:["https://chatgpt.com/connector_platform_oauth_redirect"]})
 }),env);
 assert.equal(reg.status,500);
 const as=await worker.fetch(new Request(base+"/.well-known/oauth-authorization-server"),env);
 assert.equal(as.status,500);
});

test("Discord OAuth diagnostics never disclose secrets or provider descriptions",()=>{
 const cases=[
   [401,"invalid_client","discord_invalid_client"],
   [400,"invalid_grant","discord_invalid_grant"],
   [400,"invalid_request","discord_invalid_request"],
   [400,"invalid_scope","discord_invalid_scope"],
   [401,"secret-or-auth-header-was-incorrect","discord_invalid_client"],
   [429,"rate_limited","discord_rate_limited"],
   [500,"internal_server_error","discord_unavailable"],
   [400,"raw-secret-or-customer-token-should-never-be-shown","discord_auth"]
 ];
 for(const [status,provider,expected] of cases){
   const category=classifyDiscordTokenFailure(status,provider);
   assert.equal(category,expected);
   assert.match(category,/^discord_[a-z_]+$/);
   assert.ok(!category.includes("secret-or-auth-header"));
   assert.ok(!category.includes("raw-secret-or-customer-token"));
 }
});

test("Personal OAuth commands install is user-scoped and does not request guild administrator or messages",()=>{
 const consent=new URL(personalCommandsConsentUrl());
 assert.equal(consent.origin,"https://discord.com");
 assert.equal(consent.pathname,"/oauth2/authorize");
 assert.equal(consent.searchParams.get("client_id"),"1561589128108314636");
 assert.equal(consent.searchParams.get("scope"),"applications.commands");
 assert.equal(consent.searchParams.get("integration_type"),"1");
 assert.equal(consent.searchParams.has("permissions"),false);
 assert.equal(consent.searchParams.has("guild_id"),false);
 assert.equal(consent.searchParams.has("redirect_uri"),false);
 assert.equal(consent.searchParams.has("client_secret"),false);
});
test("Personal commands consent requires existing mobile session, preserving original login",async()=>{
 const base="https://bushin-owner.workers.dev";
 const env={PUBLIC_BASE_URL:base,DISCORD_CLIENT_SECRET:"fake-ci-only",ENCRYPTION_KEY_BASE64:"fake-ci-only",BUSHIN_OWNER_DISCORD_ID:"123456789012345678",DB:{prepare(){throw Error("Must not query D1 without a session cookie")}}};
 const denied=await worker.fetch(new Request(base+"/mobile/commands"),env);
 assert.equal(denied.status,303);
 assert.equal(denied.headers.get("location"),"/mobile");
 assert.equal(denied.headers.get("set-cookie"),null);
});

test("Only an authenticated mobile session can start the personal command install",async()=>{
 const base="https://bushin-owner.workers.dev";
 const token="a".repeat(52);
 const hash=createHash("sha256").update(token).digest("base64url");
 const env={
   PUBLIC_BASE_URL:base,DISCORD_CLIENT_SECRET:"fake-ci-only",
   ENCRYPTION_KEY_BASE64:"fake-ci-only",BUSHIN_OWNER_DISCORD_ID:"123456789012345678",
   DB:{prepare(sql){
     assert.match(sql,/FROM mobile_user_sessions/);
     return {bind(...args){
       assert.equal(args[0],hash);
       return {first:async()=>({user_id:"123456789012345678"})};
     }};
   }}
 };
 const consent=await worker.fetch(new Request(base+"/mobile/commands/start",{
   headers:{cookie:"__Host-bushin_mobile="+token}
 }),env);
 assert.equal(consent.status,303);
 const u=new URL(consent.headers.get("location"));
 assert.equal(u.host,"discord.com");
 assert.equal(u.searchParams.get("scope"),"applications.commands");
 assert.equal(u.searchParams.get("integration_type"),"1");
 assert.equal(consent.headers.get("set-cookie"),null);
});

test("Opening the MCP endpoint in Android/browser explains the API instead of returning Not Found",async()=>{
 const base="https://bushin-owner.workers.dev";
 const env={PUBLIC_BASE_URL:base};
 for(const url of [base+"/mcp",base+"/mcp?utm_source=chatgpt.com"]){
   const response=await worker.fetch(new Request(url,{headers:{accept:"text/html,application/xhtml+xml"}}),env);
   assert.equal(response.status,200,url);
   assert.match(response.headers.get("content-type")||"",/text\/html/);
   assert.equal(response.headers.get("cache-control"),"no-store");
   const html=await response.text();
   assert.match(html,/API para clientes MCP/);
   assert.match(html,/plugin Bushin precisa estar instalado/);
   assert.match(html,/href="\/mobile"/);
   assert.equal(html.includes("Not found"),false);
 }
});
test("Machine GET on MCP returns 405 and POST remains the advertised RPC method",async()=>{
 const base="https://bushin-owner.workers.dev";
 const env={PUBLIC_BASE_URL:base};
 const response=await worker.fetch(new Request(base+"/mcp",{headers:{accept:"text/event-stream"}}),env);
 assert.equal(response.status,405);
 assert.equal(response.headers.get("allow"),"POST");
 assert.deepEqual((await response.json()).error,"MCP requires POST");
});


test("Bushin diagnostics verify the real OAuth application without exposing its bearer token",async t=>{
 const base="https://bushin-owner.workers.dev";
 const session="s".repeat(52), owner="123456789012345678";
 const encryptionKey=new Uint8Array(32).fill(16);
 const imported=await crypto.subtle.importKey("raw",encryptionKey,"AES-GCM",false,["encrypt"]);
 const iv=new Uint8Array(12).fill(4);
 const access="do-not-ever-display-mock-bearer-token";
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},imported,
   new TextEncoder().encode(JSON.stringify({access,refresh:"fake-refresh",expires:Date.now()+2400000}))));
 const encrypted=Buffer.from(iv).toString("base64url")+"."+Buffer.from(ciphertext).toString("base64url");
 const hash=createHash("sha256").update(session).digest("base64url");
 const env={
   PUBLIC_BASE_URL:base,DISCORD_CLIENT_SECRET:"mock-only",ENCRYPTION_KEY_BASE64:Buffer.from(encryptionKey).toString("base64"),
   BUSHIN_OWNER_DISCORD_ID:owner,DB:{prepare(sql){
     assert.match(sql,/mobile_user_sessions/);
     return {bind(value){assert.equal(value,hash);return {first:async()=>({user_id:owner,creds_encrypted:encrypted})}}};
   }}
 };
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original});
 globalThis.fetch=async (url,options)=>{
   assert.equal(String(url),"https://discord.com/api/v10/oauth2/@me");
   assert.equal(options.headers.authorization,"Bearer "+access);
   return Response.json({application:{id:"1561589128108314636",name:"Bushin OAuth Test"},user:{id:owner},scopes:["identify"]});
 };
 const req=new Request(base+"/mobile/commands",{headers:{cookie:"__Host-bushin_mobile="+session}});
 const res=await worker.fetch(req,env);
 assert.equal(res.status,200);
 const page=await res.text();
 assert.match(page,/Bushin OAuth Test/);
 assert.match(page,/User Install/);
 assert.match(page,/applications.commands/);
 assert.match(page,/\/mobile\/commands\/start/);
 assert.match(page,/1561589128108314636/);
 assert.doesNotMatch(page,/do-not-ever-display-mock-bearer-token/);
 assert.equal(res.headers.get("cache-control"),"no-store");
 globalThis.fetch=async()=>Response.json({application:{id:"123123123123123123",name:"Other App"},user:{id:owner},scopes:["identify"]});
 const mismatch=await worker.fetch(req,env);
 assert.equal(mismatch.status,200);
 const warning=await mismatch.text();
 assert.match(warning,/ATENÇÃO/);
 assert.doesNotMatch(warning,/href="\/mobile\/commands\/start"/);
});
test("Bushin user-install diagnostics are private; expired or malformed credentials are not exposed",async()=>{
 const base="https://bushin-owner.workers.dev",session="a".repeat(52);
 const hashed=createHash("sha256").update(session).digest("base64url");
 const env={
   PUBLIC_BASE_URL:base,DISCORD_CLIENT_SECRET:"mock-only",ENCRYPTION_KEY_BASE64:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
   BUSHIN_OWNER_DISCORD_ID:"123456789012345678",
   DB:{prepare(){return {bind(h){assert.equal(h,hashed);return {first:async()=>({
     user_id:"123456789012345678",creds_encrypted:"never-expose-this-encrypted-text"
   })}}}}}
 };
 const notLogged=await worker.fetch(new Request(base+"/mobile/commands"),env);
 assert.equal(notLogged.status,303);
 assert.equal(notLogged.headers.get("location"),"/mobile");
 const diag=await worker.fetch(new Request(base+"/mobile/commands",{
   headers:{cookie:"__Host-bushin_mobile="+session}
 }),env);
 assert.equal(diag.status,200);
 const html=await diag.text();
 assert.match(html,/Não foi possível verificar/);
 assert.doesNotMatch(html,/never-expose-this-encrypted-text/);
 assert.doesNotMatch(html,/href="\/mobile\/commands\/start"/);
});
