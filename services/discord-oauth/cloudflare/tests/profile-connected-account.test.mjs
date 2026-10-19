import test from "node:test";
import assert from "node:assert/strict";
import worker, {discordProfileData} from "../src/worker.mjs";

const BASE = "https://bushin.example.workers.dev";
const env = {
  PUBLIC_BASE_URL: BASE,
  DB: {prepare(){return {}}},
  DISCORD_CLIENT_SECRET:"nonproduction-only-secret",
  ENCRYPTION_KEY_BASE64:"AAAA",
  BUSHIN_OWNER_DISCORD_ID:"123456789012345678"
};
test("A ChatGPT profile tool is advertised as an OAuth-only read operation", async ()=>{
  const response = await worker.fetch(new Request(BASE+"/mcp",{
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0", id:4, method:"tools/list",params:{}})
  }),env);
  assert.equal(response.status,200);
  const data=await response.json();
  const profiles=data.result.tools.filter(t=>t._meta?.["openai/profile"]===true);
  assert.equal(profiles.length,1,"Exactly one tool is the profile identity source");
  const tool=profiles[0];
  assert.equal(tool.name,"bushin_discord_profile");
  assert.deepEqual(tool.inputSchema.required||[],[]);
  assert.deepEqual(tool.securitySchemes,[{type:"oauth2",scopes:["identify","guilds","guilds.members.read"]}]);
  assert.equal(tool.annotations.readOnlyHint,true);
  assert.equal(tool.outputSchema.type,"object");
  assert.deepEqual(tool.outputSchema.required,["id"]);
  assert.equal(tool.outputSchema.additionalProperties,false);
  assert.equal(tool.outputSchema.properties.id.type,"string");
  assert.equal(tool.outputSchema.properties.nickname.type,"string");
});
test("Native account identity requires OAuth bearer; mobile cookie alone cannot call it",async()=>{
  const response=await worker.fetch(new Request(BASE+"/mcp",{
    method:"POST", headers:{"content-type":"application/json","cookie":"__Host-bushin_mobile=not-a-bearer"},
    body:JSON.stringify({jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"bushin_discord_profile",arguments:{}}})
  }),env);
  assert.equal(response.status,401);
  assert.match(response.headers.get("www-authenticate")||"",/oauth-protected-resource/);
});
test("Profile identity is stable across names and includes no credentials",()=>{
 const a=discordProfileData({id:"123456789012345678",username:"angel_10706",display_name:"Henrique"});
 const b=discordProfileData({id:"123456789012345678",username:"angel_renamed",display_name:"Updated"});
 assert.deepEqual(a,{id:"123456789012345678",name:"Henrique",nickname:"@angel_10706"});
 assert.equal(a.id,b.id);
 assert.equal(a.email,undefined);
 assert.equal(a.token,undefined);
 assert.throws(()=>discordProfileData({id:""}),/profile ID/);
 assert.throws(()=>discordProfileData({id:"other"}),/profile ID/);
});
