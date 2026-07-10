# Novel Agent 面试案例库

这里沉淀 Novel Agent 优化过程中可复用、可验证的 Agent 工程案例。提交完成后，Career Capture 只提出一次选择，不会自动生成或提交案例。

## 四种处理方式

- `生成`：根据当前提交创建一个新案例，并关联对应主题索引。
- `跳过`：明确将当前提交标记为不沉淀。
- `稍后`：保留待处理状态，之后再次决定。
- `合并`：把当前提交的证据补充到一个已有案例。

## 证据原则

- 只写能够由提交、代码、测试或验证命令支持的事实。
- 推断必须标明为推断；未经验证的效果放在“尚未验证”。
- 不伪造耗时、准确率、成本、用户反馈等指标。
- 不读取或记录 `.env`、凭据、密钥及其他被排除路径。
- 案例生成前必须获得用户明确确认，生成后也不会自动提交。

## 本地 Hook

安装提交后检测 Hook：

```bash
npm run career -- install-hook
```

查看待处理提交：

```bash
npm run career -- status
```

## 已验证的本地流程

以下命令已在功能工作树中实际验证：

```bash
npm run career -- install-hook
npm run career -- doctor
npm run career -- status
npm run career -- rebuild-pending
```

Git Hook 只负责快速、非阻塞地记录提交。Codex 创建的提交会在提交完成后按项目 Skill 发起一次确认；其他工具或终端产生的外部提交不会触发实时 AI 回调，而是在下一次 Codex 会话运行 `status`／`rebuild-pending` 时被发现。
