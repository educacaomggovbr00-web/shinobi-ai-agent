/**
 * Bushin bridge: private GitHub Actions browser commands, authenticated by the
 * owner Discord OAuth identity in server.mjs. No arbitrary browser navigation,
 * posting, DMs, shell access, cookies, passwords, or secrets in responses.
 * Set BUSHIN_GITHUB_TOKEN in the HTTPS host's SECRET manager, never in GitHub.
 */
import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

export const REPO = "educacaomggovbr00-web/shinobi-ai-agent";
export const GUILD = "1515877468299595919";
export const CHANNELS = Object.freeze({
  "chamar-rp":"1520116350360617154",
  "chat-geral":"1520114256740352061",
  "guias":"1544461080624111716"
});
const COMMAND = "browser_actions/live_command.json";
const RESULT = "browser_actions/live_result.json";
const ROOT = "https://api.github.com/repos/"+REPO;
export const SAFE_ACTIONS = Object.freeze(["status","screenshot","inspect_ui","read_page_text","scroll","click","open_url","press"]);
const NAV_KEYS = new Set(["Escape","Tab","Shift+Tab","ArrowUp","ArrowDown",
  "ArrowLeft","ArrowRight","PageUp","PageDown","Home","End"]);

export function safeChannelUrl(value) {
  if (typeof value !== "string" || value.length > 200) throw new Error("Canal inválido");
  let url;
  try {url=new URL(value);} catch {throw new Error("URL inválida");}
  if (url.protocol!=="https:" || url.hostname!=="discord.com"
      || url.username || url.password || url.search || url.hash || url.port) {
    throw new Error("Apenas canais Discord autorizados.");
  }
  if (!Object.values(CHANNELS).some(id=>url.pathname==="/channels/"+GUILD+"/"+id)) {
    throw new Error("Canal fora da lista autorizada.");
  }
  return url.toString();
}

export function safeBrowserAction(action, params={}) {
  if (!SAFE_ACTIONS.includes(action)) throw new Error("Ação indisponível no Bushin.");
  if (!params || typeof params!=="object" || Array.isArray(params)) throw new Error("Parâmetros inválidos.");
  const output={action};
  if (action==="scroll") {
    if (!["up","down"].includes(params.direction)) throw new Error("Direção inválida.");
    if (!Number.isInteger(params.amount) || params.amount<1 || params.amount>8) throw new Error("Rolagem inválida.");
    output.direction=params.direction;output.amount=params.amount;
  }
  if (action==="click") {
    if (!Number.isInteger(params.x) || !Number.isInteger(params.y) ||
        params.x<0 || params.y<0 || params.x>=1365 || params.y>=768) {
      throw new Error("Clique fora da janela do Bushin.");
    }
    output.x=params.x;output.y=params.y;
  }
  if (action==="open_url") output.url=safeChannelUrl(params.url);
  if (action==="press") {
    if (!NAV_KEYS.has(params.key)) throw new Error("Tecla que pode enviar mensagem bloqueada.");
    output.key=params.key;
  }
  return output; // Never pass caller-supplied extra fields into the GitHub command.
}

