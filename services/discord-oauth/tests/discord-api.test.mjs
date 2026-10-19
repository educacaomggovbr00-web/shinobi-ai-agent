import test from "node:test";
import assert from "node:assert/strict";
import {
 APPLICATION_CLIENT_ID, NARUTO_GUILD_ID, OAUTH_SCOPES, readBearer,
 DiscordAuthError, discordFetch, authorizedProfile, narutoMembership
} from "../src/discord-api.mjs";

test("Public Discord client ID and limited OAuth scopes",() => {
 assert.equal(APPLICATION_CLIENT_ID,"1561589128108314636");
 assert.deepEqual(OAUTH_SCOPES,["identify","guilds","guilds.members.read"]);
 assert.ok(!OAUTH_SCOPES.includes("bot"));
 assert.ok(!OAUTH_SCOPES.includes("messages.write"));
});

test("Bearer token parsing never accepts paths or extra fields",() => {
 const fake="s".repeat(40);
 assert.equal(readBearer("Bearer "+fake),fake);
 for(const invalid of [null,"","Basic "+fake,"Bearer ","Bearer abc","Bearer "+fake+"\r\nX:bad"]) {
   assert.equal(readBearer(invalid),null);
 }
});

test("Only fixed official Discord API paths can be called",async () => {
 await assert.rejects(
    discordFetch("xyz", "https://evil.example/"),
    /not authorized|não autorizado/i);
 await assert.rejects(discordFetch("xyz","/channels/anything"),/não autorizado/i);
});

test("Profile sanitization excludes email and sensitive extras",async()=>{
 const mock=async(url, options)=>{
   assert.equal(url,"https://discord.com/api/v10/users/@me");
   assert.match(options.headers.Authorization,/^Bearer /);
   return {ok:true,status:200,json:async()=>({
      id:"1000", username:"ninja", global_name:"Henrique", verified:true,
      email:"sensitive@example.com", access_token:"secret"
   })};
 };
 const profile=await authorizedProfile("s".repeat(50),"1000",mock);
 assert.deepEqual(profile,{id:"1000",username:"ninja",display_name:"Henrique",verified:true});
 assert.equal(JSON.stringify(profile).includes("sensitive"),false);
 await assert.rejects(authorizedProfile("s".repeat(50),"wrong",mock),e=>e instanceof DiscordAuthError&&e.status===403);
});

test("Membership only queries allowed server and returns minimal fields",async()=>{
 const visited=[];
 const mock=async(url)=>{
   visited.push(url);
   const path=url.split("/api/v10")[1];
   let value;
   if(path==="/users/@me")value={id:"1000",username:"ninja"};
   else if(path==="/users/@me/guilds")value=[{id:NARUTO_GUILD_ID,name:"Naruto Project RP"},{id:"999999999999999999",name:"Private"}];
   else if(path==="/users/@me/guilds/"+NARUTO_GUILD_ID+"/member")value={nick:"Henrique",roles:["r1","r2"],joined_at:"2026-10-17"};
   else throw new Error("Unexpected request");
   return {ok:true,status:200,json:async()=>value};
 };
 const data=await narutoMembership("s".repeat(48),"1000",mock);
 assert.equal(data.member,true);
 assert.equal(data.guild_id,NARUTO_GUILD_ID);
 assert.equal(data.roles_count,2);
 assert.equal(data.nickname,"Henrique");
 assert.equal(JSON.stringify(data).includes("Private"),false);
 assert.equal(visited.length,3);
});

test("No Naruto guild means no member API access",async()=>{
 const paths=[];
 const mock=async url=>{
   const path=url.split("/api/v10")[1];paths.push(path);
   const data=path==="/users/@me"?{id:"1000",username:"ninja"}:[{id:"999",name:"Another"}];
   return {ok:true,status:200,json:async()=>data};
 };
 const data=await narutoMembership("s".repeat(48),"1000",mock);
 assert.equal(data.member,false);
 assert.equal(paths.length,2);
});

test("401s reject invalid OAuth tokens without returning raw tokens",async()=>{
 const fake="MY_TOKEN_SHOULD_STAY_PRIVATE";
 const fetchImpl=async()=>({ok:false,status:401});
 await assert.rejects(discordFetch(fake,"/users/@me",fetchImpl),err=>
     err instanceof DiscordAuthError && err.status===401 && !err.message.includes(fake));
});
