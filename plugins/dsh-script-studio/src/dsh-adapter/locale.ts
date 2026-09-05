import type { HostCapabilities } from '@script-studio/contracts/host'

interface StudioLocale {
  entry: string; title: string; description: string; close: string
  loading: string; ready: string; retry: string; error: string; unavailable: string
  enabled: string; disabled: string; unknown: string; footer: string
  createHeading: string; seasonTitle: string; episodeTitle: string; firstEpisode: string
  create: string; busy: string; noEpisodes: string; episodic: string; film: string
  revision: string; season: (position: number) => string
  seasonLabel: (position: number, title: string) => string
  episodeLabel: (position: number, title: string) => string
  capabilities: Record<keyof HostCapabilities, string>
}

export const zhCN: StudioLocale = {
  entry: '剧本工作室 · 开发验证', title: '剧本工作室',
  description: 'Stage 2 / 本地开发 fixture', close: '关闭剧本工作室',
  loading: '正在协商能力并读取项目层级…', ready: '开发面板已就绪', retry: '重新加载',
  error: '请求失败，请重新加载后重试。', unavailable: '服务端未开放此能力。',
  enabled: '可用', disabled: '不可用', unknown: '待协商',
  footer: '仅用于 Stage 2 本地组合验证；当前不声明云端权限、Canon 推进或生产数据能力。',
  createHeading: '创建下一季（本地开发 API）', seasonTitle: 'Season 标题', episodeTitle: '第一集标题',
  firstEpisode: '第一集', create: '创建 Season 与第一集', busy: '正在创建…', noEpisodes: '暂无 Episode',
  episodic: '剧集', film: '电影', revision: '修订', season: position => `第${position}季`,
  seasonLabel: (position, title) => `S${position} · ${title}`,
  episodeLabel: (position, title) => `E${position} · ${title}`,
  capabilities: {
    hierarchyRead: '层级读取', commandCreateSeason: '创建 Season', authSession: '认证会话',
    eventStream: '实时事件流', hostModelGateway: '宿主模型', interactiveAppSurface: '交互应用', telemetry: '遥测',
  },
}
