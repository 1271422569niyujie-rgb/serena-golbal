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
  const marketByKey=new Map((market?.items||[]).map(item=>[item.key,item]));
  const available=market?.status==="ok"&&["nasdaq100","gold"].every(key=>{
    const value=marketByKey.get(key)?.value;
    return value!==null&&value!==undefined&&Number.isFinite(Number(value));
  });
  const fallbackViews={
    assetSignals:{
      nasdaq100:{status:"🟡 暂不额外加仓",judgment:"行情没有完整核验，维持原定投，不根据模糊数据增加仓位。"},
      gold:{status:"🟡 继续持有，不追涨",judgment:"现有黄金仓位已经不低，数据不完整时先持有，不追着价格加仓。"}
    },
    environment:{usStocks:"⚪ 数据待核验",aShares:"⚪ 数据待核验",gold:"⚪ 数据待核验",summary:"宏观与行情数据还不完整，今天先维持长期纪律，不做方向性猜测。"}
  };
  if(!available) return {available:false,verdict:"",reason:"",amount:"",cancelIf:"",drivers:[],...fallbackViews};
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
    ],
    assetSignals:{
      nasdaq100:{status:"🟡 暂不额外加仓",judgment:"多周期行情已更新，但新闻原因尚未同步核验；维持原定投，不临时追涨杀跌。"},
      gold:{status:"🟢 继续持有",judgment:"黄金多周期行情已更新；在宏观原因未核验前，保留现有仓位，不追加战术动作。"}
    },
    environment:{usStocks:"🟡 中性观察",aShares:"⚪ 数据待核验",gold:"🟡 中性观察",summary:"行情已更新，但宏观事件还没有同步核实，今天只执行原有纪律。"}
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
