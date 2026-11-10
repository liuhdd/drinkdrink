# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目规则来源 / Sources of truth

- **AGENTS.md** 是本仓库的编码规则与产品约束入口（分层职责、错误处理、重试、提交规则等），修改代码前必须遵守。本文件补充命令与跨文件架构，不重复 AGENTS.md 的规则。
- **README.md** 描述产品行为、数据保留与部署方式。

## 常用命令 / Commands

所有命令在仓库根目录执行；要求 Node.js 22.13+，脚本通过 `--experimental-strip-types` 直接运行 TypeScript。

```sh
npm ci
npm run dev                 # Next.js 热更新 + 真实 Worker/SQLite，http://127.0.0.1:4173
npm run build               # Next 静态导出 + esbuild Worker 打包到 dist/
npm run preview             # 静态产物预览（先 build），默认 4173
npm test                    # node:test，仅 tests/*.test.ts
npm run typecheck           # tsc 分别检查 Next / Worker / Node 三个环境
npm run test:e2e            # Playwright，必须先 npm run build
npm run db:generate         # 修改 db/schema.ts 后生成 drizzle/ 迁移
node --check dist/server/index.js
```

单个测试：

```sh
node --experimental-strip-types --test tests/server.test.ts
node --experimental-strip-types --test --test-name-pattern="保存" tests/server.test.ts
npx playwright test tests/e2e/ledger.spec.ts
npx playwright test tests/e2e/ledger.spec.ts -g "撤销"
```

- `npm run dev` 支持 `PORT` 和 `LEDGER_DATA_DIR`；默认数据在 `.local-data/ledger.sqlite`，**不要清理或修改用户的 `.local-data/`**。E2E 自带临时目录（`tests/e2e-server.ts` 设置 `LEDGER_DATA_DIR` 与端口 4186）。
- 项目未配置 lint；以 `npm run typecheck` 为准。
- `.next/`、`out/`、`dist/`、`*.tsbuildinfo` 是构建产物，不编辑、不提交。`next-env.d.ts` 也由构建生成。

## 架构 / Architecture

### 运行形态

前端是 Next.js App Router 的**纯静态导出**（`output: 'export'`），没有 Next.js 服务端路由。线上由 Cloudflare Worker（`src/server/worker.ts`）同时提供 `/api/*` 和静态资源；构建脚本生成 `dist/server/index.js`、`dist/client/`、`dist/server/wrangler.json`（cron 每小时清理）以及 `.openai/` 部署元数据。

本地 `scripts/local-server.ts` 用 `node:http` + `node:sqlite` 启动同一个 Worker：`/api/*` 直接调用 `worker.fetch`，其余请求交给 Next dev（`npm run dev`）或静态文件（`npm run preview`）。`scripts/sqlite.ts` 按 `drizzle/meta/_journal.json` 顺序应用 `drizzle/*.sql`，并把 `node:sqlite` 包装成 Worker 的 `LedgerDatabase` 接口（`prepare/bind/first/all/run`）。因此本地与线上共用 Worker 代码，但数据库是独立的。

### 分层

- `src/shared/`：环境无关的账本模型、纯业务函数、校验、错误、重试、HTTP 协议编解码。被浏览器、Worker、Node 脚本和测试共同导入，**不得依赖 DOM 或 Node 专有 API**。
- `src/client/`：浏览器连接器与副作用（设备标识、`localStorage`、`fetch`、Canvas 分享图、外观 CSS、骰子音效）。`createDeviceClient` 通过注入 `{ storage, fetch, randomUUID }` 保持可测试。
- `src/hooks/`：React 连接器，持有组件状态并编排加载、保存、同步、撤销生命周期。
- `src/server/`：Worker 入口、账本 API/存储、30 天保留清理、你比划我猜 API 与题库。
- `src/components/`：页面、表单、面板；`ui/` 是 shadcn/ui 源码。`ledger-app.tsx` 是记账页外壳和视图/弹窗状态中心。

### 账本读写链路

`LedgerApp` → `useLedger` → `createDeviceClient` → `/api/ledger` → `worker.ts` → D1/SQLite。

