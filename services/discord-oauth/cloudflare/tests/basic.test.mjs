import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker,{allowedRedirect,validScope,pkceVerify} from "../src/worker.mjs";

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
