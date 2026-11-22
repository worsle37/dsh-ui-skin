/**
 * dsh-ui-skin —— 浏览器半（DSH Web/桌面客户端插件）。
 *
 * 设计要点（为什么这样写）：
 *  - 颜色走官方 `ctx.theme.overrideTokens()`：它把 token 写成 body 行内变量，
 *    DSH 的主题层不会把它冲掉，且同一个 source 再调用一次即可热替换。
 *  - 分区透明度走「作用域 CSS 变量」：给三列打上 data 属性，再把
 *    `--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` 声明在对应列上。
 *    自定义属性按 DOM 继承，所以只有该列的子树读到新值 —— 不碰任何
 *    CSS Module 的哈希类名，也不和别的插件抢 token。
 *  - 壁纸画在 `html::before`（fixed、负 z-index），再把 body/frame 变透明。
 *    这样不需要往 body 追加节点，卸载时整段 <style> 一起消失。
 *  - 首页标题文字没有官方文案覆盖点（语言包同一命名空间会拒绝重复注册），
 *    所以用最小的 DOM 补丁：只在 blank home 的 `[data-conversation-content]`
 *    里按当前语言文本定位那两个 span，改文字/颜色，卸载时恢复。
 *  - 状态全部存 Host 设置命名空间 `dsh-ui-skin`（由 index.js 的 Config 生成）；
 *    万一设置服务不可用，退化为浏览器 localStorage，插件仍可用。
 */