- 设备身份是浏览器生成的 UUID v4，存于 `localStorage` 的 `cheers-device-id-v1`，通过 `X-Device-ID` 发送，不出现在 URL。
- 服务端只在 `device_ledgers.data` 中保存 `{ ledger, memberSeen }`；`revision` + `generation` 做乐观并发控制，写入使用 `WHERE revision = ? AND generation = ?` 原子更新，冲突返回 409 并附带当前快照。
- 每次成功保存后，**以服务端返回的快照覆盖客户端状态**。`useLedger` 在 409 时通过 `errorSnapshot` 应用冲突快照。撤销栈只保留当前页面最近 30 个 `Session`，刷新后清空。
- 新写入带 `X-Request-ID`；服务端保存最近请求 ID 和请求摘要（SHA-256），相同 ID+内容重放返回原结果且不增加版本，相同 ID+不同内容返回 400。
- 客户端网络失败按指数退避+抖动重试最多 3 次；校验/冲突/数据库错误响应不重试。
- 首次初始化：GET 账本；若服务端为空，则迁移旧版 `cheers-ledger-v2`/`cheers-ledger-v1`（优先 v2），否则创建体验酒局，再以 `revision: 0, generation: null` 保存。旧版兼容只允许在迁移入口执行。
- `useLedger` 通过 `cheers-server-sync-v1` 的 `storage` 事件、窗口聚焦、`online` 和每分钟轮询做同设备多页面同步；弹窗打开时不覆盖当前编辑。

### 数据保留

`src/server/retention.ts` 实现 30 天保留：已结束酒局按结束时间、未结束酒局按开始时间、操作按发生时间、酒友按 `memberSeen` 最后使用时间裁剪；`device_ledgers.updated_at` 超过 30 天的整份账本删除，读取不延长寿命（只有保存更新 `updated_at`）。清理在 Worker 每小时 cron、每次读写的当前设备、以及本地服务启动/每小时执行。新增持久化字段时必须同时考虑 `retention.ts` 与 `records.ts` 的存储模型。

### 独立子系统

- **外观设置**（`src/shared/appearance.ts` + `src/client/appearance-*` + `src/hooks/use-appearance.ts`）：只存当前浏览器 `cheers-appearance-v1`，生成 CSS 变量，不写账本 API。新增区域要同时登记模型与 `data-appearance-region` DOM。
- **你比划我猜**（`src/server/charades.ts`、`src/server/charades-questions.ts`、`src/client/charades.ts`、`src/hooks/use-charades.ts`）：1000 道题的题库**只放在 server**；`device_charades` 按设备保存题目顺序、已抽题数与轮次，独立于账本保留期，新开酒局不重置。`POST /api/charades/next` 同样使用 revision/generation + 请求 ID 防重放。
- **骰子**（`src/components/dice-*`、`src/hooks/use-dice.ts`、`src/client/dice-audio.ts`）：纯前端 CSS 3D 与本地音效，无 API。

### 构建与类型检查

- `npm run build` = `scripts/client.ts` 运行 `next build` 并把 `out/` 复制到 `dist/client/`，随后 esbuild 将 `src/server/worker.ts` 打成 `platform: browser` 的 ESM，再复制 `.openai/hosting.json` 与 `drizzle/`。新增迁移必须提交 `drizzle/` 产物，已部署迁移不回改。
- `npm run typecheck` 分三个 project：`tsconfig.json`（Next/组件，排除 `src/server`）、`tsconfig.worker.json`（Worker，仅 ES2022 + workers-types）、`tsconfig.node.json`（脚本/测试/共享代码，Node 类型）。
- 全局 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`erasableSyntaxOnly`，且允许 `.ts` 扩展名导入。脚本与测试由 Node 直接类型剥离运行，因此共享代码只能用可擦除语法（不用 enum/namespace/参数属性），跨模块导入保留显式 `.ts` 后缀（`src/components` 通过 `@/` 别名导入）。

### 测试

- `npm test` 使用 `node --experimental-strip-types --test`，测试文件在 `tests/*.test.ts`；真实使用内存 SQLite（`applyMigrations` + `sqliteAdapter`）和进程内 Worker，客户端连接器使用注入的 storage/fetch fixture（`tests/http-fixture.ts`、`tests/network-fixture.ts`）。
- `npm run test:e2e` 使用本机 Google Chrome（Playwright `channel: 'chrome'`）、端口 4186、真实 HTTP 与临时 SQLite，启动的是 `dist/client` 生产产物，所以必须先 `npm run build`。测试定位使用稳定 ID（如 `#settings-button`），不要使用可见文本。

## 常见陷阱

- 不要新增 Next.js Route Handler 或依赖 `next start`：静态导出没有服务端运行时，API 属于 Worker。
- 修改 `db/schema.ts` 后运行 `npm run db:generate`，并确保 `drizzle/meta/_journal.json` 能驱动 `scripts/sqlite.ts` 的本地迁移；不要修改已发布的 `0000` 迁移。
- 服务端成功与本地维护失败是两件事：保存成功后本地标记失败要保留已保存账本并走 `repairLocalStorage`，不得重写账本。
- 不要为验证任务清空用户账本；E2E 与临时预览请始终指向临时 `LEDGER_DATA_DIR`。
