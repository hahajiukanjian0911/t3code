import type { UiLocale } from "@t3tools/contracts/settings";
import type * as Electron from "electron";

/** Translate only the shell's own template; never walk renderer or user content. */
export function localizeMenu(
  template: Electron.MenuItemConstructorOptions[],
  locale: UiLocale,
  displayName: string,
): Electron.MenuItemConstructorOptions[] {
  if (locale === "en") return template;
  const labels: Readonly<Record<string, string>> = {
    [`About ${displayName}`]: `关于 ${displayName}`,
    [`Hide ${displayName}`]: `隐藏 ${displayName}`,
    [`Quit ${displayName}`]: `退出 ${displayName}`,
    "Check for Updates...": "检查更新…",
    "Settings...": "设置…",
    File: "文件",
    "Close Window": "关闭窗口",
    Edit: "编辑",
    "Paste as Text": "粘贴为纯文本",
    Speech: "语音",
    View: "显示",
    Reload: "重新加载",
    "Force Reload": "强制重新加载",
    "Toggle Developer Tools": "切换开发者工具",
    "Actual Size": "实际大小",
    "Zoom In": "放大",
    "Zoom Out": "缩小",
  };
  const roles: Partial<Record<NonNullable<Electron.MenuItemConstructorOptions["role"]>, string>> = {
    services: "服务",
    hideOthers: "隐藏其他",
    unhide: "显示全部",
    quit: "退出",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    delete: "删除",
    selectAll: "全选",
    startSpeaking: "开始朗读",
    stopSpeaking: "停止朗读",
    togglefullscreen: "切换全屏",
    windowMenu: "窗口",
    minimize: "最小化",
    zoom: "缩放",
    front: "全部置于前面",
    help: "帮助",
  };
  const translate = (
    items: Electron.MenuItemConstructorOptions[],
  ): Electron.MenuItemConstructorOptions[] =>
    items.map((item) => ({
      ...item,
      ...(item.label
        ? { label: labels[item.label] ?? item.label }
        : item.role && roles[item.role]
          ? { label: roles[item.role] }
          : {}),
      ...(Array.isArray(item.submenu) ? { submenu: translate(item.submenu) } : {}),
    }));
  return translate(template);
}
