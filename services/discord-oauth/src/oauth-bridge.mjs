/**
 * Bushin's OWN OAuth 2.1 facade for ChatGPT -> Discord OAuth2.
 *
 * ChatGPT uses DCR + authorization_code + PKCE S256 with our stable HTTPS host.
 * Discord uses the owner's application ID and confidential server-side code
 * exchange. ChatGPT receives only opaque, audience-bound Bushin tokens, never
 * the user's Discord token/refresh token. Transient in-memory storage is used
 * for beta: restart or replica migration invalidates login (not production HA).
 *
 * All secrets are injected in the HTTPS host's protected environment.
 */
import {randomBytes,createHash,timingSafeEqual} from "node:crypto";
import {APPLICATION_CLIENT_ID,OAUTH_SCOPES,authorizedProfile,narutoMembership} from "./discord-api.mjs";

const now=()=>Date.now();
const random=()=>randomBytes(32).toString("base64url");
const sha256=value=>createHash("sha256").update(value).digest("base64url");
const safe=(a,b)=>typeof a==="string" && typeof b==="string" &&
  Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(code="invalid_request",message="Invalid OAuth request",http=400)=>Object.assign(
  new Error(message),{oauth_code:code,http_status:http});

export function isAllowedClientRedirect(raw){
  if(typeof raw!=="string"||raw.length>300)return false;
  let u;try{u=new URL(raw);}catch{return false;}
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.search)return false;
  if(u.hostname!=="chatgpt.com" ||u.port)return false;
  return u.pathname==="/connector_platform_oauth_redirect"||
    /^\/connector\/oauth\/[a-zA-Z0-9_-]{6,120}$/.test(u.pathname);
}
export function isValidPkceChallenge(value){
  return typeof value==="string"&&/^[A-Za-z0-9_-]{43,128}$/.test(value);
}
export function isValidPkceVerifier(value){
  return typeof value==="string"&&/^[A-Za-z0-9_.~-]{43,128}$/.test(value);
}
export function verifyPkce(verifier,challenge){
  return isValidPkceVerifier(verifier)&&isValidPkceChallenge(challenge)&&safe(sha256(verifier),challenge);
}
export const scopes=Object.freeze([...OAUTH_SCOPES]);
const limit=100;
const clients=new Map(),transactions=new Map(),codes=new Map(),accesses=new Map(),refreshes=new Map();
const THIRTY_DAYS=30*86400000, TEN_MINUTES=600000, TWENTY_FIVE_MINUTES=1500000;
let config=null;
export function configureOAuth({publicBase,ownerId,clientSecret,fetchImpl=fetch}){
  if(!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(publicBase||""))throw Error("PUBLIC_BASE_URL requires stable HTTPS origin.");
  if(typeof ownerId!=="string"||!/^[0-9]{15,22}$/.test(ownerId))throw Error("BUSHIN_OWNER_DISCORD_ID must be set securely.");
  if(typeof clientSecret!=="string"||clientSecret.length<20)throw Error("DISCORD_CLIENT_SECRET is missing in hosting secrets.");
  config={publicBase,ownerId,clientSecret,fetchImpl};
}
export function requireOAuthConfigured(){
  if(!config)throw fail("temporarily_unavailable","Discord OAuth hosting secrets missing.",503);
  return config;
}
function prune(){
  for(const map of [clients,transactions,codes,accesses,refreshes]){
    for(const [id,x] of map)if(x.expiresAt<=now())map.delete(id);
  }
}
function reserve(map,item,expiresMs){
  prune();
  if(map.size>=limit)throw fail("temporarily_unavailable","Too many pending OAuth sessions.",429);
  const key=random();map.set(key,{...item,expiresAt:now()+expiresMs});return key;
}
function userScope(input){
  if(typeof input!=="string")return null;
  const arr=input.trim().split(/\s+/).filter(Boolean);
  if(!arr.length||new Set(arr).size!==arr.length||arr.some(x=>!scopes.includes(x))||
    !arr.includes("identify")||!arr.includes("guilds"))return null;
  return arr;
}
export function metadata(){
  const {publicBase}=requireOAuthConfigured();
  return {
    issuer:publicBase,
    authorization_endpoint:publicBase+"/oauth/authorize",
    token_endpoint:publicBase+"/oauth/token",
    registration_endpoint:publicBase+"/oauth/register",
    response_types_supported:["code"],
    grant_types_supported:["authorization_code","refresh_token"],
    token_endpoint_auth_methods_supported:["none"],
    code_challenge_methods_supported:["S256"],
    scopes_supported:scopes,
    client_id_metadata_document_supported:false,
    authorization_response_iss_parameter_supported:true
  };
}
export function registerOAuthClient(payload){
  requireOAuthConfigured();prune();
  if(!payload||typeof payload!=="object")throw fail();
  if(!Array.isArray(payload.redirect_uris)||payload.redirect_uris.length<1||
      payload.redirect_uris.length>3||!payload.redirect_uris.every(isAllowedClientRedirect)) {
    throw fail("invalid_redirect_uri","Only official ChatGPT callback URLs can be registered.");
  }
  if(payload.token_endpoint_auth_method&&payload.token_endpoint_auth_method!=="none")
    throw fail("invalid_client_metadata","PKCE public client authentication only.");
  if(payload.grant_types && (payload.grant_types.length!==2||
      !payload.grant_types.includes("authorization_code")||
      !payload.grant_types.includes("refresh_token")))throw fail("invalid_client_metadata");
  const client_id=reserve(clients,{redirect_uris:[...payload.redirect_uris]},THIRTY_DAYS);
  return {client_id,client_id_issued_at:Math.floor(now()/1000),
    redirect_uris:payload.redirect_uris,
    grant_types:["authorization_code","refresh_token"],
    response_types:["code"],token_endpoint_auth_method:"none"};
}
export function beginAuthorize(query){
  const {publicBase}=requireOAuthConfigured();prune();
  const client=clients.get(query.client_id||"");
  if(!client)throw fail("invalid_client","Unknown OAuth client.",401);
  if(!client.redirect_uris.includes(query.redirect_uri))throw fail("invalid_request","Redirect URI mismatch.");
  if(query.response_type!=="code")throw fail("unsupported_response_type","Use authorization code.");
  if(query.code_challenge_method!=="S256"||!isValidPkceChallenge(query.code_challenge))
    throw fail("invalid_request","PKCE S256 is mandatory.");
  if(typeof query.state!=="string"||query.state.length<8||query.state.length>500)
    throw fail("invalid_request","Missing OAuth CSRF state.");
  if(query.resource!==publicBase+"/mcp")throw fail("invalid_target","Invalid MCP resource audience.");
  const requested=userScope(query.scope||scopes.join(" "));
  if(!requested)throw fail("invalid_scope","Invalid requested scope.");
  const discordState=reserve(transactions,{
    clientId:query.client_id,redirectUri:query.redirect_uri,
    clientState:query.state,pkceChallenge:query.code_challenge,
    scope:requested,resource:query.resource,
    discordVerifier:random()
  },TEN_MINUTES);
  const challenge=sha256(transactions.get(discordState).discordVerifier);
  const toDiscord=new URL("https://discord.com/oauth2/authorize");
  for(const [k,v] of Object.entries({
    client_id:APPLICATION_CLIENT_ID,response_type:"code",
    redirect_uri:publicBase+"/oauth/discord/callback",scope:requested.join(" "),
    state:discordState,code_challenge_method:"S256",code_challenge:challenge,
    prompt:"consent"
  }))toDiscord.searchParams.set(k,v);
  return toDiscord.toString();
}
async function exchangeDiscord(params){
  const {clientSecret,fetchImpl}=requireOAuthConfigured();
  const payload=new URLSearchParams(params);
  const resp=await fetchImpl("https://discord.com/api/v10/oauth2/token",{
    method:"POST",headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "Authorization":"Basic "+Buffer.from(APPLICATION_CLIENT_ID+":"+clientSecret).toString("base64"),
      "Accept":"application/json"
    },body:payload,signal:AbortSignal.timeout(9000)
  });
  if(!resp.ok)throw fail("access_denied","Discord rejected OAuth authorization.");
  const data=await resp.json();
  if(!data?.access_token || !data?.refresh_token || !Number.isFinite(data.expires_in))
    throw fail("server_error","Invalid Discord OAuth response.");
  return {
    discordAccess:data.access_token,discordRefresh:data.refresh_token,
    discordExpiresAt:now()+Math.max(10,data.expires_in)*1000,
    grantedScopes:String(data.scope||"").split(/\s+/).filter(Boolean)
  };
}
function completionRedirect(tx,code,error){
  const {publicBase}=requireOAuthConfigured();
  const url=new URL(tx.redirectUri);
  url.searchParams.set("state",tx.clientState);
  url.searchParams.set("iss",publicBase);
  if(error)url.searchParams.set("error",error);
  else url.searchParams.set("code",code);
  return url.toString();
}
export async function discordCallback(query){
  requireOAuthConfigured();prune();
  const state=String(query.state||"");
  const tx=transactions.get(state);
  if(!tx)throw fail("invalid_request","Login expirado: inicie novamente.");
  transactions.delete(state); // One-time, even if Discord denies/replays.
  if(query.error)return completionRedirect(tx,null,"access_denied");
  if(query.iss && query.iss!=="https://discord.com")
    return completionRedirect(tx,null,"access_denied");
  if(typeof query.code!=="string"||query.code.length<5)
    return completionRedirect(tx,null,"access_denied");
  try{
    const v=await exchangeDiscord({
      grant_type:"authorization_code",code:query.code,
      redirect_uri:config.publicBase+"/oauth/discord/callback",
      code_verifier:tx.discordVerifier
    });
    const user=await authorizedProfile(v.discordAccess,config.ownerId,config.fetchImpl);
    const membership=await narutoMembership(v.discordAccess,config.ownerId,config.fetchImpl);
    if(!membership.member)throw fail("access_denied","Account not in Naruto RP.");
    const code=reserve(codes,{
      clientId:tx.clientId,redirectUri:tx.redirectUri,
      pkceChallenge:tx.pkceChallenge,scope:tx.scope,
      userId:user.id,resource:tx.resource,...v
    },TEN_MINUTES);
    return completionRedirect(tx,code,null);
  }catch{
    return completionRedirect(tx,null,"access_denied");
  }
}
function validateClient(body){
  const client=clients.get(body.client_id);
  if(!client)throw fail("invalid_client","Registered client unavailable.",401);
  if(body.resource!==config.publicBase+"/mcp")throw fail("invalid_target","Wrong MCP audience.");
  return client;
}
function issueTokens(session,includeRefresh=true){
  const payload={...session};
  const access=reserve(accesses,payload,TWENTY_FIVE_MINUTES);
  let refresh=null;
  if(includeRefresh)refresh=reserve(refreshes,payload,THIRTY_DAYS);
  return {access_token:access,token_type:"Bearer",expires_in:1500,
    scope:payload.scope.join(" "),...(refresh?{refresh_token:refresh}:{})};
}
export async function exchangeOAuthToken(body){
  requireOAuthConfigured();prune();
  if(!body||typeof body!=="object")throw fail();
  const client=validateClient(body);
  if(body.grant_type==="authorization_code"){
    const record=codes.get(body.code||"");
    if(!record)throw fail("invalid_grant","Unknown, expired or used code.");
    codes.delete(body.code); // Prevent reuse regardless of PKCE success.
    if(record.clientId!==body.client_id || record.redirectUri!==body.redirect_uri ||
       !client.redirect_uris.includes(body.redirect_uri) ||
       !verifyPkce(body.code_verifier,record.pkceChallenge))
      throw fail("invalid_grant","OAuth code binding or PKCE failed.");
    return issueTokens(record);
  }
  if(body.grant_type==="refresh_token"){
    const record=refreshes.get(body.refresh_token||"");
    if(!record)throw fail("invalid_grant","Refresh token missing or expired.");
    refreshes.delete(body.refresh_token); // Rotate on every use.
    if(record.clientId!==body.client_id)throw fail("invalid_grant");
    let current={...record};
    if(current.discordExpiresAt < now()+120000) {
      const fresh=await exchangeDiscord({grant_type:"refresh_token",refresh_token:record.discordRefresh});
      current={...record,...fresh};
      const user=await authorizedProfile(current.discordAccess,config.ownerId,config.fetchImpl);
      if(user.id!==record.userId)throw fail("invalid_grant","Discord identity changed.");
    }
    return issueTokens(current);
  }
  throw fail("unsupported_grant_type","Only authorization_code and refresh_token.");
}
export function resolveOAuthAccess(value){
  requireOAuthConfigured();prune();
  if(typeof value!=="string")return null;
  const token=accesses.get(value);
  if(!token||token.resource!==config.publicBase+"/mcp")return null;
  if(!token.grantedScopes.every(s=>scopes.includes(s))||
      !["identify","guilds"].every(s=>token.grantedScopes.includes(s)))return null;
  if(token.discordExpiresAt<=now())return null;
  return {discordToken:token.discordAccess,userId:token.userId,scope:token.scope};
}
export function oauthErrorBody(e){
  return {error:e?.oauth_code||"server_error",error_description:String(e?.message||"OAuth failed").slice(0,150)};
}
export function oauthStatus(e){return e?.http_status||500;}
