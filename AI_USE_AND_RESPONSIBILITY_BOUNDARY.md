# AI 使用与个人职责边界设计文档

**项目**：COMM7660 Individual Project — From Media Evidence to a Working Media Product Prototype
**学生**：_(填写姓名 / 学号)_
**建立日期**：2026-10-09
**状态**：Phase 1 前置框架（本文件本身不构成提交物，用于指导整个项目的合规执行）

> **本文件目的**：在 Phase 1 一开始就把"哪些由 AI 执行、哪些必须由本人完成、每个环节留什么证据"固定下来。
> 作业明确允许 agent 协助，但要求学生对分析、产品决策、原型与报告负个人责任。本文件的作用是让这条界线**可审计、可复现、不可事后追认**。

---

## 0. 作业依据（逐条引用）

以下引用均来自 COMM7660 Individual Project 作业说明，页码为该 PDF 页码。

| # | 作业原文 | 页码 | 对本项目的约束 |
|---|---|---|---|
| E1 | "Use agentic artificial intelligence (AI)—systems that use software tools to carry out tasks—to collect data, execute analysis, build the product, and test it. **You must direct and submit your own project and remain personally responsible** for its analysis, product decisions, prototype, and report. Agent assistance is permitted; this is not a jointly developed or jointly submitted project." | p.1 | AI 使用被明确允许；责任不可转移 |
| E2 | "Start with one coding agent, such as Codex or Claude Code, and Python or R for statistical execution." | p.3 | 单一主 coding agent；分析用 Python 或 R |
| E3 | "Use the documented project location for your agent: `.agents/skills/` for Codex or `.claude/skills/` for Claude Code." | p.6 | 技能包必须落在指定目录 |
| E4 | "Approval is required after the source/pilot, before the final model, before implementation, and before each release." | p.6 | 四个强制 approval 检查点 |
| E5 | "Keep a short log of skill invoked, command run, output produced, defect found, and human correction." | p.6 | 技能执行日志格式 |
| E6 | "Record project boundaries in AGENTS.md, CLAUDE.md, or the agent's equivalent project-instruction file: approved scope, data restrictions, analytical specification, test commands, and approval points." | p.7 | 项目指令文件必须记录边界 |
| E7 | "AI coding must use actual source descriptions, **not model memory**; hide outcome values during feature coding where feasible." | p.9 | 特征编码禁止使用模型记忆 |
| E8 | "Independently double-code a random 20% of titles... For this individual project, use an **independent AI coding pass or an acknowledged peer** solely for the second coding check. **Complete your own coding without seeing the other results.**" | p.9–10 | 双编码必须相互隔离 |
| E9 | "Report the comparison as **human–AI** or human–human agreement." | p.10 | 一致性报告须标明类型 |
| E10 | "You must explain every variable and coefficient **without asking the agent to answer for you**." | p.11 | 变量/系数解释须本人掌握 |
| E11 | "**Independently verify** one descriptive quantity and one model estimate/contrast using a **separate calculation or implementation**. **Another AI assurance is not verification.**" | p.12–13 | 独立复算禁止用第二个 AI |
| E12 | "Do not provide personal account cookies." / "Do not bypass paywalls, human-verification challenges, login restrictions, rate limits, or anti-bot controls." | p.10–11 | 采集行为红线 |
| E13 | "Clearly labelled synthetic inputs may test public software, but **cannot replace the real observations** supporting the analysis." | p.11 | 合成数据不能替代真实观测 |
| E14 | "Do not infer demographics from genre labels or review language; mark unmeasured audience fit as an assumption for prototype testing." | p.10 | 禁止从类型标签推断人口统计 |
| E15 | "Use the **instructor-designated** hosted platform at http://158.182.35.42:3100/ ... rather than setting up standalone ComfyUI." | p.21 | 媒体生成必须走指定平台 |
| E16 | "Run a formative pilot with **5–8 consenting adult users**... Record tasks, completion, errors, and feedback—**not only whether users say they like the idea**." | p.28 | 用户研究须真实、须记录行为 |
| E17 | "**Fabricated records, sources, user feedback, or execution claims are unacceptable.**" | p.35 | 直接红线 |
| E18 | "Include ... **AI-use and individual decision/verification logs**." | p.31 | 须提交 AI 使用与个人决策日志 |
| E19 | "A task is not complete merely because an agent says it is." | p.19 | agent 声称 ≠ 完成 |
| E20 | "Installation is not evidence of execution." | p.6 | 装工具不算证据 |
| E21 | "Complexity, tool count, dataset size, and visual polish alone earn no marks." | p.34 | 工具数量不加分 |
| E22 | "**Do not rewrite the Phase 1 evidence** to make the eventual product look predetermined." | p.16 | Phase 1 证据冻结后不可回改美化 |
| E23 | "You must **personally** explain the model rationale, one uncertainty estimate, one evidence-to-feature link, and a failed check or revision." | p.34 | 答辩内容须本人掌握 |
| E24 | "Passing tests supports implementation quality; it does not prove a valid research design or user demand." | p.26 | 测试通过 ≠ 需求验证 |