window.__ModuleLoader__.load({
  id: 'dsh-ui-skin',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    /** 语言包命名空间（同时用于「设置 → 外观」页的文案）。 */
    const NS = 'dsh-ui-skin'
    /** Host 设置命名空间 = profile 里插件行的 id。 */
    const CONFIG_NS = 'dsh-ui-skin'
    /** 主题覆盖层标识；动态插件会被 runner pin 成包 id，这里与包名一致。 */
    const THEME_LAYER = 'dsh-ui-skin'
    /** 我们注入的 <style> 的 id，卸载时按 id 精确移除。 */
    const STYLE_ID = 'dsh-ui-skin-style'
    /** 设置页样式单独一份：关掉皮肤时它必须还在。 */
    const PAGE_STYLE_ID = 'dsh-ui-skin-page-style'
    /** 作用域标记属性。 */
    const MARK = 'data-dsh-ui-skin'
const GLASS_ROOT = 'data-dshui-glass'
const GLASS_SURFACE = 'data-dshui-surface'
    /** 设置服务缺席时的退化存储 key。 */
    const LOCAL_KEY = 'dsh.ui-skin.config.v1'

    /** 与 index.js 的 Config 默认值保持一致。 */
    const DEFAULTS = Object.freeze({
      enabled: true,
      wallpaperMode: 'gradient',
      wallpaperColor1: '#1e2a4a',
      wallpaperColor2: '#0b1020',
      wallpaperAngle: 135,
      wallpaperImage: '',
      wallpaperImagePosX: 50,
      wallpaperImagePosY: 50,
      wallpaperImageScale: 100,
      wallpaperDim: 0,
      wallpaperBlur: 0,
      chatColor: '#151517',
      chatOpacity: 72,
      chatFrost: 10,
      filesColor: '#151517',
      filesOpacity: 78,
      filesFrost: 10,
      filesFollowSidebar: true,
      sidebarColor: '#1b1b1c',
      sidebarOpacity: 86,
      sidebarFrost: 10,
      composerColor: '#2c2c2e',
      composerOpacity: 88,
      composerFrost: 10,
      accentColor: '#4176e6',
      overlayOpacity: 88,
      frostBlur: 10,
      overlayFrost: 10,
      fontColor: '',
      autoContrast: true,
      heroTitle: '',
      heroBadge: '',
      heroColor: '',
      heroIcon: '',
    })

    /** 壁纸渐变预设（色环之外的一键选择）。 */
    const PRESETS = [
      ['#1e2a4a', '#0b1020'],
      ['#2b4a8a', '#7a3f9a'],
      ['#0f3d3e', '#08201f'],
      ['#4a2b2b', '#1a0d0d'],
      ['#12324d', '#071722'],
      ['#3a2a55', '#120b1c'],
    ]

    // =====================================================================
    // 颜色工具（全部纯函数，输入都当不可信数据处理）
    // =====================================================================
    const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
    const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)$/i

    function clamp (value, min, max) {
      const number = Number(value)
      if (!Number.isFinite(number)) return min
      return Math.min(max, Math.max(min, number))
    }

    function isColor (value) {
      return typeof value === 'string' && (HEX_RE.test(value) || RGB_RE.test(value))
    }

    function safeColor (value, fallback) {
      return isColor(value) ? value : fallback
    }

    function hexToRgb (hex) {
      const text = String(hex || '').trim()
      if (HEX_RE.test(text)) {
        let body = text.slice(1)
        if (body.length === 3 || body.length === 4) body = body.split('').map(c => c + c).join('')
        return {
          r: parseInt(body.slice(0, 2), 16),
          g: parseInt(body.slice(2, 4), 16),
          b: parseInt(body.slice(4, 6), 16),
        }
      }
      const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(text)
      if (match) return { r: clamp(match[1], 0, 255), g: clamp(match[2], 0, 255), b: clamp(match[3], 0, 255) }
      return null
    }

    function rgbToHex ({ r, g, b }) {
      const part = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
      return '#' + part(r) + part(g) + part(b)
    }

    function withAlpha (color, alpha) {
      const rgb = hexToRgb(color)
      if (!rgb) return 'transparent'
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`
    }

    function mixHex (left, right, weight) {
      const a = hexToRgb(left) || { r: 0, g: 0, b: 0 }
      const b = hexToRgb(right) || { r: 255, g: 255, b: 255 }
      const t = clamp(weight, 0, 1)
      return rgbToHex({
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
      })
    }

    function blendRgb (base, overlay, alpha) {
      const a = base || { r: 0, g: 0, b: 0 }
      const b = overlay || { r: 0, g: 0, b: 0 }
      const t = clamp(alpha, 0, 1)
      return {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
      }
    }

    /** 把颜色往白（正）或黑（负）方向推，用来做同一面板里的层级差。 */
    function tintColor (color, amount) {
      const rgb = hexToRgb(color) || { r: 128, g: 128, b: 128 }
      const target = amount >= 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
      return rgbToHex(blendRgb(rgb, target, Math.abs(amount)))
    }

    function luminance (color) {
      const rgb = typeof color === 'string' ? (hexToRgb(color) || { r: 0, g: 0, b: 0 }) : color
      const channel = (value) => {
        const c = value / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
    }

    function contrastRatio (left, right) {
      const a = luminance(left) + 0.05
      const b = luminance(right) + 0.05
      return a > b ? a / b : b / a
    }

    /**
     * 自动可读：在保持用户选择的不透明度前提下，检查文字与「面板叠在壁纸上的实际颜色」
     * 的对比度；不够就一点点提高该区域的不透明度，最多到 0.99。
     * @returns {number} 实际使用的不透明度
     */
    function ensureReadable (alpha, surfaceColor, backdrop, textColor) {
      const surface = hexToRgb(surfaceColor) || { r: 0, g: 0, b: 0 }
      let value = clamp(alpha, 0, 1)
      while (value < 0.99) {
        const composite = blendRgb(backdrop, surface, value)
        if (contrastRatio(textColor, composite) >= 4.5) return Math.round(value * 1000) / 1000
        value += 0.02
      }
      return 1
    }

    /**
     * 用户只挑一个颜色，深浅两套主题各取一个可读的变体：
     * 深色主题用原色（若原本是亮色则压暗），浅色主题用原色（若原本是暗色则提亮）。
     * 这样无论用户在哪个主题下调色，切到另一套主题都不会出现「深底深字」。
     */
    function surfaceVariants (color, fallback) {
      const raw = safeColor(color, fallback)
      const lum = luminance(raw)
      return {
        light: lum >= 0.5 ? raw : mixHex(raw, '#f4f6fa', 0.86),
        dark: lum <= 0.5 ? raw : mixHex(raw, '#0b0b0d', 0.85),
      }
    }

    function hsvToHex (hue, sat, val) {
      const hh = ((hue % 360) + 360) % 360
      const s = clamp(sat, 0, 1)
      const v = clamp(val, 0, 1)
      const c = v * s
      const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
      const m = v - c
      let r = 0
      let g = 0
      let b = 0
      if (hh < 60) { r = c; g = x } else if (hh < 120) { r = x; g = c } else if (hh < 180) { g = c; b = x } else if (hh < 240) { g = x; b = c } else if (hh < 300) { r = x; b = c } else { r = c; b = x }
      return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 })
    }

    function hexToHsv (color) {
      const rgb = hexToRgb(color) || { r: 255, g: 0, b: 0 }
      const r = rgb.r / 255
      const g = rgb.g / 255
      const b = rgb.b / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const delta = max - min
      let hue = 0
      if (delta !== 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6)
        else if (max === g) hue = 60 * ((b - r) / delta + 2)
        else hue = 60 * ((r - g) / delta + 4)
      }
      return { h: (hue + 360) % 360, s: max === 0 ? 0 : delta / max, v: max }
    }

    // =====================================================================
    // 设置存储：Host 设置命名空间优先，localStorage 兜底
    // =====================================================================
    function readLocal () {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(LOCAL_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    }

    function writeLocal (value) {
      try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(LOCAL_KEY, JSON.stringify(value))
      } catch {
        /* 存储配额/隐私模式：忽略，插件仍然按内存状态工作 */
      }
    }

    /** 把任意来源的数据收敛成完整、合法的配置对象。 */
    function normalize (input) {
      const source = input && typeof input === 'object' ? input : {}
      const pickNumber = (key, min, max) => clamp(source[key], min, max)
      const mode = ['gradient', 'solid', 'image', 'none'].includes(source.wallpaperMode) ? source.wallpaperMode : DEFAULTS.wallpaperMode
      return {
        enabled: source.enabled !== false,
        wallpaperMode: mode,
        wallpaperColor1: safeColor(source.wallpaperColor1, DEFAULTS.wallpaperColor1),
        wallpaperColor2: safeColor(source.wallpaperColor2, DEFAULTS.wallpaperColor2),
        wallpaperAngle: Math.round(pickNumber('wallpaperAngle', 0, 360)),
        wallpaperImage: typeof source.wallpaperImage === 'string' ? source.wallpaperImage : '',
        wallpaperImagePosX: Math.round(pickNumber('wallpaperImagePosX', 0, 100)),
        wallpaperImagePosY: Math.round(pickNumber('wallpaperImagePosY', 0, 100)),
        wallpaperImageScale: Math.round(pickNumber('wallpaperImageScale', 100, 250)),
        wallpaperDim: Math.round(pickNumber('wallpaperDim', 0, 80)),
        wallpaperBlur: Math.round(pickNumber('wallpaperBlur', 0, 40)),
        chatColor: safeColor(source.chatColor, DEFAULTS.chatColor),
        chatOpacity: Math.round(pickNumber('chatOpacity', 0, 100)),
        chatFrost: Math.round(pickNumber('chatFrost', 0, 40)),
        filesColor: safeColor(source.filesColor, DEFAULTS.filesColor),
        filesOpacity: Math.round(pickNumber('filesOpacity', 0, 100)),
        filesFrost: Math.round(pickNumber('filesFrost', 0, 40)),
        filesFollowSidebar: source.filesFollowSidebar !== false,
        sidebarColor: safeColor(source.sidebarColor, DEFAULTS.sidebarColor),
        sidebarOpacity: Math.round(pickNumber('sidebarOpacity', 0, 100)),
        sidebarFrost: Math.round(pickNumber('sidebarFrost', 0, 40)),
        composerColor: safeColor(source.composerColor, DEFAULTS.composerColor),
        composerOpacity: Math.round(pickNumber('composerOpacity', 0, 100)),
        composerFrost: Math.round(pickNumber('composerFrost', 0, 40)),
        accentColor: safeColor(source.accentColor, DEFAULTS.accentColor),
        overlayOpacity: Math.round(pickNumber('overlayOpacity', 0, 100)),
        frostBlur: Math.round(pickNumber('frostBlur', 0, 40)),
        overlayFrost: Math.round(pickNumber('overlayFrost', 0, 40)),
        fontColor: typeof source.fontColor === 'string' && isColor(source.fontColor) ? source.fontColor : '',
        autoContrast: source.autoContrast !== false,
        heroTitle: typeof source.heroTitle === 'string' ? source.heroTitle.slice(0, 120) : '',
        heroBadge: typeof source.heroBadge === 'string' ? source.heroBadge.slice(0, 40) : '',
        heroColor: typeof source.heroColor === 'string' && isColor(source.heroColor) ? source.heroColor : '',
        heroIcon: typeof source.heroIcon === 'string' ? source.heroIcon : '',
      }
    }

    /** 配置状态中心：对外只暴露 get / set / subscribe。 */
    class SkinStore {
      constructor () {
        this.listeners = new Set()
        this.pending = {}
        this.local = readLocal()
        this.durable = normalize({ ...DEFAULTS, ...(this.local || {}) })
        this.state = this.durable
        this.form = null
        this.flushTimer = null
        this.frame = 0
      }

      /** @returns {object} 当前生效配置（稳定引用直到下一次变更）。 */
      get () {
        return this.state
      }

      /** @param {() => void} listener - 变更回调。@returns {() => void} 取消订阅。 */
      subscribe (listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      }

      /** 挂上 Host 设置表单；返回卸载函数。 */
      attach (form) {
        this.form = form
        const off = form.subscribe(() => { this.syncFromForm() })
        this.syncFromForm()
        return () => {
          if (this.form === form) this.form = null
          off()
        }
      }

      /** 从 Host 设置镜像拉取已接受的配置。 */
      syncFromForm () {
        const form = this.form
        if (!form) return
        let snapshot
        try {
          snapshot = form.getSnapshot()
        } catch {
          return
        }
        if (!snapshot || snapshot.value === undefined) return
        this.durable = normalize({ ...DEFAULTS, ...snapshot.value })
        this.rebuild()
      }

      /** 乐观更新若干字段，随后延迟写回。 */
      set (patch) {
        if (!patch || typeof patch !== 'object') return
        this.pending = { ...this.pending, ...patch }
        this.rebuild()
        if (this.flushTimer !== null) clearTimeout(this.flushTimer)
        this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush() }, 160)
      }

      /** 立刻写回挂起字段（组件卸载/页面隐藏时调用）。 */
      flush () {
        if (this.flushTimer !== null) {
          clearTimeout(this.flushTimer)
          this.flushTimer = null
        }
        const patch = this.pending
        this.pending = {}
        const keys = Object.keys(patch)
        if (keys.length === 0) return
        const form = this.form
        let snapshot
        try {
          snapshot = form ? form.getSnapshot() : undefined
        } catch {
          snapshot = undefined
        }
        const writable = form && snapshot && snapshot.value !== undefined && snapshot.writable !== false
        if (writable) {
          const ops = keys.map(key => ({ op: 'set', path: [key], value: patch[key] }))
          form.mutate(ops).then((ok) => {
            if (!ok) this.syncFromForm()
          }).catch(() => { this.syncFromForm() })
          return
        }
        // 没有可写的 Host 设置：退化为浏览器存储，并让内存里的持久层跟上。
        this.durable = normalize({ ...this.durable, ...patch })
        this.local = { ...(this.local || {}), ...patch }
        writeLocal(this.local)
      }

      rebuild () {
        this.state = normalize({ ...this.durable, ...this.pending })
        if (this.frame !== 0) return
        this.frame = requestAnimationFrame(() => {
          this.frame = 0
          for (const listener of this.listeners) {
            try {
              listener()
            } catch (error) {
              console.error('[dsh-ui-skin] listener failed', error)
            }
          }
        })
      }
    }

    // =====================================================================
    // 样式生成
    // =====================================================================

    /**
     * 壁纸走 CSS 变量而不是拼进 <style> 文本：图片 data URL 可能有几百 KB，
     * 每次拖动滑块都重建这段字符串会明显卡顿。变量只改一次 html 的行内属性。
     */
    const WALLPAPER_VARS = {
      image: '--dshui-skin-wallpaper-image',
      color: '--dshui-skin-wallpaper-color',
      blur: '--dshui-skin-wallpaper-blur',
      dim: '--dshui-skin-wallpaper-dim',
      spread: '--dshui-skin-wallpaper-spread',
      size: '--dshui-skin-wallpaper-size',
      position: '--dshui-skin-wallpaper-position',
    }

    function wallpaperValues (cfg) {
      const blur = clamp(cfg.wallpaperBlur, 0, 40)
      const spread = blur > 0 ? Math.ceil(blur * 1.7) : 0
      let image = 'none'
      let color = 'transparent'
      if (cfg.wallpaperMode === 'gradient') {
        image = `linear-gradient(${Math.round(cfg.wallpaperAngle)}deg, ${safeColor(cfg.wallpaperColor1, DEFAULTS.wallpaperColor1)} 0%, ${safeColor(cfg.wallpaperColor2, DEFAULTS.wallpaperColor2)} 100%)`
      } else if (cfg.wallpaperMode === 'solid') {
        color = safeColor(cfg.wallpaperColor1, DEFAULTS.wallpaperColor1)
      } else if (cfg.wallpaperMode === 'image' && cfg.wallpaperImage) {
        image = `url("${cfg.wallpaperImage}")`
      }
      const dim = clamp(cfg.wallpaperDim, 0, 80) / 100
      return {
        image,
        color,
        blur: `${blur}px`,
        dim: `rgba(0, 0, 0, ${Math.round(dim * 1000) / 1000})`,
        spread: `${-spread}px`,
        size: 'cover',
        position: 'center',
      }
    }

    /**
     * 按「cover 之后再乘缩放」计算图片壁纸的实际像素尺寸与位置，返回给 CSS。
     * 用像素尺寸而不是百分比尺寸，是因为 background-position 的百分比在
     * 「刚好盖住窗口」和「放大后」两种情况下含义不同，用像素才能让拖动可预期。
     */
    function wallpaperImageGeometry (cfg, info, viewportWidth, viewportHeight) {
      if (!info || !info.width || !info.height) return { size: 'cover', position: 'center' }
      const scale = clamp(cfg.wallpaperImageScale, 100, 250) / 100
      const cover = Math.max(viewportWidth / info.width, viewportHeight / info.height) * scale
      const drawnWidth = info.width * cover
      const drawnHeight = info.height * cover
      return {
        size: `${Math.round(drawnWidth)}px ${Math.round(drawnHeight)}px`,
        position: `${Math.round(clamp(cfg.wallpaperImagePosX, 0, 100))}% ${Math.round(clamp(cfg.wallpaperImagePosY, 0, 100))}%`,
      }
    }

    /**
     * 采样图片壁纸：平均色（16×16 缩略图，忽略全透明像素）+ 原始尺寸。
     * 平均色给「自动可读」估算对比度；尺寸给图片定位/缩放计算。
     */
    function sampleImageInfo (dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = 16
            canvas.height = 16
            const context = canvas.getContext('2d')
            if (!context) throw new Error('no 2d context')
            context.drawImage(image, 0, 0, 16, 16)
            const data = context.getImageData(0, 0, 16, 16).data
            let r = 0
            let g = 0
            let b = 0
            let weight = 0
            for (let i = 0; i < data.length; i += 4) {
              const alpha = data[i + 3] / 255
              r += data[i] * alpha
              g += data[i + 1] * alpha
              b += data[i + 2] * alpha
              weight += alpha
            }
            const k = weight || 1
            resolve({
              rgb: { r: r / k, g: g / k, b: b / k },
              width: image.naturalWidth || image.width,
              height: image.naturalHeight || image.height,
            })
          } catch (error) {
            reject(error)
          }
        }
        image.onerror = () => reject(new Error('wallpaper image decode failed'))
        image.src = dataUrl
      })
    }

    function wallpaperCss (cfg) {
      const none = cfg.wallpaperMode === 'none'
        ? "html[data-dshui-skin-wallpaper='none']::before,\nhtml[data-dshui-skin-wallpaper='none']::after { content: none; }\n"
        : ''
      return `${none}html::before {
  content: '';
  position: fixed;
  inset: var(${WALLPAPER_VARS.spread}, 0px);
  z-index: -2;
  pointer-events: none;
  background-color: var(${WALLPAPER_VARS.color}, transparent);
  background-image: var(${WALLPAPER_VARS.image}, none);
  background-size: var(${WALLPAPER_VARS.size}, cover);
  background-position: var(${WALLPAPER_VARS.position}, center);
  background-repeat: no-repeat;
  filter: blur(var(${WALLPAPER_VARS.blur}, 0px));
}
html::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-color: var(${WALLPAPER_VARS.dim}, rgba(0, 0, 0, 0));
}`
    }

    /** 弹层（对话框 / 菜单 / portal 卡片）里要透明的表面 token。 */
    const OVERLAY_TOKENS = [
      ['--dsw-alias-bg-module-platform', 0.07],
      ['--dsw-alias-bg-layer-1', 0.05],
      ['--dsw-alias-bg-layer-2', 0.09],
      ['--dsw-alias-bg-layer-3', 0.13],
      ['--dsw-alias-bg-overlay', 0.09],
      ['--dsw-alias-card-fill', 0.04],
      ['--dsw-alias-card-fill-hover', 0.07],
      ['--dsw-alias-card-tile-fill', 0.03],
      ['--dsw-alias-markdown-code-block', 0.06],
      ['--dsw-alias-markdown-inline-code', 0.1],
      ['--dsw-specific-bubble', 0.07],
      ['--dsw-specific-menu', 0.1],
      ['--dsw-specific-selector', 0.07],
    ]

    /** 一行 CSS 自定义属性声明。 */
    function declarations (entries) {
      return entries.map(([name, value]) => `  ${name}: ${value};`).join('\n')
    }

    /**
     * 某个区域的作用域 token。
     *
     * 关键教训：DSH 里同一个 token（尤其 bg-layer-1）会被页面、表格、单元格逐层重绘，
     * 如果每层都给同一个 alpha，叠三四层就几乎全实（轨迹页实测 4 层 → 0.9938）。
     * 因此：
     *  - 该区域的「底色」由列本身画唯一一层，列内 bg-base / layer-1..3 一律透明；
     *  - 但 bg-overlay / bg-module-platform 要留给「页面内的浮层、粘性标题条」用——
     *    不能透明，否则底下的滚动内容会直接穿上来（插件页标题重影、引用浮层透字）。
     *    这两档按弹层色/弹层不透明度给。
     *  - 卡片、代码块、气泡这些「不是铺满的」表面给一个较低的同色 alpha（subtle）。
     */
    function areaDeclarations (color, alpha, overlay, layers) {
      const dark = luminance(color) < 0.5
      const subtle = Math.min(0.5, Math.round(alpha * 0.45 * 1000) / 1000)
      const entries = [
        ['--dsw-alias-bg-base', 'transparent'],
        ['--dsw-specific-sidebar-fill', 'transparent'],
        ['--dsw-alias-bg-layer-1', 'transparent'],
        ['--dsw-alias-bg-layer-2', 'transparent'],
        ['--dsw-alias-bg-layer-3', 'transparent'],
      ]
      if (overlay) {
        const overlayFill = withAlpha(overlay.color, overlay.alpha)
        entries.push(['--dsw-alias-bg-overlay', overlayFill])
        entries.push(['--dsw-alias-bg-module-platform', overlayFill])
        entries.push(['--dsw-specific-menu', overlayFill])
        // 对话区里的「浮层卡片」（轮次导航预览、引用卡等）用 layer 系 token 画底；
        // 这里给它们一档弹层玻璃，否则会完全透明、底下文字穿上来。
        if (layers) {
          const layerFill = withAlpha(overlay.color, clamp(overlay.alpha, 0.45, 0.98))
          entries.push(['--dsw-alias-bg-layer-1', layerFill])
          entries.push(['--dsw-alias-bg-layer-2', layerFill])
          entries.push(['--dsw-alias-bg-layer-3', layerFill])
        }
      } else {
        entries.push(['--dsw-alias-bg-overlay', 'transparent'])
        entries.push(['--dsw-alias-bg-module-platform', 'transparent'])
      }
      const subtleTokens = [
        ['--dsw-alias-card-fill', 0.06],
        ['--dsw-alias-card-fill-hover', 0.12],
        ['--dsw-alias-card-tile-fill', 0.04],
        ['--dsw-alias-markdown-code-block', 0.1],
        ['--dsw-alias-markdown-code-block-banner', 0.14],
        ['--dsw-alias-markdown-inline-code', 0.16],
        ['--dsw-specific-bubble', 0.12],
        ['--dsw-specific-bubble-highlight', 0.08],
        ['--dsw-specific-selector', 0.12],
        ['--dsw-specific-tip', 0.1],
        ['--dsw-specific-guide-hero', 0.04],
        ['--dsw-specific-sidebar-nav-item-active', 0.14],
        ['--dsw-alias-button-elevated-fill', 0.2],
        ['--dsw-alias-button-floating-fill', 0.14],
        ['--dsw-alias-button-floating-hover', 0.2],
        ['--dsw-alias-interactive-bg-hover-solid', 0.12],
      ]
      for (const [name, amount] of subtleTokens) {
        entries.push([name, withAlpha(tintColor(color, dark ? amount : -amount), subtle)])
      }
      return declarations(entries)
    }

    function overlayColorOf (variant) {
      return tintColor(variant, luminance(variant) < 0.5 ? 0.02 : -0.02)
    }

    /**
     * 把用户配置 + 当前主题 + 壁纸平均色解析成「每个区域实际用的颜色/不透明度」。
     * 纯函数；壁纸平均色由控制器采样后传进来。
     * @returns 解析结果，供 CSS 与 token 生成共用
     */
    function resolveSkin (cfg, scheme, wallpaperRgb) {
      const wall = blendRgb(
        wallpaperRgb || (scheme === 'dark' ? { r: 21, g: 21, b: 23 } : { r: 249, g: 250, b: 251 }),
        { r: 0, g: 0, b: 0 },
        clamp(cfg.wallpaperDim, 0, 80) / 100,
      )
      const textAuto = scheme === 'dark' ? '#f9fafb' : '#0f1115'
      const customText = isColor(cfg.fontColor)
      const text = customText ? cfg.fontColor : textAuto
      const area = (color, opacity, fallback) => {
        const variants = surfaceVariants(color, fallback)
        const base = scheme === 'dark' ? variants.dark : variants.light
        let alpha = clamp(opacity, 0, 100) / 100
        if (cfg.autoContrast) alpha = ensureReadable(alpha, base, wall, text)
        return { color: base, alpha }
      }
      const chat = area(cfg.chatColor, cfg.chatOpacity, DEFAULTS.chatColor)
      const files = area(cfg.filesColor, cfg.filesOpacity, DEFAULTS.filesColor)
      const sidebar = area(cfg.sidebarColor, cfg.sidebarOpacity, DEFAULTS.sidebarColor)
      // 右栏可以直接沿用左栏配色（用户要求「右侧展开栏和左侧工作文件夹区一样」）。
      if (cfg.filesFollowSidebar) {
        files.color = sidebar.color
        files.alpha = sidebar.alpha
      }
      const composer = area(cfg.composerColor, cfg.composerOpacity, DEFAULTS.composerColor)
      const chatVariant = surfaceVariants(cfg.chatColor, DEFAULTS.chatColor)[scheme]
      const overlayBase = overlayColorOf(chatVariant)
      let overlayAlpha = clamp(cfg.overlayOpacity, 0, 100) / 100
      if (cfg.autoContrast) {
        // 对话框后面通常还有半透明遮罩，按「遮罩之后的背景」估算可读性
        overlayAlpha = ensureReadable(overlayAlpha, overlayBase, blendRgb(wall, { r: 0, g: 0, b: 0 }, 0.5), text)
      }
      // 开磨砂时把对话框底色调薄一点，否则 88% 不透明度看不出模糊。
      if (cfg.frostBlur > 0) overlayAlpha = clamp(overlayAlpha * 0.85, 0.5, 1)
      return {
        scheme,
        wall,
        text,
        customText,
        chat,
        files,
        sidebar,
        composer,
        overlay: { color: overlayBase, alpha: overlayAlpha },
      }
    }

    /**
     * 生成整段皮肤 CSS：壁纸层、body/frame 透明、三列各自的玻璃层与作用域 token。
     * light/dark 是 resolveSkin 的两套结果（自定义属性按 body[data-ds-dark-theme] 切换）。
     */
    /**
     * 磨砂玻璃：只作用于用户指定的四处——左右侧栏、对话框、底部输入框。
     * 刻意不做「所有卡片都磨」的大范围 backdrop-filter：那种大量模糊层在部分机器上会把渲染搞挂。
     *
     * 侧栏/右栏不能把 backdrop-filter 直接加在容器上：它会成为 position:fixed 后代的包含块，
     * 把 DSH 里浮动的「收起侧边栏」按钮之类的定位搞飘。改用 ::before 独立图层来模糊。
     */
    /**
     * 磨砂声明：用 CSS 变量，让每个部位可以单独调强度。
     * 变量由控制器写到 html 上（--dshui-frost-<area>）；0px 等于关闭。
     */
    function frostDeclarations (cfg, key) {
      const name = `--dshui-frost-${key || 'overlayFrost'}`
      return `\n  backdrop-filter: blur(var(${name}, 0px));\n  -webkit-backdrop-filter: blur(var(${name}, 0px));`
    }

    function buildCss (cfg, light, dark) {
      const rules = []
      const glass = (state, key) => withAlpha(state[key].color, state[key].alpha)
      const frost = frostDeclarations(cfg, 'overlayFrost')
      const sidebarFrost = frostDeclarations(cfg, 'sidebarFrost')
      const filesFrost = frostDeclarations(cfg, 'filesFrost')
      const chatFrost = frostDeclarations(cfg, 'chatFrost')
      const composerFrost = frostDeclarations(cfg, 'composerFrost')
      // 左列 / 中列：列本身画唯一一层玻璃，内部表面 token 见 areaDeclarations。
      for (const [mark, key] of [['center', 'chat'], ['sidebar', 'sidebar']]) {
        const layers = mark === 'center'
        rules.push(`html [${MARK}='${mark}'] {\n  background-color: ${glass(light, key)};\n${areaDeclarations(light[key].color, light[key].alpha, light.overlay, layers)}\n}`)
        rules.push(`html body[data-ds-dark-theme] [${MARK}='${mark}'] {\n  background-color: ${glass(dark, key)};\n${areaDeclarations(dark[key].color, dark[key].alpha, dark.overlay, layers)}\n}`)
      }
      // 页面视图（插件页/统计页等，页头带 _pageBar）把中列背后也磨砂；
      // 对话视图没有 _pageBar，保持清晰（用户要求对话背景不要整窗磨砂）。
      if (frost) {
        rules.push(`html [${MARK}='center'] {
  position: relative;
  isolation: isolate;
}`)
        rules.push(`html [${MARK}='center']::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}`)
        rules.push(`html [${MARK}='center']:has([class*='_pageBar'])::before {${chatFrost}\n}`)
      }
      // 磨砂图层的公共写法：独立 ::before，避免改掉容器的 fixed 包含块。
      if (frost) {
        rules.push(`html [${MARK}='sidebar'] {\n  position: relative;\n  isolation: isolate;\n}`)
        rules.push(`html [${MARK}='sidebar']::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  pointer-events: none;${sidebarFrost}\n}`)
      }
      // 右列是 0 宽的轨道（面板挂在上面），画列没用；由 dockkit 容器画一层玻璃。
      for (const [mode, state] of [['', light], ['body[data-ds-dark-theme] ', dark]]) {
        rules.push(`html ${mode}[${MARK}='rightbar'] {\n${areaDeclarations(state.files.color, state.files.alpha, state.overlay)}\n}`)
        rules.push(`html ${mode}[${MARK}='rightbar'] [data-dockkit-host],
