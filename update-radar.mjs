import {mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const OUTPUT=path.join(ROOT,"data","radar-latest.json");
const FALLBACK_OUTPUT=path.join(ROOT,"data","radar-fallback.js");
const COGNITION_HISTORY_OUTPUT=path.join(ROOT,"data","cognition-history.json");
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.4-mini";
const MAX_SOURCE_AGE_HOURS=84;

const categories=[
  {id:"domestic_policy",label:"国内政策 / 十五五",query:"(十五五 OR 国务院 OR 国家发展改革委 OR 中国人民银行 OR 金融监管总局) (规划 OR 政策 OR 就业 OR 消费 OR 金融) when:5d",priority:"must",domestic:true,localGrounded:true,maxAgeHours:120},
  {id:"county_local",label:"四川 / 成渝 / 县域",query:"(四川 OR 成都 OR 绵阳 OR 成渝 OR 县域) (银行 OR 金融 OR 产业 OR 就业 OR 人才 OR 消费 OR 政策) when:7d",priority:"know",domestic:true,localGrounded:true,maxAgeHours:168},
  {id:"macro_global",label:"重大事件 / 宏观政策",query:"(中国 重大政策 OR 美联储 OR 全球经济 OR 地缘政治) when:2d",priority:"must"},
  {id:"banking",label:"银行业",query:"(中国 银行业 OR 银行监管 OR 商业银行 OR 金融监管) when:3d",priority:"know",domestic:true,localGrounded:true},
  {id:"wealth",label:"财富管理 / 私行",query:"(中国 财富管理 OR 私人银行 OR 高净值 OR 资产配置) when:3d",priority:"know",domestic:true,localGrounded:true},
  {id:"markets",label:"黄金 / 纳指 / 利率 / 美元",query:"(黄金 OR 纳斯达克 OR 美债收益率 OR 美元指数) when:2d",priority:"must"},
  {id:"a_share_trends",label:"A股 / 资金 / 市场风潮",query:"(A股 OR 沪深股市 OR 港股) (资金流向 OR 开户 OR 成交额 OR 板块爆发 OR IPO OR 投资者情绪) when:3d",priority:"know",domestic:true,maxAgeHours:96},
  {id:"global_market_narrative",label:"美股 / 市场叙事",query:"(美股 OR 纳斯达克 OR 标普500) (资金流向 OR 财报 OR 市场叙事 OR 投资者情绪 OR 泡沫 OR 恐慌) when:3d",priority:"know",maxAgeHours:96},
  {id:"china_economy",label:"中国经济",query:"(中国经济 OR 货币政策 OR 财政政策 OR 消费 OR 房地产政策) when:3d",priority:"must",domestic:true,localGrounded:true},
  {id:"career_cities",label:"职场 / 城市产业",query:"(北京 OR 上海 OR 深圳 OR 杭州 OR 香港) (招聘 OR 岗位 OR 产业 OR 金融科技) when:4d",priority:"know",domestic:true,maxAgeHours:120},
  {id:"ai_workflows",label:"AI / 工作流",query:"(银行 AI OR 财富管理 AI OR 白领 AI 工作流 OR AI Agent 企业应用) when:3d",priority:"know"},
  {id:"frontier",label:"新行业 / 社会变化",query:"(新兴行业 OR 新工具 OR 工作方式 OR 社会趋势 OR 产业变化) when:3d",priority:"expand"},
  {id:"life_trends",label:"生活 / 观念 / 新习惯",query:"(年轻人 OR 白领 OR 城市生活) (新习惯 OR 消费观念 OR 学习方式 OR 工作观念 OR 新热潮) when:4d",priority:"expand",maxAgeHours:120}
];

const blockedTerms=["明星","综艺","恋情","离婚","票房","红毯","网红","猎奇","占卜","星座","游戏皮肤","演唱会","短剧热搜"];

const profile=`
用户画像（仅用于判断相关性，不要把私人信息写进新闻事实）：
- 25 岁，在中国国有银行县域网点做个人客户经理，工作覆盖存款、保险、基金、黄金、商户、大客户、企业客户与贷款协同。
- 已积累客户沟通、公开表达、培训汇报、复杂现场推进能力；仍需补齐财富产品、保险规划、信贷、公司业务、谈判与风险识别。
- 正在学习 AFP/财富管理和英语，希望 3 年内形成离开县域、进入更大城市和更大平台的可迁移职业资本。
- 重点观察北京、上海、深圳、杭州、香港和全球前沿，但不需要城市生活方式鸡汤。
- 关注 AI，但只学习能进入银行客户经营、访前准备、复盘、数据分析、汇报和学习的真实工作流。
- 可投资资产约：积存金 57,702 元、实物金 27g（估值可变）、现金 30,000 元、纳指基金合计约 44,000 元、稳健债基 20,000 元、定期 10,000 元、保险已投入约 30,000 元；公积金约 85,000 元单列。保险未来仍需缴费两年。工作日纳指定投 100 元。
- 核心原则：不要制造焦虑，只制造提前量。结论必须具体、克制、可验证。
`;

function decodeXml(value=""){
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g,"")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g," ");
}

