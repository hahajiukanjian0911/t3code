import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  AuthOrchestrationOperateScope,
  buildRemoteOpenUrl,
  EditorId,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { memo, use, useRef } from "react";
import { BackgroundThreadContext } from "./backgroundThread";
import { shortcutLabelForCommand } from "../../keybindings";
import { OPEN_FAVORITE_EDITOR_ATTRIBUTE } from "./OpenInPickerShortcut";
import { usePreferredEditor } from "../../editorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenHint,
  useRemoteOpenState,
} from "../../remoteOpen";
import { useEnvironment } from "../../state/environments";
import {
  ChevronDownIcon,
  FolderClosedIcon,
  MoreHorizontalIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";

import { Group, GroupSeparator } from "../ui/group";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AntigravityIcon,
  CursorIcon,
  FileExplorerIcon,
  FinderIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "../JetBrainsIcons";
import { announce } from "~/lib/announce";
import { cn, isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useComposerMenuState } from "./useComposerMenuState";

type OpenInOption = {
  label: string;
  Icon: Icon;
  value: EditorId;
  kind: "brand" | "generic";
};

const resolveOpenInOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<Omit<OpenInOption, "label">> = [
    {
      Icon: CursorIcon,
      value: "cursor",
      kind: "brand",
    },
    {
      Icon: TraeIcon,
      value: "trae",
      kind: "brand",
    },
    {
      Icon: KiroIcon,
      value: "kiro",
      kind: "brand",
    },
    {
      Icon: VisualStudioCode,
      value: "vscode",
      kind: "brand",
    },
    {
      Icon: VisualStudioCodeInsiders,
      value: "vscode-insiders",
      kind: "brand",
    },
    {
      Icon: VSCodium,
      value: "vscodium",
      kind: "brand",
    },
    {
      Icon: Zed,
      value: "zed",
      kind: "brand",
    },
    {
      Icon: AntigravityIcon,
      value: "antigravity",
      kind: "brand",
    },
    {
      Icon: IntelliJIdeaIcon,
      value: "idea",
      kind: "brand",
    },
    {
      Icon: AquaIcon,
      value: "aqua",
      kind: "brand",
    },
    {
      Icon: CLionIcon,
      value: "clion",
      kind: "brand",
    },
    {
      Icon: DataGripIcon,
      value: "datagrip",
      kind: "brand",
    },
    {
      Icon: DataSpellIcon,
      value: "dataspell",
      kind: "brand",
    },
    {
      Icon: GoLandIcon,
      value: "goland",
      kind: "brand",
    },
    {
      Icon: PhpStormIcon,
      value: "phpstorm",
      kind: "brand",
    },
    {
      Icon: PyCharmIcon,
      value: "pycharm",
      kind: "brand",
    },
    {
      Icon: RiderIcon,
      value: "rider",
      kind: "brand",
    },
    {
      Icon: RubyMineIcon,
      value: "rubymine",
      kind: "brand",
    },
    {
      Icon: RustRoverIcon,
      value: "rustrover",
      kind: "brand",
    },
    {
      Icon: WebStormIcon,
      value: "webstorm",
      kind: "brand",
    },
    {
      Icon: isMacPlatform(platform)
        ? FinderIcon
        : isWindowsPlatform(platform)
          ? FileExplorerIcon
          : FolderClosedIcon,
      value: "file-manager",
      kind: isMacPlatform(platform) || isWindowsPlatform(platform) ? "brand" : "generic",
    },
  ];
  const availableEditorSet = new Set(availableEditors);
  return baseOptions
    .filter((option) => availableEditorSet.has(option.value))
    .map((option) => ({ ...option, label: editorLabelForPlatform(option.value, platform) }));
};

const QUICK_OPEN_PRIORITY: ReadonlyArray<EditorId> = [
  "vscode",
  "zed",
  "cursor",
  "antigravity",
  "vscode-insiders",
  "vscodium",
];

