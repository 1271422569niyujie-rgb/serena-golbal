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
  {id:"domestic_policy",label:"国内政策 / 十五五",query:"(十五五 OR 国务院 OR 国家发展改革委 OR 中国人民银行 OR 金融监管总局) (规划 OR 政策 OR 就业 OR 消费 OR 金融) when:5d",bingQuery:"中国 政策",priority:"must",domestic:true,localGrounded:true,maxAgeHours:120},
  {id:"county_local",label:"四川 / 成渝 / 县域",query:"(四川 OR 成都 OR 绵阳 OR 成渝 OR 县域) (银行 OR 金融 OR 产业 OR 就业 OR 人才 OR 消费 OR 政策) when:7d",bingQuery:"四川 成都",priority:"know",domestic:true,localGrounded:true,maxAgeHours:168},
  {id:"macro_global",label:"重大事件 / 宏观政策",query:"(中国 重大政策 OR 美联储 OR 全球经济 OR 地缘政治) when:2d",bingQuery:"美联储 全球经济",priority:"must"},
  {id:"banking",label:"银行业",query:"(中国 银行业 OR 银行监管 OR 商业银行 OR 金融监管) when:3d",bingQuery:"银行 监管",priority:"know",domestic:true,localGrounded:true},
  {id:"wealth",label:"财富管理 / 私行",query:"(中国 财富管理 OR 私人银行 OR 高净值 OR 资产配置) when:3d",bingQuery:"财富管理",priority:"know",domestic:true,localGrounded:true},
  {id:"markets",label:"黄金 / 纳指 / 利率 / 美元",query:"(黄金 OR 纳斯达克 OR 美债收益率 OR 美元指数) when:2d",bingQuery:"黄金 纳斯达克",priority:"must"},
  {id:"a_share_trends",label:"A股 / 资金 / 市场风潮",query:"(A股 OR 沪深股市 OR 港股) (资金流向 OR 开户 OR 成交额 OR 板块爆发 OR IPO OR 投资者情绪) when:3d",bingQuery:"A股",priority:"know",domestic:true,maxAgeHours:96},
  {id:"global_market_narrative",label:"美股 / 市场叙事",query:"(美股 OR 纳斯达克 OR 标普500) (资金流向 OR 财报 OR 市场叙事 OR 投资者情绪 OR 泡沫 OR 恐慌) when:3d",bingQuery:"美股 纳斯达克",priority:"know",maxAgeHours:96},
  {id:"china_economy",label:"中国经济",query:"(中国经济 OR 货币政策 OR 财政政策 OR 消费 OR 房地产政策) when:3d",bingQuery:"中国经济",priority:"must",domestic:true,localGrounded:true},
  {id:"career_cities",label:"职场 / 城市产业",query:"(北京 OR 上海 OR 深圳 OR 杭州 OR 香港) (招聘 OR 岗位 OR 产业 OR 金融科技) when:4d",bingQuery:"招聘",priority:"know",domestic:true,maxAgeHours:120},
  {id:"ai_workflows",label:"AI / 工作流",query:"(银行 AI OR 财富管理 AI OR 白领 AI 工作流 OR AI Agent 企业应用) when:3d",bingQuery:"AI 金融",priority:"know"},
  {id:"frontier",label:"新行业 / 社会变化",query:"(新兴行业 OR 新工具 OR 工作方式 OR 社会趋势 OR 产业变化) when:3d",bingQuery:"科技 产业",priority:"expand"},
  {id:"life_trends",label:"生活 / 观念 / 新习惯",query:"(年轻人 OR 白领 OR 城市生活) (新习惯 OR 消费观念 OR 学习方式 OR 工作观念 OR 新热潮) when:4d",bingQuery:"年轻人",priority:"expand",maxAgeHours:120}
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

