/**
 * Bushin Browser MCP App: native visual panel + direct Discord OAuth token.
 * This is the backend of the ORIGINAL private Bushin plugin, not a replacement.
 * No Discord self-bot, Discord password input, DM access or message posting.
 *
 * Requires a stable HTTPS origin, Discord app authorization configured through
 * the host's OAuth linking UI, and restricted GitHub + owner secrets in hosting.
 */
import express from "express";
import {readFileSync} from "node:fs";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {registerAppTool,registerAppResource,RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import {z} from "zod";
import {APPLICATION_CLIENT_ID,OAUTH_SCOPES,readBearer,
  authorizedProfile,narutoMembership,DiscordAuthError} from "./discord-api.mjs";
import {CHANNELS,GUILD,safeBrowserAction,browserStatus,
  browserCommand,browserScreenshot} from "./github-bridge.mjs";

const publicBase=process.env.PUBLIC_BASE_URL?.replace(/\/$/,"");
const ownerId=process.env.BUSHIN_OWNER_DISCORD_ID||"";
const port=Number(process.env.PORT||3000);
if(!publicBase || !/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(publicBase)){
  throw new Error("Set PUBLIC_BASE_URL to a fixed HTTPS origin before starting Bushin MCP.");
}
const app=express();
app.disable("x-powered-by");
app.use(express.json({limit:"32kb"}));
app.use((_req,res,next)=>{
  res.set("X-Content-Type-Options","nosniff");
  res.set("Cache-Control","no-store");
  next();
});
const resource=publicBase+"/mcp";
const resourceMetadata=publicBase+"/.well-known/oauth-protected-resource";
const challenge='Bearer resource_metadata="'+resourceMetadata+'"';
const authScheme=[{type:"oauth2",scopes:OAUTH_SCOPES}];
const uiUri="ui://bushin-browser/browser-console-v2.html";
const uiHtml=readFileSync(new URL("../public/browser-console.html",import.meta.url),"utf8");
function errorReply(e){
  const unauthorized=(e instanceof DiscordAuthError && e.status===401)||
    /login|Autorização|token|oauth/i.test(e?.message||"");
  return {isError:true,content:[{type:"text",text:String(e?.message||"Falha do Bushin").slice(0,300)}],
          ...(unauthorized?{_meta:{"mcp/www_authenticate":[challenge]}}:{})};
}
async function requireDiscord(token){
  if(!token)throw new DiscordAuthError("Conecte o Discord ao Bushin pela tela segura do ChatGPT.",401);
  if(!ownerId)throw new Error("Configure o identificador do proprietário em BUSHIN_OWNER_DISCORD_ID no servidor HTTPS.");
  const details=await narutoMembership(token,ownerId);
  if(!details.member)throw new DiscordAuthError("Esta conta não pertence ao Naruto Project RP.",403);
  return details;
}
function reply(value){
  return {content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value};
}
function registerTool(server,name,title,description,fields,fn,annotations={readOnlyHint:true}){
  server.registerTool(name,{
    title,description,inputSchema:fields,annotations,
    securitySchemes:authScheme,
    _meta:{securitySchemes:authScheme}
  }, async (args)=>{
    try{return reply(await fn(args||{}));}
    catch(e){return errorReply(e);}
  });
}
function createServer(token){
  const server=new McpServer({name:"bushin-browser",version:"2.0.0"});
  registerTool(server,"bushin_discord_whoami","Conta Discord conectada",
    "Verifica via OAuth2 oficial a conta Discord conectada diretamente ao Bushin. Não expõe e-mail, tokens ou DMs.",{},
    async()=>{if(!token)throw new DiscordAuthError("Faça login pelo Discord.",401);
      return authorizedProfile(token,ownerId);});
  registerTool(server,"bushin_discord_naruto_membership","Vínculo Naruto RP",
    "Confere via Discord OAuth2 se a conta conectada está no servidor Naruto Project RP. Não lê mensagens.",{},
    async()=>{if(!token)throw new DiscordAuthError("Faça login pelo Discord.",401);
      return narutoMembership(token,ownerId);});
  registerTool(server,"bushin_browser_status","Status do navegador remoto",
    "Confere a execução Linux Bushin no GitHub Actions. Não lê DMs.",{},
    async()=>{await requireDiscord(token);return browserStatus();});
  server.registerTool("bushin_browser_action",{
    title:"Controlar navegador Naruto RP",
    description:"Ações seguras e limitadas ao navegador visual autorizado: status, clique, rolagem, navegação, inspeção e leitura. Não envia Discord mensagens.",
    inputSchema:{
      action:z.enum(["status","scroll","click","open_url","press","inspect_ui","read_page_text"]),
      channel:z.enum(["chamar-rp","chat-geral","guias"]).optional(),
      direction:z.enum(["up","down"]).optional(),amount:z.number().int().min(1).max(8).optional(),
      x:z.number().int().min(0).max(1364).optional(),
      y:z.number().int().min(0).max(767).optional(),
      key:z.enum(["Escape","Tab","Shift+Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight",
          "PageUp","PageDown","Home","End"]).optional()
    },
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
    securitySchemes:authScheme,
    _meta:{securitySchemes:authScheme}
  },async(args)=>{
    try{
      await requireDiscord(token);
      const payload=Object.fromEntries(Object.entries(args).filter(([k])=>k!=="action"));
      if(args.action==="open_url"){
        if(!Object.prototype.hasOwnProperty.call(CHANNELS,payload.channel))throw new Error("Canal desconhecido.");
        payload.url="https://discord.com/channels/"+GUILD+"/"+CHANNELS[payload.channel];
      }
      const safe=safeBrowserAction(args.action,payload);
      const {action,...params}=safe;
      const result=await browserCommand(action,params);
      return reply(result);
    }catch(e){return errorReply(e);}
  });
  server.registerTool("bushin_browser_screenshot",{
    title:"Captura real do navegador Bushin",
    description:"Captura a tela real do Chrome no canal Naruto RP e retorna um JPEG verificado do GitHub Actions. Fotos são estáticas, não stream ao vivo. Limites do runner se aplicam.",
    inputSchema:{},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
    securitySchemes:authScheme,
    _meta:{securitySchemes:authScheme}
  },async()=>{
    try {
      await requireDiscord(token);
      const data=await browserScreenshot();
      return {
        content:[
          {type:"text",text:"Captura real e verificada do Bushin, canal: "+String(data.visible_page||"RP")},
          {type:"image",data:data.jpeg_base64,mimeType:"image/jpeg"}
        ],
        structuredContent:{...data}
      };
    }catch(e){return errorReply(e);}
  });
  registerAppResource(server,"bushin-browser-console",uiUri,{},async()=>({
    contents:[{uri:uiUri,mimeType:RESOURCE_MIME_TYPE,text:uiHtml,
      _meta:{"openai/ui":{availableDisplayModes:["inline","fullscreen"]},
        ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}}}
    }]
  }));
  registerAppTool(server,"bushin_open_browser_console",{
    title:"Abrir o painel visual do Bushin",
    description:"Exibe um painel interativo no ChatGPT com botões e screenshots reais do Linux no GitHub, similar a um navegador remoto em etapas.",
    inputSchema:{},
    securitySchemes:authScheme,
    annotations:{readOnlyHint:true,destructiveHint:false},
    _meta:{ui:{resourceUri:uiUri},
      "openai/ui":{entrypoints:[{type:"thread"}]},
      securitySchemes:authScheme}
  },async()=>{
    try {
      await requireDiscord(token);
      return reply({status:"authenticated",...(await browserStatus()),
        note:"Capturas reais sob demanda, sem streaming e sem mensagens pessoais."});
    }catch(e){
      // Show panel with useful setup instruction instead of a fabricated screenshot.
      return {...errorReply(e),structuredContent:{error:e.message||"Conexão indisponível"}};
    }
  });
  return server;
}
app.get("/health",(_req,res)=>res.json({
  service:"Bushin Browser MCP",version:"2.0.0",
  client_id:APPLICATION_CLIENT_ID,oauth_provider:"discord",
  login_required:true,connected:false,
  note:"Service readiness does not prove Discord login, GitHub browser or active session."
}));
for(const path of ["/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp"]){
  app.get(path,(_req,res)=>res.json({
    resource,authorization_servers:["https://discord.com"],scopes_supported:OAUTH_SCOPES
  }));
}
app.post("/mcp",async(req,res)=>{
  const origin=req.get("origin");
  if(origin && origin!==publicBase)return res.sendStatus(403);
  const token=readBearer(req.get("authorization"));
  if(req.body?.method==="tools/call" && !token){
    res.set("WWW-Authenticate",challenge);
    return res.status(401).json({error:"Bushin Discord OAuth required"});
  }
  const server=createServer(token);
  const transport=new StreamableHTTPServerTransport({
    sessionIdGenerator:undefined,enableJsonResponse:true
  });
  res.on("close",()=>{
    Promise.resolve(transport.close()).catch(()=>{});
    Promise.resolve(server.close()).catch(()=>{});
  });
  try{
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  }catch(e){
    // Do not log request, authorization headers, OAuth codes or page content.
    if(!res.headersSent)res.status(500).json({error:"MCP transport failed"});
  }
});
app.get("/mcp",(_req,res)=>res.status(405).end());
app.delete("/mcp",(_req,res)=>res.status(405).end());
app.listen(port,"0.0.0.0",()=>console.log("Bushin MCP 2.0 listening on port "+port));
