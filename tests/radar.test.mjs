import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildRuleBasedAnalysis,dedupeCandidates,dedupeCognitions,enforceSelection,isReusableMarketSnapshot,parseGdeltArticles,parseIcbcGoldQuote,similarity} from "../scripts/update-radar.mjs";
import {buildMarketOnlyInvestment} from "../scripts/update-market.mjs";

test("相近标题会被识别为同一事件",()=>{
  const score=similarity("某银行发布财富管理新规解读","某银行发布财富管理新规：影响哪些客户");
  assert.ok(score>.5);
  const list=dedupeCandidates([{title:"某银行发布财富管理新规解读"},{title:"某银行发布财富管理新规：影响哪些客户"}]);
  assert.equal(list.length,1);
});

test("发布前强制执行类别、AI 与事件配额",()=>{
  const candidates=[
    {id:"a1",title:"智能助手进入客户经理访前准备",categoryId:"ai_workflows",category:"AI / 工作流"},
    {id:"a2",title:"生成式模型开始整理银行合规材料",categoryId:"ai_workflows",category:"AI / 工作流"},
    {id:"a3",title:"财富顾问试用自动会议纪要",categoryId:"ai_workflows",category:"AI / 工作流"},
    {id:"b1",title:"商业银行调整存款产品期限结构",categoryId:"banking",category:"银行业"},
    {id:"b2",title:"监管发布理财销售适当性要求",categoryId:"banking",category:"银行业"},
    {id:"b3",title:"银行网点推进养老金融服务",categoryId:"banking",category:"银行业"},
    {id:"m1",title:"宏观事件一",categoryId:"macro_global",category:"重大事件 / 宏观政策"}
  ];
  const analyses=candidates.map((candidate,index)=>({
    candidateId:candidate.id,level:index<3?"must":"know",eventKey:candidate.id,qualityScore:80,
    whatHappened:`事实 ${candidate.id}`,whyImportant:`重要 ${candidate.id}`,relation:`关系 ${candidate.id}`,
    actionLevel:"知道即可",actionDetail:`边界 ${candidate.id}`
  }));
  const output=enforceSelection(analyses,candidates);
  assert.equal(output.filter(item=>item.categoryId==="ai_workflows").length,2);
  assert.equal(output.filter(item=>item.categoryId==="banking").length,2);
  assert.ok(output.length<=10);
});

test("低质量与重复事件不会发布",()=>{
  const candidates=[
    {id:"x1",title:"事件甲",categoryId:"markets",category:"市场"},
    {id:"x2",title:"事件乙",categoryId:"wealth",category:"财富"}
  ];
  const selected=[
    {candidateId:"x1",level:"must",eventKey:"同一主体同一事件",qualityScore:69,whatHappened:"a",whyImportant:"b",relation:"c",actionLevel:"知道即可",actionDetail:"d"},
    {candidateId:"x2",level:"must",eventKey:"同一主体同一事件",qualityScore:90,whatHappened:"e",whyImportant:"f",relation:"g",actionLevel:"知道即可",actionDetail:"h"}
  ];
  const output=enforceSelection(selected,candidates);
  assert.deepEqual(output.map(item=>item.id),["x2"]);
});

test("30天内同一核心认知即使换句话说也会被过滤",()=>{
  const history=[{date:"2026-08-20",cognition:"未来更重要的是经营客户",dedupeKey:"客户经营>关系比单品销售重要"}];
  const today=[
    {cognition:"银行更看重客户关系，不只看销量。",dedupeKey:"客户经营>关系比单品销售重要"},
    {cognition:"会复盘的人，成长得更快。",dedupeKey:"复盘习惯>把经验变成下一次判断"}
  ];
  assert.deepEqual(dedupeCognitions(today,history).map(item=>item.dedupeKey),["复盘习惯>把经验变成下一次判断"]);
});

test("国内县域补充不会挤占国际与大城市主轴",()=>{
  const candidates=Array.from({length:10},(_,index)=>({
    id:`r${index}`,title:`独立事件 ${index}`,categoryId:index<5?`local_${index}`:`world_${index}`,
    category:index<5?"国内县域补充":"国际 / 大城市",localGrounded:index<5
  }));
  const analyses=candidates.map((candidate,index)=>({
    candidateId:candidate.id,level:index<3?"must":index<7?"know":"expand",eventKey:candidate.id,qualityScore:80,
    whatHappened:`事实 ${index}`,whyImportant:`重要 ${index}`,relation:`关系 ${index}`,
    actionLevel:"知道即可",actionDetail:`边界 ${index}`
  }));
  const output=enforceSelection(analyses,candidates);
  assert.ok(output.filter(item=>item.localGrounded).length<=3);
});

