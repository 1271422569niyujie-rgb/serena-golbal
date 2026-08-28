import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const OUTPUT=path.join(ROOT,"data","radar-latest.json");
const FALLBACK_OUTPUT=path.join(ROOT,"data","radar-fallback.js");
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.4-mini";
const MAX_SOURCE_AGE_HOURS=84;

const categories=[
  {id:"domestic_policy",label:"国内政策 / 十五五",query:"(十五五 OR 国务院 OR 国家发展改革委 OR 中国人民银行 OR 金融监管总局) (规划 OR 政策 OR 就业 OR 消费 OR 金融) when:5d",priority:"must",domestic:true,localGrounded:true,maxAgeHours:120},
  {id:"county_local",label:"四川 / 成渝 / 县域",query:"(四川 OR 成都 OR 绵阳 OR 成渝 OR 县域) (银行 OR 金融 OR 产业 OR 就业 OR 人才 OR 消费 OR 政策) when:7d",priority:"know",domestic:true,localGrounded:true,maxAgeHours:168},
  {id:"macro_global",label:"重大事件 / 宏观政策",query:"(中国 重大政策 OR 美联储 OR 全球经济 OR 地缘政治) when:2d",priority:"must"},
  {id:"banking",label:"银行业",query:"(中国 银行业 OR 银行监管 OR 商业银行 OR 金融监管) when:3d",priority:"know",domestic:true,localGrounded:true},
  {id:"wealth",label:"财富管理 / 私行",query:"(中国 财富管理 OR 私人银行 OR 高净值 OR 资产配置) when:3d",priority:"know",domestic:true,localGrounded:true},
  {id:"markets",label:"黄金 / 纳指 / 利率 / 美元",query:"(黄金 OR 纳斯达克 OR 美债收益率 OR 美元指数) when:2d",priority:"must"},
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

async function fetchText(url,options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal,headers:{"User-Agent":"NiniRadar/3.3 (+personal GitHub Pages project)",...(options.headers||{})}});
    if(!response.ok) throw new Error(`${response.status} ${response.statusText}`);
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
    try{
      raw=JSON.parse(await fetchText(`${host}${suffix}`,{headers:{Accept:"application/json"}}));
      break;
    }catch(error){lastError=error;}
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
  const settled=await Promise.allSettled(definitions.map(fetchYahooSeries));
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
    cognitions:{type:"array",minItems:3,maxItems:3,items:{type:"object",additionalProperties:false,properties:{
      domain:{type:"string",enum:["世界 / 科技","金融 / 职业","个人成长 / 决策"]},cognition:{type:"string",maxLength:26},why:{type:"string"},meaning:{type:"string"}
    },required:["domain","cognition","why","meaning"]}},
    outside:{type:"array",minItems:2,maxItems:4,items:{type:"object",additionalProperties:false,properties:{
      evidenceCandidateId:{type:"string"},kind:{type:"string",enum:["career","life"]},placeOrSector:{type:"string"},signal:{type:"string"},meaning:{type:"string"},horizon:{type:"string"}
    },required:["evidenceCandidateId","kind","placeOrSector","signal","meaning","horizon"]}},
    investment:{type:"object",additionalProperties:false,properties:{
      verdict:{type:"string",enum:["🟢 正常定投","🟡 可酌情小幅加仓","⚪ 正常定投，暂不额外加仓","🔴 暂缓新增风险"]},
      reason:{type:"string"},amount:{type:"string"},cancelIf:{type:"string"},drivers:{type:"array",minItems:2,maxItems:4,items:{type:"string"}}
    },required:["verdict","reason","amount","cancelIf","drivers"]},
    oneThing:{type:"object",additionalProperties:false,properties:{task:{type:"string"},minutes:{type:"integer",minimum:10,maximum:60}},required:["task","minutes"]}
  },required:["selected","cognitions","outside","investment","oneThing"]
};