html ${mode}[${MARK}='rightbar'] [data-dockkit-float] {
  background-color: ${glass(state, 'files')};
}`)
      }
      // 窗口最上面的「应用/编辑」标题条（Windows 的 titlebar 区域）：也要磨砂。
      // 不能把 backdrop-filter 加在 frame 容器上（会再次把 fixed 后代带偏），
      // 只加在标题条自身/它的 ::before 绘制层上。
      if (frost) {
        rules.push(`html [data-windows-titlebar],
html [${MARK}='frame']::before {${sidebarFrost}
}`)
      }
      // 页面视图（插件页/统计页等，页头带 _pageBar）：
      // 整块页面直接用「弹层与菜单」的底色 + 不透明度（和对话框同款），再叠加磨砂；
      // 这样页头、页体是同一块玻璃，不会出现"标题一条实心色带、下面透壁纸"的割裂。
      if (frost) {
        for (const [mode, state] of [['', light], ['body[data-ds-dark-theme] ', dark]]) {
          rules.push(`html ${mode}[${MARK}='center']:has([class*='_pageBar']) {
  background-color: ${withAlpha(state.overlay.color, state.overlay.alpha)};
}`)
        }
      }
      // 页面内的粘性标题条（插件页/设置页等）默认透明，滚动内容会穿上来重影。
      // 颜色/不透明度跟「弹层与菜单」一致，叠在页面玻璃上只多一点点，不会割裂。
      for (const [mode, state] of [['', light], ['body[data-ds-dark-theme] ', dark]]) {
        rules.push(`html ${mode}[class*='_pageBar'],
html ${mode}[class*='_pageHead'] {
  background-color: ${withAlpha(state.overlay.color, clamp(state.overlay.alpha * 0.55, 0.2, 0.9))};${frost}
}`)
      }
      // DSH 的「菜单/浮层」用 data-trigger-menu + data-menu-material 标记，但背景是空的
      // （靠调用方补），所以指令面板、轮次预览这类 popover 会透明透字。这里统一补一层玻璃底 + 磨砂。
      if (frost) {
        for (const [mode, state] of [['', light], ['body[data-ds-dark-theme] ', dark]]) {
          const fill = withAlpha(state.overlay.color, clamp(state.overlay.alpha, 0.55, 0.98))
          rules.push(`html ${mode}[data-trigger-menu][data-menu-material] {
  background-color: ${fill};${frost}
}`)
        }
      }
      // 浮动小面板（选中文字工具条/上下文菜单/预览卡）：统一补玻璃底 + 磨砂。
      for (const [mode, state] of [['', light], ['body[data-ds-dark-theme] ', dark]]) {
        rules.push(`html ${mode}[${GLASS_SURFACE}] {
  border-radius: 12px;
  background-color: ${withAlpha(state.overlay.color, clamp(state.overlay.alpha, 0.6, 0.99))};${frost}
}`)
      }
      // body 下的浮层容器（指令面板/引用卡/Toast）：把内部的「层」token 换成弹层玻璃，      // 这样它们自带的背景不再透明，底下文字不会穿出来。
      for (const [mode, state] of [['', light], ['body[data-ds-dark-theme] ', dark]]) {
        const fill = withAlpha(state.overlay.color, clamp(state.overlay.alpha, 0.45, 0.98))
        rules.push(`html ${mode}[${GLASS_ROOT}] {
  --dsw-alias-bg-layer-1: ${fill};
  --dsw-alias-bg-layer-2: ${fill};
  --dsw-alias-bg-layer-3: ${fill};
  --dsw-alias-bg-overlay: ${fill};
  --dsw-specific-menu: ${fill};
  --dsw-specific-selector: ${fill};
}`)
      }
      if (frost) {
        rules.push(`html [${MARK}='rightbar'] [data-dockkit-host],
html [${MARK}='rightbar'] [data-dockkit-float] {
  position: relative;
  isolation: isolate;
}`)
        rules.push(`html [${MARK}='rightbar'] [data-dockkit-host]::before,
html [${MARK}='rightbar'] [data-dockkit-float]::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;${filesFrost}
}`)
      }
      // 对话框 / 底部输入框：
      // - 对话框也不能直接把 backdrop-filter 加在元素上（否则里面 position:fixed 的色盘弹层会被
      //   当成相对对话框定位，飘到屏幕外）。改成 ::before 图层（dialog 自身是 fixed/堆叠上下文，无需再定位）。
      // - 底部输入区的 data-slot 是 display:contents，加滤镜无效；真正要磨的是卡片和底部统计条。
      if (frost) {
        rules.push(`html [role='dialog']::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;${frost}
}`)
        rules.push(`html [data-slot='conversation.composer'] [class$='_card'] {${composerFrost}\n}`)
        // 输入区里的引用/附件小卡片：给它们自己的玻璃底，别让对话文字从底下穿出来。
        rules.push(`html [data-slot='conversation.composer'] [class*='_quote'],