function parseRss(xml,category,feedProvider){
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match=>match[1]);
  return items.slice(0,16).map((item,index)=>{
    const rawTitle=stripHtml(extractTag(item,"title"));
    const publishedAt=extractTag(item,"pubDate");
    const publishedTime=new Date(publishedAt);
    const source=stripHtml(extractTag(item,"source"))||stripHtml(extractTag(item,"News:Source"))||sourceFromTitle(rawTitle);
    return {
      id:`${category.id}-${index}-${Buffer.from(normalizeTitle(rawTitle)).toString("base64url").slice(0,10)}`,
      categoryId:category.id,
      category:category.label,
      priorityHint:category.priority,
      domestic:Boolean(category.domestic),
      localGrounded:Boolean(category.localGrounded),
      title:cleanTitle(rawTitle),
      source,
      publishedAt:Number.isFinite(publishedTime.getTime())?publishedTime.toISOString():"",
      url:stripHtml(extractTag(item,"link")),
      snippet:stripHtml(extractTag(item,"description")).slice(0,700),
      feedProvider
    };
  }).filter(item=>item.title&&item.url&&hoursOld(item.publishedAt)<=(category.maxAgeHours??MAX_SOURCE_AGE_HOURS)&&!blockedTerms.some(term=>item.title.includes(term)));
}

async function fetchGoogleRss(category){
  const rss=`https://news.google.com/rss/search?q=${encodeURIComponent(category.query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const xml=await fetchText(rss);
  if(!/<rss\b/i.test(xml)) throw new Error("返回内容不是 RSS");
  return parseRss(xml,category,"Google News RSS");
}

async function fetchBingRss(category){
  const query=category.bingQuery||category.label;
  const rss=`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&qft=interval%3d%227%22&form=PTFTNR&format=rss&setlang=zh-cn`;
  const xml=await fetchText(rss);
  if(!/<rss\b/i.test(xml)) throw new Error("地区重定向后未返回 RSS");
  return parseRss(xml,category,"Bing News RSS");
}

const gdeltQueries={
  domestic_policy:'"China policy" OR "Chinese central bank"',
  county_local:"Sichuan OR Chengdu",
  macro_global:'"Federal Reserve" OR "global economy" OR geopolitics',
  banking:'"bank regulation" OR "commercial bank"',
  wealth:'"wealth management" OR "private banking"',
  markets:'gold OR Nasdaq OR "US Treasury"',
  a_share_trends:'"A shares" OR "China stock market"',
  global_market_narrative:'Nasdaq OR "US stocks" OR "Wall Street"',
  china_economy:'"China economy" OR "China consumption"',
  career_cities:'(Beijing OR Shanghai OR Shenzhen OR Hangzhou OR "Hong Kong") (jobs OR hiring)',
  ai_workflows:'AI (banking OR finance OR workplace)',
  frontier:'"emerging industry" OR "future of work"',
  life_trends:'"young people" (consumption OR work OR learning)'
};

function gdeltDate(value=""){
  const match=String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return match?`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`:value;
}

export function parseGdeltArticles(payload,category){
  return (payload?.articles||[]).map((article,index)=>({
    id:`${category.id}-gdelt-${index}-${Buffer.from(normalizeTitle(article.title||"")).toString("base64url").slice(0,10)}`,
    categoryId:category.id,
    category:category.label,
    priorityHint:category.priority,
    domestic:Boolean(category.domestic),
    localGrounded:Boolean(category.localGrounded),
    title:stripHtml(article.title||""),
    source:article.domain||article.sourcecountry||"GDELT 收录来源",
    publishedAt:gdeltDate(article.seendate||""),
    url:article.url||"",
    snippet:"",
    feedProvider:"GDELT DOC API"
  })).filter(item=>item.title&&item.url&&hoursOld(item.publishedAt)<=(category.maxAgeHours??MAX_SOURCE_AGE_HOURS)&&!blockedTerms.some(term=>item.title.includes(term)));
}

async function fetchGdelt(category){
  const query=gdeltQueries[category.id]||category.bingQuery||category.label;
  const days=Math.max(3,Math.ceil((category.maxAgeHours??MAX_SOURCE_AGE_HOURS)/24));
  const url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`(${query})`)}&mode=artlist&maxrecords=20&timespan=${days}d&sort=datedesc&format=json`;
  return parseGdeltArticles(JSON.parse(await fetchText(url,{headers:{Accept:"application/json"},timeoutMs:30000})),category);
}

async function fetchRss(category){
  const collected=[],errors=[];
  for(const [name,fetcher] of [["Google",fetchGoogleRss],["Bing",fetchBingRss],["GDELT",fetchGdelt]]){
    if(collected.length>=3) break;
    try{collected.push(...await fetcher(category));}
    catch(error){errors.push(`${name}: ${error.message}`);}
  }
  const result=dedupeCandidates(collected);
  if(!result.length&&errors.length===3) throw new Error(errors.join("；"));
  return result;
}

