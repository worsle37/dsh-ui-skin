# 开发记录（DEVLOG）

> 给下一次开发用：先看这一页，再动 `client.js`。面向代码与机制，不含任何本机个人信息。
> 面向使用者的说明见 [README](../README.md)。

## 当前版本

| 项 | 值 |
| --- | --- |
| 版本 | **0.2.1** |
| 验证过的 DSH | Desktop / Web **0.2.2-rc.5** |
| 形态 | 单浏览器 bundle（`client.js`，无构建）+ 一个只声明 Config 的 Host 半（`index.js`） |
| 用户入口 | 设置 → 外观 |

## 版本历史

- **0.1.0** 首个版本：壁纸、分区透明度、底部输入栏与强调色、首页标题文字/颜色/图标。
- **0.2.0** 实测反馈后重做渲染模型：
  - 改为「一列一层玻璃」：列本身画唯一一层底色，列内 `bg-base` / `bg-layer-1..3` 全部透明，
    修复轨迹/统计等页面因同 token 逐层叠加而几乎全实的问题；
  - 覆盖右侧栏卡片、底部输入栏、弹层、行内代码/代码块、文件卡片；
  - 新增「弹层与菜单不透明度」「文字颜色」「自动提高可读性」；
  - 强调色只覆盖交互 token（不再误染文件类型图标等语义色）；
  - 设置页样式与皮肤开关解耦；拍平 Windows 内容区左上圆角；
  - 修复首页标题输入法的组合输入与退格光标问题。
- **0.2.1** 图片壁纸可拖动定位：新增 `wallpaperImagePosX/PosY/Scale`，设置页有 16:9 预览
  （拖动选露出区域）、缩放 100–250%、一键居中；尺寸按原图像素用 `cover × zoom` 计算，
  窗口 resize 时重算。

## 代码结构

```
index.js        Host 半：Config（= 设置命名空间 dsh-ui-skin）+ settings.configure({auto:false})
client.js       浏览器半（全部逻辑，单文件）：
  ├─ 配置 store（Host configForms 优先，localStorage 兜底；乐观更新 + 160ms 防抖写回）
  ├─ 颜色/对比度工具（hex↔rgb、mix/tint、相对亮度、对比度、ensureReadable）
  ├─ resolveSkin：按 light/dark 计算每个区域实际颜色与不透明度
  ├─ buildCss：壁纸层 + 三列玻璃 + 作用域 token
  ├─ buildTokenLayer：全局 token 覆盖（弹层/输入栏/强调色/文字色）
  ├─ SkinController：注入样式、标记三列、theme.overrideTokens、壁纸变量、resize 重算
  ├─ HeroSync：空白会话首页标题/徽标的 DOM 补丁（结构定位，不依赖类名/文案）
  └─ 设置页组件（色环、滑块、图片预览拖动、输入框等）
scripts/dev-instance.ps1   起隔离测试 profile + Web 实例（不碰 desktop）
```

## 关键机制（改之前先理解）

1. **颜色永远走 `ctx.theme.overrideTokens()`**：把 token 以 body 行内变量下发，优先级高于基础调色板。
   每次重算前做**签名去重**——`overrideTokens` 会同步 emit `theme/change`，不去重会递归栈溢出。
2. **一列一层玻璃**：DSH 的页面/表格/单元格会逐层重绘同一个背景 token，同 alpha 叠 4 层就接近不透明。
   所以列自己画一层 `rgba`，列内铺满型 token 全部 `transparent`；卡片/代码块/气泡用
   `subtle = 列 alpha × 0.45` 的低档 alpha 保留层次。
3. **作用域 CSS 变量**：给 `frame/sidebar/center/rightbar` 打 `data-dsh-ui-skin` 标记，把区域 token
   声明在对应列上靠继承生效。不依赖 CSS Module 哈希类名；不写 `!important` 抢 token（仅
   body/frame 透明和 Windows 圆角两处用）。
4. **壁纸**：`html::before` 画图（fixed、z-index -2），`html::after` 做暗化；图片 data URL 与
   size/position 放 html 行内 CSS 变量，**不要拼进 `<style>` 文本**（几百 KB 每帧重建会卡）。
   图片几何 = `cover × zoom` 后的像素尺寸 + 百分比 position，resize 时重算。