---

## 1. 职责划分总表

**图例**：🟢 = AI 可主导执行，本人审核 ｜ 🟡 = AI 协助，本人主导 ｜ 🔴 = 必须本人亲自完成，AI 不得代劳

### Phase 1（70 分）

| 环节 | 归属 | 说明 | 必须留下的证据 |
|---|---|---|---|
| 数据源选择与授权确认 | 🟡 | AI 可核查各源条款并整理，**选择与授权判断由本人做出** | `data/source-access-manifest.md` |
| 采集脚本编写 | 🟢 | AI 主导 | `analysis/collect_*.py` + 版本 + 时间戳 |
| 10–20 条 pilot 采集 | 🟢 | AI 执行 | pilot 原始文件 + access log |
| pilot 人工检查 | 🔴 | 作业要求 "Check the saved files yourself" | 手写检查记录（含发现的问题） |
| 数据清洗与校验 | 🟢 | AI 主导 | 清洗脚本 + codebook + 缺失/重复检查报告 |
| **特征编码（第一遍）** | 🔴 | 本人完成，且**不得看到第二遍结果** | 编码文件 + 时间戳 |
| **特征编码（第二遍 / 独立 AI pass）** | 🟢 | 独立 subagent，**隔离上下文** | 独立编码文件 + 一致性统计 |
| 编码一致性报告 | 🟢 | 报告须标明 human–AI | `coding-agreement-report.md` |
| 关键字段 10% 复核 | 🟡 | AI 可辅助抽取，核对须本人确认 | 复核记录 |
| 概念模型构建 | 🟡 | AI 提供文献支持与选项，**机制论证由本人做出** | `docs/conceptual-model.md` |
| 统计模型规范 | 🟡 | AI 可提候选，**最终 spec 由本人批准** | `docs/statistical-spec.md` |
| 模型执行与图表 | 🟢 | AI 主导 | 脚本 + 3 张图 + 诊断输出 |
| 敏感性分析 | 🟡 | AI 提候选方案，**哪两个被选中由本人决定并说明理由** | 2 份敏感性分析记录 |
| **独立复算验证** | 🔴 | **禁止用第二个 AI**（E11）。须用独立计算/实现 | 复算记录（标明方法、工具、结果差异） |
| 变量/系数解释 | 🔴 | 本人撰写或至少本人能完整口述（E10） | 本人签注的解释文档 |
| 结论与产品决策 | 🔴 | 本人做出 | decision memo 本人署名 |
| PRD 撰写 | 🟡 | AI 可起草，**范围裁剪与验收标准由本人定** | PRD + 本人修订记录 |

### Phase 2（30 分）

