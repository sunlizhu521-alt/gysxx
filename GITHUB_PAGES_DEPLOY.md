# GitHub Pages 部署

本项目已经配置 GitHub Pages 静态部署能力。

## 已配置内容

- `index.html`：Pages 网站入口。
- `.nojekyll`：关闭 Jekyll 处理，避免静态资源路径被改写。
- `.github/workflows/pages.yml`：推送到 `main` 或 `master` 后自动部署到 GitHub Pages。

## 使用步骤

1. 在 GitHub 创建同名仓库。
2. 在本项目目录绑定远程仓库并推送：

```bash
git add .
git commit -m "Update site"
git remote add origin https://github.com/sunlizhu521-alt/gysxx.git
git push -u origin main
```

3. 在仓库 `Settings -> Pages` 中选择 `GitHub Actions`。
4. 等待 Actions 完成后访问 Pages 链接。

## 后续更新

```bash
git add .
git commit -m "Update site"
git push origin main
```
