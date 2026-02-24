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

// ── 교통 데이터 ─────────────────────────────────────────────────────────────

const buses = {
  강남: { route:"6103", time:"80~110분", price:"17,000원", lat:37.4979, lng:127.0276 },
  잠실: { route:"6001", time:"70~100분", price:"17,000원", lat:37.5133, lng:127.1000 },
  명동: { route:"6020", time:"60~90분",  price:"15,000원", lat:37.5636, lng:126.9869 },
  홍대: { route:"6030", time:"50~80분",  price:"15,000원", lat:37.5552, lng:126.9368 },
  신촌: { route:"6030", time:"50~80분",  price:"15,000원", lat:37.5552, lng:126.9368 },
  수원: { route:"5500-2", time:"80~100분", price:"13,000원", lat:37.2636, lng:127.0286 },
  판교: { route:"3300", time:"70~90분",  price:"13,000원", lat:37.3947, lng:127.1112 },
};

const terminals = {
  t1: ["아시아나항공","제주항공","진에어","티웨이항공","에어서울","에어부산","이스타항공"],
  t2: ["대한항공","델타항공","에어프랑스","KLM","아에로멕시코","중화항공"],
};

// ── MCP 서버 생성 ────────────────────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({ name: "인천공항-교통안내", version: "3.0.0" });

  // 위젯 리소스 등록
  registerAppResource(
    server,
    "map-widget",
    "ui://widget/map-widget.html",
    {},
    async () => ({
      contents: [{
        uri: "ui://widget/map-widget.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
        _meta: {
          "openai/widgetPrefersBorder": false,
          "openai/widgetDescription": "인천공항 교통편을 지도에서 확인하세요",
        },
      }],
    })
  );

  // 툴 1: 출발지별 교통편 + 지도
  registerAppTool(
    server,
    "get_transport_by_location",
    {
      title: "출발지별 교통편 안내",
      description: "출발 지역을 입력하면 인천공항까지 가는 교통편을 지도로 보여줍니다.",
      inputSchema: { location: z.string().describe("출발 지역 (예: 강남, 홍대, 수원)") },
      _meta: {
        ui: { resourceUri: "ui://widget/map-widget.html" },
        "openai/outputTemplate": "ui://widget/map-widget.html",
        "openai/toolInvocation/invoking": "교통편 검색 중...",
        "openai/toolInvocation/invoked": "교통편 안내 완료",
      },
    },
    async ({ location }) => {
      const loc = location || "";
      const busKey = Object.keys(buses).find(k => loc.includes(k) || k.includes(loc.replace(/역|시|구/,"")));
      const bus = busKey ? buses[busKey] : null;

      let text = `📍 **${loc} → 인천공항** 교통편 안내\n\n`;
      if (bus) text += `🚌 리무진버스 ${bus.route}번: ${bus.time} / ${bus.price}\n`;
      text += `🚇 공항철도 직통: 서울역 기준 43분 / 11,000원\n`;
      text += `🚕 택시: 서울 기준 60,000~90,000원\n`;

      const focus = bus
        ? { lat: bus.lat, lng: bus.lng }
        : { lat: 37.5546, lng: 126.9706 };

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          title: `${loc} → 인천공항`,
          subtitle: "출발지 주변 교통편",
          focus,
          highlight: bus ? "bus1" : "arex1",
        },
      };
    }
  );

  // 툴 2: 터미널 안내 + 지도
  registerAppTool(
    server,
    "get_terminal_by_airline",
    {
      title: "항공사별 터미널 안내",
      description: "항공사 이름을 입력하면 제1터미널 또는 제2터미널을 지도와 함께 안내합니다.",
      inputSchema: { airline: z.string().describe("항공사 이름 (예: 대한항공, 아시아나항공)") },
      _meta: {
        ui: { resourceUri: "ui://widget/map-widget.html" },
        "openai/outputTemplate": "ui://widget/map-widget.html",
        "openai/toolInvocation/invoking": "터미널 확인 중...",
        "openai/toolInvocation/invoked": "터미널 안내 완료",
      },
    },
    async ({ airline }) => {
      const isT1 = terminals.t1.some(a => a.includes(airline) || airline.includes(a));
      const isT2 = terminals.t2.some(a => a.includes(airline) || airline.includes(a));
      const terminal = isT1 ? "제1터미널" : isT2 ? "제2터미널" : "확인 필요";

      return {
        content: [{ type: "text", text: `✈️ **${airline}** → **${terminal}**\n\n⚠️ 항공사 앱에서 재확인 권장` }],
        structuredContent: {
          title: `${airline} → ${terminal}`,
          subtitle: "공항철도로 이동하세요",
          focus: { lat: 37.4602, lng: 126.4407 },
          highlight: "arex1",
        },
      };
    }
  );

  // 툴 3: 공항철도 + 지도
  registerAppTool(
    server,
    "get_arex_info",
    {
      title: "공항철도 안내",
      description: "공항철도(AREX) 직통/일반열차 시간표와 요금을 지도와 함께 안내합니다.",
      inputSchema: {},
      _meta: {
        ui: { resourceUri: "ui://widget/map-widget.html" },
        "openai/outputTemplate": "ui://widget/map-widget.html",
        "openai/toolInvocation/invoking": "공항철도 정보 불러오는 중...",
        "openai/toolInvocation/invoked": "공항철도 안내 완료",
      },
    },
    async () => ({
      content: [{ type:"text", text:"🚇 **공항철도(AREX)**\n\n직통: 43분 / 11,000원 / 첫차 06:10 / 막차 22:40\n일반: 66분 / 4,150원 / 첫차 05:20 / 막차 23:40" }],
      structuredContent: {
        title: "공항철도 안내",
        subtitle: "직통 / 일반 열차",
        focus: { lat: 37.5546, lng: 126.9706 },
        highlight: "arex1",
      },
    })
  );

  // 툴 4: 주차 안내 + 지도
  registerAppTool(
    server,
    "get_parking_info",
    {
      title: "주차 안내",
      description: "인천공항 주차 요금과 주차장 위치를 지도와 함께 안내합니다.",
      inputSchema: {},
      _meta: {
        ui: { resourceUri: "ui://widget/map-widget.html" },
        "openai/outputTemplate": "ui://widget/map-widget.html",
        "openai/toolInvocation/invoking": "주차 정보 불러오는 중...",
        "openai/toolInvocation/invoked": "주차 안내 완료",
      },
    },
    async () => ({
      content: [{ type:"text", text:"🚗 **인천공항 주차 요금**\n\n단기: 15분당 600원 / 일 최대 24,000원\n장기: 15분당 300원 / 일 최대 9,000원\n\n💡 공식 앱 사전예약 시 10% 할인" }],
      structuredContent: {
        title: "인천공항 주차 안내",
        subtitle: "단기/장기 주차장",
        focus: { lat: 37.4602, lng: 126.4407 },
      },
    })
  );

  return server;
}

// ── HTTP 서버 ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // 정적 파일 (위젯 HTML)
  if (req.url === "/public/map-widget.html") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.writeHead(200);
    res.end(widgetHtml);
    return;
  }

  // 헬스체크
  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", version: "3.0.0" }));
    return;
  }

  // MCP 엔드포인트
  if (req.url?.startsWith(MCP_PATH)) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`✈️  인천공항 MCP v3 실행 중: http://localhost:${PORT}`);
  console.log(`🔌 MCP 엔드포인트: http://localhost:${PORT}/mcp`);
});
