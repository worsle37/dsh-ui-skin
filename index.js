/**
 * dsh-ui-skin —— Host 半。
 *
 * 这里只做三件事：
 *  1. 声明 Config：它的每个字段都是 `volatile()`，因此变成设置命名空间
 *     `dsh-ui-skin` 里的可写字段，由 Host 持久化到 profile 的 Cordis patch，
 *     浏览器刷新、DSH 重启、端口变化都不会丢。
 *  2. 关掉自动生成的配置表单（我们自带「设置 → 外观」页面）。
 *  3. 不出别的副作用：所有视觉逻辑都在浏览器半 `client.js`。
 *
 * 默认值必须和 client.js 里的 DEFAULTS 完全一致。
 */
import z from '@deepseek-ai/schemastery'

/** 壁纸种类。 */
const WALLPAPER_MODES = ['gradient', 'solid', 'image', 'none']

/** Host 侧配置声明；字段顺序即设置页未使用，仅供阅读。 */
export const Config = z.object({
  /** 总开关：关掉后所有视觉改动立即撤销。 */
  enabled: z.boolean().default(true).volatile(),

  /** 壁纸类型：渐变 / 纯色 / 本地图片 / 关闭。 */
  wallpaperMode: z.union([...WALLPAPER_MODES]).default('gradient').volatile(),
  /** 壁纸主色（渐变起点 / 纯色）。 */
  wallpaperColor1: z.string().default('#1e2a4a').volatile(),
  /** 壁纸副色（渐变终点）。 */
  wallpaperColor2: z.string().default('#0b1020').volatile(),
  /** 渐变角度（度）。 */
  wallpaperAngle: z.number().step(1).min(0).max(360).default(135).volatile(),
  /** 本地图片的 data URL；空串表示没有图片。 */
  wallpaperImage: z.string().default('').volatile(),
  /** 图片壁纸的横向露出位置（0-100，50 = 居中）。 */
  wallpaperImagePosX: z.number().step(1).min(0).max(100).default(50).volatile(),
  /** 图片壁纸的纵向露出位置（0-100，50 = 居中）。 */
  wallpaperImagePosY: z.number().step(1).min(0).max(100).default(50).volatile(),
  /** 图片壁纸的缩放（100-250，100 = 刚好铺满窗口）。 */
  wallpaperImageScale: z.number().step(1).min(100).max(250).default(100).volatile(),
  /** 壁纸暗化遮罩强度（0-80）。 */
  wallpaperDim: z.number().step(1).min(0).max(80).default(0).volatile(),
  /** 壁纸模糊半径（0-40 px）。 */
  wallpaperBlur: z.number().step(1).min(0).max(40).default(0).volatile(),

  /** 对话界面底色。 */
  chatColor: z.string().default('#151517').volatile(),
  /** 对话界面不透明度（0-100），100 = 完全遮住壁纸。 */
  chatOpacity: z.number().step(1).min(0).max(100).default(72).volatile(),

  /** 右侧「工作区文件」栏底色。 */
  filesColor: z.string().default('#151517').volatile(),
  /** 右侧「工作区文件」栏不透明度（0-100）。 */
  filesOpacity: z.number().step(1).min(0).max(100).default(78).volatile(),

  /** 左侧边栏底色。 */
  sidebarColor: z.string().default('#1b1b1c').volatile(),
  /** 左侧边栏不透明度（0-100）。 */
  sidebarOpacity: z.number().step(1).min(0).max(100).default(86).volatile(),

  /** 底部输入栏（输入卡片）底色。 */
  composerColor: z.string().default('#2c2c2e').volatile(),
  /** 底部输入栏不透明度（0-100）。 */
  composerOpacity: z.number().step(1).min(0).max(100).default(88).volatile(),

  /** 交互强调色：只影响发送键、链接、焦点框、选中描边这类交互元素。 */
  accentColor: z.string().default('#4176e6').volatile(),

  /** 弹层 / 对话框 / 菜单 / 悬浮卡片的不透明度（0-100）。 */
  overlayOpacity: z.number().step(1).min(0).max(100).default(88).volatile(),
  /** 全局文字颜色；空串 = 跟随主题（自动可读）。 */
  fontColor: z.string().default('').volatile(),
  /** 对比度不足时自动提高面板不透明度。 */
  autoContrast: z.boolean().default(true).volatile(),

  /** 首页大标题文字；空串 = 保持默认。 */
  heroTitle: z.string().default('').volatile(),
  /** 首页「预览版」徽标文字；空串 = 保持默认。 */
  heroBadge: z.string().default('').volatile(),
  /** 首页标题文字颜色；空串 = 跟随主题。 */
  heroColor: z.string().default('').volatile(),
  /** 首页鲸鱼图标（data URL）；空串 = 保持默认图标。 */
  heroIcon: z.string().default('').volatile(),
})

/**
 * 挂载 Host 半：只登记「这个入口自己管设置表单」的策略，不做任何 IO。
 * `settings` 是可选服务（不含设置服务的组合里插件静默不挂）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 */
export function apply (ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      'dsh-ui-skin: own settings page',
    )
  })
}