function stripHtml(value=""){
  return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

function extractTag(xml,tag){
  const match=xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,`i`));
  return match?decodeXml(match[1].trim()):"";
}

function sourceFromTitle(rawTitle){
  const parts=rawTitle.split(" - ");
  return parts.length>1?parts.at(-1).trim():"公开来源";
}

function cleanTitle(rawTitle){
  const parts=rawTitle.split(" - ");
  return (parts.length>1?parts.slice(0,-1).join(" - "):rawTitle).trim();
}

export function normalizeTitle(value=""){
  return cleanTitle(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"").replace(/(最新|重磅|突发|独家|深度|解读|回应)/g,"");
}

function bigrams(value){
  const normalized=normalizeTitle(value);
  const out=new Set();
  for(let i=0;i<normalized.length-1;i++) out.add(normalized.slice(i,i+2));
  return out;
}

export function similarity(left,right){
  const a=bigrams(left),b=bigrams(right);
  if(!a.size||!b.size) return normalizeTitle(left)===normalizeTitle(right)?1:0;
  let shared=0;
  for(const token of a) if(b.has(token)) shared++;
  return shared/(a.size+b.size-shared);
}

export function dedupeCandidates(candidates,threshold=.52){
  const output=[];
  for(const candidate of candidates){
    if(output.some(existing=>similarity(existing.title,candidate.title)>=threshold)) continue;
    output.push(candidate);
  }
  return output;
}

function hoursOld(value){
  const time=new Date(value).getTime();
  return Number.isFinite(time)?Math.max(0,(Date.now()-time)/36e5):Infinity;
}

const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function fetchText(url,options={}){
  const {timeoutMs=20000,...fetchOptions}=options;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{...fetchOptions,signal:controller.signal,headers:{"User-Agent":"NiniRadar/3.3 (+personal GitHub Pages project)",...(fetchOptions.headers||{})}});
    if(!response.ok){
      const error=new Error(`${response.status} ${response.statusText}`);
      error.status=response.status;
      throw error;
    }
    return await response.text();
  }finally{clearTimeout(timeout);}
}

