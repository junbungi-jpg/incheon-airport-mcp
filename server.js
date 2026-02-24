import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// ── 정적 파일 서빙 (위젯 HTML) ───────────────────────────────────────────
app.use("/public", express.static(path.join(__dirname, "public"), {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
  }
}));

// ── 교통 데이터 ──────────────────────────────────────────────────────────

const transportData = {
  arex: {
    direct: { name: "공항철도 직통열차", duration: "43분", price: "11,000원", interval: "30분", firstTrain: "06:10", lastTrain: "22:40" },
    regular: { name: "공항철도 일반열차", duration: "66분", price: "4,150원", interval: "6~12분", firstTrain: "05:20", lastTrain: "23:40" },
  },
  buses: {
    "강남": { route: "6103", duration: "80~110분", price: "17,000원", lat: 37.4979, lng: 127.0276 },
    "잠실": { route: "6001", duration: "70~100분", price: "17,000원", lat: 37.5133, lng: 127.1000 },
    "명동": { route: "6020", duration: "60~90분", price: "15,000원", lat: 37.5636, lng: 126.9869 },
    "홍대": { route: "6030", duration: "50~80분", price: "15,000원", lat: 37.5552, lng: 126.9368 },
    "신촌": { route: "6030", duration: "50~80분", price: "15,000원", lat: 37.5552, lng: 126.9368 },
    "수원": { route: "5500-2", duration: "80~100분", price: "13,000원", lat: 37.2636, lng: 127.0286 },
    "판교": { route: "3300", duration: "70~90분", price: "13,000원", lat: 37.3947, lng: 127.1112 },
  },
  terminals: {
    t1: ["아시아나항공", "제주항공", "진에어", "티웨이항공", "에어서울", "에어부산", "이스타항공"],
    t2: ["대한항공", "델타항공", "에어프랑스", "KLM", "아에로멕시코", "중화항공"],
  },
  parking: {
    short: { unit: "15분당 600원", dailyMax: "24,000원" },
    long: { unit: "15분당 300원", dailyMax: "9,000원" },
  },
};

// ── 위젯 URL 생성 ─────────────────────────────────────────────────────────