async function collectCandidates(){
  const results=await Promise.allSettled(categories.map(fetchRss));
  const failures=[];
  const buckets=[];
  results.forEach((result,index)=>{
    if(result.status==="fulfilled"){
      console.log(`[RSS] ${categories[index].label}: ${result.value.length} 条`);
      buckets.push(result.value.slice(0,7));
    }else failures.push(`${categories[index].label}: ${result.reason?.message||"抓取失败"}`);
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

function shorten(value="",maximum=24){
  const clean=String(value).replace(/\s+/g," ").trim();
  return clean.length>maximum?`${clean.slice(0,maximum-1)}…`:clean;
}

function usefulSnippet(candidate){
  let value=String(candidate.snippet||"").replace(candidate.title," ").replace(candidate.source," ");
  value=value.replace(/\s+-\s+/g," ").replace(/\s+/g," ").trim();
  return value.length>=16?shorten(value,180):"";
}

function publishedDay(value){
  const date=new Date(value);
  return Number.isFinite(date.getTime())
    ?new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"numeric",day:"numeric"}).format(date)
    :"近日";
}

function relationFor(candidate){
  const title=shorten(candidate.title,30);
  const map={
    domestic_policy:`它可能通过政策执行、客户预期或银行业务要求传到县域网点。你暂时不用背结论，先看“${title}”后续有没有具体实施口径。`,
    county_local:`它离你当前客户和工作环境更近，可用来判断本地产业、就业与金融需求有没有变化。先区分真实业务变化和口号。`,
    macro_global:`它可能通过利率、汇率与风险偏好影响你的纳指和黄金仓位。基础模式只提示传导方向，不替你猜市场。`,
    banking:`它与存款、保险、基金、贷款或客户经营直接相关。重点看是否改变客户问题、合规要求或网点做法。`,
    wealth:`它能补充你从“卖单个产品”走向“看客户整体资产”的视角，可作为 AFP 学习与真实客户沟通的连接点。`,
    markets:`它与现有纳指、黄金仓位有关，但标题本身不足以触发加仓；还要结合 1日、5日和20日行情。`,
    a_share_trends:`它能帮助你理解国内客户正在谈论什么市场叙事。面对客户时先核实资金和政策依据，不跟着热度下判断。`,
    global_market_narrative:`它是你理解美股定价逻辑的一条线索。与你的关系是判断长期逻辑有没有变化，而不是追当天涨跌。`,
    china_economy:`它可能影响县域客户的收入预期、储蓄与贷款需求，也可能影响你未来选择城市和平台时对行业的判断。`,
    career_cities:`它提供大城市岗位与产业变化的外部坐标。可以拿它对照自己的简历证据，看哪些能力还没有形成可展示成果。`,
    ai_workflows:`它只有在能进入访前准备、客户复盘、数据整理或汇报时才与你相关。先看真实工作流，不追工具数量。`,
    frontier:`它暂时更适合作为未来 1–3 年的观察项，用来防止自己的信息边界只停留在县域环境。`,
    life_trends:`它提供大城市人群观念和习惯变化的样本。先观察它是否持续，不必因为一条热潮立刻改变生活。`
  };
  return map[candidate.categoryId]||`它为你提供县域之外的一条真实信息线索。先判断“${title}”是否会传到客户、职业或资产，再决定是否行动。`;
}

function whyFor(candidate){
  const map={
    domestic_policy:"政策真正重要的部分是执行口径，以及它会怎样改变居民、企业和金融机构的选择。",
    county_local:"县域与成渝地区的产业和就业变化，通常会先反映到客户现金流、融资与储蓄行为。",
    macro_global:"宏观事件会通过利率、美元和风险偏好影响多类资产，单日涨跌只是结果，不是完整原因。",
    banking:"银行业变化最终会落到客户需求、产品结构、风控和一线工作方法上。",
    wealth:"财富管理竞争正在从单品销售转向资产诊断、长期陪伴与风险匹配。",
    markets:"市场关注它，是因为它可能改变增长、利率或风险溢价预期，需要结合多周期数据确认。",
    a_share_trends:"A股风潮能反映国内资金偏好，但热度只有得到政策、业绩或持续资金支持才可能延续。",
    global_market_narrative:"美股叙事变化会影响估值和资金集中度，对长期定投者比一日涨跌更值得观察。",
    china_economy:"中国经济政策会沿着就业、收入、消费、房地产和信用需求传导到普通客户。",
    career_cities:"大城市产业和招聘信号会提前改变岗位要求，是判断可迁移能力是否值钱的现实依据。",
    ai_workflows:"真正值得关注的不是工具名称，而是它是否已经缩短普通白领的一段具体工作流程。",
    frontier:"新行业和工作方式往往先在少数平台出现，持续一段时间后才会传到更广泛的岗位。",
    life_trends:"观念和习惯的变化会影响消费、学习与职业选择，但需要连续信号而不是一次热搜。"
  };
  return map[candidate.categoryId]||"这条信息的价值在于提供一个可继续核实的外部信号，而不是仅凭标题得出确定结论。";
}

function actionFor(candidate,level){
  const title=shorten(candidate.title,22);
  if(level==="must") return {
    actionLevel:"加入观察清单",
    actionDetail:`打开“${title}”原始来源，先核对正文中的主体、时间和实施范围；本周只记录一条可能影响客户或资产的传导链。`
  };
  if(level==="know") return {
    actionLevel:"知道即可",
    actionDetail:`先记住“${title}”这个信号；只有后续出现正式政策、连续数据或岗位要求变化时，再升级为行动项。`
  };
  return {
    actionLevel:"知道即可",
    actionDetail:`把“${title}”当作县域之外的观察样本，下周若仍有独立来源持续报道，再判断是否值得投入时间。`
  };
}

function factualSummary(candidate){
  const snippet=usefulSnippet(candidate);
  const first=`${candidate.source}在${publishedDay(candidate.publishedAt)}发布了“${candidate.title}”。`;
  return snippet
    ?`${first}公开摘要还提到：${snippet}`
    :`${first}基础模式目前只确认标题、来源和发布时间，不补写尚未读取到的正文细节。`;
}

function selectRuleNews(candidates){
  const used=new Set(),categoryCounts=new Map();
  let aiCount=0,localGroundedCount=0;
  const picked=[];
  const eligible=candidate=>{
    if(used.has(candidate.id)||(categoryCounts.get(candidate.categoryId)||0)>=2) return false;
    if(candidate.categoryId==="ai_workflows"&&aiCount>=2) return false;
    if(candidate.localGrounded&&localGroundedCount>=2) return false;
    return true;
  };
  const take=(level,count,preferred)=>{
    for(const candidate of candidates){
      if(picked.filter(item=>item.level===level).length>=count) break;
      if(!preferred(candidate)||!eligible(candidate)) continue;
      const action=actionFor(candidate,level);
      picked.push({
        candidateId:candidate.id,
        level,
        eventKey:normalizeTitle(candidate.title),
        qualityScore:76,
        whatHappened:factualSummary(candidate),
        whyImportant:whyFor(candidate),
        relation:relationFor(candidate),
        ...action
      });
      used.add(candidate.id);
      categoryCounts.set(candidate.categoryId,(categoryCounts.get(candidate.categoryId)||0)+1);
      if(candidate.categoryId==="ai_workflows") aiCount++;
      if(candidate.localGrounded) localGroundedCount++;
    }
  };
  take("must",2,candidate=>candidate.priorityHint==="must");
  take("must",2,()=>true);
  take("know",3,candidate=>candidate.priorityHint==="know");
  take("know",3,()=>true);
  take("expand",1,candidate=>candidate.priorityHint==="expand");
  take("expand",1,()=>true);
  return picked;
}

function marketLabel(candidate){
  if(candidate.categoryId==="a_share_trends"||candidate.categoryId==="china_economy"||/A股|港股|沪深/.test(candidate.title)) return "A股";
  if(/黄金|金价|美元|美债|利率|央行|美联储/.test(candidate.title)) return "黄金 / 宏观";
  return "美股";
}

function ruleMarketStories(candidates){
  const preferred=new Set(["a_share_trends","global_market_narrative","markets","macro_global","china_economy"]);
  return candidates.filter(candidate=>preferred.has(candidate.categoryId)).slice(0,4).map(candidate=>({
    candidateId:candidate.id,
    market:marketLabel(candidate),
    title:candidate.title,
    whatHappened:factualSummary(candidate),
    whyMarketCares:whyFor(candidate),
    relation:`把它作为“${shorten(candidate.title,20)}”的观察线索；未读完原文前，不据此临时改变定投或追涨。`
  }));
}

function ruleCognitions(candidates){
  const groups=[
    {domain:"世界 / 科技",ids:new Set(["macro_global","ai_workflows","frontier","global_market_narrative"])},
    {domain:"金融 / 职业",ids:new Set(["banking","wealth","career_cities","domestic_policy","china_economy"])},
    {domain:"个人成长 / 决策",ids:new Set(["life_trends","county_local","a_share_trends","markets"])}
  ];
  const used=new Set();
  return groups.map(group=>{
    const candidate=candidates.find(item=>group.ids.has(item.categoryId)&&!used.has(item.id))||candidates.find(item=>!used.has(item.id));
    if(!candidate) return null;
    used.add(candidate.id);
    const subject=shorten(candidate.title.replace(/[：:，,。；;].*$/,""),10);
    return {
      domain:group.domain,
      cognition:shorten(`${subject}，先看传导链`,22),
      why:`今天的公开依据是 ${candidate.source} 发布的“${shorten(candidate.title,30)}”。基础模式只把它当作可核实信号，不把标题直接当结论。`,
      meaning:`以后遇到类似消息，先问它会经过哪些环节影响客户、岗位或资产；说不出传导链，就先不行动。`,
      dedupeKey:`${candidate.categoryId}>${normalizeTitle(candidate.title).slice(0,36)}`
    };
  }).filter(Boolean);
}

function ruleOutside(candidates,outsideRefreshDue){
  if(!outsideRefreshDue) return [];
  const ids=new Set(["career_cities","ai_workflows","frontier","life_trends"]);
  return candidates.filter(candidate=>ids.has(candidate.categoryId)).slice(0,4).map(candidate=>({
    evidenceCandidateId:candidate.id,
    trendKey:`${candidate.categoryId}>${normalizeTitle(candidate.title).slice(0,32)}`,
    kind:candidate.categoryId==="life_trends"?"life":"career",
    placeOrSector:candidate.category,
    signal:shorten(candidate.title,34),
    meaning:`这是 ${candidate.source} 提供的一条新信号。基础模式先记录它是否持续影响岗位、工作流或生活观念，不把单条报道写成确定趋势。`,
    horizon:"未来 1–3 年；需等待更多独立来源或岗位变化验证"
  }));
}

function changeText(value){
  return Number.isFinite(Number(value))?`${Number(value)>=0?"+":""}${Number(value).toFixed(2)}%`:"暂缺";
}

function ruleInvestment(market){
  const byKey=new Map((market.items||[]).map(item=>[item.key,item]));
  const nasdaq=byKey.get("nasdaq100"),gold=byKey.get("gold"),us10y=byKey.get("us10y");
  const available=[nasdaq?.value,gold?.value].every(value=>value!==null&&value!==undefined&&Number.isFinite(Number(value)));
  if(!available) return {
    verdict:"⚪ 正常定投，暂不额外加仓",
    reason:"基础模式没有同时拿到 Nasdaq 100 与黄金的有效行情，因此不做战术判断。",
    amount:"维持工作日纳指 ¥100 原定投；不额外加仓",
    cancelIf:"等 Nasdaq 100 与黄金行情同时恢复，并核实重大风险后再重新判断。",
    drivers:["Nasdaq 100 或黄金数据不完整","现金与未来两年保险缴费责任优先"],
    assetSignals:{
      nasdaq100:{status:"🟡 暂不额外加仓",judgment:"数据未完整核验，维持原定投，不根据模糊行情增加仓位。"},
      gold:{status:"🟡 继续持有，不追涨",judgment:"现有黄金仓位已经不低，数据不完整时先持有。"}
    },
    environment:{usStocks:"⚪ 数据待核验",aShares:"⚪ 看政策与资金信号",gold:"⚪ 数据待核验",summary:"今天只执行长期纪律，不用不完整数据猜方向。"}
  };
  const nasdaqFast=Number(nasdaq.monthChange)>=8?"近期涨幅偏快，不追涨":Number(nasdaq.monthChange)<=-8?"近期波动偏弱，仍只维持定投":"多周期波动尚未触发额外动作";
  const goldFast=Number(gold.monthChange)>=8?"近期涨幅偏快，已有仓位不追涨":Number(gold.monthChange)<=-8?"近期偏弱，先检查宏观原因":"现有仓位继续持有";
  return {
    verdict:"⚪ 正常定投，暂不额外加仓",
    reason:"免费基础模式已核验多周期行情，但没有 AI 对新闻原因做逐条联合分析；维持原计划比临时猜方向更合适。",
    amount:"工作日维持纳指 ¥100 定投；黄金不新增战术仓位",
    cancelIf:"若 20 日波动明显扩大、重大政策改变长期逻辑，或出现尚未理解的风险，暂停额外动作并重新核验。",
    drivers:[
      `Nasdaq 100：1日 ${changeText(nasdaq.dayChange)}、5日 ${changeText(nasdaq.weekChange)}、20日 ${changeText(nasdaq.monthChange)}`,
      `黄金：1日 ${changeText(gold.dayChange)}、5日 ${changeText(gold.weekChange)}、20日 ${changeText(gold.monthChange)}`,
      `美国10年期收益率：5日 ${changeText(us10y?.weekChange)}`
    ],
    assetSignals:{
      nasdaq100:{status:"🟢 按计划定投",judgment:nasdaqFast},
      gold:{status:"🟢 继续持有",judgment:goldFast}
    },
    environment:{
      usStocks:Number(nasdaq.weekChange)>=0?"🟡 风险偏好尚可":"🟡 波动偏谨慎",
      aShares:"⚪ 看政策与资金信号",
      gold:Number(gold.weekChange)>=0?"🟡 避险需求偏强":"🟡 短期有所降温",
      summary:"行情已更新；基础模式不猜新闻因果，今天维持既定节奏。"
    }
  };
}

export function buildRuleBasedAnalysis(candidates,market,context={}){
  const selected=selectRuleNews(candidates);
  const focus=selected[0]&&candidates.find(candidate=>candidate.id===selected[0].candidateId);
  return {
    selected,
    cognitions:ruleCognitions(candidates),
    outside:ruleOutside(candidates,context.outsideRefreshDue),
    marketStories:ruleMarketStories(candidates),
    investment:ruleInvestment(market),
    oneThing:{
      task:focus?`用 20 分钟打开“${shorten(focus.title,24)}”原文，写下一条它影响客户、职业或资产的传导链。`:"用 20 分钟完成本周任务清单里最靠前的一项。",
      minutes:20
    }
  };
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

function buildFinal({analysis,candidates,market,failures,verificationSourceCount,previousData={},cognitionHistory=[],outsideRefreshDue=true,analysisMode="rules",aiFallbackReason=""}){
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
      newsSource:"Google News RSS + Bing News RSS + GDELT DOC API 自动备用（候选）",
      analysis:analysisMode==="ai"
        ?`OpenAI Responses API · ${OPENAI_MODEL} · web search 核实`
        :"免费公开数据 + 本地规则基础分析（未调用 AI）",
      analysisMode,
      aiEnhanced:analysisMode==="ai",
      aiFallbackReason,
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
  const context={
    cognitionHistory,
    outsideRefreshDue,
    previousOutside:previousData.outside||[]
  };
  console.log("[3/4] 生成每日雷达；OpenAI 为可选增强层");
  let analysis,verificationSourceCount=0,analysisMode="rules",aiFallbackReason="";
  if(process.env.OPENAI_API_KEY){
    try{
      const enhanced=await analyze(candidates,market,context);
      analysis=enhanced.analysis;
      verificationSourceCount=enhanced.verificationSourceCount;
      analysisMode="ai";
      console.log("AI 个性化增强成功。");
    }catch(error){
      aiFallbackReason=shorten(error?.message||"AI 增强调用失败",240);
      console.warn(`AI 增强暂不可用，自动切换规则基础版：${aiFallbackReason}`);
    }
  }else{
    aiFallbackReason="未配置 OPENAI_API_KEY；按设计使用免费规则基础版。";
    console.log(aiFallbackReason);
  }
  if(!analysis) analysis=buildRuleBasedAnalysis(candidates,market,context);
  let finalData;
  try{
    finalData=buildFinal({analysis,candidates,market,failures,verificationSourceCount,previousData,cognitionHistory,outsideRefreshDue,analysisMode,aiFallbackReason});
  }catch(error){
    if(analysisMode!=="ai") throw error;
    aiFallbackReason=`AI 结果未通过发布校验：${shorten(error?.message||"未知校验错误",180)}`;
    console.warn(`${aiFallbackReason}；自动改用规则基础版。`);
    analysisMode="rules";
    verificationSourceCount=0;
    analysis=buildRuleBasedAnalysis(candidates,market,context);
    finalData=buildFinal({analysis,candidates,market,failures,verificationSourceCount,previousData,cognitionHistory,outsideRefreshDue,analysisMode,aiFallbackReason});
  }
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
