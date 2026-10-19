/**
 * Bushin Browser — Discord Direct (Cloudflare Workers Free + D1)
 * Same original ChatGPT plugin. This is an ALTERNATIVE backend, not a new plugin.
 * No GitHub runtime, no Composio, no personal Discord self-bot, no account cookies.
 *
 * OAuth2.1 for ChatGPT: DCR, Authorization Code, PKCE S256, state, resource.
 * Confidential Discord OAuth code exchange happens only inside this Worker.
 * Tokens are stored encrypted with AES-GCM in private D1. ChatGPT receives
 * only opaque Bushin-issued tokens, never raw Discord access/refresh tokens.
 */
import {botReady,BOT_TOOLS,botCall} from "./bot-permissions.mjs";
import {BROWSER_TOOLS,browserCall} from "./browser-bridge.mjs";
const DISCORD_CLIENT_ID="1561589128108314636";
const NARUTO_GUILD_ID="1515877468299595919";
const SCOPES=["identify","guilds","guilds.members.read"];
const DISCORD="https://discord.com/api/v10";
const enc=new TextEncoder();
const dec=new TextDecoder();
const now=()=>Date.now();
const minute=60000;
const urlSafeBytes=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
const bytesFrom64=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
function rnd(){const b=new Uint8Array(32);crypto.getRandomValues(b);return urlSafeBytes(b);}
async function digest(s){return urlSafeBytes(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s))));}
async function secretKey(env){
  if(!env.ENCRYPTION_KEY_BASE64 || typeof env.ENCRYPTION_KEY_BASE64!=="string")
    throw Error("Encryption secret missing");
  const bytes=bytesFrom64(env.ENCRYPTION_KEY_BASE64);
  if(bytes.length!==32)throw Error("Encryption secret needs exactly 32 bytes");
  return crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);
}
async function seal(value,env){
  const key=await secretKey(env),iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(JSON.stringify(value))));
  return urlSafeBytes(iv)+"."+urlSafeBytes(ciphertext);
}
async function unseal(value,env){
  const [i,c]=String(value).split(".");
  if(!i||!c)throw Error("Invalid encrypted record");
  const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytesFrom64(i)},await secretKey(env),bytesFrom64(c));
  return JSON.parse(dec.decode(bytes));
}
function oauthError(error,message="Não foi possível concluir a autorização.",status=400){
  return Object.assign(new Error(message),{errorCode:error,status});
}
const clientRedirectRE=/^\/connector\/oauth\/[A-Za-z0-9_-]{6,120}$/;
export function allowedRedirect(raw){
  if(typeof raw!=="string"||raw.length>500)return false;
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&u.hostname==="chatgpt.com"&&!u.port&&!u.username&&!u.password&&!u.hash&&!u.search&&
      (u.pathname==="/connector_platform_oauth_redirect"||clientRedirectRE.test(u.pathname));
  }catch{return false;}
}
export function validScope(raw){
  if(typeof raw!=="string")return false;
  const scopes=raw.trim().split(/\s+/);
  return scopes.length===3 && new Set(scopes).size===3 && scopes.every(s=>SCOPES.includes(s));
}
const verifierRE=/^[A-Za-z0-9_.~-]{43,128}$/;
const challengeRE=/^[A-Za-z0-9_-]{43,128}$/;
export async function pkceVerify(verifier,challenge){
  return typeof verifier==="string"&&verifierRE.test(verifier)&&typeof challenge==="string"&&challengeRE.test(challenge)&&
    (await digest(verifier))===challenge;
}
function base(env){
  const value=String(env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
  if(!/^https:\/\/[a-z0-9.-]+$/i.test(value))throw Error("PUBLIC_BASE_URL must be a fixed HTTPS origin");
  return value;
}
function ready(env){
  const b=base(env);
  if(!env.DB?.prepare||!env.DISCORD_CLIENT_SECRET||!env.ENCRYPTION_KEY_BASE64||
     !/^\d{15,22}$/.test(env.BUSHIN_OWNER_DISCORD_ID||""))throw Error("Bushin OAuth hosting not configured");
  return b;
}
function reply(body,status=200,headers={}){
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer",
    ...headers
  }});
}
function redirect(uri){return new Response(null,{status:302,headers:{location:uri,"cache-control":"no-store","referrer-policy":"no-referrer"}});}
function oauthReply(e){return reply({error:e.errorCode||"server_error",error_description:String(e.message||"OAuth failed").slice(0,160)},e.status||500);}
function q(env,sql,...params){return env.DB.prepare(sql).bind(...params);}
async function field(req){
  const max=8192;
  const len=Number(req.headers.get("content-length")||0);
  if(len>max)throw oauthError("invalid_request","Request too large",413);
  const text=await req.text();
  if(text.length>max)throw oauthError("invalid_request","Request too large",413);
  if((req.headers.get("content-type")||"").startsWith("application/json")){
    try{return JSON.parse(text);}catch{throw oauthError("invalid_request","Malformed JSON");}
  }
  if(!(req.headers.get("content-type")||"").startsWith("application/x-www-form-urlencoded"))
    throw oauthError("invalid_request","Use form encoding",415);
  return Object.fromEntries(new URLSearchParams(text));
}
function oauthMetadata(env){
  const b=ready(env);
  return {issuer:b,authorization_endpoint:b+"/oauth/authorize",
    token_endpoint:b+"/oauth/token",registration_endpoint:b+"/oauth/register",
    response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],
    token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],
    authorization_response_iss_parameter_supported:true,scopes_supported:SCOPES};
}
async function register(req,env){
  const b=ready(env),p=await field(req);
  if(!Array.isArray(p.redirect_uris)||p.redirect_uris.length!==1||!allowedRedirect(p.redirect_uris[0])||
    p.token_endpoint_auth_method && p.token_endpoint_auth_method!=="none")
    throw oauthError("invalid_client_metadata","Only official ChatGPT OAuth callbacks are accepted.");
  const count=await q(env,"SELECT COUNT(*) AS total FROM oauth_clients").first();
  if(Number(count?.total||0)>75)throw oauthError("temporarily_unavailable","Client registration limit reached.",429);
  const id=rnd(),issued=Math.floor(now()/1000);
  await q(env,"INSERT INTO oauth_clients (id,redirect_uri,created_at) VALUES (?,?,?)",
    id,p.redirect_uris[0],now()).run();
  return reply({client_id:id,client_id_issued_at:issued,redirect_uris:p.redirect_uris,
    token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]},201);
}
async function authorize(request,env){
  const b=ready(env),p=new URL(request.url).searchParams;
  const client=await q(env,"SELECT redirect_uri FROM oauth_clients WHERE id=?",p.get("client_id")||"").first();
  if(!client)throw oauthError("invalid_client","Client not registered",401);
  if(p.get("redirect_uri")!==client.redirect_uri)throw oauthError("invalid_request","Redirect mismatch");
  if(p.get("response_type")!=="code" || p.get("code_challenge_method")!=="S256" ||
    !challengeRE.test(p.get("code_challenge")||""))throw oauthError("invalid_request","PKCE S256 required");
  const state=p.get("state")||"";
  if(state.length<8||state.length>500)throw oauthError("invalid_request","CSRF state required");
  if(p.get("resource")!==b+"/mcp")throw oauthError("invalid_target","Wrong OAuth resource");
  const scope=p.get("scope")||SCOPES.join(" ");
  if(!validScope(scope))throw oauthError("invalid_scope","Only identify/guilds/guilds.members.read supported");
  const dState=rnd(),dv=rnd();
  await q(env,"INSERT INTO oauth_flows (state_hash,client_id,redirect_uri,client_state,pkce_challenge,discord_verifier,scope,expires_at) VALUES (?,?,?,?,?,?,?,?)",
    await digest(dState),p.get("client_id"),client.redirect_uri,state,p.get("code_challenge"),dv,scope,now()+10*minute).run();
  const dst=new URL("https://discord.com/oauth2/authorize");
  for(const [k,v] of Object.entries({
    client_id:DISCORD_CLIENT_ID,redirect_uri:b+"/oauth/discord/callback",
    response_type:"code",scope,state:dState,
    code_challenge_method:"S256",code_challenge:await digest(dv),prompt:"consent"
  }))dst.searchParams.set(k,v);
  return redirect(dst.toString());
}
export function classifyDiscordTokenFailure(status,code){
  const allowed=new Set(["invalid_client","invalid_grant","invalid_request","invalid_scope","unauthorized_client","unsupported_grant_type"]);
  if(allowed.has(code))return "discord_"+code;
  if(status===401||status===403)return "discord_invalid_client";
  if(status===429)return "discord_rate_limited";
  if(status>=500)return "discord_unavailable";
  return "discord_auth";
}
async function discordToken(env,data){
  // Discord supports form-body client authentication for authorization_code
  // and refresh_token grants. Nothing is logged or sent to the browser.
  // Keep the Client Secret on the Worker, protected by the Cloudflare secret binding.
  const form=new URLSearchParams(data);
  form.set("client_id",DISCORD_CLIENT_ID);
  form.set("client_secret",env.DISCORD_CLIENT_SECRET);
  const response=await fetch(DISCORD+"/oauth2/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},
    body:form,
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
    // Only consume the whitelisted error class; never echo provider descriptions,
    // request headers, authorization codes, token values or client secrets.
    let providerCode="";
    try{
      const body=await response.json();
      if(body && typeof body.error==="string")providerCode=body.error;
    }catch{}
    throw oauthError(classifyDiscordTokenFailure(response.status,providerCode),
      "Discord rejected the authorization code exchange.");
  }
  const j=await response.json();
  if(!j.access_token||!j.refresh_token||!Number.isFinite(j.expires_in))
    throw oauthError("access_denied","Invalid Discord token response.");
  if(!validScope(String(j.scope||"")))throw oauthError("invalid_scope","Discord did not grant required permissions.");
  return {access:j.access_token,refresh:j.refresh_token,expires:now()+j.expires_in*1000,scope:j.scope};
}
async function discordFetch(token,path){
  if(!["/users/@me","/users/@me/guilds/"+NARUTO_GUILD_ID+"/member"].includes(path))
    throw Error("Unapproved Discord API endpoint");
  const res=await fetch(DISCORD+path,{headers:{
    authorization:"Bearer "+token,accept:"application/json"
  },signal:AbortSignal.timeout(10000)});
  if(res.status===401)throw oauthError("invalid_grant","Discord authorization expired.",401);
  if(res.status===404)return null;
  if(res.status===403)throw oauthError("insufficient_scope","Missing Discord permission.",403);
  if(!res.ok)throw oauthError("temporarily_unavailable","Discord temporarily unavailable.",503);
  return res.json();
}
async function verified(env,creds){
  const profile=await discordFetch(creds.access,"/users/@me");
  if(!profile || profile.id!==env.BUSHIN_OWNER_DISCORD_ID)
    throw oauthError("access_denied","This Discord account is not the Bushin owner.",403);
  const membership=await discordFetch(creds.access,"/users/@me/guilds/"+NARUTO_GUILD_ID+"/member");
  if(!membership)throw oauthError("access_denied","Discord account is not in Naruto Project RP.",403);
  return {id:profile.id,username:String(profile.username||""),
    display_name:String(profile.global_name||profile.username||""),
    membership:{guild_id:NARUTO_GUILD_ID,member:true,nickname:membership.nick||null,
      roles_count:Array.isArray(membership.roles)?membership.roles.length:null}};
}
function cbUri(row,env,code,err){
  const uri=new URL(row.redirect_uri);
  uri.searchParams.set("state",row.client_state);
  uri.searchParams.set("iss",base(env));
  if(err)uri.searchParams.set("error",err);
  else uri.searchParams.set("code",code);
  return uri.toString();
}
async function discordCallback(req,env){
  const b=ready(env),p=new URL(req.url).searchParams;
  const state=p.get("state")||"";
  if(!state||state.length>500)throw oauthError("invalid_request","Discord state missing");
  const row=await q(env,"DELETE FROM oauth_flows WHERE state_hash=? AND expires_at>? RETURNING *",
    await digest(state),now()).first();
  if(!row)throw oauthError("invalid_request","Login expired or already consumed");
  if(p.get("error")||!p.get("code")||p.get("iss")&&p.get("iss")!=="https://discord.com")
    return redirect(cbUri(row,env,null,"access_denied"));
  try{
    const credentials=await discordToken(env,{
      grant_type:"authorization_code",code:p.get("code"),
      redirect_uri:b+"/oauth/discord/callback",code_verifier:row.discord_verifier
    });
    const profile=await verified(env,credentials);
    const code=rnd();
    await q(env,"INSERT INTO oauth_codes (code_hash,client_id,redirect_uri,pkce_challenge,scope,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?,?,?,?,?)",
      await digest(code),row.client_id,row.redirect_uri,row.pkce_challenge,row.scope,
      profile.id,await seal(credentials,env),now()+5*minute).run();
    return redirect(cbUri(row,env,code,null));
  }catch{
    return redirect(cbUri(row,env,null,"access_denied"));
  }
}
async function saveTokens(env,clientId,scope,userId,creds){
  const access=rnd(),refresh=rnd(),saved=await seal(creds,env);
  const duration=Math.max(60000,Math.min(25*minute,creds.expires-now()-60000));
  const time=now();
  await env.DB.batch([
    q(env,"INSERT INTO oauth_access (token_hash,client_id,scope,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?,?,?)",
      await digest(access),clientId,scope,userId,saved,time+duration),
    q(env,"INSERT INTO oauth_refresh (token_hash,client_id,scope,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?,?,?)",
      await digest(refresh),clientId,scope,userId,saved,time+30*86400000)
  ]);
  return reply({access_token:access,refresh_token:refresh,token_type:"Bearer",
    expires_in:Math.floor(duration/1000),scope});
}
async function token(req,env){
  const b=ready(env),p=await field(req);
  if(p.resource!==b+"/mcp")throw oauthError("invalid_target","Wrong OAuth resource");
  const client=await q(env,"SELECT redirect_uri FROM oauth_clients WHERE id=?",p.client_id||"").first();
  if(!client)throw oauthError("invalid_client","Unknown client.",401);
  if(p.grant_type==="authorization_code"){
    if(typeof p.code!=="string"||p.code.length>256)throw oauthError("invalid_grant","Invalid OAuth code");
    const code=await q(env,"DELETE FROM oauth_codes WHERE code_hash=? AND expires_at>? RETURNING *",
      await digest(p.code),now()).first();
    if(!code || code.client_id!==p.client_id || code.redirect_uri!==p.redirect_uri ||
       client.redirect_uri!==p.redirect_uri ||
       !await pkceVerify(p.code_verifier,code.pkce_challenge))
      throw oauthError("invalid_grant","Invalid or already used PKCE authorization code.");
    const credentials=await unseal(code.creds_encrypted,env);
    return saveTokens(env,p.client_id,code.scope,code.user_id,credentials);
  }
  if(p.grant_type==="refresh_token"){
    if(typeof p.refresh_token!=="string"||p.refresh_token.length>256)
      throw oauthError("invalid_grant","Refresh token invalid.");
    const row=await q(env,"DELETE FROM oauth_refresh WHERE token_hash=? AND expires_at>? RETURNING *",
      await digest(p.refresh_token),now()).first();
    if(!row||row.client_id!==p.client_id)throw oauthError("invalid_grant","Refresh token invalid or used.");
    let credentials=await unseal(row.creds_encrypted,env);
    if(credentials.expires<now()+3*minute){
      credentials=await discordToken(env,{grant_type:"refresh_token",refresh_token:credentials.refresh});
      const profile=await verified(env,credentials);
      if(profile.id!==row.user_id)throw oauthError("invalid_grant","Discord identity mismatch.");
    }
    return saveTokens(env,row.client_id,row.scope,row.user_id,credentials);
  }
  throw oauthError("unsupported_grant_type","Unsupported OAuth grant");
}
async function session(req,env){
  const header=req.headers.get("authorization")||"";
  const token=header.match(/^Bearer ([A-Za-z0-9._~+\/=-]{20,512})$/)?.[1];
  if(!token)return null;
  const record=await q(env,"SELECT * FROM oauth_access WHERE token_hash=? AND expires_at>?",
    await digest(token),now()).first();
  if(!record||!validScope(record.scope)||record.user_id!==env.BUSHIN_OWNER_DISCORD_ID)return null;
  const creds=await unseal(record.creds_encrypted,env);
  if(creds.expires<now()+30000)return null;
  return {record,creds};
}
function rpc(id,result){return reply({jsonrpc:"2.0",id,result});}
function rpcError(id,code,message){return reply({jsonrpc:"2.0",id,error:{code,message}});}
const TOOLS=[
 {name:"bushin_discord_whoami",title:"Verificar conta Discord",
   description:"Discord OAuth oficial: informa somente a conta autenticada; sem e-mail, DMs ou mensagens.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},
   annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"bushin_discord_naruto_membership",title:"Verificar Naruto Project RP",
   description:"Confirma vínculo da conta autorizada ao servidor Naruto Project RP.",
   inputSchema:{type:"object",properties:{},additionalProperties:false},
   annotations:{readOnlyHint:true,destructiveHint:false}}
];
async function mcp(req,env){
  ready(env);
  const ct=req.headers.get("content-type")||"";
  if(!ct.startsWith("application/json"))return reply({error:"Expected JSON"},415);
  let body;try{body=await field(req);}catch(e){return oauthReply(e);}
  const id=body.id??null,method=body.method;
  if(method==="initialize")return rpc(id,{
    protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false}},
    serverInfo:{name:"bushin-browser-discord-direct",version:"1.0.0"},
    instructions:"Discord OAuth verifica o proprietário. O controle visual opcional usa uma sessão navegador separada, ações limitadas a leitura e navegação. Envio de mensagens só por bot oficial autorizado, nunca como conta pessoal."
  });
  if(method==="notifications/initialized")return new Response(null,{status:202});
  if(method==="ping")return rpc(id,{});
  const activeTools=TOOLS.concat(BROWSER_TOOLS,botReady(env)?BOT_TOOLS:[]);
  if(method==="tools/list")return rpc(id,{tools:activeTools});
  if(method==="tools/call"){
    const auth=await session(req,env);
    if(!auth)return reply({error:"Discord login necessary"},401,{
      "www-authenticate":'Bearer resource_metadata="'+base(env)+'/.well-known/oauth-protected-resource"'
    });
    const name=body.params?.name;
    if(!activeTools.some(t=>t.name===name))return rpcError(id,-32601,"Unknown tool");
    try{
      const me=await verified(env,auth.creds);
      const data=BROWSER_TOOLS.some(t=>t.name===name)?await browserCall(env,name,body.params?.arguments||{}):
        BOT_TOOLS.some(t=>t.name===name)?await botCall(env,name,body.params?.arguments||{}):
        name==="bushin_discord_whoami"?
        {id:me.id,username:me.username,display_name:me.display_name,verified_account:true}:
        {username:me.username,...me.membership};
      return rpc(id,{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data});
    }catch(e){return rpc(id,{isError:true,content:[{type:"text",text:e.message||"Discord check failed"}]});}
  }
  return rpcError(id,-32601,"Method not found");
}