function resolvePanelQuickOpenOptions(
  options: ReadonlyArray<OpenInOption>,
  preferredEditor: EditorId | null,
): ReadonlyArray<OpenInOption> {
  const fileManager = options.find((option) => option.value === "file-manager") ?? null;
  const codeEditors = options.filter((option) => option.value !== "file-manager");
  const maxCodeEditors = fileManager ? 2 : 3;
  const picked: OpenInOption[] = [];
  const pushIfAvailable = (editorId: EditorId | null) => {
    if (!editorId || picked.length >= maxCodeEditors) return;
    if (picked.some((entry) => entry.value === editorId)) return;
    const match = codeEditors.find((entry) => entry.value === editorId);
    if (match) picked.push(match);
  };
  if (preferredEditor && preferredEditor !== "file-manager") {
    pushIfAvailable(preferredEditor);
  }
  for (const id of QUICK_OPEN_PRIORITY) pushIfAvailable(id);
  for (const entry of codeEditors) pushIfAvailable(entry.value);
  if (fileManager) picked.push(fileManager);
  return picked;
}

function getOpenInIconClass(kind: OpenInOption["kind"]) {
  return cn(kind === "brand" ? "text-foreground opacity-100" : "text-muted-foreground");
}

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  openInCwdIsFile = false,
  presentation = "toolbar",
  compact = false,
  enableShortcut = true,
  displayMode = "toolbar",
  revealFileManager = false,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  openInCwdIsFile?: boolean;
  presentation?: "toolbar" | "menu";
  compact?: boolean;
  enableShortcut?: boolean;
  displayMode?: "toolbar" | "panel";
  revealFileManager?: boolean;
}) {
  const isPanel = displayMode === "panel";
  const ActionGroup = isPanel ? "div" : Group;
  const panelAnchorRef = useRef<HTMLDivElement | null>(null);
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const remote = useRemoteOpenState(environmentId);
  const canOperateHost = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const isHostEditorDenied = remote.mode === "local-exec" && !canOperateHost;
  const canOpenEditor = remote.mode !== "remote-unavailable" && !isHostEditorDenied;
  const [menuOpen, setMenuOpen] = useComposerMenuState(isHostEditorDenied);
  const remoteCapableEditors = useRemoteCapableEditors();
  const [remoteHintSeen, markRemoteHintSeen] = useRemoteOpenHint();
  const environmentLabel = useEnvironment(environmentId)?.label ?? "this machine";
  // Remote editors run on the viewing machine; only desktop can probe that PATH.
  const effectiveEditors = remote.mode === "local-exec" ? availableEditors : remoteCapableEditors;
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(effectiveEditors);

  const openInEditor = async (editorId: EditorId | null): Promise<boolean> => {
    if (!openInCwd) return false;
    const editor = editorId ?? preferredEditor;
    if (!editor) return false;
    if (remote.mode === "remote-unavailable") return false;
    if (remote.mode === "remote-links") {
      const url = buildRemoteOpenUrl({
        editor,
        ...remote.host,
        absolutePath: openInCwd,
        isFile: openInCwdIsFile,
      });
      if (url === undefined) return false;
      // Only record hint-seen/preferred when the shell actually accepted
      // the URL (an older desktop build can refuse the editor scheme).
      const opened = await openRemoteEditorUrl(url);
      if (!opened) return false;
      markRemoteHintSeen();
      if (!isPanel || editor !== "file-manager") {
        setPreferredEditor(editor);
      }
      return true;
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
    const result = openInEditorMutation({
      environmentId,
      input: {
        cwd: openInCwd,
        editor,
        ...(revealFileManager && editor === "file-manager" ? { reveal: true } : {}),
      },
    });
    if (!isPanel || editor !== "file-manager") {
      setPreferredEditor(editor);
    }
    return (await result)._tag === "Success";
  };

  const openFavoriteEditorShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "editor.openFavorite",
  );

  const backgroundThread = use(BackgroundThreadContext);
  const options = resolveOpenInOptions(navigator.platform, effectiveEditors);
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;
  const primaryLabel = isPanel ? `Open in ${primaryOption?.label ?? "editor"}` : "Open";

  const unavailableReason =
    remote.mode === "remote-unavailable"
      ? `No SSH route to ${environmentLabel}`
      : remote.mode === "remote-links" && options.length === 0
        ? `Open from a computer to edit on ${environmentLabel}`
        : null;

  const editorItems = (
    <>
      {unavailableReason !== null ? (
        <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
          {unavailableReason}
        </MenuItem>
      ) : (
        <>
          {options.length === 0 && (
            <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
              No installed editors found
            </MenuItem>
          )}
          {options.map(({ label, Icon, value, kind }) => (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              disabled={!openInCwd || !canOpenEditor}
              key={value}
              onClick={() => {
                if (presentation === "menu" || isPanel) {
                  void openInEditor(value).then((opened) => {
                    if (opened) announce(`Opened in ${label}`);
                  });
                } else {
                  setPreferredEditor(value);
                }
              }}
            >
              <Icon aria-hidden="true" className={getOpenInIconClass(kind)} />
              <MenuItemLabel>{label}</MenuItemLabel>
              {value === preferredEditor && openFavoriteEditorShortcutLabel && (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              )}
            </MenuItem>
          ))}
          {remote.mode === "remote-links" && !remoteHintSeen && (
            <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
              Opens over SSH. Needs your key on {environmentLabel}
            </MenuItem>
          )}
        </>
      )}
    </>
  );
  if (presentation === "menu") {
    return (
      <>
        {primaryOption && (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}

            disabled={!openInCwd || !canOpenEditor}
            onClick={() => openInEditor(preferredEditor)}
          >
            <primaryOption.Icon className={cn("size-4", getOpenInIconClass(primaryOption.kind))} />
            <MenuItemLabel>Open in {primaryOption.label}</MenuItemLabel>
            {openFavoriteEditorShortcutLabel && (
              <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
            )}
          </MenuItem>
        )}
        <MenuSub>
          <MenuSubTrigger density="touch" disabled={isHostEditorDenied}>
            <SquareArrowOutUpRightIcon className="size-4" />
            <MenuItemLabel>Open in…</MenuItemLabel>
          </MenuSubTrigger>
          <MenuSubPopup>{editorItems}</MenuSubPopup>
        </MenuSub>
      </>
    );
  }

  if (isPanel && unavailableReason === null && options.length > 0) {
    const quickOptions = resolvePanelQuickOpenOptions(options, preferredEditor);
    const hasMoreEditors = options.length > quickOptions.length;
    const favoriteEditorId =
      preferredEditor && quickOptions.some((option) => option.value === preferredEditor)
        ? preferredEditor
        : (quickOptions[0]?.value ?? null);
    return (
      <div
        aria-label="Open in editor"
        role="group"
        ref={panelAnchorRef}
        className="flex w-full items-center gap-1.5"
      >
        <div
          className={cn(
            "grid min-w-0 flex-1 gap-1.5",
            quickOptions.length === 1
              ? "grid-cols-1"
              : quickOptions.length === 2
                ? "grid-cols-2"
                : "grid-cols-[1.16fr_0.86fr_0.98fr]",
          )}
        >
          {quickOptions.map((option) => {
            const isFavorite = option.value === favoriteEditorId;
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Open in ${option.label}`}
                      data-toolbar-control=""
                      disabled={!openInCwd || !canOpenEditor}
                      {...(enableShortcut && !backgroundThread && isFavorite
                        ? { [OPEN_FAVORITE_EDITOR_ATTRIBUTE]: "" }
                        : {})}
                      onClick={() => {
                        void openInEditor(option.value).then((opened) => {
                          if (opened) announce(`Opened in ${option.label}`);
                        });
                      }}
                      className="inline-flex h-7.5 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/75 bg-background/85 px-1.5 text-xs font-medium text-foreground/85 outline-none transition-[background-color,border-color,scale] hover:border-foreground/15 hover:bg-black/[0.04] active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55 dark:bg-white/[0.04] dark:hover:border-white/15 dark:hover:bg-white/[0.08]"
                    />
                  }
                >
                  <option.Icon
                    aria-hidden="true"
                    className={cn("size-3.5 shrink-0", getOpenInIconClass(option.kind))}
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                </TooltipTrigger>
                <TooltipPopup side="top">
                  Open in {option.label}
                  {isFavorite && openFavoriteEditorShortcutLabel
                    ? ` (${openFavoriteEditorShortcutLabel})`
                    : ""}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </div>
        {hasMoreEditors ? (
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    disabled={isHostEditorDenied}
                    render={
                      <button
                        type="button"
                        aria-label="Choose editor"
                        data-toolbar-control=""
                        className="grid size-7.5 shrink-0 cursor-pointer place-items-center rounded-lg border border-border/75 bg-background/85 text-muted-foreground outline-none transition-[background-color,border-color,color,scale] hover:border-foreground/15 hover:bg-black/[0.04] hover:text-foreground active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55 dark:bg-white/[0.04] dark:hover:border-white/15 dark:hover:bg-white/[0.08]"
                      />
                    }
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="top">Choose editor</TooltipPopup>
            </Tooltip>
            <MenuPopup align="end" anchor={panelAnchorRef} className="w-(--anchor-width)">
              {editorItems}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
    );
  }

  const primaryControlLabel = compact ? "Open file in preferred editor" : primaryLabel;
  const primaryControl = (
    <ThreadDetailsControl
      aria-label={primaryControlLabel}
      // Tooltip replaces the button data-slot, so toolbar theming needs a separate hook.
      data-toolbar-control=""
      size={isPanel ? "sm" : "xs"}
      variant={isPanel ? "ghost" : "outline"}
      part="primary"
      panel={isPanel}
      disabled={!preferredEditor || !openInCwd || !canOpenEditor}
      {...(enableShortcut && !backgroundThread ? { [OPEN_FAVORITE_EDITOR_ATTRIBUTE]: "" } : {})}
      onClick={() => {
        if (!preferredEditor) return;
        const label = editorLabelForPlatform(preferredEditor, navigator.platform);
        void openInEditor(preferredEditor).then((opened) => {
          if (opened) announce(`Opened in ${label}`);
        });
      }}
    >
      {primaryOption?.Icon ? (
        <primaryOption.Icon
          aria-hidden="true"
          className={cn(
            isPanel ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3.5",
            getOpenInIconClass(primaryOption.kind),
          )}
        />
      ) : isPanel ? (
        <SquareArrowOutUpRightIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      ) : null}
      <span
        className={cn(
          compact
            ? "sr-only"
            : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5",
          isPanel && cn("not-sr-only ml-0 min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS),
        )}
      >
        {primaryLabel}
      </span>
    </ThreadDetailsControl>
  );

  return (
    <ActionGroup
      aria-label="Open in editor"
      role="group"
      {...(isPanel
        ? { className: THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS, ref: panelAnchorRef }
        : {})}
    >
      <Tooltip>
        <TooltipTrigger render={primaryControl} />
        <TooltipPopup side="top">{primaryControlLabel}</TooltipPopup>
      </Tooltip>
      {isPanel ? (
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
      ) : (
        <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      )}
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                disabled={isHostEditorDenied}
                render={
                  <ThreadDetailsControl
                    aria-label="Choose editor"
                    data-toolbar-control=""
                    size={isPanel ? "sm" : "icon-xs"}
                    variant={isPanel ? "ghost" : "outline"}
                    part="secondary"
                    panel={isPanel}
                  />
                }
              />
            }
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={isPanel ? THREAD_DETAILS_PANEL_CHEVRON_CLASS : "size-4"}
            />
          </TooltipTrigger>
          <TooltipPopup side="top">Choose editor</TooltipPopup>
        </Tooltip>
        <MenuPopup
          align="end"
          {...(isPanel ? { anchor: panelAnchorRef } : {})}
          className={isPanel ? "w-(--anchor-width)" : undefined}
        >
          {editorItems}
        </MenuPopup>
      </Menu>
    </ActionGroup>
  );
});