5. **自动可读**：壁纸平均色（渐变取两点均值；图片采样 16×16）→ 与面板色、文字色算对比度，
   不足 4.5 时逐 0.02 抬 alpha（上限 0.99）；弹层按「遮罩后背景」估算。
6. **明暗主题**：用户只挑一个颜色，按亮度生成 light/dark 两套可读变体（`surfaceVariants`）。
7. **首页标题**：DSH 没有官方文案覆盖点（同一 locale 命名空间重复注册会抛错）。用结构定位：
   父 span 恰好两个纯文本 span 子节点且第一个字号 ≥18px → 改 textContent / 颜色；
   只在启用时挂 MutationObserver，禁用/离开首页恢复原文。
8. **输入框**：内部草稿 + `compositionstart/end`，组合期间不写回设置；否则中文拼音先入库、
   受控值回环会让退格/光标跳到末尾。
9. **弹层**：portal 到 body，吃 body 级 token 覆盖；**菜单材质**在菜单元素内部定义，token 覆盖不到，
   保持 DSH 原生（带背景模糊）。

## 已知限制 / 不用再试的方向

- 只支持静态壁纸；动态壁纸（视频/canvas）未做。
- 菜单/账号菜单的不透明度改不了（材质在元素内定义）；设置对话框等 portal 弹层可以。
- 文件类型图标颜色是 DSH 语义色，不属于「交互强调色」，不要试图统一改色。
- 右侧文件栏依赖 `[data-dockkit-host]`；DSH 换掉 dockkit 时只有那一层玻璃失效。
- 图片壁纸目前是「铺满 + 可拖动/缩放」，没有「完整显示(contain)」模式——可作下一步选项。
- 用户已明确 **不要 Bonjourr 式自定义排版/小部件**（2026-11-20 决定废除），不要主动加。

## 下一步候选（按用户优先级待定）

1. 图片壁纸增加「填充方式：铺满 / 完整显示」。
2. 各区域「文字颜色」分开设置（目前一个全局文字色）。
3. 壁纸按明暗主题分别配置（目前一套）。
4. 性能：设置页拖动时如感觉卡，可把 `resolveSkin`/`buildCss` 结果按参数做一次缓存。

## 开发与验证

```powershell
# 语法检查（不要用 PATH 里的旧 node）
node --check index.js
node --check client.js

# 起隔离测试实例（建/装/起一个 skintest profile，不碰 desktop）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-instance.ps1 -Start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-instance.ps1 -Stop
```

- 只改 `client.js`：刷新页面即可（bundle revision 跟文件 mtime 走）。
- 改 `index.js` 的 `Config`（增删设置字段）：**必须重启 DSH**，旧进程的 Host schema 不会热更新。
- 设置值落盘位置：`<profile>/cordis.patch.yml` 的 `id: dsh-ui-skin` 段；重启后应能读回。
- 真机自检：`document.getElementById('dsh-ui-skin-style')` 存在、`window.__dshUiSkinDebug` 为空、
  三列上有 `data-dsh-ui-skin` 标记、`computed --dsw-alias-bg-base` 符合预期。

## 发布流程

1. 改 `package.json` 版本 + 本文件「版本历史」+ README「更新记录」。
2. `git add -A && git commit`（公开仓库前先做隐私检查：提交内容里不能有本机绝对路径、用户名、邮箱、token）。
3. `git push`（本机直连 GitHub 会超时，需要走代理；详见工作区流程卡）。
4. 可选：给 repo 打 tag（`git tag v0.2.1 && git push --tags`），或发布到 npm 后用户可直接
   `dsh plugin --profile desktop add dsh-ui-skin`。

## 设计决策记录

- **不注册主题（`ctx.theme.register`）**：那会写用户持久偏好、把用户主题改成我们的 id；
  `overrideTokens` 是可叠加的覆盖层，卸载即回收。
- **不注入 `<script>`、不建 HTTP 路由**：客户端 bundle 已能完成全部功能，保持轻量与可审计。
- **设置页自带、关自动表单**：`settings.configure({ auto: false })`，页面外观与 DSH 设置页一致。
- **状态存 Host 设置命名空间而非 localStorage**：桌面端口/源可能变化，localStorage 会丢；
  localStorage 仅在设置服务缺席时兜底。