test("首日发布数据满足 V3.3 硬约束",async()=>{
  const data=JSON.parse(await readFile(new URL("../data/radar-latest.json",import.meta.url),"utf8"));
  assert.equal(data.status,"ok");
  assert.ok(data.news.length>=5&&data.news.length<=10);
  const levelCounts={must:0,know:0,expand:0};
  const categoryCounts=new Map();
  const actions=new Set(["现在就行动","加入观察清单","知道即可","与我暂时无关"]);
  for(const item of data.news){
    levelCounts[item.level]++;
    categoryCounts.set(item.categoryId,(categoryCounts.get(item.categoryId)||0)+1);
    assert.ok(item.source&&item.publishedAt&&item.url);
    assert.ok(item.whatHappened&&item.whyImportant&&item.relation);
    assert.ok(actions.has(item.actionLevel));
  }
  assert.ok(levelCounts.must>=2&&levelCounts.must<=3);
  assert.ok(levelCounts.know>=3&&levelCounts.know<=4);
  assert.ok(levelCounts.expand>=1&&levelCounts.expand<=3);
  assert.ok([...categoryCounts.values()].every(count=>count<=2));
  assert.ok((categoryCounts.get("ai_workflows")||0)<=2);
  assert.equal(new Set(data.news.map(item=>item.eventKey)).size,data.news.length);
  assert.ok(data.cognitions.every(item=>[...item.cognition].length<=26));
  assert.ok(data.cognitions.every(item=>item.dedupeKey));
  assert.ok(data.outside.some(item=>item.kind==="life"));
  assert.ok(data.outside.every(item=>item.trendKey));
  assert.ok(data.outsideUpdatedAt);
  assert.ok(data.marketStories.length>=2&&data.marketStories.length<=5);
  assert.ok(data.marketStories.every(item=>item.source&&item.publishedAt&&item.url));
  assert.ok(data.investment.assetSignals?.nasdaq100&&data.investment.assetSignals?.gold);
  assert.ok(data.investment.environment?.summary);
});

test("本地直接打开所需的随附数据与 JSON 一致",async()=>{
  const json=JSON.parse(await readFile(new URL("../data/radar-latest.json",import.meta.url),"utf8"));
  const source=await readFile(new URL("../data/radar-fallback.js",import.meta.url),"utf8");
  const payload=source.replace(/^window\.__NINI_RADAR_FALLBACK__\s*=\s*/,"").replace(/;\s*$/,"");
  const fallback=JSON.parse(payload);
  assert.equal(fallback.generatedAt,json.generatedAt);
  assert.deepEqual(fallback.news.map(item=>item.id),json.news.map(item=>item.id));
});

test("只有行情、没有新闻原因时使用克制的基础纪律判断",()=>{
  const market={status:"ok",items:[
    {key:"nasdaq100",value:100,dayChange:-1,weekChange:-2,monthChange:3},
    {key:"gold",value:100,weekChange:1},
    {key:"us10y",value:4,weekChange:2}
  ]};
  const result=buildMarketOnlyInvestment(market);
  assert.equal(result.available,true);
  assert.equal(result.verdict,"⚪ 正常定投，暂不额外加仓");
  assert.match(result.reason,/没有同步完成新闻原因核验/);
});

test("投资区必须同时拿到 Nasdaq 100 与黄金，不能用其他三项凑成可用",()=>{
  const market={status:"ok",items:[
    {key:"nasdaq100",value:null},
    {key:"gold",value:100},
    {key:"dollar",value:99},
    {key:"us10y",value:4}
  ]};
  assert.equal(buildMarketOnlyInvestment(market).available,false);
});

test("0 不能冒充有效行情",()=>{
  const market={status:"ok",items:[
    {key:"nasdaq100",value:0},
    {key:"gold",value:2500}
  ]};
  assert.equal(buildMarketOnlyInvestment(market).available,false);
});

test("能从工行公开页解析 Au99.99 的 1000g 交割规格参考价",()=>{
  const html=`
    <td id="last_080020000214">965.00</td>
    <td id="lstclose_080020000214">995.05</td>
    <div>更新时间:2026-08-30 16:16:32</div>`;
  const item=parseIcbcGoldQuote(html,Date.parse("2026-08-30T09:00:00Z"));
  assert.equal(item.key,"icbcGold1000g");
  assert.equal(item.value,965);
  assert.equal(item.unit," 元/克");
  assert.ok(item.dayChange<0);
  assert.equal(item.asOf,"2026-08-30T08:16:32.000Z");
});

