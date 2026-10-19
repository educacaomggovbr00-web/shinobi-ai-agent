import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";

const base="https://bushin-logout-ci.workers.dev";
const owner="123456789012345678";
const token="Z".repeat(52);
const tokenHash=createHash("sha256").update(token).digest("base64url");
const cookie="__Host-bushin_mobile="+token;
function envAndDatabase(){
  const deleted=[];
  const env={
    PUBLIC_BASE_URL:base,DISCORD_CLIENT_SECRET:"fake-for-ci",
    ENCRYPTION_KEY_BASE64:"fake-for-ci",BUSHIN_OWNER_DISCORD_ID:owner,
    DB:{
      prepare(sql){
        assert.equal(sql,"DELETE FROM mobile_user_sessions WHERE token_hash=?");
        return {bind(value){
          assert.equal(value,tokenHash);
          return {run:async()=>{deleted.push(value);return {success:true}}};
        }};
      }
    }
  };
  return {env,deleted};
}
function request(headers={}){
  return new Request(base+"/mobile/logout",{
    method:"POST",headers:{"cookie":cookie,...headers}
  });
}
test("Logout accepts browser Origin exactly and clears just the owner's mobile session",async()=>{
  const {env,deleted}=envAndDatabase();
  const result=await worker.fetch(request({origin:base}),env);
  assert.equal(result.status,303);
  assert.equal(result.headers.get("location"),"/mobile");
  assert.match(result.headers.get("set-cookie")||"",/__Host-bushin_mobile=;/);
  assert.equal(deleted.length,1);
});
test("Logout works on Android when Origin is omitted but Referer is same-origin",async()=>{
  const {env,deleted}=envAndDatabase();
  const result=await worker.fetch(request({referer:base+"/mobile"}),env);
  assert.equal(result.status,303);
  assert.equal(deleted.length,1);
});
test("Logout rejects cross-origin Referer, mismatched Origin and missing origin proof",async()=>{
  const cases=[
    {referer:"https://evil.example/mobile"},
    {origin:"https://evil.example",referer:base+"/mobile"},
    {referer:"not a URL"},
    {}
  ];
  for(const headers of cases){
    const {env,deleted}=envAndDatabase();
    const result=await worker.fetch(request(headers),env);
    assert.equal(result.status,403,JSON.stringify(headers));
    assert.equal(deleted.length,0);
    assert.equal(result.headers.get("set-cookie"),null);
  }
});
test("Logout with an empty mobile cookie does not change unrelated sessions",async()=>{
  const {env,deleted}=envAndDatabase();
  const result=await worker.fetch(new Request(base+"/mobile/logout",{method:"POST",headers:{origin:base}}),env);
  assert.equal(result.status,303);
  assert.equal(deleted.length,0);
});

test("Mobile portal allows only same-origin Referer so Android forms can pass CSRF validation",async()=>{
  const {env}=envAndDatabase();
  const response=await worker.fetch(new Request(base+"/mobile"),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("referrer-policy"),"same-origin");
  assert.match(response.headers.get("content-security-policy")||"",/form-action 'self'/);
});
