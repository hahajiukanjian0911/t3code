# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer in chat,
or to the previous control on other pages. Choosing a workspace focus command moves to that
area instead. Opening Pull Requests moves focus into that page.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

## Move between workspace areas

On web and desktop, press `F6` or `Shift+F6` to move between the Threads sidebar,
conversation, message input, and visible panels. Navigation wraps around and restores
the last focused control in each area. Pull Requests has a page content area. In Settings,
`F6` moves between the section list and the open section. Hidden areas are skipped. Other
dialogs and form popups retain focus; a thread context menu closes when an area command
moves focus away.

In a browser, plain `F6` may move to the browser's own toolbar. Use `mod+F6` and
`mod+Shift+F6` instead (`mod` is Command on macOS and Ctrl elsewhere). **Focus Next
Workspace Area** and **Focus Previous Workspace Area** are also in the command palette and
can be remapped in Settings > Keybindings.

In a chat workspace, move focus toward a neighboring window with `Ctrl+Command` on macOS
or `Ctrl+Alt` on Windows and Linux, plus an arrow key or `H/J/K/L`. Add `M` to the same
modifiers to maximize or restore a split within its panel. Press `Ctrl+1/2/3/4` on macOS
or `Alt+1/2/3/4` elsewhere to focus the left panel, main composer, right panel or bottom panel.
On macOS, `Cmd+K` returns to the main composer with the other panels still open.
To move a tool window, hold the directional focus modifiers plus Shift, then press `H` for
left, `L` for right, `J` for bottom or Space to float it.

Press `Shift+Esc` or double-click the window title bar to maximize or restore a window in
the app. Tool tabs in the right panel automatically share half of the workspace alongside
your conversation while keeping the Threads sidebar open; `Shift+Esc` expands the active
chat or tool window to fill the app and restores your layout on the next press.

## Browse threads

Tab moves through each thread and its buttons. Up and Down also move between threads
without opening them; Enter opens the focused thread or toggles a group. Right and Left
expand and collapse groups. `F2` renames the focused thread.

Press `Shift+F10` or the Context Menu key to open the focused thread's menu. Use the arrow
keys to move through it, Enter to choose, and Escape to close it.

The Settings section list works the same way: Tab moves through each section, Up and Down
also move between sections without opening them, and Enter opens one.