| 环节 | 归属 | 说明 | 必须留下的证据 |
|---|---|---|---|
| 媒体素材生成 | 🟢 | 走课程指定平台 `http://158.182.35.42:3100/` | asset inventory + generation log |
| 素材人工验收 | 🔴 | "A successful generation job is not evidence that the asset is acceptable" | 人工验收记录 |
| MVP 代码实现 | 🟢 | AI 主导 | 源码 + 提交历史 |
| 核心旅程本人确认 | 🔴 | "personally confirm that its core experience works" | 本人测试记录 |
| Playwright 测试 | 🟢 | AI 编写 | 测试脚本 + report |
| **故意破坏一个行为** | 🔴 | 须真实制造失败并修复 | 失败 run + 修复 run 链接 |
| GitHub Actions 工作流 | 🟢 | AI 编写 | workflow 文件 + **真实 run 链接** |
| CI/CD 证据 | 🔴 | 必须真实执行，本地输出不算 | Actions run URL × N |
| **用户 pilot 招募与执行** | 🔴 | **AI 完全不得参与**（E17） | 知情同意 + 原始事件导出 |
| 事件字典设计 | 🟡 | AI 可起草，**事件定义由本人批准** | `evaluation/event-dictionary.md` |
| 主要指标独立计算 | 🔴 | "independently calculate the primary measure" | 独立计算脚本 + 与 dashboard 差异说明 |
| 基于证据的修订 | 🔴 | 本人决定改什么 | 变更记录 + 理由 |
| 最终决策 | 🔴 | 本人做出 | final decision 记录 |
| 两个 release + rollback | 🔴 | 必须真实发布与回滚 | release 链接 × 2 + 回滚记录 |

---

## 2. 强制 Approval 检查点（E4）

作业要求四个 approval 点。以下是模板，**每次由本人填写，不得由 agent 代写**。

### ✅ Approval 1 — 数据源与 Pilot 之后

```
日期：__________
批准的内容：数据源 = ______________；Pilot 样本量 = ______ 条
我亲自检查了什么：
  - [ ] 已打开 pilot 原始文件并核对字段
  - [ ] 已确认 access conditions（授权依据：__________）
  - [ ] 已发现的问题：______________________________
  本人签字：__________
```

### ✅ Approval 2 — 最终模型之前

```
日期：__________
批准的内容：因变量 = ______；自变量 = ______；方法 = ______
我为什么批准这个 spec（本人撰写，≥3 句）：
  ______________________________________________
  ______________________________________________
我确认已排除的循环模型风险：
  - [ ] 未用 provider 的输入变量解释其输出
  - [ ] 未用 hours÷runtime 反推 views 作为因变量
  本人签字：__________
```

### ✅ Approval 3 — 实现之前

```
日期：__________
批准的内容：MVP 范围 = ______________
必须有的能力（≤3 个）：1.________ 2.________ 3.________
明确排除的：______________________________
本人签字：__________
```

### ✅ Approval 4 — 每次 Release 之前

```
Release 编号：v____   日期：__________
  - [ ] 我已亲自运行核心旅程
  - [ ] 我已检查测试通过（run 链接：________）
  - [ ] 部署版本与待评 release 一致
  - [ ] 我已确认没有凭据进入仓库
  本人签字：__________
```

---

## 3. 技能执行日志（E5）

格式：`skill invoked | command run | output produced | defect found | human correction`

| 日期 | Skill | Command | Output | Defect found | Human correction |
|---|---|---|---|---|---|
| | collect-media-data | | | | |
| | validate-media-data | | | | |
| | analyze-and-report | | | | |
| | build-media-mvp | | | | |
| | test-and-release | | | | |

> **注意**：作业要求日志体现"defect found"和"human correction"。**空白的 correction 栏看起来像没做人工审查**。真实发现问题并记录，比写"无问题"更符合评分意图。

---

## 4. 双编码隔离方案（E8 / E9）

这是唯一一个"要主动设计隔离"的环节。

```
第一遍（本人）                     第二遍（独立 AI pass）
─────────────────────────         ─────────────────────────
本人阅读 source description        独立 subagent，不共享上下文
本人决定标签                       prompt 中不含第一遍任何结果
输出：coding_pass1.csv            输出：coding_pass2.csv
         │                                │
         └────────────┬───────────────────┘
                      ▼
            一致性统计（human–AI）
            + 分歧逐条解释
```

**隔离要留的证据**：
- 两份编码文件的**创建时间戳**（证明先后）
- 第二遍的 prompt 全文（证明未泄漏第一遍结果）
- 分歧条目的逐条讨论

**必须做**：作业要求 "hide outcome values during feature coding where feasible"。即编码特征时**不要看 rating count**。