html [data-slot='conversation.composer'] [class*='_chip'],
html [data-slot='conversation.composer'] [class*='_refChip'] {
  border-radius: 12px;
  background-color: ${withAlpha(light.overlay.color, clamp(light.overlay.alpha, 0.4, 0.95))};${composerFrost}
}`)
        rules.push(`html body[data-ds-dark-theme] [data-slot='conversation.composer'] [class*='_quote'],
html body[data-ds-dark-theme] [data-slot='conversation.composer'] [class*='_chip'],
html body[data-ds-dark-theme] [data-slot='conversation.composer'] [class*='_refChip'] {
  background-color: ${withAlpha(dark.overlay.color, clamp(dark.overlay.alpha, 0.4, 0.95))};
}`)
        rules.push(`html [data-composer-dock] {
  border-radius: 12px;
  background-color: ${glass(light, 'composer')};${composerFrost}
}`)
        rules.push(`html body[data-ds-dark-theme] [data-composer-dock] {
  background-color: ${glass(dark, 'composer')};
}`)
      }
      // Windows 桌面：DSH 只给内容区左上角 16px 圆角；皮肤铺满壁纸后那个缺口会显脏，统一拍平。
      rules.push(`html [${MARK}='center'],
html body[data-ds-dark-theme] [${MARK}='center'] { border-radius: 0 !important; }`)
      // 窗口标题条（Windows）用 sidebar-fill 画，跟着左侧栏一起透明。
      rules.push(`html [${MARK}='frame'] {\n  background-color: transparent !important;\n  --dsw-specific-sidebar-fill: ${glass(light, 'sidebar')};\n}`)
      rules.push(`html body[data-ds-dark-theme] [${MARK}='frame'] {\n  background-color: transparent !important;\n  --dsw-specific-sidebar-fill: ${glass(dark, 'sidebar')};\n}`)
      return `
/* dsh-ui-skin: base layers */
html > body,
html > body[data-ds-dark-theme] {
  background-color: transparent !important;
}

/* dsh-ui-skin: per-column glass + scoped tokens */
${rules.join('\n\n')}