/* Mobile-only browser OAuth portal; no MCP client is needed. */
const MOBILE_CSS="body{background:#0b1020;color:#e8f1ff;font:16px system-ui;margin:0;padding:28px 18px}main{max-width:480px;margin:20px auto}.card{border:1px solid #384666;background:#152039;border-radius:20px;padding:24px;margin:28px 0}h1{font-size:32px}p{line-height:1.6;color:#c1d0e9}.button{display:block;background:#5865f2;color:white;text-decoration:none;border:0;border-radius:14px;padding:17px;text-align:center;font-size:17px;font-weight:800;width:100%;box-sizing:border-box;margin-top:20px}.muted{font-size:13px;color:#a5b6d3}.ok{color:#80e5b3}.user{font-size:24px;font-weight:800;overflow-wrap:anywhere}";
const M_FLOW="__Host-bushin_flow",M_SESSION="__Host-bushin_mobile";
function mCookie(req,name){for(const pair of (req.headers.get("cookie")||"").split(";")){const s=pair.trim();if(s.startsWith(name+"="))return s.slice(name.length+1)}return ""}
function mSet(name,value,age){return name+"="+value+"; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age="+age}
function mEsc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function mPage(title,content){
 const html='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bushin — Discord no celular</title><style>'+MOBILE_CSS+'</style><main><div style="font-size:48px">🍥</div><h1>'+title+'</h1><p>Conexão do Discord para Android. Não precisa de Linux.</p><div class="card">'+content+'</div><p class="muted">Login oficial do Discord: identify, guilds, guilds.members.read. Sem leitura de mensagens ou DMs. Esta página não habilita automaticamente as ferramentas MCP no aplicativo ChatGPT.</p></main></html>';
 return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'","referrer-policy":"no-referrer","x-content-type-options":"nosniff","x-frame-options":"DENY"}});
}
function mGo(to,cookies=[]){const h=new Headers({"location":to,"cache-control":"no-store","referrer-policy":"no-referrer"});for(const c of cookies)h.append("set-cookie",c);return new Response(null,{status:303,headers:h})}
async function mobileHome(req,env){
 ready(env);
 const err=new URL(req.url).searchParams.get("error");
 if(err){
   const reasons={
     state:"O navegador perdeu a sessão de login. Abra esta página no Chrome e conclua o Discord na mesma janela.",
     denied:"A autorização foi cancelada ou recusada pelo Discord.",
     discord_auth:"O Discord recusou a autorização sem indicar um motivo específico.",
     discord_invalid_client:"O Discord rejeitou as credenciais do aplicativo Bushin. O Client Secret configurado na Cloudflare provavelmente está incorreto ou foi redefinido.",
     discord_invalid_grant:"O código de autorização não foi aceito: pode ter expirado, sido usado anteriormente ou não coincidir com a verificação PKCE e a URL de retorno.",
     discord_invalid_request:"O Discord rejeitou um parâmetro da troca OAuth. Vamos conferir o formato da solicitação.",
     discord_invalid_scope:"O Discord rejeitou alguma das permissões solicitadas.",
     discord_unauthorized_client:"A aplicação do Discord não está autorizada a usar este fluxo OAuth.",
     discord_unsupported_grant_type:"O Discord não aceitou o tipo de concessão configurado.",
     discord_rate_limited:"O Discord está limitando tentativas. Aguarde antes de tentar novamente.",
     discord_unavailable:"O serviço OAuth do Discord está temporariamente indisponível.",
     owner:"A conta do Discord autorizada não corresponde ao ID do proprietário cadastrado no Bushin.",
     guild:"O Discord não confirmou essa conta como membro do Naruto Project RP.",
     scope:"O Discord não concedeu todas as três permissões de identidade solicitadas.",
     expired:"O tempo para autorizar expirou. Inicie uma nova tentativa.",
     service:"O servidor encontrou uma falha temporária. Sua senha não foi exposta."
   };
   const hint=reasons[err]||"A autorização não pôde ser concluída. Não envie códigos ou tokens.";
   return mPage("Login não concluído",'<p>'+mEsc(hint)+'</p><p class="muted">Diagnóstico: '+mEsc(Object.hasOwn(reasons,err)?err:"service")+'</p><a class="button" href="/mobile/start">Tentar novamente</a>');
 }
 const raw=mCookie(req,M_SESSION);
 if(/^[A-Za-z0-9_-]{40,80}$/.test(raw)){
   const row=await q(env,"SELECT * FROM mobile_user_sessions WHERE token_hash=? AND expires_at>?",await digest(raw),now()).first();
   if(row?.user_id===env.BUSHIN_OWNER_DISCORD_ID){
     try{const c=await unseal(row.creds_encrypted,env);if(c.expires>now()+30000){
       const me=await verified(env,c);
       return mPage("Discord conectado",'<p class="ok">✓ Conta verificada</p><div class="user">'+mEsc(me.display_name)+'</div><p>@'+mEsc(me.username)+'</p><p class="ok">✓ Membro do Naruto Project RP</p><form method="post" action="/mobile/logout"><button class="button" type="submit">Desconectar</button></form>');
     }}catch{}
   }
 }
 return mPage("Bushin no celular",'<p>Toque para autorizar a sua conta na página oficial do Discord.</p><a class="button" href="/mobile/start">Conectar com Discord</a><p class="muted">Não informe sua senha nesta página.</p>');
}
async function mobileStart(req,env){
 const b=ready(env),state="mobile."+rnd(),verifier=rnd()+rnd().slice(0,12);
 await q(env,"DELETE FROM mobile_oauth_flows WHERE expires_at<?",now()).run();
 await q(env,"INSERT INTO mobile_oauth_flows (state_hash,discord_verifier,expires_at) VALUES (?,?,?)",await digest(state),verifier,now()+10*minute).run();
 const u=new URL("https://discord.com/oauth2/authorize");
 for(const [k,v] of Object.entries({client_id:DISCORD_CLIENT_ID,redirect_uri:b+"/oauth/discord/callback",response_type:"code",scope:SCOPES.join(" "),state,code_challenge_method:"S256",code_challenge:await digest(verifier),prompt:"consent"}))u.searchParams.set(k,v);
 return mGo(u.toString(),[mSet(M_FLOW,state,600)]);
}
async function mobileCallback(req,env){
 const b=ready(env),p=new URL(req.url).searchParams,state=p.get("state")||"";
 if(!/^mobile\.[A-Za-z0-9_-]{40,80}$/.test(state)||mCookie(req,M_FLOW)!==state)return mGo("/mobile?error=state");
 const row=await q(env,"DELETE FROM mobile_oauth_flows WHERE state_hash=? AND expires_at>? RETURNING *",await digest(state),now()).first();
 if(!row)return mGo("/mobile?error=expired",[mSet(M_FLOW,"",0)]);
 if(!p.get("code")||p.get("error")||(p.get("iss")&&p.get("iss")!=="https://discord.com"))return mGo("/mobile?error=denied",[mSet(M_FLOW,"",0)]);
 try{
   const creds=await discordToken(env,{grant_type:"authorization_code",code:p.get("code"),redirect_uri:b+"/oauth/discord/callback",code_verifier:row.discord_verifier});
   const profile=await verified(env,creds),session=rnd()+rnd().slice(0,12),until=Math.min(now()+12*60*minute,creds.expires-30000);
   if(until<=now())throw Error("Expired login");
   await q(env,"INSERT INTO mobile_user_sessions (token_hash,user_id,creds_encrypted,expires_at) VALUES (?,?,?,?)",await digest(session),profile.id,await seal(creds,env),until).run();
   return mGo("/mobile",[mSet(M_FLOW,"",0),mSet(M_SESSION,session,Math.floor((until-now())/1000))]);
 }catch(e){
   const msg=String(e?.message||"");
   const supported=new Set(["discord_auth","discord_invalid_client","discord_invalid_grant","discord_invalid_request","discord_invalid_scope","discord_unauthorized_client","discord_unsupported_grant_type","discord_rate_limited","discord_unavailable"]);
   const kind=msg.includes("not the Bushin owner")?"owner":
     msg.includes("not in Naruto Project RP")?"guild":
     e?.errorCode==="invalid_scope"?"scope":
     supported.has(e?.errorCode)?e.errorCode:"service";
   return mGo("/mobile?error="+kind,[mSet(M_FLOW,"",0)]);
 }
}
async function mobileLogout(req,env){
 if(req.headers.get("origin")!==ready(env))return reply({error:"Invalid origin"},403);
 const session=mCookie(req,M_SESSION);
 if(/^[A-Za-z0-9_-]{40,80}$/.test(session))await q(env,"DELETE FROM mobile_user_sessions WHERE token_hash=?",await digest(session)).run();
 return mGo("/mobile",[mSet(M_SESSION,"",0)]);
}

