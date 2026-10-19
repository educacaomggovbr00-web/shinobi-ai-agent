import test from "node:test";
import assert from "node:assert/strict";
import {botReady,botCall,BOT_TOOLS} from "../src/bot-permissions.mjs";

const env={
  DISCORD_BOT_TOKEN:"example_not_a_real_token_abcdefghijklmnopqrstuvwxyz",
  BUSHIN_BOT_GUILD_ID:"111111111111111111",
  BUSHIN_BOT_CHANNEL_IDS:"222222222222222222"
};
const json=(status,value)=>({status,ok:status>=200&&status<300,json:async()=>value});
function fakeDiscord(handler){
  const orig=globalThis.fetch;
  globalThis.fetch=async (...args)=>handler(...args);
  return ()=>{globalThis.fetch=orig};
}
test("bot tools require explicit allowlist and a bot token",()=>{
  assert.equal(botReady({}),false);
  assert.equal(botReady(env),true);
  assert.equal(botReady({...env,BUSHIN_BOT_CHANNEL_IDS:"222222222222222222,222222222222222222"}),false);
  assert.ok(BOT_TOOLS.some(x=>x.name==="bushin_bot_read_channel"));
});
test("not allowed channel is rejected without any Discord API requests",async()=>{
  const restore=fakeDiscord(()=>{throw Error("should not fetch")});
  try{await assert.rejects(()=>botCall(env,"bushin_bot_read_channel",{channel_id:"333333333333333333"}),/não autorizado/);}
  finally{restore();}
});
test("write requires confirmation; nothing is posted",async()=>{
  let calls=0;
  const restore=fakeDiscord((url)=>{calls++;
    assert.match(url,/\/channels\/222222222222222222$/);
    return json(200,{guild_id:env.BUSHIN_BOT_GUILD_ID,type:0});
  });
  try{
    await assert.rejects(()=>botCall(env,"bushin_bot_send_message",
      {channel_id:"222222222222222222",content:"oi",confirmed:false}),/Confirme/);
    assert.equal(calls,1);
  }finally{restore();}
});
test("a confirmed message is sent as bot with mentions disabled",async()=>{
  let sent=false;
  const restore=fakeDiscord((url,options)=>{
    if(url.endsWith("/channels/222222222222222222"))return json(200,{guild_id:env.BUSHIN_BOT_GUILD_ID,type:0});
    assert.equal(options.method,"POST");
    const body=JSON.parse(options.body);
    assert.equal(body.content,"Olá");
    assert.deepEqual(body.allowed_mentions,{parse:[]});
    assert.match(options.headers.authorization,/^Bot /);
    sent=true;
    return json(200,{id:"444444444444444444"});
  });
  try{
    const r=await botCall(env,"bushin_bot_send_message",
      {channel_id:"222222222222222222",content:"Olá",confirmed:true});
    assert.equal(r.sent,true);assert.equal(sent,true);
  }finally{restore();}
});
