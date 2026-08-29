import assert from "node:assert/strict";
import {appendFile,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const DATA_PATH=path.join(ROOT,"data","radar-latest.json");
const FALLBACK_PATH=path.join(ROOT,"data","radar-fallback.js");

function validDate(value){
  return typeof value==="string"&&Number.isFinite(new Date(value).getTime());
}

function hoursOld(value){
  return (Date.now()-new Date(value).getTime())/36e5;
}

const data=JSON.parse(await readFile(DATA_PATH,"utf8"));
const fallbackSource=await readFile(FALLBACK_PATH,"utf8");
const fallback=JSON.parse(fallbackSource
  .replace(/^window\.__NINI_RADAR_FALLBACK__\s*=\s*/,"")
  .replace(/;\s*$/,"")
);

assert.equal(data.status,"ok","radar-latest.json 必须保留最后一次成功日报，不能用模拟日报替代");
assert.ok(validDate(data.generatedAt),"日报 generatedAt 无效");
assert.ok(typeof data.effectiveDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(data.effectiveDate),"日报 effectiveDate 无效");
assert.ok(Array.isArray(data.news)&&data.news.length>=5&&data.news.length<=10,"新闻数量必须为 5–10 条");

for(const item of data.news){
  assert.ok(item.title&&item.source&&item.url,"每条新闻必须有标题、来源和链接");
  assert.ok(validDate(item.publishedAt),`新闻发布时间无效：${item.title||"未命名"}`);
  assert.ok(hoursOld(item.publishedAt)>-1,"新闻发布时间不能来自未来");
  assert.ok(item.whatHappened&&item.whyImportant&&item.relation&&item.actionLevel,"每条新闻必须有独立分析字段");
}

const market=data.market||{};
assert.ok(["ok","partial","unavailable"].includes(market.status),"市场状态必须明确为 ok、partial 或 unavailable");
assert.ok(Array.isArray(market.items)&&market.items.length===4,"市场数据必须保留四个固定观察项");
for(const item of market.items){
  if(item.value===null||item.value===undefined) continue;
  assert.ok(Number.isFinite(Number(item.value)),`市场数值无效：${item.label||item.key}`);
  assert.ok(validDate(item.asOf),`市场时间无效：${item.label||item.key}`);
  assert.ok(hoursOld(item.asOf)>-1,"市场时间不能来自未来");
  assert.ok(/^https:\/\//.test(item.sourceUrl||""),`市场来源链接无效：${item.label||item.key}`);
}
if(market.items.some(item=>item.value!==null&&item.value!==undefined)){
  assert.ok(market.source&&validDate(market.generatedAt),"有行情数值时必须记录来源与抓取时间");
}

assert.deepEqual(fallback,data,"radar-fallback.js 必须与 radar-latest.json 完全一致");

const newsAge=hoursOld(data.generatedAt);
const marketAge=validDate(market.generatedAt)?hoursOld(market.generatedAt):null;
if(process.env.REQUIRE_FRESH_DATA==="1"){
  assert.ok(newsAge<=36,"本次没有生成 36 小时内的新日报");
  assert.equal(market.status,"ok","四项市场数据没有全部更新成功");
  assert.ok(marketAge!==null&&marketAge<=36,"市场抓取时间超过 36 小时");
  assert.equal(data.investment?.available,true,"Nasdaq 100 与黄金没有同时完成核验");
}
const summary=[
  "## 倪倪专属雷达数据校验",
  "",
  `- 最后成功日报：${data.effectiveDate}（生成于 ${data.generatedAt}）`,
  `- 新闻：${data.news.length} 条；当前年龄 ${Number.isFinite(newsAge)?newsAge.toFixed(1):"未知"} 小时`,
  `- 行情：${market.status}；${marketAge===null?"没有有效抓取时间":`抓取于 ${market.generatedAt}`}`,
  `- 真实性校验：来源、发布时间、行情时间、同源备用快照均通过${process.env.REQUIRE_FRESH_DATA==="1"?"；今日新鲜度通过":""}`,
  ""
].join("\n");

console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary,"utf8");