---

## 5. 合成数据与真实数据的分界（E13）

| 用途 | 允许合成数据？ | 说明 |
|---|---|---|
| 测试 CI 流程、单元测试 fixture | ✅ 允许 | 须**明确标注 synthetic** |
| 验证数据完整性检查逻辑 | ✅ 允许 | 同上 |
| **分析结论的依据** | ❌ 禁止 | 必须真实观测 |
| **用户行为证据** | ❌ 禁止 | 必须真实 pilot |

**仓库中的标注规范**：所有合成文件路径含 `synthetic_` 前缀，文件头写明用途与禁止用途。README 中单独列出。

---

## 6. 仓库内 Agent 指令文件的要求（E6）

`AGENTS.md` 须包含以下内容（作业点名要求的五项）：

```markdown
# AGENTS.md

## Approved scope
（本项目的批准范围，Phase 1 / Phase 2 分列）

## Data restrictions
（哪些数据可用、哪些禁止入库、授权依据）

## Analytical specification
（冻结的模型规范，指向 docs/statistical-spec.md）

## Test commands
（可复现的测试命令）

## Approval points
（指向本文件第 2 节的四个检查点）

## Agent boundaries
- 不得修改统计模型、产品范围、验收标准、支出限额、发布目的地（未经本人批准）
- 不得生成或改写用户反馈数据
- 不得代表本人做出 approval 决定
- 特征编码不得使用模型记忆，须基于 source description
- 不得绕过任何访问限制
```

---

## 7. 红线清单（不可协商）

| # | 禁止事项 | 依据 |
|---|---|---|
| 1 | 伪造记录、来源、用户反馈、执行声明 | E17 |
| 2 | 绕过付费墙、人机验证、登录限制、限速、反爬 | E12 |
| 3 | 提供个人账号 cookie | E12 |
| 4 | 用第二个 AI 充当"独立验证" | E11 |
| 5 | 用 AI 生成用户 pilot 反馈 | E16 / E17 |
| 6 | 用合成数据支撑分析结论 | E13 |
| 7 | 从类型标签推断人口统计 | E14 |
| 8 | 事后改写 Phase 1 冻结证据 | E22 |
| 9 | 在 GitHub 存密码、token、可识别参与者记录、未授权数据集 | p.31 |
| 10 | agent 声称完成即认为完成，不做本人检查 | E19 |

---

## 8. 答辩自查清单（E23 / E10）

8 分钟陈述 + 提问，你必须能**不看稿**回答：

- [ ] **模型 rationale**：为什么因变量度量的是 X 而非 Y？为什么选这个机制而非数据可得性？
- [ ] **一个不确定估计**：这个标准误/区间**用你自己的话说**是什么意思？（作业要求本人措辞解释）
- [ ] **一个 evidence-to-feature link**：哪条证据支撑了哪个能力？不确定性是什么？
- [ ] **一个失败检查或修订**：什么坏了、怎么发现的、怎么修的？

以及至少能当场复现：
- [ ] 一个描述统计量的独立复算过程
- [ ] 一个模型系数/对比的独立复算过程

---

## 9. 与我（DSH agent）协作时的操作约定

基于上述边界，实际协作时遵循：

1. **我写的每一份产出，你都要能自己解释**——尤其模型相关部分。如果某段你看不懂，那是个必须解决的信号，不是可以放过的细节。
2. **approval 记录你必须亲自写。** 不要让我起草"已批准"字样。
3. **CI/CD 的 run 链接必须真实来自 GitHub Actions。** 我在本地跑通只是开发过程，不是提交证据。
4. **用户 pilot 我只能帮你写工具（如事件导出解析脚本），不能碰数据和结论。**
5. **独立复算请用 Excel / 手算 / 另一个非 AI 实现。** 我可以帮你检查你的复算逻辑，但那不算"独立验证"本身。
6. **Phase 1 一旦 tag，不要再让我改那份证据。** 后续变更另开文档记录 rationale。

---

## 10. 变更记录

| 日期 | 变更 | 理由 |
|---|---|---|
| 2026-10-09 | 建立本文件 | Phase 1 前置合规框架 |
