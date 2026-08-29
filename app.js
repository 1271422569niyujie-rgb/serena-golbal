"use strict";

const DATA_URL = "./data/radar-latest.json";
const FALLBACK_DATA = window.__NINI_RADAR_FALLBACK__ || null;
const STORAGE = {
  assets:"niniRadarV33.assets",
  career:"niniRadarV33.career",
  invest:"niniRadarV33.invest"
};

const assetDefaults = {
  goldAccum:57702,
  goldPhysical:26861,
  cash:30000,
  nasdaqCny:30000,
  nasdaqUsd:14000,
  bond:20000,
  deposit:10000,
  insurance:30000,
  provident:85000
};

const assetMeta = [
  {key:"goldAccum",label:"积存金",note:"58g · 当前人民币市值"},
  {key:"goldPhysical",label:"实物金",note:"27g · 按当前估值"},
  {key:"cash",label:"现金",note:"应急与未来支出"},
  {key:"nasdaqCny",label:"纳指人民币基金",note:"人民币市值"},
  {key:"nasdaqUsd",label:"纳指美元基金",note:"按人民币市值录入"},
  {key:"bond",label:"稳健债券基金",note:"固收底盘"},
  {key:"deposit",label:"定期",note:"固收底盘"},
  {key:"insurance",label:"保险已投入",note:"未来仍需缴费两年"},
  {key:"provident",label:"公积金",note:"单独展示，不计总资产"}
];

const careerDefaults = {
  weekly:[
    {id:"afp",text:"完成 1 次 AFP 60 分钟学习，并写下 3 个能讲给客户听的要点",done:false},
    {id:"star",text:"整理 1 个真实客户 STAR 案例，补齐动作、结果与数字",done:false},
    {id:"client",text:"深聊 1 位高净值或企业客户的资产结构与家庭/经营目标",done:false},
    {id:"ai",text:"用 AI 完成 1 次客户访前准备，并记录实际节省了什么",done:false},
    {id:"english",text:"完成 1 次 3 分钟英文输出，主题从金融、AI 或工作中选 1 个",done:false}
  ],
  monthly:[
    {id:"cases",label:"客户案例",value:0,target:2},
    {id:"clients",label:"高净值/企业客户深聊",value:0,target:2},
    {id:"finance",label:"金融主题",value:0,target:1},
    {id:"aiFlow",label:"AI 工作流",value:0,target:1},
    {id:"english",label:"英文输出",value:0,target:1},
    {id:"jd",label:"目标岗位 JD 分析",value:0,target:3}
  ],
  quarterDone:false,
  quarterNote:""
};

const abilityDefinitions = [
  {
    id:"wealth",label:"财富管理",base:25,
    baseline:"已在真实工作中接触存款、保险、基金、黄金和客户资产结构",
    taskPoints:{afp:7,client:8},progressPoints:{cases:5,clientTalks:7,finance:10},
    gap:"还需要更多完整资产配置复盘，而不只是单品成交记录",
    next:"完成 1 份真实客户资产结构复盘，写清需求、取舍和风险边界"
  },
  {
    id:"project",label:"项目能力",base:28,
    baseline:"已有医院、商户和复杂现场推进等真实项目经历",
    taskPoints:{star:8,client:4},progressPoints:{cases:8,clientTalks:3,jd:2},
    gap:"项目经历还缺少统一的背景—动作—结果—数字表达",
    next:"把 1 个医院或商户项目整理成可用于面试的 STAR 案例"
  },
  {
    id:"english",label:"英语",base:10,
    baseline:"已经开始持续学习英语",
    taskPoints:{english:8},progressPoints:{english:15},
    gap:"输入多，能被外部岗位看见的口语与输出证据还少",
    next:"录一段 3 分钟金融主题英文输出并保留日期"
  },
  {
    id:"ai",label:"AI 工作流",base:15,
    baseline:"已经在主动寻找 AI 与银行真实工作的连接点",
    taskPoints:{ai:10},progressPoints:{aiFlow:20},
    gap:"还需要证明工具确实节省时间或提高了工作质量",
    next:"完成 1 次合规的客户访前准备，记录输入模板、人工核验和节省时间"
  },
  {
    id:"city",label:"大城市竞争力",base:14,
    baseline:"已有明确迁移目标，并开始关注一线城市与更大平台",
    taskPoints:{star:4,english:3,client:3},progressPoints:{jd:8,cases:3,clientTalks:3},
    gap:"目标岗位要求与个人证据之间还没有形成稳定对照",
    next:"再分析 1 个真实目标岗位 JD，只记录它要求而你尚未证明的 3 项能力"
  }
];