async function fetchRss(category){
  const rss=`https://news.google.com/rss/search?q=${encodeURIComponent(category.query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const xml=await fetchText(rss);
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match=>match[1]);
  return items.slice(0,16).map((item,index)=>{
    const rawTitle=stripHtml(extractTag(item,"title"));
    const publishedAt=extractTag(item,"pubDate");
    const source=stripHtml(extractTag(item,"source"))||sourceFromTitle(rawTitle);
    return {
      id:`${category.id}-${index}-${Buffer.from(normalizeTitle(rawTitle)).toString("base64url").slice(0,10)}`,
      categoryId:category.id,
      category:category.label,
      priorityHint:category.priority,
      domestic:Boolean(category.domestic),
      localGrounded:Boolean(category.localGrounded),
      title:cleanTitle(rawTitle),
      source,
      publishedAt:new Date(publishedAt).toISOString(),
      url:stripHtml(extractTag(item,"link")),
      snippet:stripHtml(extractTag(item,"description")).slice(0,700)
    };
  }).filter(item=>item.title&&item.url&&hoursOld(item.publishedAt)<=(category.maxAgeHours??MAX_SOURCE_AGE_HOURS)&&!blockedTerms.some(term=>item.title.includes(term)));
}

async function collectCandidates(){
  const results=await Promise.allSettled(categories.map(fetchRss));
  const failures=[];
  const buckets=[];
  results.forEach((result,index)=>{
    if(result.status==="fulfilled") buckets.push(result.value.slice(0,7));
    else failures.push(`${categories[index].label}: ${result.reason?.message||"抓取失败"}`);
  });
  const interleaved=[];
  for(let round=0;round<7;round++) for(const bucket of buckets) if(bucket[round]) interleaved.push(bucket[round]);
  const candidates=dedupeCandidates(interleaved).slice(0,56);
  if(candidates.length<5) throw new Error(`可用新闻不足 5 条。${failures.join("；")}`);
  return {candidates,failures};
}

function percentageChange(current,previous){
  if(!Number.isFinite(current)||!Number.isFinite(previous)||previous===0) return null;
  return Number(((current/previous-1)*100).toFixed(2));
}

async function fetchYahooSeries(definition){
  const suffix=`/v8/finance/chart/${encodeURIComponent(definition.symbol)}?range=2mo&interval=1d&includePrePost=false`;
  let raw,lastError;
  for(const host of ["https://query1.finance.yahoo.com","https://query2.finance.yahoo.com"]){
    for(let attempt=1;attempt<=3;attempt++){
      try{
        raw=JSON.parse(await fetchText(`${host}${suffix}`,{headers:{Accept:"application/json"}}));
        break;
      }catch(error){
        lastError=error;
        if(attempt<3) await sleep(1200*attempt);
      }
    }
    if(raw) break;
  }
  if(!raw) throw lastError||new Error(`${definition.label} 行情读取失败`);
  const result=raw?.chart?.result?.[0];
  const timestamps=result?.timestamp||[];
  const closes=result?.indicators?.quote?.[0]?.close||[];
  const rows=timestamps.map((timestamp,index)=>({timestamp,value:Number(closes[index])})).filter(row=>Number.isFinite(row.value));
  if(rows.length<2) throw new Error(`${definition.label} 可用数据不足`);
  const last=rows.at(-1);
  const transform=definition.transform||((value)=>value);
  const current=transform(last.value);
  return {
    key:definition.key,
    label:definition.label,
    value:Number(current.toFixed(definition.digits??2)),
    unit:definition.unit,
    dayChange:percentageChange(last.value,rows.at(-2)?.value),
    weekChange:percentageChange(last.value,rows.at(-6)?.value),
    monthChange:percentageChange(last.value,rows.at(-21)?.value),
    asOf:new Date(last.timestamp*1000).toISOString(),
    sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(definition.symbol)}`
  };
}

