import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import worker from "../src/worker.mjs";

class FakeD1 {
  constructor(){this.tables=Object.fromEntries(["oauth_clients","oauth_flows","oauth_codes","oauth_access","oauth_refresh"].map(t=>[t,new Map()]));}
  prepare(sql) {
    const db=this;
    return {bind(...params){
      const table=sql.match(/(?:INTO|FROM)\s+(oauth_\w+)/)?.[1];
      if(!table)throw Error("Unrecognized SQL "+sql);
      const rows=db.tables[table];
      const columns=sql.match(/\(([\w_, ]+)\)\s+VALUES\s*\(/i)?.[1]?.replace(/\s+/g,"").split(",")||[];
      const key=columns[0]|| (table==="oauth_clients"?"id":table==="oauth_flows"?"state_hash":table==="oauth_codes"?"code_hash":"token_hash");
      const query=()=>{
        if(sql.startsWith("INSERT")){
          const row=Object.fromEntries(columns.map((c,i)=>[c,params[i]]));
          if(rows.has(row[key]))throw Error("Duplicate D1 key");
          rows.set(row[key],row);return row;
        }
        if(sql.startsWith("SELECT COUNT")){
          return {total:rows.size};
        }
        if(sql.startsWith("SELECT")||sql.startsWith("DELETE")){
          const found=rows.get(params[0]);
          const valid=found && (!sql.includes("expires_at>?")||found.expires_at>params[1]);
          if(!valid)return null;
          if(sql.startsWith("DELETE"))rows.delete(params[0]);
          return {...found};
        }
        throw Error("Unknown SQL "+sql);
      };
      return {first:async()=>query(),run:async()=>({success:true,results:[query()]})};
    }};
  }
  async batch(statements) {
    for(const s of statements)await s.run();
    return statements.map(()=>({success:true}));
  }
}

const origin="https://bushin-test-account.workers.dev";
const env={
  DB:new FakeD1(),
  PUBLIC_BASE_URL:origin,
  DISCORD_CLIENT_SECRET:"fake-not-live-secret-for-ci-only",
  BUSHIN_OWNER_DISCORD_ID:"123456789012345678",
  ENCRYPTION_KEY_BASE64:Buffer.alloc(32,37).toString("base64")
};
const scopes="identify guilds guilds.members.read";
const callback="https://chatgpt.com/connector_platform_oauth_redirect";
const verifier="s".repeat(50);
const codeChallenge=createHash("sha256").update(verifier).digest("base64url");
const nativeFetch=globalThis.fetch;
let providerCalls=[];
function mockDiscordFetch(input,options){
  const u=String(input);
  if(u.startsWith("https://discord.com/api/v10/")){
    providerCalls.push({url:u,method:options?.method||"GET"});
    if(u.endsWith("/oauth2/token")){
      const form=options.body;
      assert.equal(options.method,"POST");
      assert.equal(options.headers.authorization,undefined);
      assert.ok(form instanceof URLSearchParams);
      assert.equal(form.get("client_id"),"1561589128108314636");
      assert.equal(form.get("client_secret"),env.DISCORD_CLIENT_SECRET);
      assert.equal(options.headers["content-type"],"application/x-www-form-urlencoded");
      const source=form.get("grant_type");
      assert.ok(["authorization_code","refresh_token"].includes(source));
      return Promise.resolve(new Response(JSON.stringify({
        access_token:"fake-discord-access-only-inside-worker-ci",
        refresh_token:"fake-discord-refresh-only-inside-worker-ci",
        expires_in:1800,scope:scopes
      }),{status:200,headers:{"content-type":"application/json"}}));
    }
    if(u.endsWith("/users/@me")){
      return Promise.resolve(Response.json({id:env.BUSHIN_OWNER_DISCORD_ID,
        username:"test_ninja",global_name:"Ninja",email:"hidden@example.com"}));
    }
    if(u.endsWith("/users/@me/guilds/1515877468299595919/member")){
      return Promise.resolve(Response.json({nick:"Genin",roles:["role1","role2"]}));
    }
    throw Error("External Discord endpoint outside allowlist "+u);
  }
  return nativeFetch(input,options);
}
async function request(path,options={}){
  return worker.fetch(new Request(origin+path,options),env);
}
function form(data){return {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(data)};}
async function begin(clientId,state){
  const u=new URL(origin+"/oauth/authorize");
  for(const [k,v] of Object.entries({
    client_id:clientId,redirect_uri:callback,response_type:"code",
    code_challenge:codeChallenge,code_challenge_method:"S256",
    state,resource:origin+"/mcp",scope:scopes
  }))u.searchParams.set(k,v);
  const res=await request(u.pathname+u.search);
  assert.equal(res.status,302);
  const discord=new URL(res.headers.get("location"));
  assert.equal(discord.hostname,"discord.com");
  assert.equal(discord.searchParams.get("client_id"),"1561589128108314636");
  assert.equal(discord.searchParams.get("redirect_uri"),origin+"/oauth/discord/callback");
  return discord.searchParams.get("state");
}
test("Cloudflare D1 supports a full simulated Discord OAuth + MCP login",async()=>{
  globalThis.fetch=mockDiscordFetch;
  try{
    const status=await request("/health");
    assert.equal((await status.json()).configuration_ready,true);
    const as=await request("/.well-known/oauth-authorization-server");
    const meta=await as.json();
    assert.equal(meta.issuer,origin);
    assert.deepEqual(meta.code_challenge_methods_supported,["S256"]);
    const authResource=await request("/.well-known/oauth-protected-resource");
    assert.deepEqual((await authResource.json()).authorization_servers,[origin]);

    const badReg=await request("/oauth/register",{method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({redirect_uris:["https://attacker.example/callback"]})});
    assert.equal(badReg.status,400);
    const goodReg=await request("/oauth/register",{method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({redirect_uris:[callback],token_endpoint_auth_method:"none"})});
    assert.equal(goodReg.status,201);
    const registered=await goodReg.json();
    const dState=await begin(registered.client_id,"my-client-CSRF-state-123");
    const cb=await request("/oauth/discord/callback?"+new URLSearchParams({
      code:"discord-code-test-only",state:dState,iss:"https://discord.com"
    }).toString());
    assert.equal(cb.status,302);
    const authRedirect=new URL(cb.headers.get("location"));
    assert.equal(authRedirect.hostname,"chatgpt.com");
    assert.equal(authRedirect.searchParams.get("state"),"my-client-CSRF-state-123");
    const code=authRedirect.searchParams.get("code");
    assert.ok(code && code.length>20);
    assert.equal(String(cb.headers.get("location")).includes("fake-discord-access"),false);
    assert.equal(env.DB.tables.oauth_flows.size,0);
    const replay=await request("/oauth/discord/callback?"+new URLSearchParams({
      code:"discord-code-test-only",state:dState}).toString());
    assert.equal(replay.status,400);

    const wrongCode=await request("/oauth/token",form({
      client_id:registered.client_id,grant_type:"authorization_code",
      code,redirect_uri:callback,code_verifier:"z".repeat(50),resource:origin+"/mcp"
    }));
    assert.equal(wrongCode.status,400);
    const reused=await request("/oauth/token",form({
      client_id:registered.client_id,grant_type:"authorization_code",
      code,redirect_uri:callback,code_verifier:verifier,resource:origin+"/mcp"
    }));
    assert.equal(reused.status,400);

    const dState2=await begin(registered.client_id,"my-client-CSRF-state-456");
    const cb2=await request("/oauth/discord/callback?"+new URLSearchParams({
      code:"discord-code-second-test",state:dState2}).toString());
    const finalCode=new URL(cb2.headers.get("location")).searchParams.get("code");
    assert.ok(finalCode);

    const tokenResp=await request("/oauth/token",form({
      client_id:registered.client_id,grant_type:"authorization_code",
      code:finalCode,redirect_uri:callback,code_verifier:verifier,resource:origin+"/mcp"
    }));
    assert.equal(tokenResp.status,200);
    const tokens=await tokenResp.json();
    assert.equal(tokens.token_type,"Bearer");
    assert.ok(tokens.refresh_token);
    assert.ok(!JSON.stringify(tokens).includes("fake-discord"));

    const stored=Array.from(env.DB.tables.oauth_access.values())[0];
    assert.ok(stored.creds_encrypted.includes("."));
    assert.equal(stored.creds_encrypted.includes("fake-discord-access"),false);
    assert.equal(stored.token_hash===tokens.access_token,false);

    const call={jsonrpc:"2.0",id:3,method:"tools/call",
      params:{name:"bushin_discord_whoami",arguments:{}}};
    const noAuth=await request("/mcp",{method:"POST",
      headers:{"content-type":"application/json"},body:JSON.stringify(call)});
    assert.equal(noAuth.status,401);
    assert.match(noAuth.headers.get("www-authenticate"),/resource_metadata/);

    const authCall=async(name)=>{
      const r=await request("/mcp",{method:"POST",
        headers:{"content-type":"application/json",authorization:"Bearer "+tokens.access_token},
        body:JSON.stringify({...call,params:{name,arguments:{}}})});
      assert.equal(r.status,200);
      return (await r.json()).result.structuredContent;
    };
    const who=await authCall("bushin_discord_whoami");
    assert.equal(who.username,"test_ninja");
    assert.equal(JSON.stringify(who).includes("hidden@example.com"),false);
    const member=await authCall("bushin_discord_naruto_membership");
    assert.equal(member.member,true);
    assert.equal(member.guild_id,"1515877468299595919");
    assert.equal(member.roles_count,2);

    const rt=await request("/oauth/token",form({
      client_id:registered.client_id,grant_type:"refresh_token",
      refresh_token:tokens.refresh_token,resource:origin+"/mcp"
    }));
    assert.equal(rt.status,200);
    const rotated=await rt.json();
    assert.notEqual(rotated.refresh_token,tokens.refresh_token);
    const oldRefresh=await request("/oauth/token",form({
      client_id:registered.client_id,grant_type:"refresh_token",
      refresh_token:tokens.refresh_token,resource:origin+"/mcp"
    }));
    assert.equal(oldRefresh.status,400);
    assert.ok(providerCalls.some(x=>x.url.endsWith("/users/@me")));
  }finally{globalThis.fetch=nativeFetch;}
});
