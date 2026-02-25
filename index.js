import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(path.join(__dirname, "public/map-widget.html"), "utf8");

const CLIENT_ID     = process.env.NAVER_CLIENT_ID     || "swz1idzhg6";
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "4nszVa0v5rXNtzl9bjnWAfIXeu5xyOJrnhaW14m4";
const SEARCH_ID     = process.env.NAVER_SEARCH_ID     || "wlDWMoL6EBc9DeMYteNX";
const SEARCH_SECRET = process.env.NAVER_SEARCH_SECRET || "OwJEkheCIH";
const AIRPORT_LAT = 37.4602, AIRPORT_LNG = 126.4407;

// ── 네이버 Geocoding ──────────────────────────────────────────────────────────
async function geocode(query) {
  const headers = {
    "X-NCP-APIGW-API-KEY-ID": CLIENT_ID,
    "X-NCP-APIGW-API-KEY": CLIENT_SECRET,
  };
  const urls = [
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      const data = await res.json();
      console.log(`[Geocode] status:${res.status} count:${data.meta?.totalCount ?? "?"}`);
      if (data.addresses?.length > 0) {
        const a = data.addresses[0];
        return { lat: parseFloat(a.y), lng: parseFloat(a.x), address: a.roadAddress || a.jibunAddress };
      }
    } catch (e) {
      console.error("[Geocode] 오류:", e.message);
    }
  }
  // 장소 검색 fallback
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=1`,
      { headers: { "X-Naver-Client-Id": SEARCH_ID, "X-Naver-Client-Secret": SEARCH_SECRET } }
    );
    const data = await res.json();
    console.log(`[Search] status:${res.status} items:${data.items?.length ?? 0}`);
    if (data.items?.length > 0) {
      const item = data.items[0];
      return { lat: parseFloat(item.mapy) / 1e7, lng: parseFloat(item.mapx) / 1e7, address: item.address };
    }
  } catch (e) {
    console.error("[Search] 오류:", e.message);
  }
  return null;
}

// ── 네이버 Directions ─────────────────────────────────────────────────────────
async function getDirections(startLat, startLng) {
  const headers = {
    "X-NCP-APIGW-API-KEY-ID": CLIENT_ID,
    "X-NCP-APIGW-API-KEY": CLIENT_SECRET,
  };
  const params = `?start=${startLng},${startLat}&goal=${AIRPORT_LNG},${AIRPORT_LAT}&option=trafast`;
  const urls = [
    `https://maps.apigw.ntruss.com/map-direction/v1/driving${params}`,
    `https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving${params}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      const data = await res.json();
      console.log(`[Directions] status:${res.status}`);
      const r = data.route?.trafast?.[0] || data.route?.traoptimal?.[0];
      if (r) return {
        distance: Math.round(r.summary.distance / 1000),
        duration: Math.round(r.summary.duration / 60000),
        tollFare: r.summary.tollFare || 0,
        path: r.path,
      };
    } catch (e) {
      console.error("[Directions] 오류:", e.message);
    }
  }
  return null;
}

// ── 인근 대중교통 ─────────────────────────────────────────────────────────────
function getNearbyTransit(lat, lng) {
  const ALL = [
    { id:"arex1", type:"rail", name:"공항철도 직통", icon:"🚇", color:"#3b82f6", lat:37.5546, lng:126.9706, loc:"서울역",    time:"43분",     price:"11,000원", gap:"30분" },
    { id:"arex2", type:"rail", name:"공항철도 일반", icon:"🚇", color:"#60a5fa", lat:37.5546, lng:126.9706, loc:"서울역",    time:"66분",     price:"4,150원",  gap:"6~12분" },
    { id:"bus1",  type:"bus",  name:"리무진 6103",  icon:"🚌", color:"#22c55e", lat:37.4979, lng:127.0276, loc:"강남역",    time:"80~110분", price:"17,000원", gap:"15~20분" },
    { id:"bus2",  type:"bus",  name:"리무진 6001",  icon:"🚌", color:"#4ade80", lat:37.5133, lng:127.1000, loc:"잠실역",    time:"70~100분", price:"17,000원", gap:"20~30분" },
    { id:"bus3",  type:"bus",  name:"리무진 6020",  icon:"🚌", color:"#86efac", lat:37.5636, lng:126.9869, loc:"명동",      time:"60~90분",  price:"15,000원", gap:"15~20분" },
    { id:"bus4",  type:"bus",  name:"리무진 6030",  icon:"🚌", color:"#bbf7d0", lat:37.5552, lng:126.9368, loc:"신촌·홍대", time:"50~80분",  price:"15,000원", gap:"20분" },
    { id:"bus5",  type:"bus",  name:"리무진 5500",  icon:"🚌", color:"#22c55e", lat:37.2636, lng:127.0286, loc:"수원역",    time:"80~100분", price:"13,000원", gap:"20~30분" },
    { id:"bus6",  type:"bus",  name:"리무진 3300",  icon:"🚌", color:"#4ade80", lat:37.3947, lng:127.1112, loc:"판교역",    time:"70~90분",  price:"13,000원", gap:"30분" },
    { id:"bus7",  type:"bus",  name:"리무진 8800",  icon:"🚌", color:"#86efac", lat:37.7381, lng:127.0450, loc:"의정부역",  time:"90~110분", price:"13,000원", gap:"30분" },
  ];
  function dist(a, b, c, d) {
    const R=6371, dLat=(c-a)*Math.PI/180, dLng=(d-b)*Math.PI/180;
    const x=Math.sin(dLat/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }
  const nearBuses = ALL.filter(t=>t.type==="bus")
    .map(t=>({...t, _d: dist(lat,lng,t.lat,t.lng)}))
    .sort((a,b)=>a._d-b._d).slice(0,3);
  return [ALL[0], ALL[1], ...nearBuses];
}

// ── MCP 서버 ──────────────────────────────────────────────────────────────────
function createMcpServer() {
  const server = new McpServer({ name: "인천공항-교통안내", version: "4.0.0" });

  registerAppResource(server, "map-widget", "ui://widget/map-widget.html", {}, async () => ({
    contents: [{
      uri: "ui://widget/map-widget.html",
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml.replace("__NAVER_CLIENT_ID__", CLIENT_ID || ""),
      _meta: { "openai/widgetPrefersBorder": false },
    }],
  }));

  registerAppTool(server, "get_transport_by_location", {
    title: "출발지별 교통편 안내",
    description: "출발 지역을 입력하면 인천공항까지 가는 경로와 교통편을 지도로 보여줍니다.",
    inputSchema: { location: z.string().describe("출발 지역 (예: 위례, 강남역, 수원시청)") },
    _meta: {
      ui: { resourceUri: "ui://widget/map-widget.html" },
      "openai/outputTemplate": "ui://widget/map-widget.html",
      "openai/toolInvocation/invoking": "경로 검색 중...",
      "openai/toolInvocation/invoked": "교통편 안내 완료",
    },
  }, async ({ location }) => {
    console.log(`[Tool] 검색: "${location}" | KEY: ${CLIENT_ID ? CLIENT_ID.slice(0,4)+"****" : "없음"}`);
    const geo = await geocode(location);
    console.log(`[Tool] geocode 결과:`, geo ? `${geo.lat},${geo.lng}` : "실패");
    if (!geo) {
      return {
        content: [{ type:"text", text:`❌ "${location}" 위치를 찾을 수 없어요.` }],
        structuredContent: { title:"위치 검색 실패", subtitle: location, error: true },
      };
    }
    const dir = await getDirections(geo.lat, geo.lng);
    const transit = getNearbyTransit(geo.lat, geo.lng);
    const taxiEst = dir ? `약 ${Math.round((dir.distance*1200+4800)/1000)*1000}원` : "미터제";
    transit.push({ id:"taxi1", type:"taxi", name:"택시", icon:"🚕", color:"#f59e0b",
      lat:geo.lat, lng:geo.lng, loc:"출발지", time: dir?`${dir.duration}분`:"?분", price:taxiEst, gap:"24시간" });
    let text = `📍 **${location} → 인천공항**\n\n`;
    if (dir) text += `🚗 자동차: ${dir.duration}분 / ${dir.distance}km\n`;
    text += `🚇 공항철도 직통: 서울역 43분 / 11,000원\n`;
    text += `🚌 가까운 버스: ${transit[2]?.name} (${transit[2]?.loc})\n`;
    text += `🚕 택시 예상: ${taxiEst}`;
    return {
      content: [{ type:"text", text }],
      structuredContent: {
        title: `${location} → 인천공항`,
        subtitle: geo.address || location,
        origin: { lat:geo.lat, lng:geo.lng, name:location },
        path: dir?.path || null,
        transit,
        focus: { lat:geo.lat, lng:geo.lng },
      },
    };
  });

  registerAppTool(server, "get_terminal_by_airline", {
    title: "항공사별 터미널 안내",
    description: "항공사 이름을 입력하면 제1터미널 또는 제2터미널을 안내합니다.",
    inputSchema: { airline: z.string() },
    _meta: {
      ui: { resourceUri: "ui://widget/map-widget.html" },
      "openai/outputTemplate": "ui://widget/map-widget.html",
      "openai/toolInvocation/invoking": "터미널 확인 중...",
      "openai/toolInvocation/invoked": "터미널 안내 완료",
    },
  }, async ({ airline }) => {
    const T1 = ["아시아나","제주항공","진에어","티웨이","에어서울","에어부산","이스타"];
    const T2 = ["대한항공","델타","에어프랑스","KLM","중화항공"];
    const terminal = T1.some(a=>airline.includes(a)||a.includes(airline)) ? "제1터미널"
      : T2.some(a=>airline.includes(a)||a.includes(airline)) ? "제2터미널" : "확인 필요";
    return {
      content: [{ type:"text", text:`✈️ **${airline}** → **${terminal}**\n\n⚠️ 항공사 앱에서 재확인하세요!` }],
      structuredContent: { title:`${airline} → ${terminal}`, subtitle:"공항철도로 이동하세요", focus:{lat:37.4602,lng:126.4407}, transit:null },
    };
  });

  registerAppTool(server, "get_arex_info", {
    title: "공항철도 안내",
    description: "공항철도 시간표와 요금을 안내합니다.",
    inputSchema: {},
    _meta: {
      ui: { resourceUri: "ui://widget/map-widget.html" },
      "openai/outputTemplate": "ui://widget/map-widget.html",
      "openai/toolInvocation/invoking": "공항철도 정보 불러오는 중...",
      "openai/toolInvocation/invoked": "공항철도 안내 완료",
    },
  }, async () => ({
    content: [{ type:"text", text:"🚇 직통: 43분/11,000원 (첫차 06:10, 막차 22:40)\n일반: 66분/4,150원 (첫차 05:20, 막차 23:40)" }],
    structuredContent: { title:"공항철도(AREX) 안내", subtitle:"서울역 출발 기준", focus:{lat:37.5546,lng:126.9706}, transit:null },
  }));

  return server;
}

// ── HTTP 서버 ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const httpServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.url === "/public/map-widget.html") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *; script-src * 'unsafe-inline'");
    res.writeHead(200);
    res.end(widgetHtml.replace("__NAVER_CLIENT_ID__", CLIENT_ID || ""));
    return;
  }

  // 네이버 API 직접 테스트
  if (req.url === "/test-naver") {
    res.setHeader("Content-Type", "application/json");
    const result = { clientId: CLIENT_ID?.slice(0,4)+"****", secretLen: CLIENT_SECRET?.length || 0 };
    try {
      const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent("위례중앙역")}&display=1`;
      const r = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": SEARCH_ID,
          "X-Naver-Client-Secret": SEARCH_SECRET,
        }
      });
      const data = await r.json();
      result.status = r.status;
      result.totalCount = data.meta?.totalCount;
      result.error = data.error || data.errorMessage || null;
      result.raw = JSON.stringify(data).slice(0, 300);
    } catch(e) {
      result.fetchError = e.message;
      result.cause = e.cause?.message;
    }
    res.writeHead(200);
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  if (req.url === "/health") {
    const naverKeys = Object.keys(process.env).filter(k => k.includes("NAVER"));
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      version: "4.0.0",
      naver: !!CLIENT_ID,
      naverKeys,
      clientIdLen: CLIENT_ID?.length || 0,
      secretLen: CLIENT_SECRET?.length || 0,
    }));
    return;
  }

  if (req.url?.startsWith("/mcp")) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`✈️  인천공항 MCP v4 실행 중: http://localhost:${PORT}`);
  console.log(`🗺️  네이버 API: ${CLIENT_ID ? "✅ 연결됨" : "❌ 환경변수 없음"}`);
});
