import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dedupeCandidates,enforceSelection,similarity} from "../scripts/update-radar.mjs";
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
  assert.ok(data.outside.some(item=>item.kind==="life"));
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
