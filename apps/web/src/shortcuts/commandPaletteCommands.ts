import type { AnyRouter } from "@tanstack/react-router";

import {
  dispatchCommandPalette,
  isCommandPaletteMounted,
  useCommandPaletteStore,
} from "../commandPaletteStore";
import { overlayModeForCommand } from "../components/CommandPalette.logic";
import { APPEARANCE_OPTIONS, notifyThemeSaveFailure } from "../components/CommandPaletteThemeItems";
import { toggleThemeEditorForTheme } from "../components/settings/themeEditorStore";
import { toastManager } from "../components/ui/toast";
import { getThemeSnapshot, setAppearanceMode } from "../hooks/useTheme";
import { queueWorkspaceFocusFromPalette } from "../lib/workspaceFocus";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import {
  type CommandHandler,
  type CommandScopeOptions,
  dispatchMenuAction,
  registerCommands,
  registerMenuAction,
} from "./dispatcher";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteTarget } from "../threadRoutes";

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

const toggleOverlay =
  (command: Parameters<typeof overlayModeForCommand>[0]): CommandHandler =>
  (event) => {
    const mode = overlayModeForCommand(command);
    if (mode === null) return false;
    consume(event);
    dispatchCommandPalette({ _tag: "ToggleMode", mode });
  };

/**
 * Palette, theme and usage shortcuts. They read the route, panels and theme
 * when the key is pressed, and are live only while the palette is mounted.
 */
export function installCommandPaletteCommands(
  router: AnyRouter,
  options: Pick<CommandScopeOptions, "keybindings"> = {},
): () => void {
  const readRouteThreadRef = () => {
    const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    return target?.kind === "server" ? target.threadRef : null;
  };
  const context = () => {
    const threadRef = readRouteThreadRef();
    return {
      terminalOpen: threadRef
        ? selectThreadTerminalUiState(
            useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
            threadRef,
          ).terminalOpen
        : false,
      previewOpen: threadRef
        ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "preview"
        : false,
      usagePageOpen: router.state.location.pathname === "/usage",
    };
  };
  const togglePalette = () => {
    if (isCommandPaletteMounted()) dispatchCommandPalette({ _tag: "ToggleMode", mode: "command" });
  };
  const focusCompactComposer = () => {
    const composerArea = document.querySelector<HTMLElement>(
      '[data-workspace-area="composer"]:not([data-side-chat-pane] *)',
    );
    const editor = document.querySelector<HTMLElement>(
      '[data-workspace-area="composer"] [data-testid="composer-editor"]:not([data-side-chat-pane] *)',
    );
    const conversation = document.querySelector<HTMLElement>(
      '[data-workspace-area="conversation"]:not([data-side-chat-pane] *) [data-workspace-focus-default], [data-workspace-area="conversation"]:not([data-side-chat-pane] *)',
    );
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (composerArea?.contains(active) || editor?.contains(active)) &&
      conversation
    ) {
      conversation.focus({ preventScroll: true });
      return document.activeElement === conversation;
    }
    const target = editor ?? conversation;
    target?.focus({ preventScroll: true });
    return !!target && document.activeElement === target;
  };

  // A child search (files, contents) goes back to the palette on Escape before
  // its own widgets or the dialog can treat the key as a close.
  const disposeCapture = registerCommands(
    {
      "commandPalette.toggle": (event) => {
        consume(event);
        if (!event.repeat) togglePalette();
      },
      "workspace.focusPanel.main": (event) => {
        const dialog =
          event.target instanceof Element
            ? event.target.closest('[role="dialog"], [role="alertdialog"]')
            : null;
        const docked = document.querySelector("[data-workspace-dock]") !== null;
        if (
          dialog?.hasAttribute("data-command-palette") &&
          !document.querySelector("[data-app-modal]")
        ) {
          queueWorkspaceFocusFromPalette(
            docked ? () => dispatchMenuAction("workspace.focusPanel.main") : focusCompactComposer,
          );
          dispatchCommandPalette({ _tag: "SetOpen", open: false });
        } else if (dialog || docked || !focusCompactComposer()) return false;
        consume(event);
      },
    },
    {
      ...options,
      context,
      capture: true,
      when: (event) =>
        isCommandPaletteMounted() &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        !(event.target instanceof Element && event.target.closest("[data-keybinding-capture]")),
      onKeyDown: (event) => {
        if (event.key !== "Escape") return false;
        const { open, mode } = useCommandPaletteStore.getState();
        if (!open || mode === "command") return false;
        consume(event);
        dispatchCommandPalette({ _tag: "BackToCommand" });
      },
    },
  );

  const disposeCommands = registerCommands(
    {
      "appearance.cycle": (event) => {
        consume(event);
        if (event.repeat) return;
        const { appearanceMode } = getThemeSnapshot();
        const nextMode =
          appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
        if (!setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
          return;
        }
        toastManager.add({
          id: "appearance-cycle",
          title: `Appearance: ${APPEARANCE_OPTIONS.find((option) => option.mode === nextMode)?.label}`,
          timeout: 1500,
        });
      },
      "theme.select": (event) => {
        consume(event);
        if (event.repeat) return;
        dispatchCommandPalette({ _tag: "OpenChangeTheme" });
      },
      "themeEditor.toggle": (event) => {
        consume(event);
        const { theme, themeHalves, resolvedTheme } = getThemeSnapshot();
        toggleThemeEditorForTheme({ theme, themeHalves, initialAppearance: resolvedTheme });
      },
      "usage.open": (event) => {
        consume(event);
        dispatchCommandPalette({ _tag: "SetOpen", open: false });
        void router.navigate({ to: "/usage" });
      },
      "filePicker.toggle": toggleOverlay("filePicker.toggle"),
      "projectSearch.toggle": toggleOverlay("projectSearch.toggle"),
    },
    {
      ...options,
      when: isCommandPaletteMounted,
      context,
    },
  );

  const disposeMenu = registerMenuAction("commandPalette.toggle", togglePalette);
  return () => {
    disposeMenu();
    disposeCapture();
    disposeCommands();
  };
}