function githubToken() {
  const value=process.env.BUSHIN_GITHUB_TOKEN;
  if (!value || value.length<16) throw new Error("GitHub não conectado ao servidor Bushin: configurar token restrito de Actions/Contents no hosting.");
  return value;
}
async function gh(path,method="GET",body=undefined) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const res=await fetch(ROOT+path,{
      method,signal:controller.signal,
      headers:{"Authorization":"Bearer "+githubToken(),"Accept":"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28","User-Agent":"BushinBrowser/2.0",
        ...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!res.ok) throw new Error("GitHub: "+res.status+(res.status===401||res.status===403?" (permissões insuficientes)":""));
    return res.json();
  } finally {clearTimeout(timeout);}
}
async function getFile(path) {
  const data=await gh("/contents/"+path+"?ref=main");
  if(typeof data.content!=="string" || typeof data.sha!=="string") throw new Error("GitHub: conteúdo incompleto.");
  const decoded=Buffer.from(data.content.replace(/\s/g,""),"base64").toString("utf8");
  return {sha:data.sha,json:JSON.parse(decoded)};
}
async function liveRun() {
  const data=await gh("/actions/runs?per_page=20");
  const runs=Array.isArray(data.workflow_runs)?data.workflow_runs:[];
  const run=runs.find(x=>x.path===".github/workflows/bushin-discord-live.yml" && x.status==="in_progress");
  if(!run) throw new Error("Nenhuma sessão Linux Bushin ativa. Inicie uma no GitHub Actions com login seguro.");
  return {id:String(run.id),status:run.status,url:run.html_url};
}
export async function browserStatus() {
  const run=await liveRun();
  const file=await getFile(RESULT);
  return {run_id:run.id,run_url:run.url,status:run.status,
    last_result:file.json?.ok?{
      action:file.json.action,
      url:typeof file.json.data?.url==="string"?file.json.data.url:
          typeof file.json.data?.visible_page==="string"?file.json.data.visible_page:null,
      finished_at_utc:file.json.finished_at_utc||null
    }:null};
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
let queue=Promise.resolve();
export function enqueueBrowserOperation(task) {
  const pending=queue.then(task,task);
  queue=pending.then(()=>undefined,()=>undefined);
  return pending;
}
async function issueCommand(action,params) {
  const run=await liveRun();
  const checked=safeBrowserAction(action,params);
  const command={id:"bushin-mcp-"+randomBytes(9).toString("hex"),
    session_id:run.id,...checked};
  const previous=await getFile(COMMAND);
  await gh("/contents/"+COMMAND,"PUT",{
    message:"Bushin MCP: safe "+action+" on authorized Naruto RP",
    branch:"main",sha:previous.sha,
    content:Buffer.from(JSON.stringify(command,null,2)+"\n","utf8").toString("base64")
  });
  for(let i=0;i<9;i++) {
    await sleep(i===0?1500:5000);
    const {json}=await getFile(RESULT);
    if(json?.id!==command.id || String(json.session_id)!==run.id)continue;
    if(!json.ok)throw new Error("Bushin Linux: "+String(json.error||"comando recusado").slice(0,250));
    return {run_id:run.id,...json.data};
  }
  throw new Error("Bushin Linux não respondeu no prazo. O comando pode estar pendente; confira a sessão antes de repetir.");
}
export async function browserCommand(action,params={}) {
  return enqueueBrowserOperation(()=>issueCommand(action,params));
}

function acceptedArchiveLocation(location) {
  const url=new URL(location);
  if(url.protocol!=="https:")throw new Error("Arquivo fora de HTTPS.");
  const h=url.hostname;
  if(!(h.endsWith(".blob.core.windows.net") || h.endsWith(".githubusercontent.com")
       || h==="github.com" || h.endsWith(".actions.githubusercontent.com"))) {
     throw new Error("Host do artifact não autorizado.");
  }
  return url.toString();
}
export async function fetchScreenshot(artifactId,runId) {
  if(!Number.isSafeInteger(artifactId)||artifactId<=0)throw new Error("Artifact inválido.");
  if(!/^[0-9]{8,18}$/.test(String(runId)))throw new Error("Sessão inválida.");
  const catalog=await gh("/actions/runs/"+runId+"/artifacts?per_page=100");
  const entry=(catalog.artifacts||[]).find(x=>x.id===artifactId && x.expired===false
    && String(x.name||"").startsWith("bushin-snapshot-"+runId+"-"));
  if(!entry)throw new Error("Foto privada ausente ou expirada.");
  const response=await fetch(ROOT+"/actions/artifacts/"+artifactId+"/zip",{
    redirect:"manual",headers:{Authorization:"Bearer "+githubToken(),
    Accept:"application/vnd.github+json","User-Agent":"BushinBrowser/2.0"}
  });
  if(![301,302,303,307].includes(response.status))throw new Error("Não foi possível obter foto: "+response.status);
  const location=acceptedArchiveLocation(response.headers.get("location")||"");
  const download=await fetch(location,{redirect:"error"});
  if(!download.ok)throw new Error("Não foi possível baixar foto privada.");
  const bytes=new Uint8Array(await download.arrayBuffer());
  if(bytes.byteLength>1800000)throw new Error("Foto acima do limite.");
  const items=unzipSync(bytes);
  const image=Object.entries(items).find(([name,buffer])=>/^[^/\\]+\.jpe?g$/i.test(name)
    && buffer.length>500 && buffer.length<1200000 && buffer[0]===255 && buffer[1]===216);
  if(!image)throw new Error("Artifact sem JPEG verificado.");
  return {jpeg_base64:Buffer.from(image[1]).toString("base64"),
          mime:"image/jpeg",artifact_id:artifactId,run_id:String(runId),
          captured_at:entry.created_at};
}
export async function browserScreenshot() {
  return enqueueBrowserOperation(async()=>{
    const shot=await issueCommand("screenshot",{});
    const image=await fetchScreenshot(Number(shot.artifact_id),shot.run_id);
    return {run_id:shot.run_id,visible_page:shot.visible_page, ...image};
  });
}
