# 前端版本恢复

`main` 使用已确认的 Candyland 浅色圆角版本，保留正常字号、原有布局和功能。原 Windows 界面作为独立分支保留；切换前端不会替换笔记数据库。

## Windows 界面备份

- GitHub 分支：[`backup/windows-ui-20260930`](https://github.com/ziyu1617/pf-notes/tree/backup/windows-ui-20260930)
- 对应提交：`c947f0955d308d5cf2a9d55bcd27d29c65c8e0f5`
- 源码归档：`.ui-backups/windows-20260930/frontend-source.tar.gz`
- 原可运行前端：`.ui-backups/windows-20260930/frontend-built.tar.gz`

备份分支保留原版项目源码。两个归档仅保存在创建备份的本机，不进入 Git，也不随克隆下载；归档仅包含前端，没有笔记数据或 API 密钥。

## 恢复原 Windows 页面

先关闭 Smart Notes 桌面窗口，并保存当前前端改动。以下操作会覆盖本地前端文件，但不会修改笔记数据。

在项目根目录执行：

```bash
tar -xzf .ui-backups/windows-20260930/frontend-source.tar.gz -C .
tar -xzf .ui-backups/windows-20260930/frontend-built.tar.gz -C frontend
python3 app.py
```

这样可直接使用已备份的 Windows 页面，无需重新构建。新主题 CSS 文件可能仍留在目录中，但原版入口不会加载它们。

若归档不可用，可从 GitHub 备份分支恢复 `frontend` 源码，再构建。先在项目根目录执行以下命令；此命令使用仓库地址，不依赖本地远端名称：

```bash
git fetch https://github.com/ziyu1617/pf-notes.git refs/heads/backup/windows-ui-20260930
git restore --source FETCH_HEAD -- frontend
cd frontend
NEXT_OUTPUT=export npm run build
cd ..
python3 app.py
```

这不会切换或合并分支，也不会提交或推送代码。
