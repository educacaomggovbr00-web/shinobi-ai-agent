import express from "express";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {APPLICATION_CLIENT_ID, OAUTH_SCOPES, readBearer,
        authorizedProfile, narutoMembership, DiscordAuthError} from "./discord-api.mjs";

// The plugin stays the SAME original Bushin Browser. This process is its private MCP backend.
// An HTTPS deployment URL and Discord developer app callback must be configured before login works.
const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
const ownerId = process.env.BUSHIN_OWNER_DISCORD_ID || "";
const port = Number(process.env.PORT || 3000);
if (!publicBase || !/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(publicBase)) {
  throw new Error("Set PUBLIC_BASE_URL to the fixed HTTPS production origin before starting.");
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({limit:"32kb"}));

const authScheme = [{type:"oauth2", scopes:OAUTH_SCOPES}];
function mkServer(accessToken) {
  const server = new McpServer({name:"bushin-browser-discord", version:"0.1.0"});
  server.registerTool("bushin_discord_whoami", {
    title:"Minha conta Discord",
    description:"Confere por OAuth2 oficial a conta Discord que autorizou o Bushin (sem e-mail, DMs ou tokens).",
    inputSchema:{},
    annotations:{readOnlyHint:true, destructiveHint:false},
    securitySchemes:authScheme
  }, async () => {
    try {
      const data = await authorizedProfile(accessToken, ownerId);
      return {content:[{type:"text",text:JSON.stringify(data)}]};
    } catch (e) {
      return {isError:true,content:[{type:"text",text:e.message||"Erro de autenticação."}]};
    }
  });
  server.registerTool("bushin_discord_naruto_membership", {
    title:"Meu vínculo no Naruto Project RP",
    description:"Verifica oficialmente se a conta Discord é membro do servidor Naruto Project RP; não lê mensagens nem envia posts.",
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false},
    securitySchemes:authScheme
  }, async () => {
    try {
      const data = await narutoMembership(accessToken, ownerId);
      return {content:[{type:"text",text:JSON.stringify(data)}]};
    } catch (e) {
      return {isError:true,content:[{type:"text",text:e.message||"Erro de autenticação."}]};
    }
  });
  return server;
}

const resource = publicBase + "/mcp";
const metadataUrl = publicBase + "/.well-known/oauth-protected-resource";
app.get("/health", (_req,res) => res.set("Cache-Control","no-store").json({
  service:"Bushin Browser Discord MCP", client_id:APPLICATION_CLIENT_ID,
  oauth_provider:"discord", login_required:true,
  detail:"Serviço disponível; autorização da conta deve ser verificada por ferramenta autenticada."
}));
app.get("/.well-known/oauth-protected-resource", (_req,res) => res.set("Cache-Control","no-store").json({
  resource, authorization_servers:["https://discord.com"], scopes_supported:OAUTH_SCOPES
}));
app.post("/mcp", async (req,res) => {
  const origin=req.header("origin");
  if (origin && origin !== publicBase) return res.sendStatus(403);
  const token = readBearer(req.header("authorization"));
  if (req.body?.method === "tools/call" && !token) {
    res.set("WWW-Authenticate", 'Bearer resource_metadata="' + metadataUrl + '"');
    return res.status(401).json({error:"Discord OAuth authorization required"});
  }
  const server=mkServer(token);
  const transport=new StreamableHTTPServerTransport({
    sessionIdGenerator:undefined, enableJsonResponse:true
  });
  res.on("close",()=> {Promise.resolve(transport.close()).catch(()=>{});Promise.resolve(server.close()).catch(()=>{});});
  try {
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({error:"MCP request failed"});
  }
});
app.get("/mcp",(_req,res)=>res.status(405).end());
app.delete("/mcp",(_req,res)=>res.status(405).end());

app.listen(port,"0.0.0.0",()=> {
  console.log("Bushin Discord MCP running on port " + port + " (OAuth tokens never logged)");
});
