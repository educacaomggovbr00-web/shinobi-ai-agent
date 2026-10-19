import test from "node:test";
import assert from "node:assert/strict";
import {BROWSER_TOOLS,browserCall} from "../src/browser-bridge.mjs";

test("Bridge is visible but disabled until the owner's Cloudflare secret is configured", async () => {
  assert.deepEqual(BROWSER_TOOLS.map(t=>t.name),[
    "bushin_browser_status","bushin_browser_action","bushin_browser_result"
  ]);
  const r=await browserCall({},"bushin_browser_status");
  assert.equal(r.configured,false);
  assert.equal(r.connected,false);
});

test("Bridge never writes without an active, main-branch GitHub visual session", async t => {
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=async uri => {
    assert.match(uri.toString(),/actions\/workflows\/bushin-discord-live.yml\/runs/);
    return new Response(JSON.stringify({workflow_runs:[]}),{status:200});
  };
  const env={BUSHIN_GITHUB_TOKEN:"fake-test-token-placeholder-123456"};
  const r=await browserCall(env,"bushin_browser_action",{action:"status"});
  assert.equal(r.state,"unavailable");
});

test("Bridge rejects posting and sensitive interaction before calling GitHub", async t => {
  const original=globalThis.fetch; let requested=false;
  t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=async uri => {
    requested=true;
    return new Response(JSON.stringify({workflow_runs:[{id:12345678901,status:"in_progress",head_branch:"main"}]}));
  };
  const env={BUSHIN_GITHUB_TOKEN:"fake-test-token-placeholder-123456"};
  for(const args of [
    {action:"send_message",text:"oi"},
    {action:"open_url",url:"https://discord.com/channels/@me"},
    {action:"open_url",url:"https://discord.com/channels/1515877468299595919/123456789012345678?token=1"},
    {action:"press",key:"Enter"},
    {action:"type_search",text:"ola\nmensagem"},
    {action:"click",x:1365,y:100},
    {action:"rpg_scout",urls:["https://discord.com/channels/999999999999999999/123456789012345678"]}
  ]) await assert.rejects(()=>browserCall(env,"bushin_browser_action",args));
  assert.equal(requested,false);
});

test("Browser result validates command and run IDs",async()=>{
  const env={BUSHIN_GITHUB_TOKEN:"fake-test-token-placeholder-123456"};
  await assert.rejects(()=>browserCall(env,"bushin_browser_result",{command_id:"bad",session_id:"123"}));
});

test("Tool schemas expose neither Discord token nor arbitrary script execution",()=>{
  const str=JSON.stringify(BROWSER_TOOLS);
  for(const forbidden of ["password","cookie","eval","javascript","shell","discord_token","send_message"])
    assert.equal(str.includes(forbidden),false,forbidden);
});