function modelInstructions(){
  return `你是“倪倪专属雷达”的每日主编。先使用 web search 核实候选新闻，再生成严格 JSON。

真实性：
1. 只能选择输入候选列表中可由标题、摘要和 web search 核实的事件；candidateId 必须原样返回。
2. 不猜数字、不补不存在的因果。材料不足时宁可不选。每条“发生了什么”2–4句，写清具体主体、动作、时间或范围。
3. RSS 时间、来源、链接由程序回填，你不要改写这些字段。

选题硬约束：
- 总数 5–10；must 2–3 条、know 3–4 条、expand 1–3 条。当天没有高质量内容可少选，但绝不拿娱乐、猎奇或低价值内容凑数。
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

认知与外部坐标：
- 三条认知依次覆盖世界/科技、金融/职业、个人成长/决策；必须能由当天材料或明确机制验证，拒绝鸡汤。cognition 是一句不超过 22 个汉字、像熟悉她的 GPT 当面说出的短句：口语、直接、一下能听懂，不堆“结构性、迁移、赋能、范式”等抽象词。why 和 meaning 也用日常聊天语气，每段 1–2 句。
- 认知更新优先带来大城市、更大平台和更开放环境里的新判断方式，帮助她识别“小地方都这么做”“大家都说应该如此”背后的局限；不要为了反主流而反主流，要给可验证的现实依据。
- outside 既观察北京、上海、深圳、杭州、香港、头部机构和一线白领的能力/岗位变化，也观察人的观念、习惯、学习方式、消费选择和真实新热潮。每项用 kind 标为 career 或 life；当天有高质量依据时，优先保留 1 条 life，纯娱乐热搜不算。所有内容都用 evidenceCandidateId 绑定一条已选新闻。
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

async function analyze(candidates,market){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error("缺少 OPENAI_API_KEY。请把 Key 放在 GitHub Actions Secret，不要写进前端或仓库。");
  const payload={
    model:OPENAI_MODEL,
    store:false,
    reasoning:{effort:"low"},
    instructions:modelInstructions(),
    input:JSON.stringify({generatedAt:new Date().toISOString(),candidates,market},null,2),
    tools:[{type:"web_search"}],
    include:["web_search_call.action.sources"],
    max_tool_calls:14,
    max_output_tokens:12000,
    text:{format:{type:"json_schema",name:"nini_radar_daily",strict:true,schema:outputSchema}}
  };
  const raw=await fetchText("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const response=JSON.parse(raw);
  if(response.status&&response.status!=="completed") throw new Error(`OpenAI 任务状态：${response.status}`);
  return {analysis:JSON.parse(extractOutputText(response)),verificationSourceCount:countWebSources(response)};
}

function repeatedText(items,field,threshold=.88){
  for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++) if(similarity(items[i][field],items[j][field])>=threshold) return true;
  return false;
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

function buildFinal({analysis,candidates,market,failures,verificationSourceCount}){
  const news=enforceSelection(analysis.selected,candidates);
  if(!news.length) throw new Error("所有候选均未通过质量、重复或配额校验，保留上一版日报。");
  const levelCounts=news.reduce((counts,item)=>({...counts,[item.level]:(counts[item.level]||0)+1}),{});
  if(news.length<5||levelCounts.must<2||levelCounts.know<3||levelCounts.expand<1) throw new Error("本次结果未满足 2/3/1 的最低类别配额，保留上一版日报。");
  if(repeatedText(news,"relation")||repeatedText(news,"actionDetail")) throw new Error("检测到新闻分析高度重复，拒绝发布本次结果。");
  const byId=new Map(news.map(item=>[item.id,item]));
  const outside=(analysis.outside||[]).map(item=>{
    const evidence=byId.get(item.evidenceCandidateId);
    return evidence?{...item,url:evidence.url,source:evidence.source,publishedAt:evidence.publishedAt}:null;
  }).filter(Boolean).slice(0,4);
  if(outside.length<2) throw new Error("外部坐标不足 2 条可追溯依据，拒绝发布本次结果。");
  const availableMarket=market.items.filter(item=>item.value!==null).length>=3;
  return {
    version:"3.3",
    status:"ok",
    generatedAt:new Date().toISOString(),
    effectiveDate:chinaDate(),
    timezone:"Asia/Shanghai",
    news,
    outside,
    cognitions:(analysis.cognitions||[]).slice(0,3),
    market,
    investment:{available:availableMarket,...analysis.investment},
    oneThing:analysis.oneThing,
    pipeline:{
      newsSource:"Google News RSS（候选）",
      analysis:`OpenAI Responses API · ${OPENAI_MODEL} · web search 核实`,
      verificationSourceCount,
      sourceFailures:failures,
      maxSourceAgeHours:MAX_SOURCE_AGE_HOURS,
      localGroundedSelected:news.filter(item=>item.localGrounded).length,
      note:"所有展示新闻均由程序回填原始来源与发布时间；失败时不覆盖最后一次成功日报。"
    }
  };
}

async function main(){
  if(!process.env.OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY。请把 Key 放在 GitHub Actions Secret，不要写进前端或仓库。");
  console.log("[1/4] 抓取并去重候选新闻");
  const {candidates,failures}=await collectCandidates();
  console.log(`候选 ${candidates.length} 条；源失败 ${failures.length} 个`);
  console.log("[2/4] 读取多周期市场数据");
  const market=await collectMarket();
  console.log(`市场状态：${market.status}`);
  console.log("[3/4] 核实、筛选并逐条生成个性化分析");
  const {analysis,verificationSourceCount}=await analyze(candidates,market);
  const finalData=buildFinal({analysis,candidates,market,failures,verificationSourceCount});
  console.log(`[4/4] 发布 ${finalData.news.length} 条（国内/县域补充 ${finalData.pipeline.localGroundedSelected} 条），写入数据文件`);
  await mkdir(path.dirname(OUTPUT),{recursive:true});
  await writeFile(OUTPUT,`${JSON.stringify(finalData,null,2)}\n`,"utf8");
  await writeFile(FALLBACK_OUTPUT,`window.__NINI_RADAR_FALLBACK__ = ${JSON.stringify(finalData,null,2)};\n`,"utf8");
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked){
  main().catch(error=>{
    console.error(`更新失败：${error.stack||error.message}`);
    process.exitCode=1;
  });
}
