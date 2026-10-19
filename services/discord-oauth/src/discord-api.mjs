// Discord official OAuth access tokens arrive only through the HTTPS MCP Authorization header.
// Never persist tokens, user emails, raw API payloads, or OAuth codes in a file/log.
export const APPLICATION_CLIENT_ID = "1561589128108314636";
export const NARUTO_GUILD_ID = "1515877468299595919";
const API = "https://discord.com/api/v10";
export const OAUTH_SCOPES = Object.freeze(["identify", "guilds", "guilds.members.read"]);

export function readBearer(header) {
  if (typeof header !== "string" || !/^Bearer [A-Za-z0-9._~+\/=\-]{20,2048}$/.test(header)) return null;
  return header.slice(7);
}

export class DiscordAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "DiscordAuthError";
    this.status = status;
  }
}

export async function discordFetch(token, path, fetchImpl = fetch) {
  if (!token) throw new DiscordAuthError("Login do Discord necessário.", 401);
  const knownPaths = ["/users/@me", "/users/@me/guilds", "/users/@me/guilds/" + NARUTO_GUILD_ID + "/member"];
  if (!knownPaths.includes(path)) throw new Error("Discord endpoint não autorizado.");
  const response = await fetchImpl(API + path, {
    method:"GET",
    headers:{Authorization:"Bearer " + token, Accept:"application/json",
             "User-Agent":"BushinBrowser/1.9 (+https://github.com/educacaomggovbr00-web/shinobi-ai-agent)"},
    signal:AbortSignal.timeout(8500)
  });
  if (response.status === 401) throw new DiscordAuthError("Autorização Discord expirada ou inválida.", 401);
  if (response.status === 403) throw new DiscordAuthError("Escopo insuficiente para esta informação.", 403);
  if (response.status === 404) throw new DiscordAuthError("Informação do Discord indisponível para esta conta.", 404);
  if (!response.ok) throw new Error("Falha temporária no Discord (HTTP " + response.status + ").");
  const body = await response.json();
  if (!body || typeof body !== "object") throw new Error("Resposta inesperada do Discord.");
  return body;
}

export async function authorizedProfile(token, expectedUserId = "", fetchImpl = fetch) {
  const profile = await discordFetch(token, "/users/@me", fetchImpl);
  if (expectedUserId && profile.id !== expectedUserId) {
    throw new DiscordAuthError("Esta conta Discord não é a conta autorizada do Bushin.", 403);
  }
  return {id: String(profile.id || ""), username: String(profile.username || ""),
          display_name: String(profile.global_name || profile.username || ""),
          verified: !!profile.verified};
}

export async function narutoMembership(token, expectedUserId = "", fetchImpl = fetch) {
  const profile = await authorizedProfile(token, expectedUserId, fetchImpl);
  const guilds = await discordFetch(token, "/users/@me/guilds", fetchImpl);
  if (!Array.isArray(guilds)) throw new Error("Lista de servidores inválida.");
  const present = guilds.some(g => String(g.id) === NARUTO_GUILD_ID);
  if (!present) {
    return {username: profile.username, guild_id:NARUTO_GUILD_ID, member:false,
            note:"Conta não localizada na lista de servidores retornada pelo Discord."};
  }
  let info = null, detail = "Detalhes de membro não disponíveis com esta autorização.";
  try {
    info = await discordFetch(token, "/users/@me/guilds/" + NARUTO_GUILD_ID + "/member", fetchImpl);
    detail = "Dados de membro obtidos oficialmente.";
  } catch (e) {
    if (!(e instanceof DiscordAuthError) || ![403,404].includes(e.status)) throw e;
  }
  return {username: profile.username, guild_id:NARUTO_GUILD_ID, member:true,
          nickname: info?.nick || null, roles_count: Array.isArray(info?.roles)?info.roles.length:null,
          joined_at: info?.joined_at || null, note:detail};
}
