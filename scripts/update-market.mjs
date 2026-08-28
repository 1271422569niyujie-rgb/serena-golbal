import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";
import {collectMarket} from "./update-radar.mjs";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const DATA_PATH=path.join(ROOT,"data","radar-latest.json");
const FALLBACK_PATH=path.join(ROOT,"data","radar-fallback.js");

function pct(value){
  return Number.isFinite(Number(value))?`${Number(value)>=0?"+":""}${Number(value).toFixed(2)}%`:"暂缺";
}

export function buildMarketOnlyInvestment(market){
  const available=market?.status==="ok"&&(market.items||[]).filter(item=>item.value!==null).length>=3;
  if(!available) return {available:false,verdict:"",reason:"",amount:"",cancelIf:"",drivers:[]};
  const nasdaq=market.items.find(item=>item.key==="nasdaq100");
  const gold=market.items.find(item=>item.key==="gold");
  const us10y=market.items.find(item=>item.key==="us10y");
  return {
    available:true,
    verdict:"⚪ 正常定投，暂不额外加仓",
    reason:"行情已经更新，但这次没有同步完成新闻原因核验。先维持原计划，不根据几根涨跌线临时加动作。",
    amount:"工作日维持纳指 ¥100 定投；不额外加仓",
    cancelIf:"下一次新闻与行情完成联合核验，或你标记了尚未搞懂的重大风险时重新判断。",
    drivers:[
      `Nasdaq 100：1日 ${pct(nasdaq?.dayChange)}、5日 ${pct(nasdaq?.weekChange)}、20日 ${pct(nasdaq?.monthChange)}`,
      `黄金：5日 ${pct(gold?.weekChange)}`,
      `美国10年期收益率：5日 ${pct(us10y?.weekChange)}`
    ]
  };
}

async function main(){
  const data=JSON.parse(await readFile(DATA_PATH,"utf8"));
  const market=await collectMarket();
  market.generatedAt=new Date().toISOString();
  market.note=market.status==="ok"
    ?"行情已独立更新。若新闻分析暂时失败，投资区会使用克制的基础纪律判断，不把行情涨跌硬解释成原因。"
    :"公开行情源本次没有返回至少 3 项有效数据，因此不展示伪实时数字；投资区暂时使用基础纪律模式。";

  data.market=market;
  data.investment=buildMarketOnlyInvestment(market);
  data.pipeline={...(data.pipeline||{}),marketOnlyUpdatedAt:market.generatedAt,marketSource:market.source};
  await writeFile(DATA_PATH,`${JSON.stringify(data,null,2)}\n`,"utf8");
  await writeFile(FALLBACK_PATH,`window.__NINI_RADAR_FALLBACK__ = ${JSON.stringify(data,null,2)};\n`,"utf8");
  console.log(`市场数据状态：${market.status}；有效项 ${(market.items||[]).filter(item=>item.value!==null).length}/4`);
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked){
  main().catch(error=>{
    console.error(`市场更新失败：${error.stack||error.message}`);
    process.exitCode=1;
  });
}