const state = {activeFilter:"all",radar:null,dataAgeHours:Infinity,usingFallback:false,assetsVisible:false,assets:{},career:{},invest:{cashMonths:8,riskFlag:false}};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const money = value => `¥${Math.round(Number(value)||0).toLocaleString("zh-CN")}`;
const clamp = (value,min,max) => Math.min(max,Math.max(min,value));

function safeJson(key,fallback){
  try { return {...fallback,...JSON.parse(localStorage.getItem(key)||"{}")}; }
  catch { return structuredClone(fallback); }
}

function formatDate(value,withTime=true){
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN",withTime?{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}:{year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}

function chinaDateKey(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function actionMeta(level){
  return {
    "现在就行动":["🔴 现在就行动","now"],
    "加入观察清单":["🟡 加入观察清单","watch"],
    "知道即可":["🟢 知道即可","know"],
    "与我暂时无关":["⚪ 与我暂时无关","none"]
  }[level] || ["⚪ 与我暂时无关","none"];
}

function levelMeta(level){
  return level==="must"?["🔴 必须关注","red"]:level==="know"?["🟡 建议了解","amber"]:["🟢 拓展视野","green"];
}

function showFreshness(data){
  const box=$("freshness");
  box.hidden=false;
  box.className="freshness";
  const generated=new Date(data.generatedAt);
  state.dataAgeHours=(Date.now()-generated.getTime())/36e5;
  if(data.status!=="ok"){
    box.classList.add("error");
    box.textContent="尚未生成真实日报：请先按 README 配置 GitHub Secret，并手动运行一次更新任务。";
    return;
  }
  const localNote=state.usingFallback?" 当前为本地直接打开模式，使用网站随附的最近一次快照；发布到 GitHub Pages 后会优先读取每日更新数据。":"";
  const modeNote=data.pipeline?.analysisMode==="rules"
    ?" 当前为免费基础版：标题、来源和时间来自公开数据，解释由透明规则生成；AI 个性化增强未启用。"
    :data.pipeline?.analysisMode==="ai"?" 当前已启用 AI 个性化增强。":"";
  const source=`数据生成于 ${formatDate(data.generatedAt)}，新闻均保留原始来源与发布时间。${modeNote}${localNote}`;
  if(!Number.isFinite(state.dataAgeHours)||state.dataAgeHours>72){
    box.classList.add("error");
    box.textContent=`数据已过期，不作为今日信息使用。${source}`;
  }else if(data.effectiveDate!==chinaDateKey()||state.dataAgeHours>36){
    box.classList.add("warn");
    box.textContent=`这不是今天生成的新日报，请只作回顾。${source}`;
  }else{
    box.textContent=`今日数据有效。${source}`;
  }
}

function emptyState(message){
  return `<section class="card mutedCard">${esc(message)}</section>`;
}

function renderNews(){
  const all=Array.isArray(state.radar?.news)?state.radar.news:[];
  const list=all.filter(item=>state.activeFilter==="all"||item.level===state.activeFilter);
  const counts=all.reduce((acc,item)=>{acc[item.category]=(acc[item.category]||0)+1;return acc;},{});
  $("balance").innerHTML=Object.entries(counts).map(([name,count])=>`<span class="pill">${esc(name)} ${count}</span>`).join("");
  if(!list.length){
    $("news").innerHTML=emptyState(state.radar?.status==="ok"?"这个优先级今天没有达到发布标准的信息。":"今日真实新闻尚未生成，不会用示例内容占位。");
    return;
  }
  $("news").innerHTML=list.map(item=>{
    const [levelLabel,color]=levelMeta(item.level);
    const [actionLabel,actionClass]=actionMeta(item.actionLevel);
    return `<article class="card newsCard">
      <div class="tag ${color}">${levelLabel} · ${esc(item.category)}</div>
      <div class="title">${esc(item.title)}</div>
      <div class="meta">${esc(item.source)} · 发布于 ${esc(formatDate(item.publishedAt))}</div>
      <div class="analysis">
        <div class="analysisRow"><b>发生了什么</b>${esc(item.whatHappened)}</div>
        <div class="analysisRow"><b>为什么重要</b>${esc(item.whyImportant)}</div>
        <div class="analysisRow"><b>和我有什么关系</b>${esc(item.relation)}</div>
        <div class="analysisRow"><span class="actionBadge ${actionClass}">${actionLabel}</span>${item.actionDetail?`<div>${esc(item.actionDetail)}</div>`:""}</div>
      </div>
      <a class="source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">打开原始来源 →</a>
    </article>`;
  }).join("");
}

function renderOutside(){
  const items=Array.isArray(state.radar?.outside)?state.radar.outside.slice(0,4):[];
  $("outside").innerHTML=items.length?items.map(item=>`<section class="card outsideCard">
    <div class="tag blue">${item.kind==="life"?"🌿 生活与观念":"📍 能力与平台"} · ${esc(item.placeOrSector)}</div>
    <div class="title">${esc(item.signal)}</div>
    <div class="txt">${esc(item.meaning)}</div>
    <div class="horizon">可能影响：${esc(item.horizon)}</div>
    ${item.url?`<a class="source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">查看依据 →</a>`:""}
  </section>`).join(""):emptyState("今天没有足够可靠的一线城市或行业信号，宁可少一条。 ");
}

function renderMarketStories(){
  const items=Array.isArray(state.radar?.marketStories)?state.radar.marketStories.slice(0,5):[];
  $("marketStories").innerHTML=items.length?items.map((item,index)=>`<article class="card marketStory">
    <div class="tag amber">0${index+1} · ${esc(item.market||"市场风潮")}</div>
    <div class="title">${esc(item.title)}</div>
    <div class="storyRow"><b>发生了什么：</b>${esc(item.whatHappened)}</div>
    <div class="storyRow"><b>为什么市场在关注：</b>${esc(item.whyMarketCares)}</div>
    <div class="storyRow"><b>对我意味着什么：</b>${esc(item.relation)}</div>
    <div class="meta">${esc(item.source)} · 发布于 ${esc(formatDate(item.publishedAt))}</div>
    <a class="source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">查看原始来源 →</a>
  </article>`).join(""):emptyState("今天没有足够重要的市场大事或新风潮，不用普通涨跌凑数。 ");
}

function renderCognitions(){
  const items=Array.isArray(state.radar?.cognitions)?state.radar.cognitions.slice(0,3):[];
  $("cognitions").innerHTML=items.length?items.map((item,index)=>`<section class="card cognitionCard">
    <div class="cognitionLabel"><div class="tag blue">0${index+1} · ${esc(item.domain)}</div></div>
    <div class="title">${esc(item.cognition)}</div>
    <div class="cognitionWhy"><b>为什么：</b>${esc(item.why)}</div>
    <div class="cognitionMeaning"><b>对我的意义：</b>${esc(item.meaning)}</div>
  </section>`).join(""):emptyState("今日认知更新暂不可用；不展示与当天事实无关的鸡汤占位。 ");
}

function formatMarketValue(item){
  if(item.value===null||item.value===undefined||!Number.isFinite(Number(item.value))) return "暂不可用";
  const digits=item.unit==="%"?2:item.value>1000?0:2;
  return `${Number(item.value).toLocaleString("zh-CN",{maximumFractionDigits:digits,minimumFractionDigits:item.unit==="%"?2:0})}${item.unit||""}`;
}

function changeClass(value){ return Number(value)>=0?"up":"down"; }
function formatChange(value){ return value===null||value===undefined||!Number.isFinite(Number(value))?"—":`${Number(value)>=0?"+":""}${Number(value).toFixed(2)}%`; }

function renderMarket(){
  const market=state.radar?.market;
  const items=Array.isArray(market?.items)?market.items:[];
  const investment=state.radar?.investment||{};
  const assetSignals=investment.assetSignals||{};
  const visibleAssets=[
    {key:"nasdaq100",label:"Nasdaq 100",fallbackStatus:"🟡 暂不额外加仓",fallbackJudgment:"行情尚未完成核验，维持原定投，不根据单日波动加动作。"},
    {key:"gold",label:"黄金",fallbackStatus:"🟡 继续持有，不追涨",fallbackJudgment:"行情尚未完成核验，保留现有仓位，暂不根据模糊信息追涨。"}
  ];
  $("marketGrid").innerHTML=visibleAssets.map(definition=>{
    const item=items.find(entry=>entry.key===definition.key)||{key:definition.key,label:definition.label,value:null,unit:"",dayChange:null,weekChange:null,monthChange:null};
    const signal=assetSignals[definition.key]||{status:definition.fallbackStatus,judgment:definition.fallbackJudgment};
    return `<div class="metric marketAsset">
    <span class="pill">${esc(definition.label)}</span>
    <div class="v smallV">${esc(formatMarketValue(item))}</div>
    <div class="move">1日 <span class="${changeClass(item.dayChange)}">${formatChange(item.dayChange)}</span> · 5日 ${formatChange(item.weekChange)} · 20日 ${formatChange(item.monthChange)}</div>
    <div class="assetStatus">${esc(signal.status)}</div>
    <div class="marketJudgment">${esc(signal.judgment)}</div>
  </div>`;
  }).join("");
  const environment=investment.environment||{
    usStocks:"⚪ 数据待核验",aShares:"⚪ 数据待核验",gold:"⚪ 数据待核验",
    summary:"宏观与行情数据还不完整，今天先不做方向性解读。"
  };
  $("marketEnvironment").innerHTML=`<div class="tag blue">🌡️ 今天的市场环境</div>
    <div class="environmentRows">
      <div class="environmentItem"><span>美股</span><b>${esc(environment.usStocks)}</b></div>
      <div class="environmentItem"><span>A股</span><b>${esc(environment.aShares)}</b></div>
      <div class="environmentItem"><span>黄金</span><b>${esc(environment.gold)}</b></div>
    </div>
    <div class="environmentSummary">${esc(environment.summary)}</div>`;
  $("marketStamp").textContent=market?.asOf?`市场数据截至 ${formatDate(market.asOf)} · ${market.source||"公开市场数据"}`:"市场数据时间暂不可用";
  renderInvestmentVerdict();
}

function renderInvestmentVerdict(){
  const investment=state.radar?.investment;
  const market=state.radar?.market;
  const marketTime=new Date(market?.generatedAt||market?.asOf||0).getTime();
  const marketAgeHours=Number.isFinite(marketTime)?(Date.now()-marketTime)/36e5:Infinity;
  const fresh=market?.status==="ok"&&marketAgeHours<=72;
  const verdict=$("investVerdict"),reason=$("investReason"),detail=$("investDetail");
  if(!fresh||!investment?.available){
    if(state.invest.riskFlag){
      verdict.textContent="🔴 暂缓新增风险";
      reason.textContent="你已经标记有尚未搞懂的重大风险。在它被说清楚以前，不新增风险仓位。";
      detail.innerHTML="<div><b>今天怎么做：</b>暂停额外加仓；原有定投也可以等你把风险传导链梳理清楚后再恢复。</div>";
    }else{
      verdict.textContent="⚪ 正常定投，暂不额外加仓";
      reason.textContent="行情或新闻原因还没有完成核验，所以今天不做战术判断。不是说市场一定危险，而是信息不够时不随便加动作。";
      detail.innerHTML=`<div><b>今天怎么做：</b>维持工作日纳指 ¥100 的原定计划，不额外加仓。</div><div><b>数据状态：</b>${esc(market?.note||"市场数据暂未完整更新；恢复后再重新评估。")}</div>`;
    }
    return;
  }
  let finalVerdict=investment.verdict;
  let finalReason=investment.reason;
  let amount=investment.amount;
  let cancelIf=investment.cancelIf;
  if(state.invest.riskFlag){
    finalVerdict="🔴 暂缓新增风险";
    finalReason="你已标记存在尚未理解清楚的重大风险。先把风险传导链弄清楚，再决定是否新增仓位。";
    amount="不新增风险资产";
    cancelIf="当风险来源、可能影响和最坏情形已经能用自己的话解释清楚时，再重新评估。";
  }else if(Number(state.invest.cashMonths)<6&&investment.verdict.includes("加仓")){
    finalVerdict="⚪ 正常定投，暂不额外加仓";
    finalReason="现金安全垫低于 6 个月，且未来两年仍有保险缴费责任；流动性优先于战术加仓。";
    amount="仅维持工作日 ¥100 定投";
    cancelIf="现金安全垫恢复到至少 6 个月，且保险缴费资金已单独预留后，再重新评估。";
  }
  verdict.textContent=finalVerdict;
  reason.textContent=finalReason;
  detail.innerHTML=`${amount?`<div><b>金额/动作：</b>${esc(amount)}</div>`:""}${cancelIf?`<div><b>取消或重评条件：</b>${esc(cancelIf)}</div>`:""}`;
}

function renderOneThing(){
  const item=state.radar?.oneThing;
  $("oneThing").textContent=item?.task||"今天没有足够可靠的新信息触发额外动作：完成本周任务清单里最靠前的一项即可。";
}

function renderRadar(){
  showFreshness(state.radar);
  renderNews();
  renderOutside();
  renderCognitions();
  renderMarket();
  renderMarketStories();
  renderOneThing();
}

async function loadRadar(manual=false){
  const status=$("status");
  status.textContent=manual?"正在检查是否有新的已发布日报…":"正在读取今日雷达…";
  $("refreshBtn").disabled=true;
  const acceptData=(data,usingFallback=false)=>{
    if(!data||!Array.isArray(data.news)||!data.generatedAt) throw new Error("数据格式不完整");
    state.radar=data;
    state.usingFallback=usingFallback;
    renderRadar();
    status.textContent=data.status==="ok"?`${usingFallback?"本地快照":"已读取"} ${data.news.length} 条 · ${formatDate(data.generatedAt)}`:"自动日报尚未配置完成";
  };
  try{
    if(location.protocol==="file:"&&FALLBACK_DATA){
      acceptData(FALLBACK_DATA,true);
      return;
    }
    const response=await fetch(`${DATA_URL}?v=${Date.now()}`,{cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    acceptData(data,false);
  }catch(error){
    if(FALLBACK_DATA){
      acceptData(FALLBACK_DATA,true);
      console.warn("实时 JSON 读取失败，已使用随网站发布的快照。",error);
      return;
    }
    state.radar={status:"unavailable",generatedAt:new Date(0).toISOString(),news:[],outside:[],cognitions:[],market:{items:[]},investment:{available:false},oneThing:null};
    state.dataAgeHours=Infinity;
    renderRadar();
    $("freshness").hidden=false;
    $("freshness").className="freshness error";
    $("freshness").textContent="今日数据暂不可用。网页没有收到有效日报，未展示旧新闻或编造内容。";
    status.textContent="数据暂不可用，请稍后再试";
    console.error(error);
  }finally{
    $("refreshBtn").disabled=false;
  }
}

function loadAssets(){
  state.assets=safeJson(STORAGE.assets,assetDefaults);
  $("assetEditor").innerHTML=assetMeta.map(item=>`<div class="assetline">
    <div class="assetLabel"><span>${esc(item.label)}</span><small>${esc(item.note)}</small></div>
    <div class="assetValue">
      <input class="assetInput" data-key="${item.key}" type="number" min="0" step="1" inputmode="decimal" value="${Number(state.assets[item.key])||0}" readonly aria-label="${esc(item.label)}金额">
      <button class="editOne" type="button" data-edit="${item.key}" aria-label="编辑${esc(item.label)}">✎</button>
    </div>
  </div>`).join("");
  $("assetEditor").addEventListener("focusin",event=>{
    if(event.target.classList.contains("assetInput")) beginAssetEdit(event.target);
  });
  $("assetEditor").addEventListener("click",event=>{
    const key=event.target.dataset.edit;
    if(key) beginAssetEdit(document.querySelector(`.assetInput[data-key="${key}"]`));
  });
  $("assetEditor").addEventListener("keydown",event=>{
    if(event.target.classList.contains("assetInput")&&event.key==="Enter") event.target.blur();
  });
  $("assetEditor").addEventListener("input",event=>{
    if(!event.target.classList.contains("assetInput")) return;
    state.assets[event.target.dataset.key]=Math.max(0,Number(event.target.value)||0);
    localStorage.setItem(STORAGE.assets,JSON.stringify(state.assets));
    updateAssetTotals();
  });
  $("assetEditor").addEventListener("focusout",event=>{
    if(event.target.classList.contains("assetInput")) finishAssetEdit(event.target);
  });
  updateAssetTotals();
  setAssetsVisible(false);
}

function setAssetsVisible(visible){
  state.assetsVisible=Boolean(visible);
  $("assetSensitive").hidden=!state.assetsVisible;
  $("assetPrivacyMask").hidden=state.assetsVisible;
  $("assetVisibilityBtn").textContent=state.assetsVisible?"🙈 隐藏":"👁 显示";
  $("assetVisibilityBtn").setAttribute("aria-expanded",String(state.assetsVisible));
}

function beginAssetEdit(input){
  if(!input) return;
  input.readOnly=false;
  input.classList.add("editing");
  requestAnimationFrame(()=>{input.focus();input.select();});
}

function finishAssetEdit(input){
  input.value=Math.max(0,Number(input.value)||0);
  state.assets[input.dataset.key]=Number(input.value)||0;
  input.readOnly=true;
  input.classList.remove("editing");
  localStorage.setItem(STORAGE.assets,JSON.stringify(state.assets));
  updateAssetTotals();
}

function toggleAllAssets(){
  const inputs=[...document.querySelectorAll(".assetInput")];
  const editing=inputs.some(input=>!input.readOnly);
  if(editing){
    inputs.forEach(finishAssetEdit);
    $("assetEditBtn").textContent="编辑全部";
  }else{
    inputs.forEach(input=>{input.readOnly=false;input.classList.add("editing");});
    inputs[0]?.focus();
    $("assetEditBtn").textContent="保存资产";
  }
}

function updateAssetTotals(){
  const values={...assetDefaults,...state.assets};
  const total=Object.entries(values).reduce((sum,[key,value])=>key==="provident"?sum:sum+(Number(value)||0),0);
  $("totalAssets").textContent=money(total);
  $("providentShow").textContent=money(values.provident);
  const groups=[
    ["黄金",values.goldAccum+values.goldPhysical],
    ["权益/纳指",values.nasdaqCny+values.nasdaqUsd],
    ["固收",values.bond+values.deposit],
    ["现金",values.cash],
    ["保险",values.insurance]
  ];
  $("portfolioBars").innerHTML=groups.map(([label,value])=>{
    const pct=total?value/total*100:0;
    return `<div class="barRow"><span>${label}</span><div class="barTrack"><div class="barFill" style="width:${clamp(pct,0,100).toFixed(1)}%"></div></div><span class="barPct">${pct.toFixed(1)}%</span></div>`;
  }).join("");
  const [topLabel,topValue]=groups.sort((a,b)=>b[1]-a[1])[0];
  const topPct=total?topValue/total*100:0;
  $("concentration").textContent=topPct>=45?`${topLabel}占比约 ${topPct.toFixed(1)}%，集中度较高。不是要求立刻卖出；新增资金先优先检查现金安全垫、保险缴费与其他资产的分散需要。`:`当前最高的是${topLabel}，占比约 ${topPct.toFixed(1)}%。暂未触发 45% 集中度提醒，继续用新增资金慢慢校准即可。`;
}

function resetAssets(){
  if(!window.confirm("恢复到 V3.3 当前资产基准？你之后录入的资产金额会被覆盖。")) return;
  state.assets={...assetDefaults};
  localStorage.setItem(STORAGE.assets,JSON.stringify(state.assets));
  document.querySelectorAll(".assetInput").forEach(input=>{input.value=state.assets[input.dataset.key];input.readOnly=true;input.classList.remove("editing");});
  $("assetEditBtn").textContent="编辑全部";
  updateAssetTotals();
}

function normalizeCareer(saved){
  const base=structuredClone(careerDefaults);
  if(!saved) return base;
  if(Array.isArray(saved.weekly)) base.weekly=saved.weekly;
  if(Array.isArray(saved.monthly)) base.monthly=saved.monthly;
  base.quarterDone=Boolean(saved.quarterDone);
  base.quarterNote=String(saved.quarterNote||"");
  return base;
}

function saveCareer(){ localStorage.setItem(STORAGE.career,JSON.stringify(state.career)); }

function renderCareer(){
  $("weeklyTasks").innerHTML=state.career.weekly.map(task=>`<label class="taskItem ${task.done?"done":""}">
    <input class="taskCheck" type="checkbox" data-task="${esc(task.id)}" ${task.done?"checked":""}>
    <input class="taskText" type="text" data-task-text="${esc(task.id)}" value="${esc(task.text)}" aria-label="本周任务内容">
  </label>`).join("");
  $("monthlyProgress").innerHTML=state.career.monthly.map(item=>{
    const pct=item.target?clamp(item.value/item.target*100,0,100):0;
    return `<div class="progressItem">
      <div class="progressTop"><span>${esc(item.label)}</span><span class="progressControls"><input type="number" min="0" max="99" step="1" data-progress="${esc(item.id)}" value="${Number(item.value)||0}" aria-label="${esc(item.label)}当前进度"> / ${Number(item.target)||1}</span></div>
      <div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
  $("quarterDone").checked=state.career.quarterDone;
  $("quarterNote").value=state.career.quarterNote;
  renderAbilities();
}

function renderAbilities(){
  if(!$("abilityAccount")) return;
  const weeklyDone=new Set((state.career.weekly||[]).filter(item=>item.done).map(item=>item.id));
  const progress=new Map((state.career.monthly||[]).map(item=>[item.id,Number(item.value)||0]));
  $("abilityAccount").innerHTML=abilityDefinitions.map(definition=>{
    let score=definition.base;
    const recent=[];
    for(const [taskId,points] of Object.entries(definition.taskPoints)){
      if(weeklyDone.has(taskId)){score+=points;recent.push(state.career.weekly.find(item=>item.id===taskId)?.text||taskId);}
    }
    for(const [progressId,points] of Object.entries(definition.progressPoints)){
      const value=progress.get(progressId)||0;
      if(value>0){score+=value*points;recent.push(`${state.career.monthly.find(item=>item.id===progressId)?.label||progressId}：${value}`);}
    }
    score=clamp(Math.round(score),0,100);
    return `<details class="abilityItem">
      <summary><span class="abilityName">${esc(definition.label)}</span><span class="abilityTrack"><span class="abilityFill" style="width:${score}%"></span></span><span class="abilityScore">${score}%</span></summary>
      <div class="abilityDetail">
        <div><b>已有证据：</b>${esc(definition.baseline)}</div>
        <div><b>最近新增：</b>${recent.length?esc(recent.slice(-2).join("；")):"本周还没有新增记录"}</div>
        <div><b>当前缺口：</b>${esc(definition.gap)}</div>
        <div><b>下一步最值得补：</b>${esc(definition.next)}</div>
      </div>
    </details>`;
  }).join("");
}

function loadCareer(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(STORAGE.career)||"null");}catch{}
  state.career=normalizeCareer(saved);
  renderCareer();
}

function bindCareer(){
  $("weeklyTasks").addEventListener("input",event=>{
    if(!event.target.dataset.taskText) return;
    const task=state.career.weekly.find(item=>item.id===event.target.dataset.taskText);
    if(task){task.text=event.target.value;saveCareer();}
  });
  $("weeklyTasks").addEventListener("change",event=>{
    if(event.target.dataset.task){
      const task=state.career.weekly.find(item=>item.id===event.target.dataset.task);
      if(task) task.done=event.target.checked;
    }
    if(event.target.dataset.taskText){
      const task=state.career.weekly.find(item=>item.id===event.target.dataset.taskText);
      if(task) task.text=event.target.value.trim()||task.text;
    }
    saveCareer();renderCareer();
  });
  $("monthlyProgress").addEventListener("change",event=>{
    const item=state.career.monthly.find(entry=>entry.id===event.target.dataset.progress);
    if(item){item.value=clamp(Number(event.target.value)||0,0,99);saveCareer();renderCareer();}
  });
  $("monthlyProgress").addEventListener("input",event=>{
    const item=state.career.monthly.find(entry=>entry.id===event.target.dataset.progress);
    if(!item) return;
    item.value=clamp(Number(event.target.value)||0,0,99);
    saveCareer();
    const fill=event.target.closest(".progressItem")?.querySelector(".progressFill");
    if(fill) fill.style.width=`${item.target?clamp(item.value/item.target*100,0,100):0}%`;
    renderAbilities();
  });
  $("quarterDone").addEventListener("change",event=>{state.career.quarterDone=event.target.checked;saveCareer();});
  $("quarterNote").addEventListener("input",event=>{state.career.quarterNote=event.target.value;saveCareer();});
  $("careerResetBtn").addEventListener("click",()=>{
    if(!window.confirm("重置本周、本月和季度记录？")) return;
    state.career=structuredClone(careerDefaults);saveCareer();renderCareer();
  });
}

function loadInvestPreferences(){
  state.invest=safeJson(STORAGE.invest,{cashMonths:8,riskFlag:false});
  $("cashMonths").value=Number(state.invest.cashMonths)||0;
  $("riskFlag").checked=Boolean(state.invest.riskFlag);
}

function saveInvestPreferences(){
  state.invest.cashMonths=Number($("cashMonths").value)||0;
  state.invest.riskFlag=$("riskFlag").checked;
  localStorage.setItem(STORAGE.invest,JSON.stringify(state.invest));
  renderInvestmentVerdict();
}

function bindEvents(){
  $("refreshBtn").addEventListener("click",()=>loadRadar(true));
  document.querySelectorAll(".nav [data-filter]").forEach(button=>button.addEventListener("click",()=>{
    state.activeFilter=button.dataset.filter;
    document.querySelectorAll(".nav .btn").forEach(item=>item.classList.remove("on"));
    button.classList.add("on");
    renderNews();
  }));
  $("assetEditBtn").addEventListener("click",toggleAllAssets);
  $("assetResetBtn").addEventListener("click",resetAssets);
  $("assetVisibilityBtn").addEventListener("click",()=>setAssetsVisible(!state.assetsVisible));
  $("cashMonths").addEventListener("input",saveInvestPreferences);
  $("riskFlag").addEventListener("change",saveInvestPreferences);
  bindCareer();
}

function init(){
  $("today").textContent=new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).format(new Date());
  loadAssets();
  loadCareer();
  loadInvestPreferences();
  bindEvents();
  loadRadar();
}

document.addEventListener("DOMContentLoaded",init);