/* dsh-ui-skin: wallpaper */
${wallpaperCss(cfg)}
`
    }

    /**
     * 全局 token 覆盖层（body 行内）：负责 portal 出去的弹层、输入卡片、强调色和文字颜色。
     * 每个 token 必须给 { light, dark } 一对值。
     */
    function overlayValues (state) {
      const color = state.overlay.color
      const dark = luminance(color) < 0.5
      const values = { '--dsw-alias-bg-base': withAlpha(color, state.overlay.alpha) }
      for (const [name, amount] of OVERLAY_TOKENS) {
        values[name] = withAlpha(tintColor(color, dark ? amount : -amount), state.overlay.alpha)
      }
      return values
    }

    function buildTokenLayer (cfg, light, dark) {
      const tokens = {}
      const lightOverlay = overlayValues(light)
      const darkOverlay = overlayValues(dark)
      for (const name of Object.keys(lightOverlay)) {
        tokens[name] = { light: lightOverlay[name], dark: darkOverlay[name] }
      }
      tokens['--dsw-specific-sidebar-fill'] = {
        light: withAlpha(light.sidebar.color, light.sidebar.alpha),
        dark: withAlpha(dark.sidebar.color, dark.sidebar.alpha),
      }
      tokens['--dsw-specific-input-major'] = {
        light: withAlpha(light.composer.color, light.composer.alpha),
        dark: withAlpha(dark.composer.color, dark.composer.alpha),
      }
      // 强调色只碰「交互元素」：发送/信息按钮、链接、焦点环、选中描边。
      // 不再覆盖 state-business-primary —— 那是语义色（文件类型图标、时间线等也在用）。
      const accent = safeColor(cfg.accentColor, DEFAULTS.accentColor)
      const accentLightHover = mixHex(accent, '#000000', 0.14)
      const accentDarkHover = mixHex(accent, '#ffffff', 0.2)
      tokens['--dsw-alias-button-info-fill'] = { light: accent, dark: accent }
      tokens['--dsw-alias-button-info-hover'] = { light: accentLightHover, dark: accentDarkHover }
      tokens['--dsw-alias-link'] = { light: accent, dark: accent }
      tokens['--dsw-focus-ring-color'] = { light: accent, dark: accent }
      tokens['--dsw-alias-border-selected'] = { light: accent, dark: accent }
      // 设置页左侧导航的选中底色也用强调色（用户要求「设置左选项选中也应用强调色」）。
      tokens['--dsw-specific-sidebar-nav-item-active'] = {
        light: withAlpha(accent, 0.2),
        dark: withAlpha(accent, 0.26),
      }
      // 自定义文字颜色（空 = 跟随主题）
      if (light.customText) {
        tokens['--dsw-alias-label-primary'] = { light: light.text, dark: dark.text }
        tokens['--dsw-alias-label-secondary'] = { light: withAlpha(light.text, 0.72), dark: withAlpha(dark.text, 0.72) }
        tokens['--dsw-alias-label-tertiary'] = { light: withAlpha(light.text, 0.78), dark: withAlpha(dark.text, 0.78) }
        tokens['--dsw-alias-label-caption'] = { light: withAlpha(light.text, 0.55), dark: withAlpha(dark.text, 0.55) }
        tokens['--dsw-alias-label-dimmed'] = { light: withAlpha(light.text, 0.4), dark: withAlpha(dark.text, 0.4) }
      }
      return tokens
    }

    // =====================================================================
    // 首页标题补丁（唯一的 DOM 改动，严格限定在 blank home 内）
    // =====================================================================
    class HeroSync {
      constructor (getConfig) {
        this.getConfig = getConfig
        this.observer = null
        this.frame = 0
        this.titleEl = null
        this.badgeEl = null
        this.groupEl = null
        this.originalTitle = null
        this.originalBadge = null
        this.savedGroupStyle = null
        this.savedBadgeStyle = null
      }

      /** 只有真的自定义了首页内容时才挂观察器；否则完全不动 DOM。 */
      setActive (active) {
        if (active) {
          if (this.observer) return
          if (!document.body) return
          this.observer = new MutationObserver(() => this.schedule())
          this.observer.observe(document.body, { childList: true, subtree: true, characterData: true })
          this.sync()
          return
        }
        this.stop()
      }

      stop () {
        if (this.observer) {
          this.observer.disconnect()
          this.observer = null
        }
        if (this.frame !== 0) {
          cancelAnimationFrame(this.frame)
          this.frame = 0
        }
        this.restore()
      }

      schedule () {
        if (this.frame !== 0) return
        this.frame = requestAnimationFrame(() => {
          this.frame = 0
          this.sync()
        })
      }

      /**
       * 按结构定位首页的「大标题 + 徽标」两个 span：
       * 父 span 恰好两个纯文本 span 子节点，且第一个字号 >= 18px。
       * 不依赖 CSS Module 类名，也不依赖任何语言的默认文案。
       * @param {Element} hero - blank home 的对话容器。
       * @returns {{group: Element, title: Element, badge: Element} | null}
       */
      find (hero) {
        const candidates = hero.querySelectorAll('span')
        for (const candidate of candidates) {
          if (candidate.children.length !== 2) continue
          const title = candidate.children[0]
          const badge = candidate.children[1]
          if (title.tagName !== 'SPAN' || badge.tagName !== 'SPAN') continue
          if (title.children.length !== 0 || badge.children.length !== 0) continue
          const size = Number.parseFloat(getComputedStyle(title).fontSize) || 0
          if (size < 18) continue
          return { group: candidate, title, badge }
        }
        return null
      }

      /** 把已经改过的节点恢复成宿主原本的文字/颜色。 */
      restore () {
        if (this.titleEl && this.titleEl.isConnected && this.originalTitle !== null
          && this.titleEl.textContent !== this.originalTitle) {
          this.titleEl.textContent = this.originalTitle
        }
        if (this.badgeEl && this.badgeEl.isConnected && this.originalBadge !== null
          && this.badgeEl.textContent !== this.originalBadge) {
          this.badgeEl.textContent = this.originalBadge
        }
        if (this.groupEl && this.groupEl.isConnected && this.savedGroupStyle !== null) {
          this.groupEl.setAttribute('style', this.savedGroupStyle)
        }
        if (this.badgeEl && this.badgeEl.isConnected && this.savedBadgeStyle !== null) {
          this.badgeEl.setAttribute('style', this.savedBadgeStyle)
        }
        this.titleEl = null
        this.badgeEl = null
        this.groupEl = null
        this.originalTitle = null
        this.originalBadge = null
        this.savedGroupStyle = null
        this.savedBadgeStyle = null
      }

      sync () {
        const config = this.getConfig()
        if (!config.enabled) return
        const hero = document.querySelector('[data-conversation-content][data-content-phase="hero"]')
        if (!hero) {
          this.restore()
          return
        }
        const found = this.find(hero)
        if (!found) return
        const wantTitle = config.heroTitle || ''
        const wantBadge = config.heroBadge || ''
        const wantColor = config.heroColor || ''
        if (this.titleEl !== found.title) {
          this.titleEl = found.title
          this.badgeEl = found.badge
          this.groupEl = found.group
          this.originalTitle = found.title.textContent
          this.originalBadge = found.badge.textContent
          this.savedGroupStyle = null
          this.savedBadgeStyle = null
        }
        const nextTitle = wantTitle || this.originalTitle || ''
        const nextBadge = wantBadge || this.originalBadge || ''
        if (nextTitle !== '' && this.titleEl.textContent !== nextTitle) this.titleEl.textContent = nextTitle
        if (nextBadge !== '' && this.badgeEl.textContent !== nextBadge) this.badgeEl.textContent = nextBadge
        if (this.savedGroupStyle === null) this.savedGroupStyle = this.groupEl.getAttribute('style') || ''
        if (wantColor) {
          if (this.groupEl.style.color !== wantColor) this.groupEl.style.setProperty('color', wantColor)
        } else if (this.groupEl.style.color) {
          this.groupEl.style.removeProperty('color')
        }
        if (this.savedBadgeStyle === null) this.savedBadgeStyle = this.badgeEl.getAttribute('style') || ''
        if (wantColor) {
          if (this.badgeEl.style.color !== wantColor) this.badgeEl.style.setProperty('color', wantColor)
        } else if (this.badgeEl.style.color) {
          this.badgeEl.style.removeProperty('color')
        }
      }
    }

    // =====================================================================
    // 皮肤控制器：把 store 状态落到样式 / token / 列标记 / 首页
    // =====================================================================

    /** 当前插件实例的 store；设置页组件作为兜底读取（inject face 异常时也不会空白）。 */
    let sharedStore = null

    class SkinController {
      constructor (ctx, store) {
        this.ctx = ctx
        this.store = store
        this.styleEl = null
        this.pageStyleEl = null
        this.tokenDispose = null
        this.marks = { frame: null, sidebar: null, center: null, rightbar: null }
        this.observer = null
        this.markFrame = 0
        this.disposed = false
        this.theme = null
        this.brandInject = null
        this.brandIcon = null
        this.tokenSignature = null
        this.wallpaperInfo = null
        this.wallpaperSampleKey = ''
        this.hero = new HeroSync(() => this.store.get())
        this.unsubscribe = null
        this.resizeFrame = 0
        this.onResize = () => {
          if (this.resizeFrame !== 0 || this.disposed) return
          this.resizeFrame = requestAnimationFrame(() => {
            this.resizeFrame = 0
            const config = this.store.get()
            if (config.enabled && config.wallpaperMode === 'image') this.applyWallpaper(config)
          })
        }
      }

      start () {
        this.disposed = false
        // 设置页样式与皮肤开关无关：关掉皮肤时「外观」页也不能裸奔。
        this.ensurePageStyle()
        window.addEventListener('resize', this.onResize)
        this.unsubscribe = this.store.subscribe(() => this.apply())
        this.apply()
        return () => this.dispose()
      }

      /** 主题服务可能比本插件晚就绪：拿到后再应用一次全局 token 覆盖。 */
      attachTheme (theme) {
        this.theme = theme || null
        this.apply()
        return () => {
          this.theme = null
          this.apply()
        }
      }

      report (error) {
        try {
          console.error('[dsh-ui-skin]', error)
          window.__dshUiSkinDebug = String((error && error.stack) || error)
        } catch {
          /* 调试输出自身不能成为故障源 */
        }
      }

      ensureStyle () {
        if (this.styleEl && this.styleEl.isConnected) return this.styleEl
        let element = document.getElementById(STYLE_ID)
        if (!element) {
          element = document.createElement('style')
          element.id = STYLE_ID
          element.setAttribute('data-plugin', 'dsh-ui-skin')
          document.head.append(element)
        }
        this.styleEl = element
        return element
      }

      /** 设置页自己的样式：与皮肤开关解耦，只在插件卸载时移除。 */
      ensurePageStyle () {
        if (this.pageStyleEl && this.pageStyleEl.isConnected) return this.pageStyleEl
        let element = document.getElementById(PAGE_STYLE_ID)
        if (!element) {
          element = document.createElement('style')
          element.id = PAGE_STYLE_ID
          element.setAttribute('data-plugin', 'dsh-ui-skin')
          document.head.append(element)
        }
        element.textContent = PAGE_CSS
        this.pageStyleEl = element
        return element
      }

      /**
       * 给 portal 到 body 的浮层容器（指令面板、引用卡片、Toast 等）打标记，
       * 让它们内部一律使用同一套「弹层玻璃」token，避免背景透明、底下文字穿上来。
       * 只处理不包含主布局列的 body 直接子节点，不改元素自身样式。
       */
      markGlassRoots () {
        if (!document.body) return
        for (const child of document.body.children) {
          if (!(child instanceof HTMLElement)) continue
          if (child.id === STYLE_ID || child.id === PAGE_STYLE_ID) continue
          if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue
          if (child.querySelector(`[${MARK}]`)) continue
          if (!child.hasAttribute(GLASS_ROOT)) child.setAttribute(GLASS_ROOT, '')
        }
        // 再扫一遍「浮动小面板」：选中文字工具条、菜单、预览卡等。
        // 这些元素常常没有自己的背景，透明后底下文字会穿上来。
        const surfaceSelector = "[role='menu'], [role='toolbar'], [role='listbox'], [role='tooltip'], [data-trigger-menu], [class*='_toolbar'], [class*='_selection'], [class*='_popover'], [class*='_menu_'], [class$='_menu']"
        for (const el of document.querySelectorAll(surfaceSelector)) {
          if (!(el instanceof HTMLElement) || el.hasAttribute(GLASS_SURFACE)) continue
          const style = getComputedStyle(el)
          if (style.position !== 'fixed' && style.position !== 'absolute') continue
          const rect = el.getBoundingClientRect()
          if (rect.width < 80 || rect.height < 20 || rect.width > window.innerWidth * 0.95) continue
          el.setAttribute(GLASS_SURFACE, '')
        }
      }

      markColumns () {
        const rightbar = document.querySelector('[data-rightbar-col]')
        if (!rightbar) return
        const frame = rightbar.parentElement
        const center = rightbar.previousElementSibling
        const sidebar = center ? center.previousElementSibling : null
        const apply = (element, key) => {
          if (!element) return
          if (element.getAttribute(MARK) !== key) element.setAttribute(MARK, key)
          this.marks[key] = element
        }
        apply(frame, 'frame')
        apply(sidebar, 'sidebar')
        apply(center, 'center')
        apply(rightbar, 'rightbar')
        this.markGlassRoots()
        if (!this.observer) {
          this.observer = new MutationObserver(() => this.scheduleMark())
          this.observer.observe(document.body, { childList: true, subtree: true })
        }
      }

      scheduleMark () {
        if (this.markFrame !== 0 || this.disposed) return
        this.markFrame = requestAnimationFrame(() => {
          this.markFrame = 0
          // 新弹出的浮层（指令面板/引用卡/对话框）也要打上弹层玻璃标记。
          this.markGlassRoots()
          const { frame, sidebar, center, rightbar } = this.marks
          if (frame && sidebar && center && rightbar
            && frame.isConnected && sidebar.isConnected && center.isConnected && rightbar.isConnected) return
          this.markColumns()
        })
      }

      apply () {
        if (this.disposed) return
        try {
          const config = this.store.get()
          if (!config.enabled) {
            this.teardown()
            return
          }
          this.updateWallpaperInfo(config)
          const wallRgb = this.wallpaperBaseRgb(config)
          const light = resolveSkin(config, 'light', wallRgb)
          const dark = resolveSkin(config, 'dark', wallRgb)
          this.ensureStyle().textContent = buildCss(config, light, dark)
          this.applyWallpaper(config)
          this.markColumns()
          this.applyTokens(config, light, dark)
          this.syncBrand(config)
          const wantHero = Boolean(config.heroTitle || config.heroBadge || config.heroColor)
          this.hero.setActive(wantHero)
          if (wantHero) this.hero.sync()
        } catch (error) {
          this.report(error)
        }
      }

      /**
       * 图片壁纸：异步采样一次平均色 + 原图尺寸，未就绪时先用中性色/cover，
       * 采样完成后重跑一次 apply。渐变/纯色是同步算的。
       */
      updateWallpaperInfo (config) {
        const dataUrl = config.wallpaperMode === 'image' ? config.wallpaperImage : ''
        if (!dataUrl) {
          this.wallpaperInfo = null
          this.wallpaperSampleKey = ''
          return
        }
        if (this.wallpaperSampleKey === dataUrl) return
        this.wallpaperSampleKey = dataUrl
        this.wallpaperInfo = null
        sampleImageInfo(dataUrl).then((info) => {
          if (this.disposed || this.wallpaperSampleKey !== dataUrl) return
          this.wallpaperInfo = info
          this.apply()
        }).catch(() => { /* 采样失败就按中性色/cover 处理 */ })
      }

      /** 壁纸的平均色（不含暗化遮罩），供自动可读性估算用。 */
      wallpaperBaseRgb (config) {
        if (config.wallpaperMode === 'solid') return hexToRgb(config.wallpaperColor1)
        if (config.wallpaperMode === 'gradient') {
          const start = hexToRgb(config.wallpaperColor1)
          const end = hexToRgb(config.wallpaperColor2)
          if (!start || !end) return null
          return { r: (start.r + end.r) / 2, g: (start.g + end.g) / 2, b: (start.b + end.b) / 2 }
        }
        if (config.wallpaperMode === 'image') return this.wallpaperInfo ? this.wallpaperInfo.rgb : null
        return null
      }

      /** 壁纸只改 html 上的几个 CSS 变量，避免每次重写巨大的 <style> 文本。 */
      applyWallpaper (config) {
        const root = document.documentElement
        if (config.wallpaperMode === 'none') root.setAttribute('data-dshui-skin-wallpaper', 'none')
        else root.removeAttribute('data-dshui-skin-wallpaper')
        const values = wallpaperValues(config)
        if (config.wallpaperMode === 'none') {
          values.image = 'none'
          values.color = 'transparent'
        }
        if (config.wallpaperMode === 'image' && this.wallpaperInfo) {
          const geometry = wallpaperImageGeometry(
            config,
            this.wallpaperInfo,
            root.clientWidth || window.innerWidth,
            root.clientHeight || window.innerHeight,
          )
          values.size = geometry.size
          values.position = geometry.position
        }
        for (const [key, name] of Object.entries(WALLPAPER_VARS)) {
          root.style.setProperty(name, values[key])
        }
        // 每个部位独立的磨砂强度（0px = 关闭）
        for (const key of ['sidebarFrost', 'filesFrost', 'chatFrost', 'composerFrost', 'overlayFrost']) {
          root.style.setProperty(`--dshui-frost-${key}`, `${Math.round(clamp(config[key], 0, 40))}px`)
        }
      }

      clearWallpaper () {
        const root = document.documentElement
        root.removeAttribute('data-dshui-skin-wallpaper')
        for (const name of Object.values(WALLPAPER_VARS)) root.style.removeProperty(name)
        this.wallpaperInfo = null
        this.wallpaperSampleKey = ''
      }

      applyTokens (config, light, dark) {
        if (!this.theme || typeof this.theme.overrideTokens !== 'function') return
        // overrideTokens 会同步 emit `theme/change`，而我们的监听器又会回写样式；
        // 先记下签名，值没变就不再调用，避免「覆盖 → 事件 → 覆盖」的死循环。
        const layer = buildTokenLayer(config, light, dark)
        const signature = JSON.stringify(layer)
        if (signature === this.tokenSignature) return
        this.tokenSignature = signature
        try {
          this.tokenDispose = this.theme.overrideTokens(THEME_LAYER, layer)
        } catch (error) {
          this.tokenSignature = null
          this.report(error)
        }
      }

      /** 自定义图标只在配置了图片时占用 `conversation.hero.brand.mark`。 */
      syncBrand (config) {
        const icon = config.heroIcon
        if (icon === this.brandIcon) return
        this.brandIcon = icon
        if (this.brandInject) {
          this.brandInject()
          this.brandInject = null
        }
        if (!icon) return
        const SELF = this
        this.brandInject = this.ctx.slots.inject('conversation.hero.brand.mark', () => this.ctx.slots.register({
          name: 'conversation.hero.brand.mark',
          id: 'dsh-ui-skin-hero-icon',
        }, function BrandMark (props) {
          const size = typeof props.size === 'number' ? props.size : 34
          return h('img', {
            src: SELF.brandIcon,
            width: size,
            height: size,
            alt: '',
            className: props.className,
            style: { objectFit: 'contain', display: 'block' },
          })
        }))
      }

      teardown () {
        this.clearWallpaper()
        if (this.styleEl) {
          this.styleEl.remove()
          this.styleEl = null
        }
        if (this.tokenDispose) {
          try {
            this.tokenDispose()
          } catch {
            /* 层可能已被同源重注册替换 */
          }
          this.tokenDispose = null
          this.tokenSignature = null
        }
        for (const key of Object.keys(this.marks)) {
          const element = this.marks[key]
          if (element) element.removeAttribute(MARK)
          this.marks[key] = null
        }
        for (const element of document.querySelectorAll(`[${GLASS_ROOT}]`)) element.removeAttribute(GLASS_ROOT)
        for (const element of document.querySelectorAll(`[${GLASS_SURFACE}]`)) element.removeAttribute(GLASS_SURFACE)
        for (const element of document.querySelectorAll(`[${GLASS_SURFACE}]`)) element.removeAttribute(GLASS_SURFACE)
        if (this.brandInject) {
          this.brandInject()
          this.brandInject = null
        }
        this.brandIcon = null
        this.hero.stop()
      }

      dispose () {
        this.disposed = true
        window.removeEventListener('resize', this.onResize)
        if (this.resizeFrame !== 0) {
          cancelAnimationFrame(this.resizeFrame)
          this.resizeFrame = 0
        }
        if (this.unsubscribe) {
          this.unsubscribe()
          this.unsubscribe = null
        }
        if (this.observer) {
          this.observer.disconnect()
          this.observer = null
        }
        if (this.markFrame !== 0) {
          cancelAnimationFrame(this.markFrame)
          this.markFrame = 0
        }
        this.teardown()
        // 插件卸载时才移除设置页样式（关皮肤时它要留着）。
        if (this.pageStyleEl) {
          this.pageStyleEl.remove()
          this.pageStyleEl = null
        }
      }
    }

    // =====================================================================
    // 设置页样式（类名统一 dshuiskin- 前缀，只用 DSH 主题 token）
    // =====================================================================
    const PAGE_CSS = `