export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    try{
      const b=base(env);
      if(new URL(req.url).origin!==b)return reply({error:"Unrecognized host"},403);
      if((path==="/"||path==="/mobile")&&req.method==="GET")return await mobileHome(req,env);
      if(path==="/mobile/start"&&req.method==="GET")return await mobileStart(req,env);
      if(path==="/mobile/logout"&&req.method==="POST")return await mobileLogout(req,env);
      if(path==="/oauth/discord/callback"&&req.method==="GET"&&new URL(req.url).searchParams.get("state")?.startsWith("mobile."))return await mobileCallback(req,env);
      if(path==="/health"&&req.method==="GET")return reply({
        app:"Bushin Browser — Discord Direct (Cloudflare)",client_id:DISCORD_CLIENT_ID,
        connected:false,login_required:true,backend:"cloudflare-workers",
        no_github_dependency:true,configuration_ready:!!(env.DB&&env.DISCORD_CLIENT_SECRET&&
          env.ENCRYPTION_KEY_BASE64&&env.BUSHIN_OWNER_DISCORD_ID)
      });
      if(path==="/.well-known/oauth-protected-resource"||path==="/.well-known/oauth-protected-resource/mcp")
        return reply({resource:b+"/mcp",authorization_servers:[b],scopes_supported:SCOPES});
      if(path==="/.well-known/oauth-authorization-server")return reply(oauthMetadata(env));
      if(path==="/oauth/register"&&req.method==="POST")return await register(req,env);
      if(path==="/oauth/authorize"&&req.method==="GET")return await authorize(req,env);
      if(path==="/oauth/discord/callback"&&req.method==="GET")return await discordCallback(req,env);
      if(path==="/oauth/token"&&req.method==="POST")return await token(req,env);
      if(path==="/mcp"&&req.method==="POST")return await mcp(req,env);
      return reply({error:"Not found"},404);
    }catch(e){return oauthReply(e);}
  }
};
