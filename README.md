# 供应链信息库

这是一个可直接打开的静态供应链信息库项目。当前版本先登记 1 条钉钉在线文档链接，用来验证资料索引、分类筛选、搜索和跳转流程。

## 文件结构

- `index.html`：看板页面
- `purchase.html`：采购分工信息页面
- `upload.html`：旧分享链接入口，自动跳转到供应商交付信息页面
- `delivery.html`：供应商交付信息页面
- `file-library.html`：月度维度表文件库页面
- `fact-library.html`：备货事实表库页面
- `domestic-stock.html`：国内备货页面
- `cross-border-stock.html`：跨境备货页面
- `styles.css`：页面样式
- `app.js`：筛选、排序、图表和指标计算逻辑
- `upload.js`：上传页文件选择和状态展示逻辑
- `file-library.js`：多维度文件保存、列表和删除逻辑
- `fact-library.js`：备货发货事实表文件保存、应用和临时删除逻辑
- `data/documents.json`：钉钉文档索引数据
- `data/documents.js`：支持直接双击打开页面的同源数据脚本

## 使用方式

直接用浏览器打开 `D:\Codex\供应链钉钉文档信息库\index.html`。

发布到 GitHub Pages 后，打开仓库的 Pages 地址即可访问看板。

## 线上分享与本地文件库

同事在不同电脑打开 GitHub Pages 时，不能读取你本机浏览器 IndexedDB 里的文件。当前分享方案是：

- 采购分工信息、供应商交付信息默认读取仓库里的轻量看板数据 JSON，打开链接就有内容。
- 文件库更新页面不预置原始 Excel 文件，同事进入后按自己电脑本地上传、替换、确认应用刷新。
- 同事上传后的文件只保存在自己浏览器本地，不会改变其他同事电脑的数据，也不会改变 GitHub 链接。

如果需要重新生成轻量看板数据，先用固定源文件生成数据，再提交到 GitHub：

```powershell
cd D:\Codex\供应链钉钉文档信息库
C:\Users\82498\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\publish_shared_library.py
git add .
git commit -m "Publish latest library data"
git push origin main
```

固定源文件路径维护在 `data/library-source-files.json`。发布给同事前，可以清空 `data/shared-library.json`，避免原始 Excel 文件随文件库自动导入。

如果浏览器因本地安全策略限制 `fetch` 读取 JSON，可在项目目录启动一个本地静态服务：

```powershell
cd D:\Codex\供应链钉钉文档信息库
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 后续可扩展

- 继续向 `data/documents.json` 和 `data/documents.js` 增加钉钉文档链接。
- 补齐真实文档名称、负责人、分类、标签和摘要。
- 后续可接入 Excel、数据库或低代码后台维护资料索引。
- 保持正文内容在钉钉在线文档中编辑，信息库只做索引和跳转入口。

## 公开发布提醒

本仓库计划公开发布到 GitHub Pages。不要提交原始 Excel、供应商价格、联系人、电话、地址等敏感明细；这些工作文件已通过 `.gitignore` 排除。
