import test from "node:test";
import assert from "node:assert/strict";
import {SAFE_ACTIONS,CHANNELS,REPO,safeBrowserAction,safeChannelUrl,enqueueBrowserOperation} from "../src/github-bridge.mjs";

test("Bridge is limited to one private GitHub repo and the authorized Naruto guild",()=>{
  assert.equal(REPO,"educacaomggovbr00-web/shinobi-ai-agent");
  assert.equal(Object.keys(CHANNELS).length,3);
  assert.equal(CHANNELS["chamar-rp"],"1520116350360617154");
  assert.equal(SAFE_ACTIONS.includes("post"),false);
  assert.equal(SAFE_ACTIONS.includes("send_message"),false);
  assert.equal(SAFE_ACTIONS.includes("shell"),false);
  assert.equal(SAFE_ACTIONS.includes("type"),false);
});

test("Navigation cannot leave approved RP channels",()=>{
  const approved="https://discord.com/channels/1515877468299595919/1520116350360617154";
  assert.equal(safeChannelUrl(approved),approved);
  for(const url of [
    "https://discord.com/login",
    "https://discord.com/channels/@me/12345",
    "https://discord.com/channels/999999999999999999/1520116350360617154",
    "https://discord.com/channels/1515877468299595919/888888888888888888",
    "https://discord.com/channels/1515877468299595919/1520116350360617154?token=secret",
    "https://discord.com@evil.example/channels/1515877468299595919/1520116350360617154",
    "http://discord.com/channels/1515877468299595919/1520116350360617154",
  ]){
    assert.throws(()=>safeChannelUrl(url),Error,url);
  }
});

test("Safe actions strip untrusted surplus fields",()=>{
  assert.deepEqual(safeBrowserAction("click",{x:100,y:220,authorization:"secret",text:"hack"}),{
    action:"click",x:100,y:220
  });
  assert.deepEqual(safeBrowserAction("status",{url:"https://evil.example"}),{action:"status"});
  assert.deepEqual(safeBrowserAction("scroll",{direction:"down",amount:2,post:true}),{
    action:"scroll",direction:"down",amount:2
  });
  assert.deepEqual(safeBrowserAction("press",{key:"Escape",secret:"key"}),{
    action:"press",key:"Escape"
  });
  for(const action of ["post","send_message","upload","type","exec","shell","screenshot_dm"])
    assert.throws(()=>safeBrowserAction(action,{}),Error);
});

test("Mouse, keyboard and scroll have strict limits",()=>{
  for(const [x,y] of [[-1,5],[0,768],[1365,2],[1.5,100],["12",25],[true,2]])
    assert.throws(()=>safeBrowserAction("click",{x,y}),Error);
  for(const [direction,amount] of [["up",0],["sideways",2],["down",9],["down",true]])
    assert.throws(()=>safeBrowserAction("scroll",{direction,amount}),Error);
  for(const key of ["Enter","Space","Control+V","Alt+F4","Delete"])
    assert.throws(()=>safeBrowserAction("press",{key}),Error);
});

test("Queue executes sequentially even after one task fails",async()=>{
 const seen=[];
 const a=enqueueBrowserOperation(async()=>{seen.push("a-start");await new Promise(r=>setTimeout(r,6));seen.push("a-end");return 1;});
 const b=enqueueBrowserOperation(async()=>{seen.push("b-start");throw Error("expected");});
 const c=enqueueBrowserOperation(async()=>{seen.push("c-start");return 3;});
 assert.equal(await a,1);
 await assert.rejects(b,/expected/);
 assert.equal(await c,3);
 assert.deepEqual(seen,["a-start","a-end","b-start","c-start"]);
});
