import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const input=path.join(root,"data","radar-latest.json");
const output=path.join(root,"data","radar-fallback.js");
const data=JSON.parse(await readFile(input,"utf8"));

await writeFile(output,`window.__NINI_RADAR_FALLBACK__ = ${JSON.stringify(data,null,2)};\n`,"utf8");
console.log(`已生成本地直接打开数据：${output}`);