export async function collectMarket(){
  const definitions=[
    {key:"nasdaq100",label:"Nasdaq 100",symbol:"^NDX",unit:"点",digits:0},
    {key:"gold",label:"COMEX 黄金",symbol:"GC=F",unit:" 美元/盎司",digits:2},
    {key:"dollar",label:"美元指数",symbol:"DX-Y.NYB",unit:"",digits:2},
    {key:"us10y",label:"美国 10Y",symbol:"^TNX",unit:"%",digits:2}
  ];
  const settled=[];
  for(let index=0;index<definitions.length;index+=2){
    settled.push(...await Promise.allSettled(definitions.slice(index,index+2).map(fetchYahooSeries)));
    if(index+2<definitions.length) await sleep(800);
  }
  const items=settled.map((result,index)=>result.status==="fulfilled"?result.value:{
    key:definitions[index].key,label:definitions[index].label,value:null,unit:definitions[index].unit,
    dayChange:null,weekChange:null,monthChange:null,asOf:"",sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(definitions[index].symbol)}`
  });
  const available=items.filter(item=>item.value!==null);
  const asOf=available.map(item=>item.asOf).sort().at(-1)||"";
  return {status:available.length>=3?"ok":available.length?"partial":"unavailable",asOf,source:"Yahoo Finance（公开行情，可能延迟）",items};
}

const outputSchema={
  type:"object",additionalProperties:false,
  properties:{
    selected:{type:"array",minItems:5,maxItems:10,items:{type:"object",additionalProperties:false,properties:{
      candidateId:{type:"string"},level:{type:"string",enum:["must","know","expand"]},eventKey:{type:"string"},qualityScore:{type:"integer",minimum:0,maximum:100},
      whatHappened:{type:"string"},whyImportant:{type:"string"},relation:{type:"string"},
      actionLevel:{type:"string",enum:["现在就行动","加入观察清单","知道即可","与我暂时无关"]},actionDetail:{type:"string"}
    },required:["candidateId","level","eventKey","qualityScore","whatHappened","whyImportant","relation","actionLevel","actionDetail"]}},
    cognitions:{type:"array",minItems:1,maxItems:3,items:{type:"object",additionalProperties:false,properties:{
      domain:{type:"string",enum:["世界 / 科技","金融 / 职业","个人成长 / 决策"]},cognition:{type:"string",maxLength:26},why:{type:"string"},meaning:{type:"string"},dedupeKey:{type:"string"}
    },required:["domain","cognition","why","meaning","dedupeKey"]}},
    outside:{type:"array",minItems:0,maxItems:4,items:{type:"object",additionalProperties:false,properties:{
      evidenceCandidateId:{type:"string"},trendKey:{type:"string"},kind:{type:"string",enum:["career","life"]},placeOrSector:{type:"string"},signal:{type:"string"},meaning:{type:"string"},horizon:{type:"string"}
    },required:["evidenceCandidateId","trendKey","kind","placeOrSector","signal","meaning","horizon"]}},
    marketStories:{type:"array",minItems:2,maxItems:5,items:{type:"object",additionalProperties:false,properties:{
      candidateId:{type:"string"},market:{type:"string",enum:["A股","美股","黄金 / 宏观"]},title:{type:"string"},whatHappened:{type:"string"},whyMarketCares:{type:"string"},relation:{type:"string"}
    },required:["candidateId","market","title","whatHappened","whyMarketCares","relation"]}},
    investment:{type:"object",additionalProperties:false,properties:{
      verdict:{type:"string",enum:["🟢 正常定投","🟡 可酌情小幅加仓","⚪ 正常定投，暂不额外加仓","🔴 暂缓新增风险"]},
      reason:{type:"string"},amount:{type:"string"},cancelIf:{type:"string"},drivers:{type:"array",minItems:2,maxItems:4,items:{type:"string"}},
      assetSignals:{type:"object",additionalProperties:false,properties:{
        nasdaq100:{type:"object",additionalProperties:false,properties:{status:{type:"string"},judgment:{type:"string"}},required:["status","judgment"]},
        gold:{type:"object",additionalProperties:false,properties:{status:{type:"string"},judgment:{type:"string"}},required:["status","judgment"]}
      },required:["nasdaq100","gold"]},
      environment:{type:"object",additionalProperties:false,properties:{
        usStocks:{type:"string"},aShares:{type:"string"},gold:{type:"string"},summary:{type:"string"}
      },required:["usStocks","aShares","gold","summary"]}
    },required:["verdict","reason","amount","cancelIf","drivers","assetSignals","environment"]},
    oneThing:{type:"object",additionalProperties:false,properties:{task:{type:"string"},minutes:{type:"integer",minimum:10,maximum:60}},required:["task","minutes"]}
  },required:["selected","cognitions","outside","marketStories","investment","oneThing"]
};

function modelInstructions(){
  return `你是“倪倪专属雷达”的每日主编。先使用 web search 核实候选新闻，再生成严格 JSON。

真实性：
1. 只能选择输入候选列表中可由标题、摘要和 web search 核实的事件；candidateId 必须原样返回。
2. 不猜数字、不补不存在的因果。材料不足时宁可不选。每条“发生了什么”2–4句，写清具体主体、动作、时间或范围。
3. RSS 时间、来源、链接由程序回填，你不要改写这些字段。

选题硬约束：
- 总数 5–10；must 2–3 条、know 3–4 条、expand 1–3 条。当天没有高质量内容可少选，但绝不拿娱乐、猎奇或低价值内容凑数。
- selected 对应“今日外部世界”，回答过去 24–72 小时发生了什么。规划、县域产业等低频主题即使候选窗口更长，也只有仍在影响当前决策时才选择，并必须保留真实发布时间。
- 同一 category 最多 2 条；AI / 工作流最多 2 条；同一公司或同一事件只留 1 条。eventKey 用“主体+事件”短语归并重复报道。
- qualityScore 低于 70 的内容不要选。真正的能力跃迁型 AI 事件可以进 must，普通产品更新不能。
- 国际经济、全球市场、科技变化与北京/上海/深圳/杭州/香港等大城市前沿仍是主轴，通常占约 70%–80%。国内政策、中国经济、四川/成渝/县域等贴近当下生活的信息作为补充，通常约 20%–30%，比例只作编辑方向，不为凑数机械执行。
- 国内补充只在确有直接传导链时选择：政策如何影响客户、银行业务、资产判断或迁移选择。没有可靠且真正相关的内容时可以为 0；不得因为“发生在国内”就自动提高等级。

逐条分析：
- whyImportant 解释结构性变化，不复述标题。
- relation 必须落到这位县域银行客户经理的实际工作、财富管理能力、三年迁移资本、英语/AFP学习或现有资产约束；不同新闻不得换词复用同一建议。
- actionLevel 只用给定四类。若“现在就行动”，actionDetail 给一个本周可完成、对象/产出/次数清楚的小动作；观察项写清观察指标与复查时点；知道即可或暂时无关也要说明边界。

投资：
- 同时看 1日/5日/20日、新闻驱动、长期逻辑、纳指与黄金仓位、现金安全垫和未来两年保险缴费。不可只凭单日涨跌。
- 若建议小幅加仓，amount 必须写人民币金额区间，cancelIf 写清取消条件。不得出现梭哈、抄底冲刺等措辞。
- 若市场数据不足或重大风险尚不清晰，优先克制。
- 前台只直接解释用户真实持有的 Nasdaq 100 与黄金。assetSignals.nasdaq100 和 assetSignals.gold 各给一个短状态和一句不超过 45 字的人话判断；美元指数、美债收益率、VIX、汇率和利率预期只能作为后台依据，不把专业数字丢给用户自己解读。
- environment 把宏观环境翻译为美股、A股、黄金三个简短状态和一句总判断。信息不足就写“⚪ 数据待核验”，不得假装实时。

市场大事与风潮：
- marketStories 选 2–5 条真正可能改变预期或形成讨论热潮的事件，关注 A股、美股，以及有重大事件时的黄金/宏观。优先 IPO、资金流向、散户行为、爆火板块、龙头财报、重大政策、利率转向、泡沫/恐慌和新投资叙事。
- 不要把“指数涨 0.3%”“某股涨 2%”当市场大事。每条只写 1–2 句事实、1 句市场为何关注、1 句对用户的含义。candidateId 必须来自候选；来源、时间和链接由程序回填。

认知与外部坐标：
- cognitions 可以 1–3 条，宁缺毋滥。优先覆盖世界/科技、金融/职业、个人成长/决策，但绝不能为凑满 3 条换词重复。生成前必须查看 input.cognitionHistory；dedupeKey 用“主题>核心结论”的稳定写法。只要核心观点、标题、主题或结论与过去 30 天相同，即使换了措辞也不要生成。
- cognition 是一句不超过 22 个汉字、像熟悉她的 GPT 当面说出的短句：口语、直接、一下能听懂，不堆“结构性、迁移、赋能、范式”等抽象词。why 和 meaning 也用日常聊天语气，每段 1–2 句。
- 认知更新优先带来大城市、更大平台和更开放环境里的新判断方式，帮助她识别“小地方都这么做”“大家都说应该如此”背后的局限；不要为了反主流而反主流，要给可验证的现实依据。
- outside 回答未来 1–3 年优秀平台、岗位、能力、工作方式和生活观念往哪里变化，不回答“今天发生了什么”。它与今日外部世界不能只是同一新闻换个说法。查看 input.outsideRefreshDue：为 false 时返回空数组；为 true 时也只有发现相对 input.previousOutside 真正新的趋势证据才返回。trendKey 用稳定短语归并同一趋势；每项用 kind 标为 career 或 life，所有内容都用 evidenceCandidateId 绑定候选新闻。
- oneThing 只给一个 10–60 分钟动作，优先服务当周可迁移职业资本。

${profile}`;
}

function extractOutputText(response){
  if(typeof response.output_text==="string") return response.output_text;
  for(const item of response.output||[]){
    for(const content of item.content||[]){
      if(content.type==="output_text"&&typeof content.text==="string") return content.text;
    }
  }
  throw new Error("OpenAI 响应中没有可解析的 output_text");
}

function countWebSources(response){
  let count=0;
  for(const item of response.output||[]){
    const sources=item.action?.sources;
    if(Array.isArray(sources)) count+=sources.length;
  }
  return count;
}

async function analyze(candidates,market,context={}){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error("缺少 OPENAI_API_KEY。请把 Key 放在 GitHub Actions Secret，不要写进前端或仓库。");
  const payload={
    model:OPENAI_MODEL,
    store:false,
    reasoning:{effort:"low"},
    instructions:modelInstructions(),
    input:JSON.stringify({generatedAt:new Date().toISOString(),candidates,market,...context},null,2),
    tools:[{type:"web_search"}],
    include:["web_search_call.action.sources"],
    max_tool_calls:18,
    max_output_tokens:14000,
    text:{format:{type:"json_schema",name:"nini_radar_daily",strict:true,schema:outputSchema}}
  };
  const raw=await fetchText("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify(payload),
    timeoutMs:180000
  });
  const response=JSON.parse(raw);
  if(response.status&&response.status!=="completed") throw new Error(`OpenAI 任务状态：${response.status}`);
  return {analysis:JSON.parse(extractOutputText(response)),verificationSourceCount:countWebSources(response)};
}

function repeatedText(items,field,threshold=.88){
  for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++) if(similarity(items[i][field],items[j][field])>=threshold) return true;
  return false;
}

function canonicalCognition(value=""){
  return normalizeTitle(value)
    .replace(/客户关系|经营客户|客户总资产|客户资产留存/g,"客户经营")
    .replace(/卖产品|产品销售|单品销量|单次成交/g,"单品销售")
    .replace(/可迁移能力|外部岗位证据|带得走的能力/g,"可迁移证据")
    .replace(/人工智能/g,"ai")
    .replace(/大平台|头部平台|更大平台/g,"大平台");
}

export function dedupeCognitions(cognitions=[],history=[]){
  const accepted=[];
  const priorKeys=new Set(history.map(item=>canonicalCognition(item.dedupeKey||"")).filter(Boolean));
  const prior=history.map(item=>canonicalCognition(`${item.dedupeKey||""}${item.cognition||item.title||""}${item.conclusion||""}`)).filter(Boolean);
  for(const item of cognitions){
    const key=canonicalCognition(item.dedupeKey||"");
    const signature=canonicalCognition(`${item.dedupeKey||""}${item.cognition||""}`);
    if(!signature) continue;
    if(key&&priorKeys.has(key)) continue;
    if(prior.some(existing=>existing===signature||similarity(existing,signature)>=.58)) continue;
    if(accepted.some(existing=>{
      const otherKey=canonicalCognition(existing.dedupeKey||"");
      if(key&&otherKey===key) return true;
      const other=canonicalCognition(`${existing.dedupeKey||""}${existing.cognition||""}`);
      return other===signature||similarity(other,signature)>=.58;
    })) continue;
    accepted.push(item);
  }
  return accepted.slice(0,3);
}

function daysSince(dateValue){
  const time=new Date(`${String(dateValue||"").slice(0,10)}T00:00:00Z`).getTime();
  return Number.isFinite(time)?Math.floor((Date.now()-time)/864e5):Infinity;
}

function isOutsideDuplicate(left,right){
  const leftKey=normalizeTitle(left.trendKey||left.signal||"");
  const rightKey=normalizeTitle(right.trendKey||right.signal||"");
  return Boolean(leftKey&&rightKey&&(leftKey===rightKey||similarity(leftKey,rightKey)>=.56));
}

async function readJsonOr(file,fallback){
  try{return JSON.parse(await readFile(file,"utf8"));}catch{return fallback;}
}

export function enforceSelection(selected,candidates){
  const byId=new Map(candidates.map(item=>[item.id,item]));
  const categoryCounts=new Map(),levelCounts={must:0,know:0,expand:0};
  const levelCaps={must:3,know:4,expand:3};
  const eligibleCount=Math.min(10,selected.filter(item=>byId.has(item.candidateId)&&item.qualityScore>=70).length);
  const localGroundedCap=Math.max(1,Math.round(eligibleCount*.3));
  const eventKeys=new Set();
  const output=[];
  let aiCount=0,localGroundedCount=0;
  for(const analysis of selected){
    const candidate=byId.get(analysis.candidateId);
    if(!candidate||analysis.qualityScore<70||output.length>=10) continue;
    const eventKey=normalizeTitle(analysis.eventKey||candidate.title);
    if(!eventKey||eventKeys.has(eventKey)) continue;
    if(output.some(item=>similarity(item.title,candidate.title)>=.56)) continue;
    const categoryCount=categoryCounts.get(candidate.categoryId)||0;
    if(categoryCount>=2||levelCounts[analysis.level]>=levelCaps[analysis.level]) continue;
    if(candidate.categoryId==="ai_workflows"&&aiCount>=2) continue;
    if(candidate.localGrounded&&localGroundedCount>=localGroundedCap) continue;
    eventKeys.add(eventKey);
    categoryCounts.set(candidate.categoryId,categoryCount+1);
    levelCounts[analysis.level]++;
    if(candidate.categoryId==="ai_workflows") aiCount++;
    if(candidate.localGrounded) localGroundedCount++;
    output.push({...candidate,...analysis,eventKey});
  }
  return output;
}

function chinaDate(instant=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(instant);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isReusableMarketSnapshot(market,maxAgeMinutes=30){
  const generatedAt=new Date(market?.generatedAt||0).getTime();
  const ageMinutes=(Date.now()-generatedAt)/60000;
  return ["ok","partial"].includes(market?.status)&&Number.isFinite(ageMinutes)&&ageMinutes>=0&&ageMinutes<=maxAgeMinutes;
}

function buildFinal({analysis,candidates,market,failures,verificationSourceCount,previousData={},cognitionHistory=[],outsideRefreshDue=true}){
  const news=enforceSelection(analysis.selected,candidates);
  if(!news.length) throw new Error("所有候选均未通过质量、重复或配额校验，保留上一版日报。");
  const levelCounts=news.reduce((counts,item)=>({...counts,[item.level]:(counts[item.level]||0)+1}),{});
  if(news.length<5||levelCounts.must<2||levelCounts.know<3||levelCounts.expand<1) throw new Error("本次结果未满足 2/3/1 的最低类别配额，保留上一版日报。");
  if(repeatedText(news,"relation")||repeatedText(news,"actionDetail")) throw new Error("检测到新闻分析高度重复，拒绝发布本次结果。");
  const candidateById=new Map(candidates.map(item=>[item.id,item]));
  const marketStoryIds=new Set();
  const marketStories=(analysis.marketStories||[]).map(item=>{
    const evidence=candidateById.get(item.candidateId);
    if(!evidence||marketStoryIds.has(evidence.id)) return null;
    marketStoryIds.add(evidence.id);
    return {...item,url:evidence.url,source:evidence.source,publishedAt:evidence.publishedAt};
  }).filter(Boolean).slice(0,5);
  if(marketStories.length<2) throw new Error("市场大事不足 2 条可追溯依据，拒绝发布本次结果。");

  const previousOutside=(previousData.outside||[]).map(item=>({...item,trendKey:item.trendKey||normalizeTitle(item.signal||"")}));
  const proposedOutside=(analysis.outside||[]).map(item=>{
    const evidence=candidateById.get(item.evidenceCandidateId);
    return evidence?{...item,url:evidence.url,source:evidence.source,publishedAt:evidence.publishedAt}:null;
  }).filter(Boolean).slice(0,4);
  const novelOutside=proposedOutside.filter(item=>!previousOutside.some(existing=>isOutsideDuplicate(item,existing)));
  const outside=outsideRefreshDue&&novelOutside.length
    ?[...novelOutside,...previousOutside.filter(existing=>!novelOutside.some(item=>isOutsideDuplicate(item,existing)))].slice(0,4)
    :previousOutside.slice(0,4);
  const outsideUpdatedAt=outsideRefreshDue&&novelOutside.length?chinaDate():previousData.outsideUpdatedAt||previousData.effectiveDate||chinaDate();

  const cognitions=dedupeCognitions(analysis.cognitions||[],cognitionHistory);
  market.generatedAt=new Date().toISOString();
  const marketByKey=new Map((market.items||[]).map(item=>[item.key,item]));
  const availableMarket=["nasdaq100","gold"].every(key=>marketByKey.get(key)?.value!==null&&marketByKey.get(key)?.value!==undefined);
  return {
    version:"3.3",
    status:"ok",
    generatedAt:new Date().toISOString(),
    effectiveDate:chinaDate(),
    timezone:"Asia/Shanghai",
    news,
    outside,
    outsideUpdatedAt,
    marketStories,
    cognitions,
    market,
    investment:{available:availableMarket,...analysis.investment},
    oneThing:analysis.oneThing,
    pipeline:{
      newsSource:"Google News RSS（候选）",
      analysis:`OpenAI Responses API · ${OPENAI_MODEL} · web search 核实`,
      verificationSourceCount,
      sourceFailures:failures,
      maxSourceAgeHours:MAX_SOURCE_AGE_HOURS,
      cognitionHistoryWindowDays:30,
      outsideRefreshDays:7,
      localGroundedSelected:news.filter(item=>item.localGrounded).length,
      note:"所有展示新闻均由程序回填原始来源与发布时间；失败时不覆盖最后一次成功日报。"
    }
  };
}

async function main(){
  if(!process.env.OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY。请把 Key 放在 GitHub Actions Secret，不要写进前端或仓库。");
  console.log("[1/4] 抓取并去重候选新闻");
  const previousData=await readJsonOr(OUTPUT,{});
  const historyFile=await readJsonOr(COGNITION_HISTORY_OUTPUT,{entries:[]});
  const allHistory=Array.isArray(historyFile)?historyFile:(historyFile.entries||[]);
  const cognitionHistory=allHistory.filter(item=>daysSince(item.date)<=30);
  const outsideRefreshDue=daysSince(previousData.outsideUpdatedAt||previousData.effectiveDate)>=7;
  const {candidates,failures}=await collectCandidates();
  console.log(`候选 ${candidates.length} 条；源失败 ${failures.length} 个`);
  console.log("[2/4] 读取多周期市场数据");
  const market=isReusableMarketSnapshot(previousData.market)
    ?previousData.market
    :await collectMarket();
  if(isReusableMarketSnapshot(previousData.market)) console.log("复用本次工作流刚刚核验的行情，避免重复请求行情源。");
  console.log(`市场状态：${market.status}`);
  console.log("[3/4] 核实、筛选并逐条生成个性化分析");
  const {analysis,verificationSourceCount}=await analyze(candidates,market,{
    cognitionHistory,
    outsideRefreshDue,
    previousOutside:previousData.outside||[]
  });
  const finalData=buildFinal({analysis,candidates,market,failures,verificationSourceCount,previousData,cognitionHistory,outsideRefreshDue});
  console.log(`[4/4] 发布 ${finalData.news.length} 条（国内/县域补充 ${finalData.pipeline.localGroundedSelected} 条），写入数据文件`);
  await mkdir(path.dirname(OUTPUT),{recursive:true});
  await writeFile(OUTPUT,`${JSON.stringify(finalData,null,2)}\n`,"utf8");
  await writeFile(FALLBACK_OUTPUT,`window.__NINI_RADAR_FALLBACK__ = ${JSON.stringify(finalData,null,2)};\n`,"utf8");
  const newHistory=finalData.cognitions.map(item=>({
    date:finalData.effectiveDate,
    domain:item.domain,
    cognition:item.cognition,
    dedupeKey:item.dedupeKey,
    theme:String(item.dedupeKey||"").split(">")[0]||item.domain,
    conclusion:item.cognition
  }));
  await writeFile(COGNITION_HISTORY_OUTPUT,`${JSON.stringify({updatedAt:new Date().toISOString(),entries:[...cognitionHistory,...newHistory]},null,2)}\n`,"utf8");
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked){
  main().catch(error=>{
    console.error(`更新失败：${error.stack||error.message}`);
    process.exitCode=1;
  });
}
