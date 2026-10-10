const messages = {
  en: {
    language: 'Language', details: 'Connection details', detailsShort: 'Details', close: 'Close',
    checking: 'Checking connection…', connected: 'Connected to local host', waiting: 'Waiting for local host', disconnected: 'Disconnected', connect: 'Connect',
    access: 'Tab access', individual: 'Individual tabs', all: 'All web tabs',
    individualHint: 'Only shared tabs are accessible. Access ends on an origin change or browser restart.',
    allHint: 'Agents can read, control and close current and future web tabs, including signed-in pages.',
    newTabs: 'Agent-created tabs', newTabsHint: 'Allow agents to open new web tabs', advanced: 'Advanced settings', scriptingOn: 'Scripting on',
    developer: 'JavaScript evaluation', developerHint: 'Allow arbitrary code within accessible pages.',
    tabs: 'Web tabs', refresh: 'Refresh', search: 'Search tabs', searchPlaceholder: 'Search title or domain', filter: 'Filter tabs',
    filterAll: 'All tabs', filterInUse: 'In use', filterBlocked: 'Blocked', loading: 'Loading tabs…',
    available: 'Available', inUse: 'In use', blocked: 'Blocked', unshared: 'Not shared', current: 'Current',
    untitled: 'Untitled', session: 'Controlled by session: {session}',
    block: 'Block', allow: 'Allow', share: 'Share', revoke: 'Revoke',
    noTabs: 'No web tabs are open.', noMatches: 'No matching tabs.', reset: 'Clear filters', count: '{shown} of {total}',
    summaryNone: 'No tabs in use', summary: '{count} tabs in use', stop: 'Stop & revoke all', stopping: 'Stopping…',
    version: 'Extension version', connection: 'Connection', mode: 'Access mode', diagnosticHint: 'For installation errors, run this in the project directory:',
    copy: 'Copy diagnostics', copied: 'Copied', copyFailed: 'Could not copy. Select the command to copy it manually.',
    actionFailed: 'The change could not be confirmed. Refresh to inspect the current state.',
    SESSION_CONFLICT: 'This tab is controlled by another session. Revoke its access before sharing it again.',
    INVALID_URL: 'Only HTTP(S) web tabs can be shared.'
  },
  zh: {
    language: '界面语言', details: '连接诊断', detailsShort: '诊断', close: '关闭',
    checking: '正在检查连接…', connected: '本地主机已连接', waiting: '正在等待本地主机', disconnected: '未连接', connect: '连接',
    access: '访问范围', individual: '逐个授权', all: '所有网页',
    individualHint: '仅可访问已分享的标签；跨域或重启浏览器后，授权失效。',
    allHint: '可读取、操作和关闭当前及新开的网页标签，包括已登录页面。',
    newTabs: '允许新建标签', newTabsHint: '允许 Agent 打开新的网页标签', advanced: '高级设置', scriptingOn: '脚本已启用',
    developer: 'JavaScript 求值', developerHint: '允许在可访问的页面内执行任意代码。',
    tabs: '网页标签', refresh: '刷新', search: '搜索标签页', searchPlaceholder: '搜索标题或域名', filter: '筛选标签',
    filterAll: '全部标签', filterInUse: '已接管', filterBlocked: '已屏蔽', loading: '正在加载标签…',
    available: '可访问', inUse: '已接管', blocked: '已屏蔽', unshared: '未授权', current: '当前',
    untitled: '无标题', session: '由会话控制：{session}',
    block: '屏蔽', allow: '允许', share: '分享', revoke: '撤销',
    noTabs: '没有打开的网页标签。', noMatches: '没有匹配的标签。', reset: '清除筛选', count: '{shown} / {total}',
    summaryNone: '暂无标签被接管', summary: '{count} 个标签已接管', stop: '停止并撤销全部授权', stopping: '正在停止…',
    version: '扩展版本', connection: '连接状态', mode: '访问模式', diagnosticHint: '安装或连接异常时，可在项目目录运行：',
    copy: '复制诊断信息', copied: '已复制', copyFailed: '无法复制，请选中命令手动复制。',
    actionFailed: '未能确认这次修改，请刷新检查当前状态。',
    SESSION_CONFLICT: '该标签正由其他会话控制，请先撤销访问，再重新分享。',
    INVALID_URL: '仅支持分享 HTTP(S) 网页标签。'
  }
};

export function defaultLanguage(locale) { return /^zh\b/i.test(locale) ? 'zh' : 'en'; }
export function translator(language) {
  const dictionary = messages[language] || messages.en;
  return (key, values = {}) => (dictionary[key] || messages.en[key] || key).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''));
}
