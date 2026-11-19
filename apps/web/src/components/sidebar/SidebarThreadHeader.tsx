import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  hasProjects: boolean;
  dragRegion?: boolean;
  projectScope: ReactNode;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  searchToggleRef?: RefObject<HTMLButtonElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  hasProjects,
  dragRegion = false,
  projectScope,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchOpen,
  onToggleSearch,
  searchToggleRef,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";

  return (
    <div className="flex flex-col">
      <div
        data-thread-tools-bar=""
        className={cn("flex h-8 items-center", dragRegion && "drag-region")}
      >
        <div className="ms-auto flex shrink-0 items-center">
          <SidebarHeaderIconButton
            ref={searchToggleRef}
            label="Search threads"
            data-thread-search-toggle=""
            aria-expanded={searchOpen}
            aria-controls="sidebar-thread-search-panel"
            isActive={searchOpen}
            onClick={onToggleSearch}
          >
            <SearchIcon />
          </SidebarHeaderIconButton>
          {hasProjects ? (
            <>
              {projectScope}
              <SidebarHeaderIconButton label="Add project" onClick={onNewProject}>
                <FolderPlusIcon />
              </SidebarHeaderIconButton>
            </>
          ) : null}
          <SidebarHeaderIconButton
            label="New thread"
            tooltip={
              showNewThreadInProjectHint ? (
                <span className="flex flex-col gap-0.5">
                  <span>{newThreadLabel}</span>
                  <span className="text-muted-foreground">
                    New thread in current project: Shift+click
                    {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
                  </span>
                </span>
              ) : (
                newThreadLabel
              )
            }
            disabled={newThreadDisabled}
            onClick={onNewThread}
          >
            <SquarePenIcon />
          </SidebarHeaderIconButton>
        </div>
      </div>
      <div
        id="sidebar-thread-search-panel"
        data-thread-search-tray=""
        data-state={searchOpen ? "open" : "closed"}
        aria-hidden={!searchOpen}
        inert={!searchOpen ? true : undefined}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          searchOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            data-thread-search=""
            className="mt-1.5 flex h-8 min-w-0 items-center gap-2 rounded-md bg-sidebar-row-hover px-2 py-1.5 text-sm font-normal text-sidebar-muted-foreground ring-1 ring-inset ring-sidebar-border/70 transition-colors hover:text-sidebar-foreground focus-within:bg-background focus-within:text-sidebar-foreground focus-within:ring-ring/70"
          >
            <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
            {/* Native search inputs clear on Escape even during IME composition. */}
            <SidebarInput
              size="sm"
              ref={searchInputRef}
              nativeInput
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search"
              aria-label="Search threads"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={resultsVisible}
              aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
              aria-activedescendant={
                activeResultExists
                  ? `sidebar-thread-search-result-${activeSearchResultIndex}`
                  : undefined
              }
              className="min-w-0 flex-1"
            />
            {isSearching || searchQuery.length > 0 ? (
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                className="shrink-0"
                aria-label="Clear thread search"
                onClick={() => {
                  onClearSearch();
                  searchInputRef.current?.focus();
                }}
              >
                <XIcon className="size-3" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