test("工行官网直连失败时的只读转码文本也能按同一口径解析",()=>{
  const markdown=`
| Au99.99 | 965.00 | 跌 | -3.0199% | 16420 | 993.00 | 995.05 | 1000.00 | 965.00 |
更新时间:2026-08-30 17:02:32`;
  const item=parseIcbcGoldQuote(markdown,Date.parse("2026-08-30T09:10:00Z"));
  assert.equal(item.value,965);
  assert.equal(item.dayChange,-3.02);
  assert.equal(item.asOf,"2026-08-30T09:02:32.000Z");
});

test("同一次工作流只复用 30 分钟内核心数值有效的行情",()=>{
  const validItems=[{key:"nasdaq100",value:26000},{key:"gold",value:3500}];
  assert.equal(isReusableMarketSnapshot({status:"ok",items:validItems,generatedAt:new Date().toISOString()}),true);
  assert.equal(isReusableMarketSnapshot({status:"ok",items:[{key:"nasdaq100",value:0},{key:"gold",value:3500}],generatedAt:new Date().toISOString()}),false);
  assert.equal(isReusableMarketSnapshot({status:"partial",items:validItems,generatedAt:new Date().toISOString()}),false);
  assert.equal(isReusableMarketSnapshot({status:"unavailable",generatedAt:new Date().toISOString()}),false);
  assert.equal(isReusableMarketSnapshot({status:"ok",items:validItems,generatedAt:new Date(Date.now()-31*60000).toISOString()}),false);
});

test("没有 API Key 时规则基础版仍生成完整日报结构",()=>{
  const definitions=[
    ["p1","domestic_policy","国内政策 / 十五五","must",true],
    ["m1","macro_global","重大事件 / 宏观政策","must",false],
    ["l1","county_local","四川 / 成渝 / 县域","know",true],
    ["a1","a_share_trends","A股 / 资金 / 市场风潮","know",false],
    ["g1","global_market_narrative","美股 / 市场叙事","know",false],
    ["c1","career_cities","职场 / 城市产业","know",true],
    ["f1","frontier","新行业 / 社会变化","expand",false],
    ["t1","life_trends","生活 / 观念 / 新习惯","expand",false]
  ];
  const candidates=definitions.map(([id,categoryId,category,priorityHint,localGrounded],index)=>(
    {id,categoryId,category,priorityHint,localGrounded,title:`真实公开标题 ${index+1}`,source:`公开来源 ${index+1}`,
      publishedAt:new Date(Date.now()-index*3600000).toISOString(),url:`https://example.com/${id}`,snippet:""}
  ));
  const market={status:"ok",generatedAt:new Date().toISOString(),items:[
    {key:"nasdaq100",value:20000,dayChange:1,weekChange:2,monthChange:3},
    {key:"gold",value:2500,dayChange:-1,weekChange:1,monthChange:4},
    {key:"dollar",value:100,dayChange:0,weekChange:1,monthChange:1},
    {key:"us10y",value:4,dayChange:0,weekChange:-1,monthChange:2}
  ]};
  const result=buildRuleBasedAnalysis(candidates,market,{outsideRefreshDue:true});
  assert.equal(result.selected.filter(item=>item.level==="must").length,2);
  assert.equal(result.selected.filter(item=>item.level==="know").length,3);
  assert.equal(result.selected.filter(item=>item.level==="expand").length,1);
  assert.ok(result.selected.every(item=>item.whatHappened.includes("基础模式")||item.whatHappened.includes("公开摘要")));
  assert.ok(result.marketStories.length>=2);
  assert.equal(result.investment.verdict,"⚪ 正常定投，暂不额外加仓");
  assert.equal(result.cognitions.length,3);
  assert.ok(result.cognitions.every(item=>!item.cognition.includes("真实公开标题")));
  assert.ok(result.outside.length>=1);
  assert.ok(result.outside.every(item=>[...item.meaning].length<=48));
});

test("GDELT 备用源只接收带真实标题、链接和新鲜时间的条目",()=>{
  const category={id:"markets",label:"市场",priority:"must",maxAgeHours:84};
  const items=parseGdeltArticles({articles:[
    {title:"Nasdaq reacts to rate outlook",url:"https://example.com/news",domain:"example.com",seendate:new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")},
    {title:"没有链接",url:"",domain:"example.com",seendate:"20260828T120000Z"}
  ]},category);
  assert.equal(items.length,1);
  assert.equal(items[0].source,"example.com");
  assert.equal(items[0].feedProvider,"GDELT DOC API");
});
