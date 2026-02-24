import express from "express";

const app = express();
app.use(express.json());

// ─── 데이터베이스 (교통 정보) ───────────────────────────────────────────────

const transportData = {
  // 공항철도 (AREX)
  arex: {
    direct: {
      name: "공항철도 직통열차",
      routes: [
        { from: "서울역", duration: "43분", price: "11,000원", interval: "30분" },
        { from: "홍대입구", duration: "35분", price: "9,500원", interval: "30분" },
      ],
      firstTrain: "06:10 (서울역 출발)",
      lastTrain: "22:40 (서울역 출발)",
      terminal: "제1·2터미널 모두 정차 (제2터미널 먼저)",
      tip: "좌석 지정, 수하물 위탁 가능 (서울역 도심공항터미널)",
    },
    regular: {
      name: "공항철도 일반열차",
      routes: [
        { from: "서울역", duration: "66분", price: "4,150원", interval: "6~12분" },
        { from: "홍대입구", duration: "53분", price: "3,650원", interval: "6~12분" },
        { from: "디지털미디어시티", duration: "48분", price: "3,450원", interval: "6~12분" },
        { from: "김포공항", duration: "33분", price: "2,950원", interval: "6~12분" },
      ],
      firstTrain: "05:20 (서울역 출발)",
      lastTrain: "23:40 (서울역 출발)",
      terminal: "제1·2터미널 모두 정차",
      tip: "T-money/교통카드 사용 가능, 지하철 환승 가능",
    },
  },

  // 지역별 리무진버스
  buses: {
    서울: [
      { route: "6103", from: "강남역·양재역", duration: "80~110분", price: "17,000원", interval: "15~20분" },
      { route: "6001", from: "잠실역·강변역", duration: "70~100분", price: "17,000원", interval: "20~30분" },
      { route: "6020", from: "명동·서울역", duration: "60~90분", price: "15,000원", interval: "15~20분" },
      { route: "6030", from: "신촌·홍대", duration: "50~80분", price: "15,000원", interval: "20분" },
    ],
    경기: [
      { route: "5500-2", from: "수원역", duration: "80~100분", price: "13,000원", interval: "20~30분" },
      { route: "3300", from: "성남·판교", duration: "70~90분", price: "13,000원", interval: "30분" },
      { route: "8800", from: "의정부", duration: "90~110분", price: "13,000원", interval: "30분" },
    ],
    인천: [
      { route: "인천1", from: "인천시청·부평역", duration: "40~60분", price: "7,000원", interval: "10~15분" },
    ],
    지방: [
      { from: "대전", duration: "약 2시간 30분", price: "23,000원~", tip: "KTX 광명역 환승 추천" },
      { from: "부산", duration: "약 5시간", price: "40,000원~", tip: "KTX + 공항철도 환승 추천" },
      { from: "대구", duration: "약 3시간 30분", price: "30,000원~", tip: "KTX + 공항철도 환승 추천" },
      { from: "광주", duration: "약 3시간", price: "27,000원~", tip: "KTX + 공항철도 환승 추천" },
    ],
  },

  // KTX 연계
  ktx: {
    name: "KTX + 공항철도 환승",
    routes: [
      { from: "부산역", ktxTo: "서울역", ktxDuration: "2시간 30분", ktxPrice: "59,800원~", totalTime: "약 3시간 20분" },
      { from: "대구역", ktxTo: "서울역", ktxDuration: "1시간 40분", ktxPrice: "42,600원~", totalTime: "약 2시간 30분" },
      { from: "대전역", ktxTo: "서울역", ktxDuration: "50분", ktxPrice: "23,700원~", totalTime: "약 1시간 40분" },
      { from: "광주송정역", ktxTo: "서울역", ktxDuration: "1시간 30분", ktxPrice: "46,800원~", totalTime: "약 2시간 20분" },
    ],
    tip: "서울역 도착 후 공항철도 직통/일반열차로 환승. 서울역에서 수하물 위탁 가능!",
  },

  // 택시
  taxi: {
    fromSeoul: {
      area: "서울 시내 기준",
      price: "60,000~90,000원",
      nightSurcharge: "심야(00:00~04:00) 약 20% 할증",
      duration: "50~90분 (교통 상황에 따라 상이)",
      types: [
        { type: "일반택시", price: "60,000~80,000원" },
        { type: "모범택시", price: "80,000~100,000원" },
        { type: "카카오 블랙", price: "90,000~120,000원" },
      ],
      tip: "카카오택시 앱에서 '대형' 선택 시 짐 많을 때 편리",
    },
  },

  // 주차
  parking: {
    terminal1: {
      name: "제1터미널 주차장",
      shortTerm: { unit: "15분당 600원", dailyMax: "24,000원", note: "첫 30분 1,200원" },
      longTerm: { unit: "15분당 300원", dailyMax: "9,000원", note: "P3·P4 장기주차장" },
      tip: "장기주차장은 셔틀버스 운행 (5~10분 간격)",
    },
    terminal2: {
      name: "제2터미널 주차장",
      shortTerm: { unit: "15분당 600원", dailyMax: "24,000원", note: "첫 30분 1,200원" },
      longTerm: { unit: "15분당 300원", dailyMax: "9,000원", note: "P1 장기주차장" },
      tip: "공항 공식 앱(인천공항)에서 사전예약 시 10% 할인",
    },
  },

  // 터미널 배정
  terminals: {
    terminal1: ["아시아나항공", "제주항공", "진에어", "티웨이항공", "에어서울", "에어부산", "이스타항공", "에어로케이", "에어프레미아"],
    terminal2: ["대한항공", "델타항공", "에어프랑스", "KLM", "아에로멕시코", "중화항공", "샤먼항공", "가루다인도네시아"],
    tip: "탑승 전 반드시 항공사 홈페이지 또는 앱에서 터미널 재확인 권장",
  },
};

