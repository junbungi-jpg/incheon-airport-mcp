import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(path.join(__dirname, "public/map-widget.html"), "utf8");

// ── 환경변수 ─────────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID     = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// ── 네이버 API 헬퍼 ───────────────────────────────────────────────────────────

// 주소 → 좌표 (Geocoding) - 두 엔드포인트 + 검색 fallback
async function geocode(query) {
  const ncpHeaders = {
    "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID,
    "X-NCP-APIGW-API-KEY":    NAVER_CLIENT_SECRET,
  };

  // 1차: 최신 엔드포인트
  const endpoints = [
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: ncpHeaders });
      const data = await res.json();
      console.log(`[Geocode] ${url.split("?")[0]} status:${res.status} count:${data.meta?.totalCount}`);
      if (data.addresses?.length > 0) {
        const a = data.addresses[0];
        return { lat: parseFloat(a.y), lng: parseFloat(a.x), address: a.roadAddress || a.jibunAddress };
      }
    } catch (e) {
      console.error(`[Geocode] 실패:`, e.message);
    }
  }

  // 2차: 네이버 장소 검색 fallback
  try {
    const searchUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=1`;
    const res = await fetch(searchUrl, {
      headers: {
        "X-Naver-Client-Id":     NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });
    const data = await res.json();
    console.log(`[Search] status:${res.status} items:${data.items?.length}`);
    if (data.items?.length > 0) {
      const item = data.items[0];
      return {
        lat: parseFloat(item.mapy) / 1e7,
        lng: parseFloat(item.mapx) / 1e7,
        address: item.address || query,
      };
    }
  } catch (e) {
    console.error("[Search fallback] 실패:", e.message);
  }

  return null;
}

// 출발지 → 인천공항 경로 (Directions 5)
const AIRPORT_LNG = 126.4407, AIRPORT_LAT = 37.4602;

async function getDirections(startLat, startLng) {
  const params = `?start=${startLng},${startLat}&goal=${AIRPORT_LNG},${AIRPORT_LAT}&option=trafast`;
  const endpoints = [
    `https://maps.apigw.ntruss.com/map-direction/v1/driving${params}`,
    `https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving${params}`,
  ];
  const headers = {
    "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID,
    "X-NCP-APIGW-API-KEY":    NAVER_CLIENT_SECRET,
  };

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers });
      const data = await res.json();
      console.log(`[Directions] status:${res.status} route:`, !!data.route);
      if (data.route) {
        const r = data.route.trafast?.[0] || data.route.traoptimal?.[0];
        if (r) return {
          distance: Math.round(r.summary.distance / 1000),
          duration: Math.round(r.summary.duration / 60000),
          tollFare: r.summary.tollFare || 0,
          path: r.path,
        };
      }
    } catch (e) {
      console.error(`[Directions] 실패:`, e.message);
    }
  }
  return null;
}

