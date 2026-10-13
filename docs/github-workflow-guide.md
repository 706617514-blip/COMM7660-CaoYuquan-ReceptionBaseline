# GitHub 操作说明（个人工作手册）

> 本文件是本人使用的操作手册，**不是评分交付物**。作业要求的正式证据是 `README.md` 与
> `docs/` 下的其余文档。中文仅为便于本人操作；正式提交的报告与规范文档仍为英文。

## 0. 关键事实

| 项目 | 值 |
|---|---|
| 仓库地址 | <https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline> |
| 可见性 | Private（作业要求：除非导师批准公开） |
| 默认分支 | `main` |
| 学生 | Cao Yuquan — 26366290 |
| 协作者 | `fffchaobu`（Professor Charles Feng），write 权限 |
| 邀请日期 / 状态 | 2026-10-13 / **pending**（邀请 id 337417458） |
| 初始提交 | `5fbe3be85c56825ce78f3447317de0d6fc1dca0f` |
| 本机 CLI | `~/.local/bin/gh`（gh 2.102.0，已登录 `706617514-blip`） |

## 1. 在本机连接仓库

```bash
git clone https://github.com/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline.git
cd COMM7660-CaoYuquan-ReceptionBaseline
```

本机已经通过 `gh` 登录过，`git push` 可直接使用。换机器时需要重新授权：

```bash
gh auth login              # 选 GitHub.com → HTTPS → 浏览器设备码
gh auth setup-git          # 让 git 复用 gh 的凭据
gh auth status             # 检查当前账号与权限范围
```

## 2. 日常改动流程（Phase 2 全程使用）

```bash
git switch -c feature/short-name      # 一处改动一个分支
# ……改文件……
git add -A
git commit -m "说明这次改了什么、为什么"
git push -u origin feature/short-name

gh pr create --fill                   # 建 pull request
gh pr checks                          # 看 CI 检查结果
gh pr diff                            # 自己复核改动内容
gh pr review --comment -b "我的 PM 审查意见"
gh pr merge --squash --delete-branch  # 审核通过后合并
git switch main && git pull
```

作业要求保留"决策与对反馈的回应"，PR 里的评论就是这份记录。不要等导师逐条批准代码改动，
但每次分析/产品决定都要写下理由，以及你如何核查了 agent 的输出——提交量本身不算质量证据。

## 3. 协作者（导师）权限

邀请已发出，当前为 `pending`。检查与处理：

```bash
# 查看待接受的邀请
gh api repos/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/invitations

# 导师接受后查看协作者
gh api repos/706617514-blip/COMM7660-CaoYuquan-ReceptionBaseline/collaborators
```

- **pending 不等于已获得访问**。作业明确要求：若邀请仍处于 pending，要主动把仓库链接和邀请
  日期告知导师。
- 需要重新邀请时：仓库 → Settings → Collaborators → Add people → 搜索 **fffchaobu** →
  选中该账号 → 发送。必须是**仓库邀请**，不能只发一个网页链接。
- 两个阶段（到 2026-11-19 评分与复议期结束）都要保留导师权限，不要中途移除。

## 4. Phase 1 冻结版本（下一步由你本人执行）

作业要求：Phase 1 提交时用标签冻结分析证据，并把**完全同一份** Moodle 报告附到 Release。

```bash
git tag -a phase1-analytics -m "Phase 1 frozen analytical submission"
git push origin phase1-analytics
git rev-list -n1 phase1-analytics        # 取得完整 commit id

gh release create phase1-analytics \
  --title "Phase 1 — Media analytics and product justification" \
  --notes "冻结的分析证据、产品决策与 PRD。" \
  reports/COMM7660_Phase1_report.docx
```

打标签之后：

1. 把 tag 名和完整 commit id 回填到 `README.md` 的 "Submitted phase versions" 表；
2. 把 Moodle 上提交的那份 `.docx` 附到该 Release（两份文件必须一致）；
3. **该标签下的文件不要再改动**。Phase 2 用之后的提交继续开发，不重写 Phase 1 快照。

Phase 1 报告的 access block 还需要：仓库地址、协作者 `fffchaobu` 与邀请日期/状态、release/tag、
完整 commit id。前三项已确定，后两项在打标签后填入——先跑
`python3 analysis/check_report_compliance.py` 确认为 PASS 再提交。

## 5. Phase 2：CI/CD 与发布

- 工作流放在 `.github/workflows/`，在 pull request 和合并到 `main` 时触发；
- 部署必须依赖所有必需检查通过；
- 凭据放 Settings → Secrets and variables → Actions，绝不写进代码或前端文件；
- 交付两个编号发布（例如 `v0.1`、`v0.2`），并保留：一次**失败的检查**记录、两次成功发布、
  一次**回滚到上一版可用版本**的验证记录。

静态网页产品可用 Pages：

```bash
# 仓库 Settings → Pages → Build and deployment → GitHub Actions
```

注意：私有仓库启用 Pages 通常需要付费计划。作业明确说明**不要为了让 Pages 生效而把受限的
课程资料公开**；必要时用已批准的评审主机托管，源码与发布证据仍留在 GitHub。

## 6. Issue 与 PR 的用法

```bash
gh issue create --title "标题" --body "内容"     # 记录任务、疑问、缺陷
gh issue list
gh issue close <编号>
gh pr checks <编号>
gh run list                                       # 查看 Actions 运行记录
gh run view <run-id> --log-failed                 # 查看失败日志
```

## 7. 大文件与受限素材

```bash
git lfs install
git lfs track "*.mp4" "*.zip" "*.glb"
git add .gitattributes
```

或把构建产物/视频附到 GitHub Release。作业说明：缺失的 LFS 对象或占位符**不算**已交付素材，
提交前要亲自测试导师能否取回每一个必需文件。

## 8. 安全红线（作业明文规定）

- 不提交密码、token、账号 cookie、可识别参与者记录、未授权数据集或媒体——**私有仓库也不行**；
- 不把评论者标识（`author.steamid`、`personaname`、`profile_url`）写入仓库；
- 不绕过付费墙、登录限制、限流或反爬控制，不提供个人账号 cookie；
- 本机凭据：`gh` 的 token 存于系统钥匙串，不要导出到仓库或报告；
- 合成数据只能用于测试软件，路径必须带 `synthetic_` 前缀，且不得作为分析结论的证据。

## 9. 常用命令速查

```bash
git status                      # 当前改动
git log --oneline -10           # 最近提交
git diff                        # 未暂存的改动
git switch -c <分支>            # 新建并切换分支
git restore <文件>              # 丢弃某文件的未提交改动
git tag -l                      # 已有标签
git remote -v                   # 远端地址

gh repo view --web              # 浏览器打开仓库
gh browse <路径>                # 浏览器打开某个文件
gh pr list                      # PR 列表
gh release list                 # Release 列表
gh api repos/O/R                # 直接调 REST API
```

## 10. 目录说明

Phase 1 已提交的目录：`docs/`、`data/`、`analysis/`、`product/`、`records/`、`reports/`、
`tests/`、`.agents/skills/`。

`media/`（Phase 2 素材）与 `evaluation/`（事件字典与试点记录）目前为空，因此尚未纳入版本控制；
Phase 2 放入文件后会自动出现。`.github/workflows/` 同样为 Phase 2 内容。
