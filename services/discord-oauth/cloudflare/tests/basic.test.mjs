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
 const consent=await worker.fetch(new Request(base+"/mobile/commands",{
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
