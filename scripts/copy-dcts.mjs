import { copyFileSync } from "node:fs";

/**
 * 为 CJS 消费方生成 index.d.cts：exports["."] 的 require 分支 types 指向它，
 * 避免「单一 ESM 形态 d.ts 服务 require 分支」的类型解析问题
 * (require 侧把 ESM 语法的 d.ts 当 CJS 解析，import= 与 export= 语义错配)。
 * rollupTypes 合并只产出 index.d.ts，这里做一次纯复制(内容双格式通用)。
 */
copyFileSync(new URL("../dist/index.d.ts", import.meta.url), new URL("../dist/index.d.cts", import.meta.url));
console.log("dist/index.d.cts written");
