# 共享项目说明

> `AGENTS.md` 和 `CLAUDE.md` 都只作为入口文件。公共项目背景、协作约定和任务边界以本文件为准。

## 项目定位

- 名称：Sapient Spend
- 一句话定位：Local-first YNAB-clone budgeting web app — offline PWA, zero dependencies, no backend; all data in localStorage (Basiq bank sync planned but not wired).
- 当前阶段：Feature-complete v1. Current work is pixel-fidelity polish against the real YNAB web app and mobile-layout quality.

## 术语与风格约定

- Money is **integer cents** everywhere; months are `"YYYY-MM"`, dates `"YYYY-MM-DD"`.
- Vanilla ES modules, no build step, no npm dependencies. Charts are hand-rolled inline SVG.
- `SPEC.md` is the store-API contract; `js/store.js` is the money engine. `YNAB-PIXEL.md` holds design values measured from the real YNAB app — all colors/fonts/spacing come from tokens in `css/app.css`, no hardcoded hex in view CSS.
- The `h\`\`` tagged template escapes interpolated strings; arrays and whole `<...>` fragments pass through raw.
- View modules (`js/views/*.js`) export `render(root, params)` and fully re-render on store changes; UI state lives in module-local variables.
- `node test/engine-check.mjs` must stay green — it asserts the budget math (RTA, carryover, credit-card handling, Age of Money, targets, matching, loans).
- Dev server: `python3 serve.py` (port 8437, sends no-store). UI copy is original — never copy YNAB's prose.

## 当前重点

- UI fidelity paper-cuts vs the real YNAB (screenshot-compared), especially mobile (375px).
- Accessibility: `impeccable detect http://localhost:8437/index.html` should stay at 1 finding (the intentional single-font one).
- Keeping the engine self-check green after any store.js change.

## 适合 Codex 承担的任务

典型任务：

- 精确的 grep / pattern 匹配与定位
- 事实/一致性核查（配置项、常量、接口签名、引用）
- 合规扫描（命名规范、格式、死链 / 断引用）
- 按模块 / 目录的统计与对比

本项目中还适合：

- Cross-file CSS audits: token usage vs `YNAB-PIXEL.md`, class-name collisions between view stylesheets (one already bit us: an unscoped `.chip` in reports.css leaked into the budget view), dead selectors.
- Spec-vs-implementation drift checks: `SPEC.md` store API vs actual `js/store.js` exports and return shapes.
- Consistency sweeps: popover/menu style family (radius/shadow/padding), 12px-uppercase table headers, `fmt()` usage for all money rendering, h`` escaping mistakes (raw HTML in plain-string interpolations).
- Running `node test/engine-check.mjs` and `impeccable detect` and reporting regressions with file:line pointers.

## 边界（§12 硬约束）

- 不改动 `js/store.js` 的金额算法与 `test/engine-check.mjs` 的断言值，除非任务明确要求并说明理由。
- 不引入 npm 依赖、构建步骤或外部网络请求（应用必须离线可用）。
- 不删除 / 重写 `SPEC.md`、`YNAB-PIXEL.md`；发现两者与实现矛盾时用 `handoff` 报告，不擅自改契约。
- 不复制 YNAB 的文案原文进代码库。