function getWidgetUrl() {
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/public/map-widget.html`;
}

// ── MCP 핸들러 ────────────────────────────────────────────────────────────

function handleMCP(method, params) {

  // tools/list
  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "get_transport_by_location",
          description: "출발 지역을 입력하면 인천공항까지 가는 교통편을 지도 UI로 보여줍니다.",
          inputSchema: {
            type: "object",
            properties: {
              location: { type: "string", description: "출발 지역 (예: 강남, 홍대, 수원)" },
            },
            required: ["location"],
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: "get_terminal_by_airline",
          description: "항공사 이름을 입력하면 제1터미널 또는 제2터미널 안내를 지도와 함께 보여줍니다.",
          inputSchema: {
            type: "object",
            properties: {
              airline: { type: "string", description: "항공사 이름 (예: 대한항공, 아시아나항공)" },
            },
            required: ["airline"],
          },
          annotations: { readOnlyHint: true },
        },
        {
          name: "get_parking_info",
          description: "인천공항 주차 요금 및 주차 위치를 지도와 함께 안내합니다.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
        },
        {
          name: "get_arex_info",
          description: "공항철도(AREX) 직통/일반열차 시간표와 요금을 지도와 함께 안내합니다.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
        },
      ],
    };
  }

  // tools/call
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    const widgetUrl = getWidgetUrl();

    // 1. 지도로 교통편 보여주기
    if (name === "get_transport_by_location") {
      const loc = args.location || "";
      const busMatch = Object.entries(transportData.buses).find(
        ([key]) => loc.includes(key) || key.includes(loc.replace(/역|시|구/, ""))
      );

      let text = `📍 **${loc} → 인천공항** 교통편을 지도에서 확인하세요!\n\n`;

      if (busMatch) {
        const [area, bus] = busMatch;
        text += `🚌 **리무진버스 ${bus.route}번**: ${bus.duration} / ${bus.price}\n`;
      }
      text += `🚇 **공항철도 직통**: 서울역 기준 43분 / 11,000원\n`;
      text += `🚕 **택시**: 서울 기준 60,000~90,000원 / 50~90분\n`;

      const focusData = busMatch
        ? { lat: busMatch[1].lat, lng: busMatch[1].lng }
        : { lat: 37.5546, lng: 126.9706 };

      return {
        content: [{ type: "text", text }],
        _meta: {
          "openai/outputTemplate": {
            url: widgetUrl,
            toolOutput: {
              title: `${loc} → 인천공항`,
              subtitle: `출발지 주변 교통편`,
              focusLocation: focusData,
            },
          },
        },
      };
    }

    // 2. 터미널 안내
    if (name === "get_terminal_by_airline") {
      const airline = args.airline || "";
      const isT1 = transportData.terminals.t1.some(a => a.includes(airline) || airline.includes(a));
      const isT2 = transportData.terminals.t2.some(a => a.includes(airline) || airline.includes(a));
      const terminal = isT1 ? "제1터미널" : isT2 ? "제2터미널" : "확인 필요";
      const highlight = isT2 ? "arex_direct" : "arex_regular";

      return {
        content: [{
          type: "text",
          text: `✈️ **${airline}**은(는) **${terminal}** 이용\n\n⚠️ 탑승 전 항공사 앱에서 반드시 재확인하세요!`,
        }],
        _meta: {
          "openai/outputTemplate": {
            url: widgetUrl,
            toolOutput: {
              title: `${airline} → ${terminal}`,
              subtitle: `공항철도로 이동하세요`,
              highlight,
              focusLocation: { lat: 37.4602, lng: 126.4407 },
            },
          },
        },
      };
    }

    // 3. 주차 안내
    if (name === "get_parking_info") {
      return {
        content: [{
          type: "text",
          text: `🚗 **인천공항 주차 요금**\n\n단기주차: ${transportData.parking.short.unit} / 일 최대 ${transportData.parking.short.dailyMax}\n장기주차: ${transportData.parking.long.unit} / 일 최대 ${transportData.parking.long.dailyMax}\n\n💡 공식 앱 사전예약 시 10% 할인!`,
        }],
        _meta: {
          "openai/outputTemplate": {
            url: widgetUrl,
            toolOutput: {
              title: "인천공항 주차 안내",
              subtitle: "단기/장기 주차장 위치",
              focusLocation: { lat: 37.4602, lng: 126.4407 },
            },
          },
        },
      };
    }

    // 4. 공항철도 안내
    if (name === "get_arex_info") {
      const { direct, regular } = transportData.arex;
      return {
        content: [{
          type: "text",
          text: `🚇 **공항철도(AREX)**\n\n직통: 43분 / 11,000원 / 첫차 ${direct.firstTrain} / 막차 ${direct.lastTrain}\n일반: 66분 / 4,150원 / 첫차 ${regular.firstTrain} / 막차 ${regular.lastTrain}`,
        }],
        _meta: {
          "openai/outputTemplate": {
            url: widgetUrl,
            toolOutput: {
              title: "공항철도 안내",
              subtitle: "직통 / 일반 열차",
              highlight: "arex_direct",
              focusLocation: { lat: 37.5546, lng: 126.9706 },
            },
          },
        },
      };
    }

    return { content: [{ type: "text", text: "알 수 없는 툴입니다." }] };
  }

  // initialize
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "incheon-airport-mcp-v2", version: "2.0.0" },
    };
  }

  return { error: "Unknown method" };
}

// ── SSE 엔드포인트 ────────────────────────────────────────────────────────

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  sendSSE(res, { jsonrpc: "2.0", method: "connection/established" });
  req.on("close", () => res.end());
});

app.post("/sse", express.json(), (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { method, params, id } = req.body;
  const result = handleMCP(method, params || {});
  sendSSE(res, { jsonrpc: "2.0", id, result });
  res.end();
});

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "2.0.0" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✈️  인천공항 MCP v2 실행 중: http://localhost:${PORT}`);
  console.log(`🗺️  지도 위젯: http://localhost:${PORT}/public/map-widget.html`);
});
