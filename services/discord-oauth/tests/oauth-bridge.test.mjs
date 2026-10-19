import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
 configureOAuth,metadata,registerOAuthClient,beginAuthorize,discordCallback,
 exchangeOAuthToken,resolveOAuthAccess,isAllowedClientRedirect,verifyPkce
} from "../src/oauth-bridge.mjs";

const base="https://bushin.example";
const owner="123456789012345678";
const clientCallback="https://chatgpt.com/connector_platform_oauth_redirect";
const verifier="a".repeat(50);
const challenge=createHash("sha256").update(verifier).digest("base64url");
let exchanged=0;
const fakeFetch=async(url,options)=>{
 const u=String(url);
 if(u.endsWith("/oauth2/token")){
   exchanged++;
   assert.match(options.headers.Authorization,/^Basic /);
   assert.match(options.body.toString(),/code_verifier=/);
   return {ok:true,status:200,json:async()=>({
     access_token:"FAKE_DISCORD_ACCESS_DO_NOT_LEAK",
     refresh_token:"FAKE_DISCORD_REFRESH_DO_NOT_LEAK",
     expires_in:604800,scope:"identify guilds guilds.members.read"
   })};
 }
 if(u.endsWith("/users/@me"))return {ok:true,status:200,json:async()=>({
   id:owner,username:"henrique",global_name:"Henrique",email:"private@example.com"})};
 if(u.endsWith("/users/@me/guilds"))return {ok:true,status:200,json:async()=>[
   {id:"1515877468299595919",name:"Naruto Project RP"}]};
 if(u.endsWith("/users/@me/guilds/1515877468299595919/member"))return {
   ok:true,status:200,json:async()=>({nick:null,roles:[]})};
 throw Error("Unexpected external request: "+u);
};
configureOAuth({publicBase:base,ownerId:owner,clientSecret:"not-real-secret-for-integration-test",fetchImpl:fakeFetch});

test("Discovers standards compliant MCP OAuth2.1 metadata",()=>{
 const m=metadata();
 assert.equal(m.issuer,base);
 assert.equal(m.registration_endpoint,base+"/oauth/register");
 assert.deepEqual(m.code_challenge_methods_supported,["S256"]);
 assert.deepEqual(m.token_endpoint_auth_methods_supported,["none"]);
 assert.equal(m.authorization_response_iss_parameter_supported,true);
});

test("Registration allowlists only official ChatGPT callback URLs",()=>{
 for(const valid of [clientCallback,"https://chatgpt.com/connector/oauth/abcdef123"]){
   assert.equal(isAllowedClientRedirect(valid),true);
 }
 for(const invalid of ["https://evil.example/callback","http://chatgpt.com/connector_platform_oauth_redirect",
   "https://chatgpt.com.evil.example/connector_platform_oauth_redirect",
   "https://chatgpt.com/connector_platform_oauth_redirect?steal=1",
   "https://chatgpt.com/chats","https://chatgpt.com/connector/oauth/x"]){
     assert.equal(isAllowedClientRedirect(invalid),false,invalid);
 }
 assert.throws(()=>registerOAuthClient({redirect_uris:["https://evil.example"]}),/official ChatGPT/);
 const reg=registerOAuthClient({redirect_uris:[clientCallback],token_endpoint_auth_method:"none"});
 assert.equal(reg.token_endpoint_auth_method,"none");
 assert.ok(reg.client_id.length>20);
});

test("PKCE must be S256, wrong verifier is refused",()=>{
 assert.equal(verifyPkce(verifier,challenge),true);
 assert.equal(verifyPkce("b".repeat(50),challenge),false);
 assert.equal(verifyPkce("short",challenge),false);
});

test("Realistic DCR -> Discord OAuth -> ChatGPT token -> authenticated MCP session",async()=>{
 const reg=registerOAuthClient({redirect_uris:[clientCallback]});
 const params={client_id:reg.client_id,redirect_uri:clientCallback,
   response_type:"code",resource:base+"/mcp",state:"CHATGPT_CSRF_STATE_12345",
   code_challenge_method:"S256",code_challenge:challenge,
   scope:"identify guilds guilds.members.read"};
 assert.throws(()=>beginAuthorize({...params,resource:"https://evil.example/mcp"}),/resource/);
 assert.throws(()=>beginAuthorize({...params,code_challenge_method:"plain"}),/PKCE/);
 const discordUrl=new URL(beginAuthorize(params));
 assert.equal(discordUrl.hostname,"discord.com");
 assert.equal(discordUrl.searchParams.get("client_id"),"1561589128108314636");
 assert.equal(discordUrl.searchParams.get("redirect_uri"),base+"/oauth/discord/callback");
 assert.equal(discordUrl.searchParams.get("prompt"),"consent");
 assert.equal(discordUrl.searchParams.get("code_challenge_method"),"S256");
 const dState=discordUrl.searchParams.get("state");
 const callback=new URL(await discordCallback({code:"MOCK_CODE_RECEIVED",state:dState,iss:"https://discord.com"}));
 assert.equal(callback.origin,"https://chatgpt.com");
 assert.equal(callback.searchParams.get("state"),params.state);
 assert.equal(callback.searchParams.get("iss"),base);
 const code=callback.searchParams.get("code");
 assert.ok(code && code.length>30);
 assert.equal(callback.toString().includes("FAKE_DISCORD_ACCESS"),false);
 await assert.rejects(
   exchangeOAuthToken({client_id:reg.client_id,resource:params.resource,grant_type:"authorization_code",
     code,redirect_uri:clientCallback,code_verifier:"b".repeat(50)}),/PKCE/);
 await assert.rejects(
   exchangeOAuthToken({client_id:reg.client_id,resource:params.resource,grant_type:"authorization_code",
     code,redirect_uri:clientCallback,code_verifier:verifier}),/used code/);
 const url2=new URL(beginAuthorize(params));
 const callback2=new URL(await discordCallback({code:"MOCK_FRESH_CODE",state:url2.searchParams.get("state"),
   iss:"https://discord.com"}));
 const goodCode=callback2.searchParams.get("code");
 const tokens=await exchangeOAuthToken({client_id:reg.client_id,resource:params.resource,
   grant_type:"authorization_code",code:goodCode,redirect_uri:clientCallback,
   code_verifier:verifier});
 assert.equal(tokens.token_type,"Bearer");
 assert.ok(tokens.refresh_token);
 assert.equal(JSON.stringify(tokens).includes("FAKE_DISCORD"),false);
 const auth=resolveOAuthAccess(tokens.access_token);
 assert.equal(auth.discordToken,"FAKE_DISCORD_ACCESS_DO_NOT_LEAK");
 assert.equal(auth.userId,owner);
 assert.equal(auth.scope.length,3);
 const refreshed=await exchangeOAuthToken({client_id:reg.client_id,resource:params.resource,
   grant_type:"refresh_token",refresh_token:tokens.refresh_token});
 assert.ok(refreshed.refresh_token!==tokens.refresh_token);
 assert.equal(resolveOAuthAccess("INVALID"),null);
 assert.ok(exchanged>=2);
});
