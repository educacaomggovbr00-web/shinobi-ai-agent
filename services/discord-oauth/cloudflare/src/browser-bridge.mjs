/**
 * Bushin Browser — optional GitHub Actions visual-session bridge.
 * Discord OAuth authenticates ONLY the named Bushin owner before these MCP
 * functions are dispatched. This transport never receives Discord cookies.
 *
 * The Linux listener validates destinations/actions independently.
 * No personal-message sending, DMs, terminal, passwords, or arbitrary URLs.
 */
const REPO = "educacaomggovbr00-web/shinobi-ai-agent";
const GUILD = "1515877468299595919";
const BASE = "https://api.github.com/repos/" + REPO;
const GITHUB_HEADERS = token => ({
  authorization: "Bearer " + token,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "Bushin-Browser-Cloudflare"
});
const initialized = env => typeof env.BUSHIN_GITHUB_TOKEN === "string" && env.BUSHIN_GITHUB_TOKEN.length >= 20;
async function github(env, route, init={}) {
  if (!initialized(env)) throw Error("Ponte do navegador não configurada: falta BUSHIN_GITHUB_TOKEN na Cloudflare.");
  const res = await fetch(BASE + route, {
    ...init,
    headers: {...GITHUB_HEADERS(env.BUSHIN_GITHUB_TOKEN), ...(init.body ? {"content-type":"application/json"}:{})},
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw Error("GitHub não autorizou a ponte ou a sessão não está disponível (HTTP " + res.status + ").");
  return res.json();
}
function decodeBase64(str) {
  return new TextDecoder().decode(Uint8Array.from(atob(str.replace(/\s/g,"")), c => c.charCodeAt(0)));
}
function encodeBase64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
async function liveRun(env) {
  const runs = await github(env, "/actions/workflows/bushin-discord-live.yml/runs?status=in_progress&per_page=10");
  const active = (runs.workflow_runs || []).find(r => r.status === "in_progress" && r.head_branch === "main");
  if (!active) return null;
  return {id: String(active.id), started_at: active.run_started_at || active.created_at};
}
const COMMAND = "/contents/browser_actions/live_command.json?ref=main";
const RESULT = "/contents/browser_actions/live_result.json?ref=main";
async function readJson(env, path) {
  const v = await github(env,path);
  return {sha:v.sha, json:JSON.parse(decodeBase64(v.content))};
}
function channelUrl(value) {
  if (typeof value!=="string" || value.length>180) throw Error("URL inválida.");
  const url=new URL(value);
  if (url.protocol!=="https:" || url.hostname!=="discord.com" || url.search || url.hash ||
      !new RegExp("^/channels/"+GUILD+"/[0-9]{15,22}$").test(url.pathname))
      throw Error("Só canais autorizados do Naruto Project RP são permitidos.");
  return url.origin+url.pathname;
}
function validate(action, args) {
  const c={action};
  if (["status","read_page_text","rpg_view","inspect_ui","screenshot"].includes(action)) return c;
  if (action==="tabs") {
    if (args.tab_index!==undefined && (!Number.isInteger(args.tab_index)||args.tab_index<0||args.tab_index>20))
      throw Error("Índice da aba inválido.");
    if (args.tab_index!==undefined)c.tab_index=args.tab_index;
    return c;
  }
  if (action==="compose_message") {
    c.channel_url=channelUrl(args.channel_url);
    if(typeof args.text!=="string"||!args.text.trim()||args.text.length>500||/[\r\n]/.test(args.text)||/@(?:everyone|here)\b/i.test(args.text))
      throw Error("Mensagem de rascunho inválida.");
    c.text=args.text;
    return c;
  }
  if (action==="capture_gallery") {
    if(!Array.isArray(args.urls)||args.urls.length<2||args.urls.length>4)
      throw Error("Galeria exige de 2 a 4 canais.");
    c.urls=args.urls.map(channelUrl);
    if(new Set(c.urls).size!==c.urls.length)throw Error("Canais duplicados.");
    return c;
  }
  if (action==="open_url") {c.url=channelUrl(args.url);return c;}
  if (action==="rpg_scout") {
    if (!Array.isArray(args.urls) || args.urls.length<1 || args.urls.length>4) throw Error("Informe de 1 a 4 canais.");
    c.urls=args.urls.map(channelUrl);
    if (new Set(c.urls).size!==c.urls.length) throw Error("Canais duplicados.");
    return c;
  }
  if (action==="scroll") {
    if (!["up","down"].includes(args.direction)) throw Error("Direção inválida.");
    if (!Number.isInteger(args.amount)||args.amount<1||args.amount>8) throw Error("Rolagem deve ser 1 a 8.");
    c.direction=args.direction;c.amount=args.amount;return c;
  }
  if (action==="click") {
    if (!Number.isInteger(args.x)||args.x<0||args.x>=1365||!Number.isInteger(args.y)||args.y<0||args.y>=768) throw Error("Clique fora da tela.");
    c.x=args.x;c.y=args.y;return c;
  }
  if (action==="press") {
    if (!["Escape","Tab","Shift+Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","PageUp","PageDown","Home","End"].includes(args.key))
      throw Error("Tecla não permitida.");
    c.key=args.key;return c;
  }
  if (action==="type_search") {
    if (typeof args.text!=="string" || args.text.length<1 || args.text.length>100 || /[\r\n]/.test(args.text))
      throw Error("Texto de busca inválido.");
    c.text=args.text;return c;
  }
  throw Error("Ação não autorizada neste navegador.");
}
async function currentResult(env, id, runId) {
  const r=(await readJson(env,RESULT)).json;
  if (r.id !== id || String(r.session_id)!==runId)
    return {state:"queued",command_id:id,session_id:runId};
  return {state:r.ok?"completed":"failed",command_id:id,session_id:runId,
    action:r.action,ok:!!r.ok,...(r.ok?{data:r.data}:{error:String(r.error||"Falhou").slice(0,300)})};
}
export const BROWSER_TOOLS = [
 {name:"bushin_browser_status",title:"Status do navegador Bushin",
  description:"Verifica a ponte e a sessão visual Linux autorizada sem abrir ou alterar a conta Discord.",
  inputSchema:{type:"object",properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"bushin_browser_action",title:"Navegar no Discord com Bushin",
  description:"Comanda leitura, navegação, abas, capturas e preparação de rascunhos na sessão autorizada do Naruto RP. Nunca envia mensagens por esta ferramenta; confirme o resultado com bushin_browser_result.",
  inputSchema:{type:"object",properties:{
   action:{type:"string",enum:["status","read_page_text","rpg_view","rpg_scout","inspect_ui","open_url","scroll","click","press","type_search","screenshot","tabs","capture_gallery","compose_message"]},
   url:{type:"string"},urls:{type:"array",items:{type:"string"},minItems:1,maxItems:4},
   direction:{type:"string",enum:["up","down"]},amount:{type:"integer",minimum:1,maximum:8},
   x:{type:"integer",minimum:0,maximum:1364},y:{type:"integer",minimum:0,maximum:767},
   key:{type:"string"},text:{type:"string"},channel_url:{type:"string"},
   tab_index:{type:"integer",minimum:0,maximum:20}
  },required:["action"],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:"bushin_browser_result",title:"Resultado de ação do Bushin",
  description:"Confere o resultado real de um comando anteriormente enfileirado; não afirma sucesso sem resposta da sessão.",
  inputSchema:{type:"object",properties:{
   command_id:{type:"string",pattern:"^bushin-[a-f0-9-]{36}$"},
   session_id:{type:"string",pattern:"^[0-9]{8,20}$"}
  },required:["command_id","session_id"],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false}}
];
export async function browserCall(env,name,args={}) {
  if (!initialized(env)) return {configured:false,connected:false,
    reason:"BUSHIN_GITHUB_TOKEN ainda não foi configurado na área Secrets do Worker Cloudflare. Nenhum token deve ser enviado ao chat."};
  if(name==="bushin_browser_status") {
    const active=await liveRun(env);
    return {configured:true,connected:!!active,session:active,
      note:active?"Sessão detectada; estar ativo não comprova login no Discord.":"Nenhuma sessão Linux ativa foi detectada."};
  }
  if(name==="bushin_browser_result") {
    if (!/^bushin-[a-f0-9-]{36}$/.test(args.command_id||"") || !/^[0-9]{8,20}$/.test(args.session_id||""))
      throw Error("Identificador inválido.");
    return currentResult(env,args.command_id,args.session_id);
  }
  if(name!=="bushin_browser_action") throw Error("Ferramenta inexistente.");
  const c=validate(args.action,args);
  const active=await liveRun(env);
  if(!active) return {state:"unavailable",reason:"Nenhuma sessão visual Linux ativa. Uma sessão precisa ser iniciada e autenticada manualmente."};
  const id="bushin-"+crypto.randomUUID();
  const old=await readJson(env,COMMAND);
  await github(env,"/contents/browser_actions/live_command.json",{
    method:"PUT",
    body:JSON.stringify({message:"Bushin visual: "+c.action+" "+id,sha:old.sha,branch:"main",
      content:encodeBase64(JSON.stringify({id,session_id:active.id,...c})+"\n")})
  });
  for(let i=0;i<4;i++){
    await new Promise(resolve=>setTimeout(resolve,750));
    const state=await currentResult(env,id,active.id);
    if(state.state!=="queued") return state;
  }
  return {state:"queued",command_id:id,session_id:active.id,
    note:"Comando enviado, mas não confirmado. Use bushin_browser_result antes de declarar sucesso."};
}