// 인근 대중교통 정류장 (Static 데이터 + 거리 계산)
function getNearbyTransit(lat, lng) {
  const TRANSIT = [
    { id:"arex1", type:"rail",  name:"공항철도 직통", icon:"🚇", color:"#3b82f6", lat:37.5546, lng:126.9706, loc:"서울역",     time:"43분",     price:"11,000원", gap:"30분" },
    { id:"arex2", type:"rail",  name:"공항철도 일반", icon:"🚇", color:"#60a5fa", lat:37.5546, lng:126.9706, loc:"서울역",     time:"66분",     price:"4,150원",  gap:"6~12분" },
    { id:"bus1",  type:"bus",   name:"리무진 6103",  icon:"🚌", color:"#22c55e", lat:37.4979, lng:127.0276, loc:"강남역",     time:"80~110분", price:"17,000원", gap:"15~20분" },
    { id:"bus2",  type:"bus",   name:"리무진 6001",  icon:"🚌", color:"#4ade80", lat:37.5133, lng:127.1000, loc:"잠실역",     time:"70~100분", price:"17,000원", gap:"20~30분" },
    { id:"bus3",  type:"bus",   name:"리무진 6020",  icon:"🚌", color:"#86efac", lat:37.5636, lng:126.9869, loc:"명동",       time:"60~90분",  price:"15,000원", gap:"15~20분" },
    { id:"bus4",  type:"bus",   name:"리무진 6030",  icon:"🚌", color:"#bbf7d0", lat:37.5552, lng:126.9368, loc:"신촌·홍대",  time:"50~80분",  price:"15,000원", gap:"20분" },
    { id:"bus5",  type:"bus",   name:"리무진 5500",  icon:"🚌", color:"#22c55e", lat:37.2636, lng:127.0286, loc:"수원역",     time:"80~100분", price:"13,000원", gap:"20~30분" },
    { id:"bus6",  type:"bus",   name:"리무진 3300",  icon:"🚌", color:"#4ade80", lat:37.3947, lng:127.1112, loc:"판교역",     time:"70~90분",  price:"13,000원", gap:"30분" },
    { id:"bus7",  type:"bus",   name:"리무진 8800",  icon:"🚌", color:"#86efac", lat:37.7381, lng:127.0450, loc:"의정부역",   time:"90~110분", price:"13,000원", gap:"30분" },
    { id:"taxi1", type:"taxi",  name:"택시",          icon:"🚕", color:"#f59e0b", lat,          lng,          loc:"출발지",     time:"?분",      price:"미터제",   gap:"24시간" },
  ];

  // 거리 계산 (km) - Haversine
  function dist(a, b, c, d) {
    const R=6371, dLat=(c-a)*Math.PI/180, dLng=(d-b)*Math.PI/180;
    const x=Math.sin(dLat/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }

  // 출발지에서 가까운 버스 정류장 top3
  const buses = TRANSIT.filter(t => t.type === 'bus')
    .map(t => ({ ...t, _dist: dist(lat,lng,t.lat,t.lng) }))
    .sort((a,b) => a._dist - b._dist)
    .slice(0, 3);

  return [
    TRANSIT[0], // 공항철도 직통
    TRANSIT[1], // 공항철도 일반
    ...buses,
    TRANSIT[9], // 택시 (출발지 기준)
  ];
}

// ── MCP 서버 ──────────────────────────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({ name: "인천공항-교통안내", version: "4.0.0" });

  // 위젯 리소스 등록
  registerAppResource(server, "map-widget", "ui://widget/map-widget.html", {},
    async () => ({
      contents: [{
        uri: "ui://widget/map-widget.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
        _meta: { "openai/widgetPrefersBorder": false },
      }],
    })
  );

  // 툴 1: 출발지 → 인천공항 (핵심 툴)
  registerAppTool(server, "get_transport_by_location", {
    title: "출발지별 교통편 안내",
    description: "출발 지역을 입력하면 인천공항까지 가는 실제 경로와 교통편을 지도로 보여줍니다.",
    inputSchema: { location: z.string().describe("출발 지역 또는 주소 (예: 위례, 강남역, 수원시청)") },
    _meta: {
      ui: { resourceUri: "ui://widget/map-widget.html" },
      "openai/outputTemplate": "ui://widget/map-widget.html",
      "openai/toolInvocation/invoking": "경로 검색 중...",
      "openai/toolInvocation/invoked": "교통편 안내 완료",
    },
  }, async ({ location }) => {
    // 1. 출발지 좌표 조회
    const geo = await geocode(location);
    if (!geo) {
      return {
        content: [{ type: "text", text: `❌ "${location}" 위치를 찾을 수 없어요. 더 자세한 주소로 다시 시도해보세요.` }],
        structuredContent: { title: "위치 검색 실패", subtitle: location, error: true },
      };
    }

    // 2. 자동차 경로 조회
    const dir = await getDirections(geo.lat, geo.lng);

    // 3. 인근 대중교통
    const transit = getNearbyTransit(geo.lat, geo.lng);

    // 4. 택시 요금 추정 (거리 × 약 1,200원/km + 기본 4,800원)
    const taxiEst = dir ? `약 ${Math.round((dir.distance * 1200 + 4800) / 1000) * 1000}원` : "미터제";
    const carTime = dir ? `${dir.duration}분` : "-";

    // 택시 데이터 업데이트
    transit[transit.length - 1] = {
      ...transit[transit.length - 1],
      lat: geo.lat, lng: geo.lng,
      time: carTime,
      price: taxiEst,
    };

    let text = `📍 **${location} → 인천공항** 교통편 안내\n\n`;
    if (dir) text += `🚗 자동차: ${dir.duration}분 / 약 ${dir.distance}km (고속도로 통행료 ${dir.tollFare.toLocaleString()}원)\n`;
    text += `🚇 공항철도 직통: 서울역 기준 43분 / 11,000원\n`;
    text += `🚌 가장 가까운 버스: ${transit[2]?.name} (${transit[2]?.loc})\n`;
    text += `🚕 택시 예상: ${taxiEst}`;

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        title: `${location} → 인천공항`,
        subtitle: geo.address || location,
        origin: { lat: geo.lat, lng: geo.lng, name: location },
        path: dir?.path || null,
        transit,
        focus: { lat: geo.lat, lng: geo.lng },
      },
    };
  });

  // 툴 2: 터미널 안내
  registerAppTool(server, "get_terminal_by_airline", {
    title: "항공사별 터미널 안내",
    description: "항공사 이름을 입력하면 제1터미널 또는 제2터미널을 안내합니다.",
    inputSchema: { airline: z.string().describe("항공사 이름") },
    _meta: {
      ui: { resourceUri: "ui://widget/map-widget.html" },
      "openai/outputTemplate": "ui://widget/map-widget.html",
      "openai/toolInvocation/invoking": "터미널 확인 중...",
      "openai/toolInvocation/invoked": "터미널 안내 완료",
    },
  }, async ({ airline }) => {
    const T1 = ["아시아나","제주항공","진에어","티웨이","에어서울","에어부산","이스타"];
    const T2 = ["대한항공","델타","에어프랑스","KLM","아에로멕시코","중화항공"];
    const isT1 = T1.some(a => airline.includes(a) || a.includes(airline));
    const isT2 = T2.some(a => airline.includes(a) || a.includes(airline));
    const terminal = isT1 ? "제1터미널" : isT2 ? "제2터미널" : "확인 필요";
    return {
      content: [{ type:"text", text:`✈️ **${airline}** → **${terminal}**\n\n⚠️ 항공사 앱에서 반드시 재확인하세요!` }],
      structuredContent: {
        title: `${airline} → ${terminal}`,
        subtitle: "공항철도로 이동하세요",
        focus: { lat: 37.4602, lng: 126.4407 },
        transit: null,
      },
    };
  });

  // 툴 3: 공항철도
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
    structuredContent: {
      title: "공항철도(AREX) 안내",
      subtitle: "서울역 출발 기준",
      focus: { lat: 37.5546, lng: 126.9706 },
      transit: null,
    },
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
    // Client ID를 HTML에 주입
    const injected = widgetHtml.replace('__NAVER_CLIENT_ID__', NAVER_CLIENT_ID || '');
    res.writeHead(200); res.end(injected); return;
  }

  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ status:"ok", version:"4.0.0", naver: !!NAVER_CLIENT_ID }));
    return;
  }

  if (req.url?.startsWith("/mcp")) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`✈️  인천공항 MCP v4 실행 중: http://localhost:${PORT}`);
  console.log(`🗺️  네이버 API: ${NAVER_CLIENT_ID ? "✅ 연결됨" : "❌ 환경변수 없음"}`);
});