// ─── SSE 헬퍼 ────────────────────────────────────────────────────────────────

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── MCP 핸들러 ──────────────────────────────────────────────────────────────

function handleMCP(method, params) {
  // 툴 목록 반환
  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "get_transport_by_location",
          description: "출발 지역을 입력하면 인천공항까지 가는 교통수단(버스, 철도, 택시 등)을 안내합니다.",
          inputSchema: {
            type: "object",
            properties: {
              location: { type: "string", description: "출발 지역 또는 도시명 (예: 강남, 수원, 부산)" },
            },
            required: ["location"],
          },
        },
        {
          name: "get_terminal_by_airline",
          description: "항공사 이름을 입력하면 인천공항 제1터미널 또는 제2터미널 중 어디로 가야 하는지 알려줍니다.",
          inputSchema: {
            type: "object",
            properties: {
              airline: { type: "string", description: "항공사 이름 (예: 대한항공, 아시아나항공)" },
            },
            required: ["airline"],
          },
        },
        {
          name: "get_parking_info",
          description: "인천공항 주차 요금 및 장기/단기 주차 정보를 안내합니다.",
          inputSchema: {
            type: "object",
            properties: {
              terminal: { type: "string", description: "터미널 번호 (1 또는 2, 생략 시 전체)" },
            },
          },
        },
        {
          name: "get_arex_info",
          description: "공항철도(AREX) 직통/일반열차 시간표, 요금, 운행 정보를 안내합니다.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
  }

  // 툴 실행
  if (method === "tools/call") {
    const { name, arguments: args } = params;

    // 1. 출발지별 교통수단 안내
    if (name === "get_transport_by_location") {
      const loc = args.location || "";
      let result = `📍 **${loc} → 인천공항** 교통편 안내\n\n`;

      // 버스 검색
      let busFound = false;
      for (const [region, routes] of Object.entries(transportData.buses)) {
        if (region === "지방") continue;
        const matched = routes.filter(
          (r) => r.from.includes(loc) || loc.includes(r.from.replace(/역.*/, ""))
        );
        if (matched.length > 0) {
          result += `🚌 **리무진버스**\n`;
          matched.forEach((r) => {
            result += `  • ${r.from} → [${r.route}번] ${r.duration} / ${r.price} / ${r.interval} 간격\n`;
          });
          result += "\n";
          busFound = true;
        }
      }

      // 지방 도시 검색
      const provincialMatch = transportData.buses.지방.find((r) => r.from.includes(loc) || loc.includes(r.from));
      if (provincialMatch) {
        result += `🚌 **리무진버스** (지방)\n`;
        result += `  • ${provincialMatch.from}: 약 ${provincialMatch.duration} / ${provincialMatch.price}\n`;
        result += `  💡 ${provincialMatch.tip}\n\n`;

        // KTX 연계 추천
        const ktxMatch = transportData.ktx.routes.find((r) => r.from.includes(loc) || loc.includes(r.from.replace("역", "")));
        if (ktxMatch) {
          result += `🚄 **KTX + 공항철도 환승 (추천)**\n`;
          result += `  • ${ktxMatch.from} → 서울역: ${ktxMatch.ktxDuration} / ${ktxMatch.ktxPrice}\n`;
          result += `  • 서울역 → 인천공항: +43분 / 11,000원\n`;
          result += `  • 총 소요시간: ${ktxMatch.totalTime}\n`;
          result += `  💡 ${transportData.ktx.tip}\n\n`;
        }
        busFound = true;
      }

      // 서울/수도권이면 공항철도 추가
      const isSeoulArea = ["서울", "강남", "홍대", "신촌", "잠실", "명동", "수원", "인천", "부평", "경기"].some(
        (k) => loc.includes(k)
      );
      if (isSeoulArea || !busFound) {
        result += `🚇 **공항철도 (AREX)**\n`;
        result += `  • 직통열차: 서울역 기준 43분 / 11,000원 / 30분 간격\n`;
        result += `  • 일반열차: 서울역 기준 66분 / 4,150원 / 6~12분 간격\n\n`;
      }

      // 택시 정보 추가
      result += `🚕 **택시**\n`;
      result += `  • 서울 기준 60,000~90,000원 / 50~90분\n`;
      result += `  • 심야(00~04시) 약 20% 할증\n\n`;

      result += `ℹ️ 출발 지역을 더 구체적으로 알려주시면 정확한 정류장을 안내드릴 수 있어요!`;

      return { content: [{ type: "text", text: result }] };
    }

    // 2. 터미널 안내
    if (name === "get_terminal_by_airline") {
      const airline = args.airline || "";
      const t1 = transportData.terminals.terminal1.find((a) => a.includes(airline) || airline.includes(a));
      const t2 = transportData.terminals.terminal2.find((a) => a.includes(airline) || airline.includes(a));

      let result = "";
      if (t1) {
        result = `✈️ **${airline}**은(는) **제1여객터미널** 이용\n\n`;
        result += `제1터미널 이용 항공사: ${transportData.terminals.terminal1.join(", ")}\n\n`;
        result += `⚠️ ${transportData.terminals.tip}`;
      } else if (t2) {
        result = `✈️ **${airline}**은(는) **제2여객터미널** 이용\n\n`;
        result += `제2터미널 이용 항공사: ${transportData.terminals.terminal2.join(", ")}\n\n`;
        result += `⚠️ ${transportData.terminals.tip}`;
      } else {
        result = `❓ **${airline}** 터미널 정보를 찾지 못했어요.\n\n`;
        result += `**제1터미널**: ${transportData.terminals.terminal1.join(", ")}\n\n`;
        result += `**제2터미널**: ${transportData.terminals.terminal2.join(", ")}\n\n`;
        result += `⚠️ 항공사 홈페이지 또는 항공권에서 터미널을 꼭 확인하세요!`;
      }

      return { content: [{ type: "text", text: result }] };
    }

    // 3. 주차 정보
    if (name === "get_parking_info") {
      const t = args.terminal;
      let result = `🚗 **인천공항 주차 요금 안내**\n\n`;

      const terminals = t === "1" ? ["terminal1"] : t === "2" ? ["terminal2"] : ["terminal1", "terminal2"];
      terminals.forEach((key) => {
        const p = transportData.parking[key];
        result += `**${p.name}**\n`;
        result += `  단기주차: ${p.shortTerm.unit} / 일 최대 ${p.shortTerm.dailyMax} (${p.shortTerm.note})\n`;
        result += `  장기주차: ${p.longTerm.unit} / 일 최대 ${p.longTerm.dailyMax} (${p.longTerm.note})\n`;
        result += `  💡 ${p.tip}\n\n`;
      });

      result += `📱 사전예약: 인천공항 공식 앱 또는 https://www.airport.kr`;
      return { content: [{ type: "text", text: result }] };
    }

    // 4. 공항철도 정보
    if (name === "get_arex_info") {
      const d = transportData.arex;
      let result = `🚇 **공항철도(AREX) 안내**\n\n`;

      result += `**직통열차**\n`;
      result += `  운행간격: ${d.direct.routes[0].interval} / 첫차: ${d.direct.firstTrain} / 막차: ${d.direct.lastTrain}\n`;
      d.direct.routes.forEach((r) => {
        result += `  • ${r.from}: ${r.duration} / ${r.price}\n`;
      });
      result += `  터미널: ${d.direct.terminal}\n`;
      result += `  💡 ${d.direct.tip}\n\n`;

      result += `**일반열차**\n`;
      result += `  운행간격: ${d.regular.routes[0].interval} / 첫차: ${d.regular.firstTrain} / 막차: ${d.regular.lastTrain}\n`;
      d.regular.routes.forEach((r) => {
        result += `  • ${r.from}: ${r.duration} / ${r.price}\n`;
      });
      result += `  터미널: ${d.regular.terminal}\n`;
      result += `  💡 ${d.regular.tip}`;

      return { content: [{ type: "text", text: result }] };
    }

    return { content: [{ type: "text", text: "알 수 없는 툴입니다." }] };
  }

  // initialize
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "incheon-airport-mcp", version: "1.0.0" },
    };
  }

  return { error: "Unknown method" };
}

// ─── SSE 엔드포인트 ───────────────────────────────────────────────────────────

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 연결 확인 메시지
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

app.get("/health", (_, res) => res.json({ status: "ok", service: "인천공항 MCP 서버" }));

// ─── 서버 시작 ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✈️  인천공항 MCP 서버 실행 중: http://localhost:${PORT}`);
});