.dshuiskin-page { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 28px; color: var(--dsw-alias-label-primary); }
.dshuiskin-head { display: flex; flex-direction: column; gap: 6px; }
.dshuiskin-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.dshuiskin-desc { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dshuiskin-card { border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.dshuiskin-cardTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshuiskin-cardHint { font-size: 11.5px; line-height: 17px; color: var(--dsw-alias-label-caption); }
.dshuiskin-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 30px; }
.dshuiskin-rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshuiskin-label { font-size: 13px; color: var(--dsw-alias-label-primary); }
.dshuiskin-hint { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-caption); }
.dshuiskin-control { display: flex; align-items: center; gap: 8px; flex: none; }
.dshuiskin-range { width: 180px; accent-color: var(--dsw-alias-button-info-fill); }
.dshuiskin-value { min-width: 40px; text-align: right; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dshuiskin-input { width: 220px; height: 30px; box-sizing: border-box; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; outline: none; }
.dshuiskin-input:focus-visible { border-color: var(--dsw-alias-button-info-fill); }
.dshuiskin-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.dshuiskin-btn:hover { background: var(--dsw-alias-interactive-bg-active); }
.dshuiskin-btn[data-primary='true'] { background: var(--dsw-alias-button-info-fill); border-color: transparent; color: var(--dsw-alias-label-on-color); }
.dshuiskin-btn[data-primary='true']:hover { background: var(--dsw-alias-button-info-fill); filter: brightness(1.08); }
.dshuiskin-seg { display: flex; gap: 6px; flex-wrap: wrap; }
.dshuiskin-segBtn { height: 28px; padding: 0 12px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12.5px; cursor: pointer; }
.dshuiskin-segBtn[data-on='true'] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dshuiskin-swatch { width: 30px; height: 30px; border-radius: 9px; border: 0.5px solid var(--dsw-alias-border-l4); cursor: pointer; padding: 0; position: relative; overflow: hidden; background: var(--dsw-alias-bg-layer-2); flex: none; }
.dshuiskin-swatch[data-empty='true'] { background: conic-gradient(from 0deg, #8a8f98, #d7dbe0, #8a8f98, #d7dbe0); }
.dshuiskin-swatch[data-empty='true']::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, transparent 44%, rgba(0, 0, 0, 0.5) 45%, rgba(0, 0, 0, 0.5) 55%, transparent 56%); }
.dshuiskin-field { display: flex; align-items: center; gap: 8px; }
.dshuiskin-fieldLabel { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshuiskin-pop { position: fixed; z-index: 2147483000; width: 232px; box-sizing: border-box; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 14px; background: var(--dsw-alias-bg-overlay); box-shadow: var(--dsw-elevation-prominent); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshuiskin-wheel { display: block; margin: 0 auto; touch-action: none; cursor: crosshair; }
.dshuiskin-hexRow { display: flex; gap: 8px; align-items: center; }
.dshuiskin-hex { flex: 1; min-width: 0; height: 28px; box-sizing: border-box; padding: 0 8px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; font-family: var(--ds-font-family-code); outline: none; }
.dshuiskin-wallPreviewWrap { display: flex; flex-direction: column; gap: 10px; }
.dshuiskin-wallPreview { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; border: 0.5px solid var(--dsw-alias-border-l3); background-color: var(--dsw-alias-bg-layer-2); background-repeat: no-repeat; cursor: grab; touch-action: none; }
.dshuiskin-wallPreview:active { cursor: grabbing; }
.dshuiskin-wallPreviewHint { position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.5); color: #fff; font-size: 11px; line-height: 16px; pointer-events: none; }
.dshuiskin-switch { width: 40px; height: 24px; border-radius: 999px; border: none; padding: 0; cursor: pointer; background: var(--dsw-alias-interactive-bg-active); position: relative; flex: none; transition: background-color 120ms ease; }
.dshuiskin-switch[data-on='true'] { background: var(--dsw-alias-button-info-fill); }
.dshuiskin-switchThumb { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); box-shadow: 0 1px 2px rgba(0,0,0,0.25); transition: transform 120ms ease; }
.dshuiskin-switch[data-on='true'] .dshuiskin-switchThumb { transform: translateX(16px); }
.dshuiskin-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 4px; }
.dshuiskin-saved { font-size: 11.5px; color: var(--dsw-alias-label-caption); }
.dshuiskin-previewRow { display: flex; gap: 8px; align-items: center; }
.dshuiskin-dot { width: 18px; height: 18px; border-radius: 50%; border: 0.5px solid var(--dsw-alias-border-l4); }
@media (max-width: 640px) {
  .dshuiskin-row { flex-direction: column; align-items: flex-start; }
  .dshuiskin-input { width: 100%; }
  .dshuiskin-range { width: 150px; }
}
`

    // =====================================================================
    // 设置页组件
    // =====================================================================

    /** 色环 + 明度/饱和度方块。 */
    function ColorWheel ({ value, onChange }) {
      const canvasRef = React.useRef(null)
      const hsvRef = React.useRef(hexToHsv(isColor(value) ? value : '#4176e6'))
      const dragRef = React.useRef(null)
      const emittedRef = React.useRef(isColor(value) ? value : '')
      const SIZE = 196
      const CX = SIZE / 2
      const R_OUT = 94
      const R_IN = 76
      const SQ = 104
      const SQ_X = CX - SQ / 2
      const SQ_Y = CX - SQ / 2

      const draw = React.useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const width = Math.round(SIZE * dpr)
        if (canvas.width !== width || canvas.height !== width) {
          canvas.width = width
          canvas.height = width
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, SIZE, SIZE)
        // 色相环：1° 一段，避免 conic-gradient 在部分内核上的锯齿。
        const mid = (R_OUT + R_IN) / 2
        for (let angle = 0; angle < 360; angle += 1) {
          const start = ((angle - 0.7) * Math.PI) / 180
          const end = ((angle + 1.3) * Math.PI) / 180
          ctx.beginPath()
          ctx.arc(CX, CX, mid, start, end)
          ctx.strokeStyle = `hsl(${angle}, 100%, 50%)`
          ctx.lineWidth = R_OUT - R_IN
          ctx.stroke()
        }
        const { h, s, v } = hsvRef.current
        // 饱和度/明度方块
        ctx.fillStyle = `hsl(${h}, 100%, 50%)`
        ctx.fillRect(SQ_X, SQ_Y, SQ, SQ)
        const white = ctx.createLinearGradient(SQ_X, 0, SQ_X + SQ, 0)
        white.addColorStop(0, 'rgba(255,255,255,1)')
        white.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = white
        ctx.fillRect(SQ_X, SQ_Y, SQ, SQ)
        const black = ctx.createLinearGradient(0, SQ_Y, 0, SQ_Y + SQ)
        black.addColorStop(0, 'rgba(0,0,0,0)')
        black.addColorStop(1, 'rgba(0,0,0,1)')
        ctx.fillStyle = black
        ctx.fillRect(SQ_X, SQ_Y, SQ, SQ)
        // 方块描边
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.strokeRect(SQ_X + 0.5, SQ_Y + 0.5, SQ - 1, SQ - 1)
        // 两个圆钮
        const hueX = CX + Math.cos((h * Math.PI) / 180) * mid
        const hueY = CX + Math.sin((h * Math.PI) / 180) * mid
        ctx.beginPath()
        ctx.arc(hueX, hueY, 6, 0, Math.PI * 2)
        ctx.fillStyle = `hsl(${h}, 100%, 50%)`
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2
        ctx.stroke()
        const svX = SQ_X + s * SQ
        const svY = SQ_Y + (1 - v) * SQ
        ctx.beginPath()
        ctx.arc(svX, svY, 6, 0, Math.PI * 2)
        ctx.fillStyle = hsvToHex(h, s, v)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2
        ctx.stroke()
      }, [])

      React.useEffect(() => {
        if (!isColor(value)) return
        if (value.toLowerCase() === emittedRef.current.toLowerCase()) return
        hsvRef.current = hexToHsv(value)
        emittedRef.current = value
        draw()
      }, [value, draw])

      React.useEffect(() => { draw() }, [draw])

      const emit = () => {
        const { h: hue, s, v } = hsvRef.current
        const hex = hsvToHex(hue, s, v)
        emittedRef.current = hex
        onChange(hex)
      }

      const handle = (event) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        const dx = x - CX
        const dy = y - CX
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (dragRef.current === null) {
          if (distance >= R_IN - 6) dragRef.current = 'hue'
          else if (x >= SQ_X && x <= SQ_X + SQ && y >= SQ_Y && y <= SQ_Y + SQ) dragRef.current = 'sv'
          else return
        }
        if (dragRef.current === 'hue') {
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI
          hsvRef.current = { ...hsvRef.current, h: (angle + 360) % 360 }
        } else {
          const s = clamp((x - SQ_X) / SQ, 0, 1)
          const v = 1 - clamp((y - SQ_Y) / SQ, 0, 1)
          hsvRef.current = { ...hsvRef.current, s, v }
        }
        draw()
        emit()
      }

      return h('canvas', {
        ref: canvasRef,
        className: 'dshuiskin-wheel',
        style: { width: SIZE + 'px', height: SIZE + 'px' },
        onPointerDown: (event) => {
          dragRef.current = null
          handle(event)
          if (dragRef.current !== null) {
            try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 忽略 */ }
          }
        },
        onPointerMove: (event) => {
          if (dragRef.current === null) return
          handle(event)
        },
        onPointerUp: (event) => {
          dragRef.current = null
          try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 忽略 */ }
        },
        onPointerCancel: () => { dragRef.current = null },
      })
    }

    /** 底色/颜色选择：色块按钮 + 弹出式色环。 */
    function ColorField ({ value, onChange, allowEmpty, emptyLabel, label }) {
      const [open, setOpen] = React.useState(false)
      const [position, setPosition] = React.useState(null)
      const [hexText, setHexText] = React.useState(value || '')
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => { setHexText(value || '') }, [value])

      const openPanel = () => {
        const button = buttonRef.current
        if (!button) return
        const rect = button.getBoundingClientRect()
        const width = 232
        const height = 306
        const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8))
        let top = rect.bottom + 8
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8)
        setPosition({ left, top })
        setOpen(true)
      }

      React.useEffect(() => {
        if (!open) return
        const onPointerDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          if (buttonRef.current && buttonRef.current.contains(target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      return h('div', { className: 'dshuiskin-field' },
        label ? h('span', { className: 'dshuiskin-fieldLabel' }, label) : null,
        h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'dshuiskin-swatch',
          'data-empty': String(!value),
          title: value || emptyLabel || '',
          style: value ? { background: value } : undefined,
          onClick: openPanel,
          'aria-label': label || '颜色',
        }),
        open && position ? h('div', { ref: panelRef, className: 'dshuiskin-pop', style: position },
          h(ColorWheel, {
            value: isColor(value) ? value : '#4176e6',
            onChange: (next) => { setHexText(next); onChange(next) },
          }),
          h('div', { className: 'dshuiskin-hexRow' },
            h('input', {
              className: 'dshuiskin-hex',
              value: hexText,
              spellCheck: false,
              placeholder: '#rrggbb',
              onChange: (event) => {
                const text = event.target.value
                setHexText(text)
                if (isColor(text)) onChange(text)
              },
              onBlur: () => { if (!isColor(hexText) && !(allowEmpty && hexText.trim() === '')) setHexText(value || '') },
            }),
            allowEmpty
              ? h('button', {
                type: 'button',
                className: 'dshuiskin-btn',
                onClick: () => { onChange(''); setHexText(''); setOpen(false) },
              }, emptyLabel || '默认')
              : null,
          ),
        ) : null,
      )
    }

    function Slider ({ value, min, max, step, onChange, suffix }) {
      return h('div', { className: 'dshuiskin-control' },
        h('input', {
          type: 'range',
          className: 'dshuiskin-range',
          min,
          max,
          step: step || 1,
          value,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        h('span', { className: 'dshuiskin-value' }, String(value) + (suffix || '')),
      )
    }

    /**
     * 文本输入：内部保存草稿，输入法组合期间不写回设置。
     * 这样中文拼音不会先落进配置再被回写成乱码，退格/光标也不会因为
     * 受控值回环而跳到末尾。
     */
    function TextField ({ value, placeholder, onChange, width }) {
      const [draft, setDraft] = React.useState(value)
      const composing = React.useRef(false)
      const focused = React.useRef(false)
      React.useEffect(() => {
        if (!focused.current) setDraft(value)
      }, [value])
      return h('input', {
        className: 'dshuiskin-input',
        style: width ? { width } : undefined,
        value: draft,
        placeholder,
        spellCheck: false,
        onFocus: () => { focused.current = true },
        onBlur: () => {
          focused.current = false
          if (draft !== value) onChange(draft)
        },
        onCompositionStart: () => { composing.current = true },
        onCompositionEnd: (event) => {
          composing.current = false
          const next = event.currentTarget.value
          setDraft(next)
          onChange(next)
        },
        onChange: (event) => {
          const next = event.target.value
          setDraft(next)
          if (!composing.current) onChange(next)
        },
      })
    }

    function Switch ({ checked, onChange, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'dshuiskin-switch',
        'aria-checked': checked,
        'aria-label': label,
        'data-on': String(checked),
        onClick: () => onChange(!checked),
      }, h('span', { className: 'dshuiskin-switchThumb' }))
    }

    function Row ({ label, hint, children }) {
      return h('div', { className: 'dshuiskin-row' },
        h('div', { className: 'dshuiskin-rowText' },
          h('span', { className: 'dshuiskin-label' }, label),
          hint ? h('span', { className: 'dshuiskin-hint' }, hint) : null,
        ),
        h('div', { className: 'dshuiskin-control' }, children),
      )
    }

    function Card ({ title, hint, children }) {
      return h('section', { className: 'dshuiskin-card' },
        title ? h('div', { className: 'dshuiskin-cardTitle' }, title) : null,
        hint ? h('div', { className: 'dshuiskin-cardHint' }, hint) : null,
        children,
      )
    }

    /** 图片压缩：壁纸走 JPEG，图标保留 PNG 透明。 */
    async function fileToDataUrl (file, maxEdge, mime, quality) {
      if (!(file instanceof File) || file.size === 0) return ''
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return ''
        context.drawImage(bitmap, 0, 0, width, height)
        return canvas.toDataURL(mime, quality)
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close()
      }
    }

    async function compressWallpaper (file) {
      const attempts = [[1920, 0.84], [1440, 0.78], [1080, 0.7], [860, 0.62]]
      let smallest = ''
      for (const [edge, quality] of attempts) {
        const dataUrl = await fileToDataUrl(file, edge, 'image/jpeg', quality)
        if (!dataUrl) continue
        if (!smallest || dataUrl.length < smallest.length) smallest = dataUrl
        if (dataUrl.length <= 900000) return dataUrl
      }
      return smallest
    }

    function buildDictionaryZh () {
      return {
        nav: '外观',
        title: '外观皮肤',
        desc: '静态壁纸、分区透明度、底部输入栏与交互配色、首页标题文字。改完立即生效，并自动保存在 DSH 设置里。',
        enable: '启用皮肤',
        enableHint: '关闭后立即恢复 DSH 原生外观，设置本身保留。',
        wallpaper: '壁纸',
        wallpaperHint: '壁纸只支持静态图片或纯色/渐变，不做动画。',
        mode: '壁纸类型',
        modeGradient: '渐变',
        modeSolid: '纯色',
        modeImage: '图片',
        modeNone: '关闭',
        colorStart: '渐变起点',
        colorEnd: '渐变终点',
        angle: '渐变角度',
        dim: '暗化遮罩',
        blur: '模糊',
        image: '本地图片',
        imageHint: '建议宽度 1920px 以内，会自动压缩后保存；拖动上面的预览可以调整露出位置。',
        dragHint: '拖动调整位置',
        noImage: '还没有选择图片',
        zoom: '缩放',
        centerImage: '居中',
        pickImage: '选择图片',
        clear: '清除',
        preset: '推荐配色',
        chat: '对话界面',
        files: '工作区文件栏',
        filesFollow: '跟随左侧边栏配色',
        filesFollowHint: '打开后右栏直接用左侧边栏的底色和不透明度；关掉后下面两项才能单独调右栏。',
        frost: '磨砂玻璃',
        frostHint: '只给左右侧边栏、对话框、底部输入框加磨砂；中间对话区保持清晰。',
        frostBlur: '磨砂强度',
        frostBlurHint: '0 = 关闭，建议 8–16；调大更雾，也更吃显卡。',
        sidebar: '左侧边栏',
        surfaceHint: '不透明度越低，壁纸透出越多。',
        opacity: '不透明度',
        baseColor: '底色',
        composer: '底部输入栏',
        composerColor: '输入栏底色',
        overlay: '弹层与菜单',
        overlayHint: '对话框、下拉菜单、悬浮卡片用这一档。太高会挡壁纸，太低会看不清字。',
        overlayOpacity: '弹层不透明度',
        accent: '交互强调色',
        accentHint: '只影响发送键、链接、焦点框、选中描边这类交互元素；文件图标等语义色保持 DSH 原样。',
        text: '文字颜色',
        textHint: '留空 = 跟随主题（自动按面板亮度保证可读）。',
        autoContrast: '自动提高可读性',
        autoContrastHint: '对比度不够时，自动加深对应面板，最多到接近不透明；关掉就完全按你的滑块来。',
        hero: '首页标题',
        heroTitle: '大标题文字',
        heroTitleHint: '留空 = 使用默认「探索未至之境」。',
        heroBadge: '「预览版」文字',
        heroBadgeHint: '留空 = 使用默认文案。',
        heroColor: '标题颜色',
        heroIcon: '鲸鱼图标',
        heroIconHint: '留空 = 使用默认图标。上传 PNG 可保留透明背景。',
        pickIcon: '换图标',
        reset: '恢复默认设置',
        saved: '改动会自动保存',
        applyFailed: '保存失败，已回退到上一次成功保存的值。',
        colorFollowTheme: '跟随主题',
      }
    }

    function buildDictionaryEn () {
      return {
        nav: 'Appearance',
        title: 'UI skin',
        desc: 'Static wallpaper, per-area transparency, bottom input-bar and accent colors, and the home headline. Changes apply immediately and are saved in DSH settings.',
        enable: 'Enable skin',
        enableHint: 'Turning it off restores the stock DSH look; your settings are kept.',
        wallpaper: 'Wallpaper',
        wallpaperHint: 'Static images, solid colors, or gradients only — no animation.',
        mode: 'Wallpaper type',
        modeGradient: 'Gradient',
        modeSolid: 'Solid',
        modeImage: 'Image',
        modeNone: 'Off',
        colorStart: 'Start color',
        colorEnd: 'End color',
        angle: 'Gradient angle',
        dim: 'Dim overlay',
        blur: 'Blur',
        image: 'Local image',
        imageHint: 'Up to about 1920px wide is recommended; drag the preview to choose what stays visible.',
        dragHint: 'Drag to position',
        noImage: 'No image selected yet',
        zoom: 'Zoom',
        centerImage: 'Center',
        pickImage: 'Choose image',
        clear: 'Clear',
        preset: 'Presets',
        chat: 'Chat panel',
        files: 'Workspace files panel',
        filesFollow: 'Match left sidebar colors',
        filesFollowHint: 'When on, the right panel uses the left sidebar base color and opacity. Turn it off to tune the right panel separately.',
        frost: 'Frosted glass',
        frostHint: 'Frosts only the left/right sidebars, dialogs, and the bottom input bar; the chat area stays crisp.',
        frostBlur: 'Frost strength',
        frostBlurHint: '0 = off, 8–16 is a good range. Higher is hazier and heavier on the GPU.',
        sidebar: 'Left sidebar',
        surfaceHint: 'Lower opacity shows more wallpaper.',
        opacity: 'Opacity',
        baseColor: 'Base color',
        composer: 'Bottom input bar',
        composerColor: 'Input-bar color',
        overlay: 'Menus & dialogs',
        overlayHint: 'Dialogs, dropdown menus, and floating cards use this opacity.',
        overlayOpacity: 'Overlay opacity',
        accent: 'Accent color',
        accentHint: 'Only interactive elements: send button, links, focus ring, selected outlines. File-type icons keep their DSH colors.',
        text: 'Text color',
        textHint: 'Blank = follow the theme (auto-contrast keeps it readable).',
        autoContrast: 'Auto readability',
        autoContrastHint: 'When contrast is too low, deepen the matching panel automatically.',
        hero: 'Home headline',
        heroTitle: 'Headline text',
        heroTitleHint: 'Leave blank to keep the default headline.',
        heroBadge: 'Badge text',
        heroBadgeHint: 'Leave blank to keep the default badge.',
        heroColor: 'Headline color',
        heroIcon: 'Whale icon',
        heroIconHint: 'Leave empty for the stock icon. Upload a PNG to keep transparency.',
        pickIcon: 'Replace icon',
        reset: 'Reset to defaults',
        saved: 'Changes save automatically',
        applyFailed: 'Saving failed and the last saved value was restored.',
        colorFollowTheme: 'Theme',
      }
    }

    /** 图片壁纸预览：在 16:9 的框里拖动 = 调整壁纸露出位置；缩放用滑块。 */
    function WallpaperPreview ({ config, onChange, t }) {
      const boxRef = React.useRef(null)
      const [info, setInfo] = React.useState(null)
      const dragRef = React.useRef(null)
      const dataUrl = config.wallpaperImage || ''

      React.useEffect(() => {
        let cancelled = false
        if (!dataUrl) {
          setInfo(null)
          return () => { cancelled = true }
        }
        sampleImageInfo(dataUrl).then((next) => { if (!cancelled) setInfo(next) }).catch(() => { if (!cancelled) setInfo(null) })
        return () => { cancelled = true }
      }, [dataUrl])

      const box = boxRef.current
      const geometry = info && box
        ? wallpaperImageGeometry(config, info, box.clientWidth || 320, box.clientHeight || 180)
        : { size: 'cover', position: 'center' }

      const onPointerDown = (event) => {
        const element = boxRef.current
        if (!element || !info) return
        event.preventDefault()
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          posX: config.wallpaperImagePosX,
          posY: config.wallpaperImagePosY,
          width: element.clientWidth,
          height: element.clientHeight,
        }
        try { element.setPointerCapture(event.pointerId) } catch { /* 忽略 */ }
      }
      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (!drag || !info) return
        const scale = clamp(config.wallpaperImageScale, 100, 250) / 100
        const cover = Math.max(drag.width / info.width, drag.height / info.height) * scale
        const overflowX = Math.max(1, info.width * cover - drag.width)
        const overflowY = Math.max(1, info.height * cover - drag.height)
        onChange({
          wallpaperImagePosX: Math.round(clamp(drag.posX - ((event.clientX - drag.x) / overflowX) * 100, 0, 100)),
          wallpaperImagePosY: Math.round(clamp(drag.posY - ((event.clientY - drag.y) / overflowY) * 100, 0, 100)),
        })
      }
      const endDrag = (event) => {
        if (!dragRef.current) return
        dragRef.current = null
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 忽略 */ }
      }

      return h('div', { className: 'dshuiskin-wallPreviewWrap' },
        h('div', {
          ref: boxRef,
          className: 'dshuiskin-wallPreview',
          style: dataUrl
            ? {
              backgroundImage: `url("${dataUrl}")`,
              backgroundSize: geometry.size,
              backgroundPosition: geometry.position,
            }
            : undefined,
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        }, h('span', { className: 'dshuiskin-wallPreviewHint' }, dataUrl ? t('dragHint') : t('noImage'))),
        h('div', { className: 'dshuiskin-row' },
          h('div', { className: 'dshuiskin-control' },
            h('span', { className: 'dshuiskin-fieldLabel' }, t('zoom')),
            h(Slider, { value: config.wallpaperImageScale, min: 100, max: 250, onChange: (value) => onChange({ wallpaperImageScale: value }), suffix: '%' }),
            h('button', {
              type: 'button',
              className: 'dshuiskin-btn',
              onClick: () => onChange({ wallpaperImagePosX: 50, wallpaperImagePosY: 50, wallpaperImageScale: 100 }),
            }, t('centerImage')),
          ),
        ),
      )
    }

    /** 设置页：store 通过注册时的 inject face 传入。 */
    function SettingsSection (props) {
      const store = props.store || sharedStore
      const t = props.t || ((key) => key)
      const [config, setConfig] = React.useState(() => (store ? store.get() : DEFAULTS))
      React.useEffect(() => {
        if (!store) return undefined
        return store.subscribe(() => setConfig(store.get()))
      }, [store])
      React.useEffect(() => {
        if (!store) return undefined
        return () => store.flush()
      }, [store])
      const update = React.useCallback((patch) => { if (store) store.set(patch) }, [store])
      const wallpaperInputRef = React.useRef(null)
      const iconInputRef = React.useRef(null)
      const [busy, setBusy] = React.useState('')

      const pickWallpaper = async (file) => {
        if (!file) return
        setBusy('wallpaper')
        try {
          const dataUrl = await compressWallpaper(file)
          if (dataUrl) update({ wallpaperImage: dataUrl, wallpaperMode: 'image' })
        } catch (error) {
          console.error('[dsh-ui-skin] wallpaper failed', error)
        } finally {
          setBusy('')
          if (wallpaperInputRef.current) wallpaperInputRef.current.value = ''
        }
      }

      const pickIcon = async (file) => {
        if (!file) return
        setBusy('icon')
        try {
          const dataUrl = await fileToDataUrl(file, 256, 'image/png')
          if (dataUrl) update({ heroIcon: dataUrl })
        } catch (error) {
          console.error('[dsh-ui-skin] icon failed', error)
        } finally {
          setBusy('')
          if (iconInputRef.current) iconInputRef.current.value = ''
        }
      }

      const modeOptions = [
        ['gradient', t('modeGradient')],
        ['solid', t('modeSolid')],
        ['image', t('modeImage')],
        ['none', t('modeNone')],
      ]

      return h('div', { className: 'dshuiskin-page' },
        h('div', { className: 'dshuiskin-head' },
          h('h2', { className: 'dshuiskin-title' }, t('title')),
          h('p', { className: 'dshuiskin-desc' }, t('desc')),
        ),

        h(Card, null,
          h(Row, { label: t('enable'), hint: t('enableHint') },
            h(Switch, { checked: config.enabled, onChange: (value) => update({ enabled: value }), label: t('enable') }),
          ),
        ),

        h(Card, { title: t('wallpaper'), hint: t('wallpaperHint') },
          h(Row, { label: t('mode') },
            h('div', { className: 'dshuiskin-seg' },
              ...modeOptions.map(([value, label]) => h('button', {
                key: value,
                type: 'button',
                className: 'dshuiskin-segBtn',
                'data-on': String(config.wallpaperMode === value),
                onClick: () => update({ wallpaperMode: value }),
              }, label)),
            ),
          ),
          config.wallpaperMode === 'gradient' || config.wallpaperMode === 'solid'
            ? h('div', { className: 'dshuiskin-seg' },
              ...PRESETS.map(([left, right], index) => h('button', {
                key: String(index),
                type: 'button',
                className: 'dshuiskin-swatch',
                title: t('preset'),
                'aria-label': t('preset'),
                style: { background: `linear-gradient(135deg, ${left}, ${right})` },
                onClick: () => update({ wallpaperColor1: left, wallpaperColor2: right, wallpaperMode: 'gradient' }),
              })),
            )
            : null,
          config.wallpaperMode === 'gradient'
            ? h('div', { className: 'dshuiskin-row' },
              h('div', { className: 'dshuiskin-control' },
                h(ColorField, { value: config.wallpaperColor1, label: t('colorStart'), onChange: (value) => update({ wallpaperColor1: value }) }),
                h(ColorField, { value: config.wallpaperColor2, label: t('colorEnd'), onChange: (value) => update({ wallpaperColor2: value }) }),
              ),
              h(Slider, { value: config.wallpaperAngle, min: 0, max: 360, onChange: (value) => update({ wallpaperAngle: value }), suffix: '°' }),
            )
            : config.wallpaperMode === 'solid'
              ? h(Row, { label: t('baseColor') },
                h(ColorField, { value: config.wallpaperColor1, onChange: (value) => update({ wallpaperColor1: value }) }),
              )
              : null,
          config.wallpaperMode === 'image'
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              h(WallpaperPreview, { config, onChange: update, t }),
              h('div', { className: 'dshuiskin-row' },
                h('span', { className: 'dshuiskin-hint' }, t('imageHint')),
                h('div', { className: 'dshuiskin-control' },
                  h('input', {
                    ref: wallpaperInputRef,
                    type: 'file',
                    accept: 'image/*',
                    style: { display: 'none' },
                    onChange: (event) => { void pickWallpaper(event.target.files && event.target.files[0]) },
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dshuiskin-btn',
                    onClick: () => wallpaperInputRef.current && wallpaperInputRef.current.click(),
                  }, busy === 'wallpaper' ? '…' : t('pickImage')),
                  config.wallpaperImage
                    ? h('button', {
                      type: 'button',
                      className: 'dshuiskin-btn',
                      onClick: () => update({ wallpaperImage: '' }),
                    }, t('clear'))
                    : null,
                ),
              ),
            )
            : null,
          h(Row, { label: t('dim') },
            h(Slider, { value: config.wallpaperDim, min: 0, max: 80, onChange: (value) => update({ wallpaperDim: value }), suffix: '%' }),
          ),
          h(Row, { label: t('blur') },
            h(Slider, { value: config.wallpaperBlur, min: 0, max: 40, onChange: (value) => update({ wallpaperBlur: value }), suffix: 'px' }),
          ),
        ),

        h(Card, { title: t('chat'), hint: t('surfaceHint') },
          h(Row, { label: t('opacity') },
            h(Slider, { value: config.chatOpacity, min: 0, max: 100, onChange: (value) => update({ chatOpacity: value }), suffix: '%' }),
          ),
          h(Row, { label: t('frostBlur') },
            h(Slider, { value: config.chatFrost, min: 0, max: 40, onChange: (value) => update({ chatFrost: value }), suffix: 'px' }),
          ),
          h(Row, { label: t('baseColor') },
            h(ColorField, { value: config.chatColor, onChange: (value) => update({ chatColor: value }) }),
          ),
        ),

        h(Card, { title: t('files'), hint: t('surfaceHint') },
          h(Row, { label: t('filesFollow'), hint: t('filesFollowHint') },
            h(Switch, { checked: config.filesFollowSidebar, onChange: (value) => update({ filesFollowSidebar: value }), label: t('filesFollow') }),
          ),
          config.filesFollowSidebar
            ? null
            : h(Row, { label: t('opacity') },
              h(Slider, { value: config.filesOpacity, min: 0, max: 100, onChange: (value) => update({ filesOpacity: value }), suffix: '%' }),
            ),
          h(Row, { label: t('frostBlur') },
            h(Slider, { value: config.filesFrost, min: 0, max: 40, onChange: (value) => update({ filesFrost: value }), suffix: 'px' }),
          ),
          config.filesFollowSidebar
            ? null
            : h(Row, { label: t('baseColor') },
              h(ColorField, { value: config.filesColor, onChange: (value) => update({ filesColor: value }) }),
            ),
        ),

        h(Card, { title: t('sidebar'), hint: t('surfaceHint') },
          h(Row, { label: t('opacity') },
            h(Slider, { value: config.sidebarOpacity, min: 0, max: 100, onChange: (value) => update({ sidebarOpacity: value }), suffix: '%' }),
          ),
          h(Row, { label: t('frostBlur') },
            h(Slider, { value: config.sidebarFrost, min: 0, max: 40, onChange: (value) => update({ sidebarFrost: value }), suffix: 'px' }),
          ),
          h(Row, { label: t('baseColor') },
            h(ColorField, { value: config.sidebarColor, onChange: (value) => update({ sidebarColor: value }) }),
          ),
        ),

        h(Card, { title: t('composer'), hint: null },
          h(Row, { label: t('composerColor') },
            h(ColorField, { value: config.composerColor, onChange: (value) => update({ composerColor: value }) }),
          ),
          h(Row, { label: t('opacity') },
            h(Slider, { value: config.composerOpacity, min: 0, max: 100, onChange: (value) => update({ composerOpacity: value }), suffix: '%' }),
          ),
          h(Row, { label: t('frostBlur') },
            h(Slider, { value: config.composerFrost, min: 0, max: 40, onChange: (value) => update({ composerFrost: value }), suffix: 'px' }),
          ),
        ),

        h(Card, { title: t('overlay'), hint: t('overlayHint') },
          h(Row, { label: t('overlayOpacity') },
            h(Slider, { value: config.overlayOpacity, min: 0, max: 100, onChange: (value) => update({ overlayOpacity: value }), suffix: '%' }),
          ),
          h(Row, { label: t('frostBlur') },
            h(Slider, { value: config.overlayFrost, min: 0, max: 40, onChange: (value) => update({ overlayFrost: value }), suffix: 'px' }),
          ),
        ),

        h(Card, { title: t('accent'), hint: t('accentHint') },
          h('div', { className: 'dshuiskin-previewRow' },
            h(ColorField, { value: config.accentColor, onChange: (value) => update({ accentColor: value }) }),
            h('div', { className: 'dshuiskin-dot', style: { background: config.accentColor } }),
            h('button', { type: 'button', className: 'dshuiskin-btn', 'data-primary': 'true' }, 'Aa'),
            h('a', { className: 'dshuiskin-hint', style: { color: config.accentColor } }, 'link'),
          ),
        ),

        h(Card, { title: t('text'), hint: t('textHint') },
          h(Row, { label: t('text') },
            h(ColorField, {
              value: config.fontColor,
              allowEmpty: true,
              emptyLabel: t('colorFollowTheme'),
              onChange: (value) => update({ fontColor: value }),
            }),
          ),
          h(Row, { label: t('autoContrast'), hint: t('autoContrastHint') },
            h(Switch, { checked: config.autoContrast, onChange: (value) => update({ autoContrast: value }), label: t('autoContrast') }),
          ),
        ),

        h(Card, { title: t('hero'), hint: null },
          h(Row, { label: t('heroTitle'), hint: t('heroTitleHint') },
            h(TextField, {
              value: config.heroTitle,
              placeholder: '探索未至之境',
              onChange: (value) => update({ heroTitle: value }),
            }),
          ),
          h(Row, { label: t('heroBadge'), hint: t('heroBadgeHint') },
            h(TextField, {
              value: config.heroBadge,
              placeholder: '预览版',
              width: '160px',
              onChange: (value) => update({ heroBadge: value }),
            }),
          ),
          h(Row, { label: t('heroColor') },
            h(ColorField, {
              value: config.heroColor,
              allowEmpty: true,
              emptyLabel: t('colorFollowTheme'),
              onChange: (value) => update({ heroColor: value }),
            }),
          ),
          h(Row, { label: t('heroIcon'), hint: t('heroIconHint') },
            h('div', { className: 'dshuiskin-control' },
              config.heroIcon
                ? h('img', { src: config.heroIcon, alt: '', width: 28, height: 28, style: { objectFit: 'contain' } })
                : null,
              h('input', {
                ref: iconInputRef,
                type: 'file',
                accept: 'image/*',
                style: { display: 'none' },
                onChange: (event) => { void pickIcon(event.target.files && event.target.files[0]) },
              }),
              h('button', {
                type: 'button',
                className: 'dshuiskin-btn',
                onClick: () => iconInputRef.current && iconInputRef.current.click(),
              }, busy === 'icon' ? '…' : t('pickIcon')),
              config.heroIcon
                ? h('button', { type: 'button', className: 'dshuiskin-btn', onClick: () => update({ heroIcon: '' }) }, t('clear'))
                : null,
            ),
          ),
        ),

        h('div', { className: 'dshuiskin-footer' },
          h('span', { className: 'dshuiskin-saved' }, t('saved')),
          h('button', {
            type: 'button',
            className: 'dshuiskin-btn',
            onClick: () => update({ ...DEFAULTS }),
          }, t('reset')),
        ),
      )
    }

    function SettingsIcon ({ size, active }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
      },
      h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 3, stroke: 'currentColor', strokeWidth: 1.3, opacity: active ? 1 : 0.75 }),
      h('circle', { cx: 6.2, cy: 6.2, r: 1.6, fill: 'currentColor', opacity: active ? 1 : 0.8 }),
      h('circle', { cx: 10, cy: 10, r: 1.6, fill: 'currentColor', opacity: active ? 1 : 0.8 }),
      h('path', { d: 'M3.4 10.4c1.4 1.2 3.2 1.2 4.6 0', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: 0.7 }),
      )
    }

    // =====================================================================
    // 插件入口
    // =====================================================================
    return {
      inject: ['slots', 'locale'],
      name: 'dsh-ui-skin',
      apply (ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(
          () => ctx.locale.register(NS, { zh: buildDictionaryZh(), en: buildDictionaryEn() }),
          'dsh-ui-skin: dictionaries',
        )

        const store = new SkinStore()
        sharedStore = store
        const controller = new SkinController(ctx, store)
        ctx.effect(() => controller.start(), 'dsh-ui-skin: skin')

        // 主题服务由 ui-theme 提供，可能稍后才就绪；就绪后再叠 token 覆盖层。
        ctx.inject(['theme'], (scope) => {
          scope.effect(() => controller.attachTheme(scope.theme), 'dsh-ui-skin: theme service')
        })

        // Host 设置命名空间可选：存在就作为持久层，不存在就地退化。
        ctx.inject(['configForms'], (scope) => {
          scope.effect(() => store.attach(scope.configForms.get(CONFIG_NS)), 'dsh-ui-skin: settings form')
        })

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-ui-skin',
          order: 100,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({ store }),
        }, SettingsSection)), 'dsh-ui-skin: settings page')

        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'dsh-ui-skin',
        }, SettingsIcon)), 'dsh-ui-skin: settings icon')

        // 页面关闭/隐藏前把挂起写入刷掉，避免最后一次拖动丢失。
        const onHide = () => store.flush()
        window.addEventListener('pagehide', onHide)
        ctx.effect(() => () => window.removeEventListener('pagehide', onHide), 'dsh-ui-skin: flush on hide')
      },
    }
  },
})
