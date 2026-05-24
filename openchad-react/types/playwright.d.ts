// Comprehensive Playwright type definitions for Monaco Editor
declare interface Page {
  // Event listeners
  on(event: 'close', listener: (page: Page) => any): this;
  on(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  on(event: 'crash', listener: (page: Page) => any): this;
  on(event: 'dialog', listener: (dialog: Dialog) => any): this;
  on(event: 'domcontentloaded', listener: (page: Page) => any): this;
  on(event: 'download', listener: (download: Download) => any): this;
  on(event: 'filechooser', listener: (fileChooser: FileChooser) => any): this;
  on(event: 'frameattached', listener: (frame: Frame) => any): this;
  on(event: 'framedetached', listener: (frame: Frame) => any): this;
  on(event: 'framenavigated', listener: (frame: Frame) => any): this;
  on(event: 'load', listener: (page: Page) => any): this;
  on(event: 'pageerror', listener: (error: Error) => any): this;
  on(event: 'popup', listener: (page: Page) => any): this;
  on(event: 'request', listener: (request: Request) => any): this;
  on(event: 'requestfailed', listener: (request: Request) => any): this;
  on(event: 'requestfinished', listener: (request: Request) => any): this;
  on(event: 'response', listener: (response: Response) => any): this;
  on(event: 'websocket', listener: (webSocket: WebSocket) => any): this;
  on(event: 'worker', listener: (worker: Worker) => any): this;
  once(event: 'close', listener: (page: Page) => any): this;
  once(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  once(event: 'crash', listener: (page: Page) => any): this;
  once(event: 'dialog', listener: (dialog: Dialog) => any): this;
  once(event: 'domcontentloaded', listener: (page: Page) => any): this;
  once(event: 'download', listener: (download: Download) => any): this;
  once(event: 'filechooser', listener: (fileChooser: FileChooser) => any): this;
  once(event: 'frameattached', listener: (frame: Frame) => any): this;
  once(event: 'framedetached', listener: (frame: Frame) => any): this;
  once(event: 'framenavigated', listener: (frame: Frame) => any): this;
  once(event: 'load', listener: (page: Page) => any): this;
  once(event: 'pageerror', listener: (error: Error) => any): this;
  once(event: 'popup', listener: (page: Page) => any): this;
  once(event: 'request', listener: (request: Request) => any): this;
  once(event: 'requestfailed', listener: (request: Request) => any): this;
  once(event: 'requestfinished', listener: (request: Request) => any): this;
  once(event: 'response', listener: (response: Response) => any): this;
  once(event: 'websocket', listener: (webSocket: WebSocket) => any): this;
  once(event: 'worker', listener: (worker: Worker) => any): this;
  addListener(event: 'close', listener: (page: Page) => any): this;
  addListener(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  addListener(event: 'crash', listener: (page: Page) => any): this;
  addListener(event: 'dialog', listener: (dialog: Dialog) => any): this;
  addListener(event: 'domcontentloaded', listener: (page: Page) => any): this;
  addListener(event: 'download', listener: (download: Download) => any): this;
  addListener(event: 'filechooser', listener: (fileChooser: FileChooser) => any): this;
  addListener(event: 'frameattached', listener: (frame: Frame) => any): this;
  addListener(event: 'framedetached', listener: (frame: Frame) => any): this;
  addListener(event: 'framenavigated', listener: (frame: Frame) => any): this;
  addListener(event: 'load', listener: (page: Page) => any): this;
  addListener(event: 'pageerror', listener: (error: Error) => any): this;
  addListener(event: 'popup', listener: (page: Page) => any): this;
  addListener(event: 'request', listener: (request: Request) => any): this;
  addListener(event: 'requestfailed', listener: (request: Request) => any): this;
  addListener(event: 'requestfinished', listener: (request: Request) => any): this;
  addListener(event: 'response', listener: (response: Response) => any): this;
  addListener(event: 'websocket', listener: (webSocket: WebSocket) => any): this;
  addListener(event: 'worker', listener: (worker: Worker) => any): this;
  removeListener(event: 'close', listener: (page: Page) => any): this;
  removeListener(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  removeListener(event: 'crash', listener: (page: Page) => any): this;
  removeListener(event: 'dialog', listener: (dialog: Dialog) => any): this;
  removeListener(event: 'domcontentloaded', listener: (page: Page) => any): this;
  removeListener(event: 'download', listener: (download: Download) => any): this;
  removeListener(event: 'filechooser', listener: (fileChooser: FileChooser) => any): this;
  removeListener(event: 'frameattached', listener: (frame: Frame) => any): this;
  removeListener(event: 'framedetached', listener: (frame: Frame) => any): this;
  removeListener(event: 'framenavigated', listener: (frame: Frame) => any): this;
  removeListener(event: 'load', listener: (page: Page) => any): this;
  removeListener(event: 'pageerror', listener: (error: Error) => any): this;
  removeListener(event: 'popup', listener: (page: Page) => any): this;
  removeListener(event: 'request', listener: (request: Request) => any): this;
  removeListener(event: 'requestfailed', listener: (request: Request) => any): this;
  removeListener(event: 'requestfinished', listener: (request: Request) => any): this;
  removeListener(event: 'response', listener: (response: Response) => any): this;
  removeListener(event: 'websocket', listener: (webSocket: WebSocket) => any): this;
  removeListener(event: 'worker', listener: (worker: Worker) => any): this;
  off(event: 'close', listener: (page: Page) => any): this;
  off(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  off(event: 'crash', listener: (page: Page) => any): this;
  off(event: 'dialog', listener: (dialog: Dialog) => any): this;
  off(event: 'domcontentloaded', listener: (page: Page) => any): this;
  off(event: 'download', listener: (download: Download) => any): this;
  off(event: 'filechooser', listener: (fileChooser: FileChooser) => any): this;
  off(event: 'frameattached', listener: (frame: Frame) => any): this;
  off(event: 'framedetached', listener: (frame: Frame) => any): this;
  off(event: 'framenavigated', listener: (frame: Frame) => any): this;
  off(event: 'load', listener: (page: Page) => any): this;
  off(event: 'pageerror', listener: (error: Error) => any): this;
  off(event: 'popup', listener: (page: Page) => any): this;
  off(event: 'request', listener: (request: Request) => any): this;
  off(event: 'requestfailed', listener: (request: Request) => any): this;
  off(event: 'requestfinished', listener: (request: Request) => any): this;
  off(event: 'response', listener: (response: Response) => any): this;
  off(event: 'websocket', listener: (webSocket: WebSocket) => any): this;
  off(event: 'worker', listener: (worker: Worker) => any): this;
  prependListener(event: 'close', listener: (page: Page) => any): this;
  prependListener(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  prependListener(event: 'crash', listener: (page: Page) => any): this;
  prependListener(event: 'dialog', listener: (dialog: Dialog) => any): this;
  prependListener(event: 'domcontentloaded', listener: (page: Page) => any): this;
  prependListener(event: 'download', listener: (download: Download) => any): this;
  prependListener(event: 'filechooser', listener: (fileChooser: FileChooser) => any): this;
  prependListener(event: 'frameattached', listener: (frame: Frame) => any): this;
  prependListener(event: 'framedetached', listener: (frame: Frame) => any): this;
  prependListener(event: 'framenavigated', listener: (frame: Frame) => any): this;
  prependListener(event: 'load', listener: (page: Page) => any): this;
  prependListener(event: 'pageerror', listener: (error: Error) => any): this;
  prependListener(event: 'popup', listener: (page: Page) => any): this;
  prependListener(event: 'request', listener: (request: Request) => any): this;
  prependListener(event: 'requestfailed', listener: (request: Request) => any): this;
  prependListener(event: 'requestfinished', listener: (request: Request) => any): this;
  prependListener(event: 'response', listener: (response: Response) => any): this;
  prependListener(event: 'websocket', listener: (webSocket: WebSocket) => any): this;
  prependListener(event: 'worker', listener: (worker: Worker) => any): this;
  // Navigation
  goto(url: string, options?: { referer?: string; timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; }): Promise<Response | null>;
  goBack(options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; }): Promise<Response | null>;
  goForward(options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; }): Promise<Response | null>;
  reload(options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; }): Promise<Response | null>;
  // Interactions
  click(selector: string, options?: { button?: "left" | "right" | "middle"; clickCount?: number; delay?: number; force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  dblclick(selector: string, options?: { button?: "left" | "right" | "middle"; delay?: number; force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  fill(selector: string, value: string, options?: { force?: boolean; noWaitAfter?: boolean; strict?: boolean; timeout?: number; }): Promise<void>;
  type(selector: string, text: string, options?: { delay?: number; noWaitAfter?: boolean; strict?: boolean; timeout?: number; }): Promise<void>;
  press(selector: string, key: string, options?: { delay?: number; noWaitAfter?: boolean; strict?: boolean; timeout?: number; }): Promise<void>;
  check(selector: string, options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  uncheck(selector: string, options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  hover(selector: string, options?: { force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  tap(selector: string, options?: { force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  selectOption(selector: string, values: any, options?: any): Promise<string[]>;
  setInputFiles(selector: string, files: any, options?: any): Promise<void>;
  focus(selector: string, options?: { strict?: boolean; timeout?: number; }): Promise<void>;
  // Evaluation
  evaluate(pageFunction: any, arg?: any): Promise<any>;
  evaluateHandle(pageFunction: any, arg?: any): Promise<any>;
  $eval(selector: string, pageFunction: any, arg?: any): Promise<any>;
  $$eval(selector: string, pageFunction: any, arg?: any): Promise<any>;
  // Selectors
  $(selector: string, options?: { strict?: boolean }): Promise<ElementHandle | null>;
  $$(selector: string): Promise<ElementHandle[]>;
  locator(selector: string, options?: { has?: Locator; hasNot?: Locator; hasNotText?: string | RegExp; hasText?: string | RegExp; }): Locator;
  getByRole(role: "alert" | "alertdialog" | "application" | "article" | "banner" | "blockquote" | "button" | "caption" | "cell" | "checkbox" | "code" | "columnheader" | "combobox" | "complementary" | "contentinfo" | "definition" | "deletion" | "dialog" | "directory" | "document" | "emphasis" | "feed" | "figure" | "form" | "generic" | "grid" | "gridcell" | "group" | "heading" | "img" | "insertion" | "link" | "list" | "listbox" | "listitem" | "log" | "main" | "marquee" | "math" | "meter" | "menu" | "menubar" | "menuitem" | "menuitemcheckbox" | "menuitemradio" | "navigation" | "none" | "note" | "option" | "paragraph" | "presentation" | "progressbar" | "radio" | "radiogroup" | "region" | "row" | "rowgroup" | "rowheader" | "scrollbar" | "search" | "searchbox" | "separator" | "slider" | "spinbutton" | "status" | "strong" | "subscript" | "superscript" | "switch" | "tab" | "table" | "tablist" | "tabpanel" | "term" | "textbox" | "time" | "timer" | "toolbar" | "tooltip" | "tree" | "treegrid" | "treeitem", options?: { checked?: boolean; disabled?: boolean; exact?: boolean; expanded?: boolean; includeHidden?: boolean; level?: number; name?: string | RegExp; pressed?: boolean; selected?: boolean; }): Locator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string | RegExp): Locator;
  // Wait methods
  waitForSelector(selector: string, options?: { state?: "attached" | "detached" | "visible" | "hidden"; strict?: boolean; timeout?: number; }): Promise<ElementHandle | null>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle", options?: { timeout?: number; }): Promise<void>;
  waitForURL(url: string | RegExp | ((url: any) => boolean), options?: any): Promise<void>;
  waitForNavigation(options?: { timeout?: number; url?: string | RegExp | ((url: any) => boolean); waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; }): Promise<Response | null>;
  waitForFunction(pageFunction: any, arg?: any, options?: any): Promise<any>;
  waitForEvent(event: 'close', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'console', optionsOrPredicate?: { predicate?: (consoleMessage: ConsoleMessage) => boolean | Promise<boolean>; timeout?: number; } | ((consoleMessage: ConsoleMessage) => boolean | Promise<boolean>)): Promise<ConsoleMessage>;
  waitForEvent(event: 'crash', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'dialog', optionsOrPredicate?: { predicate?: (dialog: Dialog) => boolean | Promise<boolean>; timeout?: number; } | ((dialog: Dialog) => boolean | Promise<boolean>)): Promise<Dialog>;
  waitForEvent(event: 'domcontentloaded', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'download', optionsOrPredicate?: { predicate?: (download: Download) => boolean | Promise<boolean>; timeout?: number; } | ((download: Download) => boolean | Promise<boolean>)): Promise<Download>;
  waitForEvent(event: 'filechooser', optionsOrPredicate?: { predicate?: (fileChooser: FileChooser) => boolean | Promise<boolean>; timeout?: number; } | ((fileChooser: FileChooser) => boolean | Promise<boolean>)): Promise<FileChooser>;
  waitForEvent(event: 'frameattached', optionsOrPredicate?: { predicate?: (frame: Frame) => boolean | Promise<boolean>; timeout?: number; } | ((frame: Frame) => boolean | Promise<boolean>)): Promise<Frame>;
  waitForEvent(event: 'framedetached', optionsOrPredicate?: { predicate?: (frame: Frame) => boolean | Promise<boolean>; timeout?: number; } | ((frame: Frame) => boolean | Promise<boolean>)): Promise<Frame>;
  waitForEvent(event: 'framenavigated', optionsOrPredicate?: { predicate?: (frame: Frame) => boolean | Promise<boolean>; timeout?: number; } | ((frame: Frame) => boolean | Promise<boolean>)): Promise<Frame>;
  waitForEvent(event: 'load', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'pageerror', optionsOrPredicate?: { predicate?: (error: Error) => boolean | Promise<boolean>; timeout?: number; } | ((error: Error) => boolean | Promise<boolean>)): Promise<Error>;
  waitForEvent(event: 'popup', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'request', optionsOrPredicate?: { predicate?: (request: Request) => boolean | Promise<boolean>; timeout?: number; } | ((request: Request) => boolean | Promise<boolean>)): Promise<Request>;
  waitForEvent(event: 'requestfailed', optionsOrPredicate?: { predicate?: (request: Request) => boolean | Promise<boolean>; timeout?: number; } | ((request: Request) => boolean | Promise<boolean>)): Promise<Request>;
  waitForEvent(event: 'requestfinished', optionsOrPredicate?: { predicate?: (request: Request) => boolean | Promise<boolean>; timeout?: number; } | ((request: Request) => boolean | Promise<boolean>)): Promise<Request>;
  waitForEvent(event: 'response', optionsOrPredicate?: { predicate?: (response: Response) => boolean | Promise<boolean>; timeout?: number; } | ((response: Response) => boolean | Promise<boolean>)): Promise<Response>;
  waitForEvent(event: 'websocket', optionsOrPredicate?: { predicate?: (webSocket: WebSocket) => boolean | Promise<boolean>; timeout?: number; } | ((webSocket: WebSocket) => boolean | Promise<boolean>)): Promise<WebSocket>;
  waitForEvent(event: 'worker', optionsOrPredicate?: { predicate?: (worker: Worker) => boolean | Promise<boolean>; timeout?: number; } | ((worker: Worker) => boolean | Promise<boolean>)): Promise<Worker>;
  waitForRequest(urlOrPredicate: any, options?: { timeout?: number; }): Promise<Request>;
  waitForResponse(urlOrPredicate: any, options?: { timeout?: number; }): Promise<Response>;
  // Content
  content(): Promise<string>;
  setContent(html: string, options?: any): Promise<void>;
  title(): Promise<string>;
  url(): string;
  innerHTML(selector: string, options?: any): Promise<string>;
  innerText(selector: string, options?: any): Promise<string>;
  textContent(selector: string, options?: any): Promise<string | null>;
  getAttribute(selector: string, name: string, options?: any): Promise<string | null>;
  inputValue(selector: string, options?: any): Promise<string>;
  // State checks
  isChecked(selector: string, options?: any): Promise<boolean>;
  isDisabled(selector: string, options?: any): Promise<boolean>;
  isEditable(selector: string, options?: any): Promise<boolean>;
  isEnabled(selector: string, options?: any): Promise<boolean>;
  isHidden(selector: string, options?: any): Promise<boolean>;
  isVisible(selector: string, options?: any): Promise<boolean>;
  isClosed(): boolean;
  // Screenshot & PDF
  screenshot(options?: { animations?: "disabled" | "allow"; caret?: "hide" | "initial"; clip?: { x: number; y: number; width: number; height: number }; fullPage?: boolean; mask?: Locator[]; omitBackground?: boolean; path?: string; quality?: number; scale?: "css" | "device"; timeout?: number; type?: "png" | "jpeg"; }): Promise<any>;
  pdf(options?: any): Promise<any>;
  // Frames
  frame(frameSelector: string | { name?: string; url?: string | RegExp | ((url: any) => boolean); }): Frame | null;
  frameLocator(selector: string): FrameLocator;
  frames(): Frame[];
  mainFrame(): Frame;
  // Context & routing
  context(): BrowserContext;
  route(url: string | RegExp | ((url: any) => boolean), handler: any, options?: { times?: number; }): Promise<void>;
  unroute(url: string | RegExp | ((url: any) => boolean), handler?: any): Promise<void>;
  // Misc
  close(options?: { reason?: string; runBeforeUnload?: boolean; }): Promise<void>;
  bringToFront(): Promise<void>;
  emulateMedia(options?: any): Promise<void>;
  setViewportSize(viewportSize: { width: number; height: number; }): Promise<void>;
  viewportSize(): { width: number; height: number } | null;
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
  setExtraHTTPHeaders(headers: { [key: string]: string; }): Promise<void>;
  addInitScript(script: any, arg?: any): Promise<void>;
  exposeFunction(name: string, callback: Function): Promise<void>;
  pause(): Promise<void>;
  // Additional methods
  addLocatorHandler(locator: Locator, handler: (locator: Locator) => Promise<any>, options?: { noWaitAfter?: boolean; times?: number; }): Promise<void>;
  addScriptTag(options?: { content?: string; path?: string; type?: string; url?: string; }): Promise<ElementHandle>;
  addStyleTag(options?: { content?: string; path?: string; url?: string; }): Promise<ElementHandle>;
  consoleMessages(): Promise<ConsoleMessage[]>;
  dispatchEvent(selector: string, type: string, eventInit?: any, options?: { strict?: boolean; timeout?: number; }): Promise<void>;
  dragAndDrop(source: string, target: string, options?: { force?: boolean; noWaitAfter?: boolean; sourcePosition?: { x: number; y: number; }; strict?: boolean; targetPosition?: { x: number; y: number; }; timeout?: number; trial?: boolean; }): Promise<void>;
  exposeBinding(name: string, playwrightBinding: any, options?: { handle?: boolean; }): Promise<void>;
  opener(): Promise<Page | null>;
  pageErrors(): Promise<Error[]>;
  removeAllListeners(type?: string): this;
  removeLocatorHandler(locator: Locator): Promise<void>;
  requestGC(): Promise<void>;
  requests(): Promise<Request[]>;
  routeFromHAR(har: string, options?: { notFound?: "abort" | "fallback"; update?: boolean; updateContent?: "embed" | "attach"; updateMode?: "full" | "minimal"; url?: string | RegExp; }): Promise<void>;
  routeWebSocket(url: string | RegExp | ((url: any) => boolean), handler: any): Promise<void>;
  setChecked(selector: string, checked: boolean, options?: any): Promise<void>;
  unrouteAll(options?: { behavior?: "wait" | "ignoreErrors" | "default"; }): Promise<void>;
  video(): Video | null;
  workers(): Worker[];
  // Properties
  accessibility: Accessibility;
  clock: Clock;
  coverage: Coverage;
  keyboard: Keyboard;
  mouse: Mouse;
  request: APIRequestContext;
  touchscreen: Touchscreen;
  [key: string]: any;
}
declare interface Frame {
  // Selectors & evaluation
  $(selector: string, options?: { strict?: boolean }): Promise<ElementHandle | null>;
  $$(selector: string): Promise<ElementHandle[]>;
  $eval(selector: string, pageFunction: any, arg?: any): Promise<any>;
  $$eval(selector: string, pageFunction: any, arg?: any): Promise<any>;
  evaluate(pageFunction: any, arg?: any): Promise<any>;
  evaluateHandle(pageFunction: any, arg?: any): Promise<any>;
  // Locators
  locator(selector: string, options?: { has?: Locator; hasNot?: Locator; hasNotText?: string | RegExp; hasText?: string | RegExp; }): Locator;
  getByRole(role: "alert" | "alertdialog" | "application" | "article" | "banner" | "blockquote" | "button" | "caption" | "cell" | "checkbox" | "code" | "columnheader" | "combobox" | "complementary" | "contentinfo" | "definition" | "deletion" | "dialog" | "directory" | "document" | "emphasis" | "feed" | "figure" | "form" | "generic" | "grid" | "gridcell" | "group" | "heading" | "img" | "insertion" | "link" | "list" | "listbox" | "listitem" | "log" | "main" | "marquee" | "math" | "meter" | "menu" | "menubar" | "menuitem" | "menuitemcheckbox" | "menuitemradio" | "navigation" | "none" | "note" | "option" | "paragraph" | "presentation" | "progressbar" | "radio" | "radiogroup" | "region" | "row" | "rowgroup" | "rowheader" | "scrollbar" | "search" | "searchbox" | "separator" | "slider" | "spinbutton" | "status" | "strong" | "subscript" | "superscript" | "switch" | "tab" | "table" | "tablist" | "tabpanel" | "term" | "textbox" | "time" | "timer" | "toolbar" | "tooltip" | "tree" | "treegrid" | "treeitem", options?: { checked?: boolean; disabled?: boolean; exact?: boolean; expanded?: boolean; includeHidden?: boolean; level?: number; name?: string | RegExp; pressed?: boolean; selected?: boolean; }): Locator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string | RegExp): Locator;
  frameLocator(selector: string): FrameLocator;
  // Interactions
  click(selector: string, options?: { button?: "left" | "right" | "middle"; clickCount?: number; delay?: number; force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  dblclick(selector: string, options?: { button?: "left" | "right" | "middle"; delay?: number; force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  fill(selector: string, value: string, options?: { force?: boolean; noWaitAfter?: boolean; strict?: boolean; timeout?: number; }): Promise<void>;
  type(selector: string, text: string, options?: { delay?: number; noWaitAfter?: boolean; strict?: boolean; timeout?: number; }): Promise<void>;
  press(selector: string, key: string, options?: { delay?: number; noWaitAfter?: boolean; strict?: boolean; timeout?: number; }): Promise<void>;
  check(selector: string, options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  uncheck(selector: string, options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  setChecked(selector: string, checked: boolean, options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  hover(selector: string, options?: { force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  tap(selector: string, options?: { force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; strict?: boolean; timeout?: number; trial?: boolean; }): Promise<void>;
  selectOption(selector: string, values: any, options?: any): Promise<string[]>;
  setInputFiles(selector: string, files: any, options?: any): Promise<void>;
  focus(selector: string, options?: any): Promise<void>;
  dispatchEvent(selector: string, type: string, eventInit?: any, options?: { strict?: boolean; timeout?: number; }): Promise<void>;
  dragAndDrop(source: string, target: string, options?: { force?: boolean; noWaitAfter?: boolean; sourcePosition?: { x: number; y: number; }; strict?: boolean; targetPosition?: { x: number; y: number; }; timeout?: number; trial?: boolean; }): Promise<void>;
  // Script & style injection
  addScriptTag(options?: { content?: string; path?: string; type?: string; url?: string; }): Promise<ElementHandle>;
  addStyleTag(options?: { content?: string; path?: string; url?: string; }): Promise<ElementHandle>;
  // Navigation & content
  goto(url: string, options?: any): Promise<Response | null>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle", options?: any): Promise<void>;
  waitForNavigation(options?: any): Promise<Response | null>;
  waitForSelector(selector: string, options?: any): Promise<ElementHandle | null>;
  waitForFunction(pageFunction: any, arg?: any, options?: any): Promise<any>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForURL(url: any, options?: any): Promise<void>;
  content(): Promise<string>;
  setContent(html: string, options?: any): Promise<void>;
  title(): Promise<string>;
  url(): string;
  name(): string;
  // Frame hierarchy
  parentFrame(): Frame | null;
  childFrames(): Frame[];
  frameElement(): Promise<ElementHandle>;
  page(): Page;
  isDetached(): boolean;
  // Content queries
  innerHTML(selector: string, options?: any): Promise<string>;
  innerText(selector: string, options?: any): Promise<string>;
  textContent(selector: string, options?: any): Promise<string | null>;
  getAttribute(selector: string, name: string, options?: any): Promise<string | null>;
  inputValue(selector: string, options?: any): Promise<string>;
  // State checks
  isChecked(selector: string, options?: any): Promise<boolean>;
  isDisabled(selector: string, options?: any): Promise<boolean>;
  isEditable(selector: string, options?: any): Promise<boolean>;
  isEnabled(selector: string, options?: any): Promise<boolean>;
  isHidden(selector: string, options?: any): Promise<boolean>;
  isVisible(selector: string, options?: any): Promise<boolean>;
  [key: string]: any;
}
declare interface BrowserContext {
  // Event listeners
  on(event: 'backgroundpage', listener: (page: Page) => any): this;
  on(event: 'close', listener: (browserContext: BrowserContext) => any): this;
  on(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  on(event: 'dialog', listener: (dialog: Dialog) => any): this;
  on(event: 'page', listener: (page: Page) => any): this;
  on(event: 'request', listener: (request: Request) => any): this;
  on(event: 'requestfailed', listener: (request: Request) => any): this;
  on(event: 'requestfinished', listener: (request: Request) => any): this;
  on(event: 'response', listener: (response: Response) => any): this;
  on(event: 'serviceworker', listener: (worker: Worker) => any): this;
  on(event: 'weberror', listener: (webError: WebError) => any): this;
  once(event: 'backgroundpage', listener: (page: Page) => any): this;
  once(event: 'close', listener: (browserContext: BrowserContext) => any): this;
  once(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  once(event: 'dialog', listener: (dialog: Dialog) => any): this;
  once(event: 'page', listener: (page: Page) => any): this;
  once(event: 'request', listener: (request: Request) => any): this;
  once(event: 'requestfailed', listener: (request: Request) => any): this;
  once(event: 'requestfinished', listener: (request: Request) => any): this;
  once(event: 'response', listener: (response: Response) => any): this;
  once(event: 'serviceworker', listener: (worker: Worker) => any): this;
  once(event: 'weberror', listener: (webError: WebError) => any): this;
  addListener(event: 'backgroundpage', listener: (page: Page) => any): this;
  addListener(event: 'close', listener: (browserContext: BrowserContext) => any): this;
  addListener(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  addListener(event: 'dialog', listener: (dialog: Dialog) => any): this;
  addListener(event: 'page', listener: (page: Page) => any): this;
  addListener(event: 'request', listener: (request: Request) => any): this;
  addListener(event: 'requestfailed', listener: (request: Request) => any): this;
  addListener(event: 'requestfinished', listener: (request: Request) => any): this;
  addListener(event: 'response', listener: (response: Response) => any): this;
  addListener(event: 'serviceworker', listener: (worker: Worker) => any): this;
  addListener(event: 'weberror', listener: (webError: WebError) => any): this;
  removeListener(event: 'backgroundpage', listener: (page: Page) => any): this;
  removeListener(event: 'close', listener: (browserContext: BrowserContext) => any): this;
  removeListener(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  removeListener(event: 'dialog', listener: (dialog: Dialog) => any): this;
  removeListener(event: 'page', listener: (page: Page) => any): this;
  removeListener(event: 'request', listener: (request: Request) => any): this;
  removeListener(event: 'requestfailed', listener: (request: Request) => any): this;
  removeListener(event: 'requestfinished', listener: (request: Request) => any): this;
  removeListener(event: 'response', listener: (response: Response) => any): this;
  removeListener(event: 'serviceworker', listener: (worker: Worker) => any): this;
  removeListener(event: 'weberror', listener: (webError: WebError) => any): this;
  off(event: 'backgroundpage', listener: (page: Page) => any): this;
  off(event: 'close', listener: (browserContext: BrowserContext) => any): this;
  off(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  off(event: 'dialog', listener: (dialog: Dialog) => any): this;
  off(event: 'page', listener: (page: Page) => any): this;
  off(event: 'request', listener: (request: Request) => any): this;
  off(event: 'requestfailed', listener: (request: Request) => any): this;
  off(event: 'requestfinished', listener: (request: Request) => any): this;
  off(event: 'response', listener: (response: Response) => any): this;
  off(event: 'serviceworker', listener: (worker: Worker) => any): this;
  off(event: 'weberror', listener: (webError: WebError) => any): this;
  prependListener(event: 'backgroundpage', listener: (page: Page) => any): this;
  prependListener(event: 'close', listener: (browserContext: BrowserContext) => any): this;
  prependListener(event: 'console', listener: (consoleMessage: ConsoleMessage) => any): this;
  prependListener(event: 'dialog', listener: (dialog: Dialog) => any): this;
  prependListener(event: 'page', listener: (page: Page) => any): this;
  prependListener(event: 'request', listener: (request: Request) => any): this;
  prependListener(event: 'requestfailed', listener: (request: Request) => any): this;
  prependListener(event: 'requestfinished', listener: (request: Request) => any): this;
  prependListener(event: 'response', listener: (response: Response) => any): this;
  prependListener(event: 'serviceworker', listener: (worker: Worker) => any): this;
  prependListener(event: 'weberror', listener: (webError: WebError) => any): this;
  // Pages
  newPage(): Promise<Page>;
  pages(): Page[];
  backgroundPages(): Page[];
  serviceWorkers(): Worker[];
  // Cookies
  addCookies(cookies: Array<{ name: string; value: string; url?: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None"; }>): Promise<void>;
  cookies(urls?: string | string[]): Promise<Array<any>>;
  clearCookies(options?: any): Promise<void>;
  // Routing
  route(url: string | RegExp | ((url: any) => boolean), handler: any, options?: { times?: number; }): Promise<void>;
  unroute(url: string | RegExp | ((url: any) => boolean), handler?: any): Promise<void>;
  unrouteAll(options?: { behavior?: "wait" | "ignoreErrors" | "default"; }): Promise<void>;
  routeFromHAR(har: string, options?: { notFound?: "abort" | "fallback"; update?: boolean; updateContent?: "embed" | "attach"; updateMode?: "full" | "minimal"; url?: string | RegExp; }): Promise<void>;
  routeWebSocket(url: string | RegExp | ((url: any) => boolean), handler: any): Promise<void>;
  // Settings
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
  setExtraHTTPHeaders(headers: { [key: string]: string; }): Promise<void>;
  setGeolocation(geolocation: { latitude: number; longitude: number; accuracy?: number; } | null): Promise<void>;
  setHTTPCredentials(httpCredentials: { username: string; password: string; } | null): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  grantPermissions(permissions: string[], options?: { origin?: string; }): Promise<void>;
  clearPermissions(): Promise<void>;
  // Storage
  storageState(options?: { indexedDB?: boolean; path?: string; }): Promise<{ cookies: Array<any>; origins: Array<any>; }>;
  // CDP
  newCDPSession(page: Page | Frame): Promise<CDPSession>;
  // Wait for events
  waitForEvent(event: 'backgroundpage', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'close', optionsOrPredicate?: { predicate?: (browserContext: BrowserContext) => boolean | Promise<boolean>; timeout?: number; } | ((browserContext: BrowserContext) => boolean | Promise<boolean>)): Promise<BrowserContext>;
  waitForEvent(event: 'console', optionsOrPredicate?: { predicate?: (consoleMessage: ConsoleMessage) => boolean | Promise<boolean>; timeout?: number; } | ((consoleMessage: ConsoleMessage) => boolean | Promise<boolean>)): Promise<ConsoleMessage>;
  waitForEvent(event: 'dialog', optionsOrPredicate?: { predicate?: (dialog: Dialog) => boolean | Promise<boolean>; timeout?: number; } | ((dialog: Dialog) => boolean | Promise<boolean>)): Promise<Dialog>;
  waitForEvent(event: 'page', optionsOrPredicate?: { predicate?: (page: Page) => boolean | Promise<boolean>; timeout?: number; } | ((page: Page) => boolean | Promise<boolean>)): Promise<Page>;
  waitForEvent(event: 'request', optionsOrPredicate?: { predicate?: (request: Request) => boolean | Promise<boolean>; timeout?: number; } | ((request: Request) => boolean | Promise<boolean>)): Promise<Request>;
  waitForEvent(event: 'requestfailed', optionsOrPredicate?: { predicate?: (request: Request) => boolean | Promise<boolean>; timeout?: number; } | ((request: Request) => boolean | Promise<boolean>)): Promise<Request>;
  waitForEvent(event: 'requestfinished', optionsOrPredicate?: { predicate?: (request: Request) => boolean | Promise<boolean>; timeout?: number; } | ((request: Request) => boolean | Promise<boolean>)): Promise<Request>;
  waitForEvent(event: 'response', optionsOrPredicate?: { predicate?: (response: Response) => boolean | Promise<boolean>; timeout?: number; } | ((response: Response) => boolean | Promise<boolean>)): Promise<Response>;
  waitForEvent(event: 'serviceworker', optionsOrPredicate?: { predicate?: (worker: Worker) => boolean | Promise<boolean>; timeout?: number; } | ((worker: Worker) => boolean | Promise<boolean>)): Promise<Worker>;
  waitForEvent(event: 'weberror', optionsOrPredicate?: { predicate?: (webError: WebError) => boolean | Promise<boolean>; timeout?: number; } | ((webError: WebError) => boolean | Promise<boolean>)): Promise<WebError>;
  // Misc
  close(options?: { reason?: string; }): Promise<void>;
  browser(): Browser | null;
  exposeFunction(name: string, callback: Function): Promise<void>;
  exposeBinding(name: string, playwrightBinding: any, options?: { handle?: boolean; }): Promise<void>;
  addInitScript(script: any, arg?: any): Promise<void>;
  removeAllListeners(type?: string): this;
  [key: string]: any;
}
declare interface Browser {
  // Event listeners
  on(event: 'disconnected', listener: (browser: Browser) => any): this;
  once(event: 'disconnected', listener: (browser: Browser) => any): this;
  addListener(event: 'disconnected', listener: (browser: Browser) => any): this;
  removeListener(event: 'disconnected', listener: (browser: Browser) => any): this;
  off(event: 'disconnected', listener: (browser: Browser) => any): this;
  prependListener(event: 'disconnected', listener: (browser: Browser) => any): this;
  // Methods
  browserType(): BrowserType;
  close(): Promise<void>;
  contexts(): BrowserContext[];
  isConnected(): boolean;
  newBrowserCDPSession(): Promise<CDPSession>;
  newContext(options?: any): Promise<BrowserContext>;
  newPage(options?: any): Promise<Page>;
  startTracing(page?: Page, options?: { categories?: string[]; path?: string; screenshots?: boolean; }): Promise<void>;
  stopTracing(): Promise<any>;
  version(): string;
  [key: string]: any;
}
declare interface Locator {
  // Actions
  click(options?: { button?: "left" | "right" | "middle"; clickCount?: number; delay?: number; force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  dblclick(options?: { button?: "left" | "right" | "middle"; delay?: number; force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  fill(value: string, options?: { force?: boolean; noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  type(text: string, options?: { delay?: number; noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  press(key: string, options?: { delay?: number; noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  pressSequentially(text: string, options?: { delay?: number; noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  check(options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  uncheck(options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  setChecked(checked: boolean, options?: { force?: boolean; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  hover(options?: { force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  tap(options?: { force?: boolean; modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">; noWaitAfter?: boolean; position?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  focus(options?: { timeout?: number; }): Promise<void>;
  blur(options?: { timeout?: number; }): Promise<void>;
  clear(options?: { force?: boolean; noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  selectOption(values: string | ElementHandle | Array<string> | { value?: string; label?: string; index?: number; } | Array<ElementHandle> | Array<{ value?: string; label?: string; index?: number; }>, options?: { force?: boolean; noWaitAfter?: boolean; timeout?: number; }): Promise<string[]>;
  selectText(options?: { force?: boolean; timeout?: number; }): Promise<void>;
  setInputFiles(files: string | Array<string> | { name: string; mimeType: string; buffer: any; } | Array<{ name: string; mimeType: string; buffer: any; }>, options?: { noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  dispatchEvent(type: string, eventInit?: any, options?: { timeout?: number; }): Promise<void>;
  dragTo(target: Locator, options?: { force?: boolean; noWaitAfter?: boolean; sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number }; timeout?: number; trial?: boolean; }): Promise<void>;
  scrollIntoViewIfNeeded(options?: { timeout?: number; }): Promise<void>;
  // Content & attributes
  textContent(options?: { timeout?: number; }): Promise<string | null>;
  innerText(options?: { timeout?: number; }): Promise<string>;
  innerHTML(options?: { timeout?: number; }): Promise<string>;
  getAttribute(name: string, options?: { timeout?: number; }): Promise<string | null>;
  inputValue(options?: { timeout?: number; }): Promise<string>;
  // State checks
  isChecked(options?: { timeout?: number; }): Promise<boolean>;
  isDisabled(options?: { timeout?: number; }): Promise<boolean>;
  isEditable(options?: { timeout?: number; }): Promise<boolean>;
  isEnabled(options?: { timeout?: number; }): Promise<boolean>;
  isHidden(options?: { timeout?: number; }): Promise<boolean>;
  isVisible(options?: { timeout?: number; }): Promise<boolean>;
  // Filtering & navigation
  and(locator: Locator): Locator;
  or(locator: Locator): Locator;
  filter(options?: { has?: Locator; hasNot?: Locator; hasNotText?: string | RegExp; hasText?: string | RegExp; }): Locator;
  locator(selector: string, options?: { has?: Locator; hasNot?: Locator; hasNotText?: string | RegExp; hasText?: string | RegExp; }): Locator;
  getByRole(role: "alert" | "alertdialog" | "application" | "article" | "banner" | "blockquote" | "button" | "caption" | "cell" | "checkbox" | "code" | "columnheader" | "combobox" | "complementary" | "contentinfo" | "definition" | "deletion" | "dialog" | "directory" | "document" | "emphasis" | "feed" | "figure" | "form" | "generic" | "grid" | "gridcell" | "group" | "heading" | "img" | "insertion" | "link" | "list" | "listbox" | "listitem" | "log" | "main" | "marquee" | "math" | "meter" | "menu" | "menubar" | "menuitem" | "menuitemcheckbox" | "menuitemradio" | "navigation" | "none" | "note" | "option" | "paragraph" | "presentation" | "progressbar" | "radio" | "radiogroup" | "region" | "row" | "rowgroup" | "rowheader" | "scrollbar" | "search" | "searchbox" | "separator" | "slider" | "spinbutton" | "status" | "strong" | "subscript" | "superscript" | "switch" | "tab" | "table" | "tablist" | "tabpanel" | "term" | "textbox" | "time" | "timer" | "toolbar" | "tooltip" | "tree" | "treegrid" | "treeitem", options?: { checked?: boolean; disabled?: boolean; exact?: boolean; expanded?: boolean; includeHidden?: boolean; level?: number; name?: string | RegExp; pressed?: boolean; selected?: boolean; }): Locator;
  getByText(text: string | RegExp, options?: { exact?: boolean; }): Locator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean; }): Locator;
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean; }): Locator;
  getByAltText(text: string | RegExp, options?: { exact?: boolean; }): Locator;
  getByTitle(text: string | RegExp, options?: { exact?: boolean; }): Locator;
  getByTestId(testId: string | RegExp): Locator;
  contentFrame(): FrameLocator;
  frameLocator(selector: string): FrameLocator;
  // Collection methods
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  all(): Promise<Locator[]>;
  // Wait & evaluate
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number; }): Promise<void>;
  evaluate(pageFunction: any, arg?: any): Promise<any>;
  evaluateAll(pageFunction: any, arg?: any): Promise<any>;
  evaluateHandle(pageFunction: any, arg?: any): Promise<any>;
  // Screenshot
  screenshot(options?: { animations?: "disabled" | "allow"; caret?: "hide" | "initial"; mask?: Locator[]; omitBackground?: boolean; path?: string; quality?: number; scale?: "css" | "device"; timeout?: number; type?: "png" | "jpeg"; }): Promise<any>;
  // Misc
  boundingBox(options?: { timeout?: number; }): Promise<{ x: number; y: number; width: number; height: number } | null>;
  elementHandle(options?: { timeout?: number; }): Promise<ElementHandle>;
  elementHandles(): Promise<ElementHandle[]>;
  highlight(): Promise<void>;
  [key: string]: any;
}
declare interface ElementHandle {
  $(selector: string): Promise<ElementHandle | null>;
  $$(selector: string): Promise<ElementHandle[]>;
  $eval(selector: string, pageFunction: any, arg?: any): Promise<any>;
  $$eval(selector: string, pageFunction: any, arg?: any): Promise<any>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  check(options?: any): Promise<void>;
  click(options?: any): Promise<void>;
  contentFrame(): Promise<Frame | null>;
  dblclick(options?: any): Promise<void>;
  dispatchEvent(type: string, eventInit?: any): Promise<void>;
  evaluate(pageFunction: any, arg?: any): Promise<any>;
  evaluateHandle(pageFunction: any, arg?: any): Promise<any>;
  fill(value: string, options?: any): Promise<void>;
  focus(): Promise<void>;
  getAttribute(name: string): Promise<string | null>;
  hover(options?: any): Promise<void>;
  innerHTML(): Promise<string>;
  innerText(): Promise<string>;
  inputValue(options?: any): Promise<string>;
  isChecked(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  isEditable(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  isHidden(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  ownerFrame(): Promise<Frame | null>;
  press(key: string, options?: any): Promise<void>;
  screenshot(options?: any): Promise<any>;
  scrollIntoViewIfNeeded(options?: { timeout?: number; }): Promise<void>;
  selectOption(values: any, options?: any): Promise<string[]>;
  selectText(options?: { force?: boolean; timeout?: number; }): Promise<void>;
  setChecked(checked: boolean, options?: any): Promise<void>;
  setInputFiles(files: any, options?: any): Promise<void>;
  tap(options?: any): Promise<void>;
  textContent(): Promise<string | null>;
  type(text: string, options?: any): Promise<void>;
  uncheck(options?: any): Promise<void>;
  waitForElementState(state: "visible" | "hidden" | "stable" | "enabled" | "disabled" | "editable", options?: { timeout?: number; }): Promise<void>;
  waitForSelector(selector: string, options?: any): Promise<ElementHandle | null>;
  [key: string]: any;
}
declare interface Request {
  url(): string;
  method(): string;
  postData(): string | null;
  postDataJSON(): any;
  headers(): { [key: string]: string; };
  allHeaders(): Promise<{ [key: string]: string; }>;
  headerValue(name: string): Promise<string | null>;
  response(): Promise<Response | null>;
  frame(): Frame;
  isNavigationRequest(): boolean;
  redirectedFrom(): Request | null;
  redirectedTo(): Request | null;
  failure(): { errorText: string; } | null;
  timing(): any;
  resourceType(): string;
  [key: string]: any;
}
declare interface Response {
  url(): string;
  status(): number;
  statusText(): string;
  ok(): boolean;
  headers(): { [key: string]: string; };
  allHeaders(): Promise<{ [key: string]: string; }>;
  headerValue(name: string): Promise<string | null>;
  headerValues(name: string): Promise<string[]>;
  body(): Promise<any>;
  text(): Promise<string>;
  json(): Promise<any>;
  finished(): Promise<Error | null>;
  frame(): Frame;
  request(): Request;
  securityDetails(): Promise<any>;
  serverAddr(): Promise<{ ipAddress: string; port: number; } | null>;
  [key: string]: any;
}
declare interface Dialog {
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
  message(): string;
  type(): string;
  defaultValue(): string;
  page(): Page | null;
  [key: string]: any;
}
declare interface Download {
  cancel(): Promise<void>;
  delete(): Promise<void>;
  failure(): Promise<string | null>;
  path(): Promise<string>;
  saveAs(path: string): Promise<void>;
  suggestedFilename(): string;
  url(): string;
  page(): Page;
  [key: string]: any;
}
declare interface FileChooser {
  element(): ElementHandle;
  isMultiple(): boolean;
  page(): Page;
  setFiles(files: any, options?: { noWaitAfter?: boolean; timeout?: number; }): Promise<void>;
  [key: string]: any;
}
declare interface ConsoleMessage {
  args(): any[];
  text(): string;
  type(): "log" | "debug" | "info" | "error" | "warning" | "dir" | "dirxml" | "table" | "trace" | "clear" | "startGroup" | "startGroupCollapsed" | "endGroup" | "assert" | "profile" | "profileEnd" | "count" | "timeEnd";
  location(): { url: string; lineNumber: number; columnNumber: number; };
  page(): Page | null;
  [key: string]: any;
}
declare interface FrameLocator {
  first(): FrameLocator;
  last(): FrameLocator;
  nth(index: number): FrameLocator;
  frameLocator(selector: string): FrameLocator;
  locator(selector: string, options?: any): Locator;
  getByRole(role: string, options?: any): Locator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string | RegExp): Locator;
  owner(): Locator;
  [key: string]: any;
}
declare interface Keyboard {
  down(key: string): Promise<void>;
  up(key: string): Promise<void>;
  press(key: string, options?: { delay?: number; }): Promise<void>;
  insertText(text: string): Promise<void>;
  type(text: string, options?: { delay?: number; }): Promise<void>;
  [key: string]: any;
}
declare interface Mouse {
  click(x: number, y: number, options?: { button?: "left" | "right" | "middle"; clickCount?: number; delay?: number; }): Promise<void>;
  dblclick(x: number, y: number, options?: { button?: "left" | "right" | "middle"; delay?: number; }): Promise<void>;
  down(options?: { button?: "left" | "right" | "middle"; clickCount?: number; }): Promise<void>;
  up(options?: { button?: "left" | "right" | "middle"; clickCount?: number; }): Promise<void>;
  move(x: number, y: number, options?: { steps?: number; }): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
  [key: string]: any;
}
declare interface Touchscreen {
  tap(x: number, y: number): Promise<void>;
  [key: string]: any;
}
declare interface Worker {
  url(): string;
  evaluate(pageFunction: any, arg?: any): Promise<any>;
  evaluateHandle(pageFunction: any, arg?: any): Promise<any>;
  [key: string]: any;
}
declare interface WebSocket {
  on(event: 'close', listener: (webSocket: WebSocket) => any): this;
  on(event: 'framereceived', listener: (data: { payload: string | any; }) => any): this;
  on(event: 'framesent', listener: (data: { payload: string | any; }) => any): this;
  on(event: 'socketerror', listener: (error: string) => any): this;
  once(event: string, listener: any): this;
  url(): string;
  isClosed(): boolean;
  waitForEvent(event: string, optionsOrPredicate?: any): Promise<any>;
  [key: string]: any;
}
declare interface Route {
  abort(errorCode?: string): Promise<void>;
  continue(options?: { headers?: { [key: string]: string; }; method?: string; postData?: string | any; url?: string; }): Promise<void>;
  fallback(options?: { headers?: { [key: string]: string; }; method?: string; postData?: string | any; url?: string; }): Promise<void>;
  fetch(options?: { headers?: { [key: string]: string; }; maxRedirects?: number; maxRetries?: number; method?: string; postData?: string | any; timeout?: number; url?: string; }): Promise<any>;
  fulfill(options?: { body?: string | any; contentType?: string; headers?: { [key: string]: string; }; json?: any; path?: string; response?: any; status?: number; }): Promise<void>;
  request(): Request;
  [key: string]: any;
}
declare interface Video {
  delete(): Promise<void>;
  path(): Promise<string>;
  saveAs(path: string): Promise<void>;
  [key: string]: any;
}
declare interface JSHandle {
  asElement(): ElementHandle | null;
  dispose(): Promise<void>;
  evaluate(pageFunction: any, arg?: any): Promise<any>;
  evaluateHandle(pageFunction: any, arg?: any): Promise<JSHandle>;
  getProperties(): Promise<Map<string, JSHandle>>;
  getProperty(propertyName: string): Promise<JSHandle>;
  jsonValue(): Promise<any>;
  [key: string]: any;
}
declare interface WebError {
  error(): Error;
  page(): Page | null;
  [key: string]: any;
}
declare interface BrowserType {
  connect(wsEndpoint: string, options?: { headers?: { [key: string]: string; }; slowMo?: number; timeout?: number; }): Promise<Browser>;
  connectOverCDP(endpointURL: string, options?: { endpointURL?: string; headers?: { [key: string]: string; }; slowMo?: number; timeout?: number; }): Promise<Browser>;
  executablePath(): string;
  launch(options?: {
    args?: string[];
    channel?: string;
    chromiumSandbox?: boolean;
    devtools?: boolean;
    downloadsPath?: string;
    env?: { [key: string]: string | undefined; };
    executablePath?: string;
    firefoxUserPrefs?: { [key: string]: string | number | boolean; };
    handleSIGHUP?: boolean;
    handleSIGINT?: boolean;
    handleSIGTERM?: boolean;
    headless?: boolean;
    ignoreDefaultArgs?: boolean | string[];
    logger?: Logger;
    proxy?: { server: string; bypass?: string; username?: string; password?: string; };
    slowMo?: number;
    timeout?: number;
    tracesDir?: string;
  }): Promise<Browser>;
  launchPersistentContext(userDataDir: string, options?: any): Promise<BrowserContext>;
  launchServer(options?: any): Promise<BrowserServer>;
  name(): string;
  [key: string]: any;
}
declare interface Accessibility {
  snapshot(options?: { interestingOnly?: boolean; root?: ElementHandle; }): Promise<any>;
  [key: string]: any;
}
declare interface Clock {
  fastForward(ticks: number | string): Promise<void>;
  install(options?: { time?: number | string | Date; }): Promise<void>;
  pauseAt(time: number | string | Date): Promise<void>;
  resume(): Promise<void>;
  runFor(ticks: number | string): Promise<void>;
  setFixedTime(time: number | string | Date): Promise<void>;
  setSystemTime(time: number | string | Date): Promise<void>;
  [key: string]: any;
}
declare interface Coverage {
  startCSSCoverage(options?: { resetOnNavigation?: boolean; }): Promise<void>;
  startJSCoverage(options?: { reportAnonymousScripts?: boolean; resetOnNavigation?: boolean; }): Promise<void>;
  stopCSSCoverage(): Promise<Array<{ url: string; text?: string; ranges: Array<{ start: number; end: number; }>; }>>;
  stopJSCoverage(): Promise<Array<{ url: string; scriptId: string; source?: string; functions: Array<{ functionName: string; isBlockCoverage: boolean; ranges: Array<{ count: number; startOffset: number; endOffset: number; }>; }>; }>>;
  [key: string]: any;
}
declare interface APIRequestContext {
  delete(url: string, options?: { data?: string | any; failOnStatusCode?: boolean; form?: any; headers?: { [key: string]: string; }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; maxRetries?: number; multipart?: any; params?: any; timeout?: number; }): Promise<any>;
  dispose(options?: { reason?: string; }): Promise<void>;
  fetch(urlOrRequest: string | Request, options?: { data?: string | any; failOnStatusCode?: boolean; form?: any; headers?: { [key: string]: string; }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; maxRetries?: number; method?: string; multipart?: any; params?: any; timeout?: number; }): Promise<any>;
  get(url: string, options?: any): Promise<any>;
  head(url: string, options?: any): Promise<any>;
  patch(url: string, options?: any): Promise<any>;
  post(url: string, options?: { data?: string | any; failOnStatusCode?: boolean; form?: any; headers?: { [key: string]: string; }; ignoreHTTPSErrors?: boolean; maxRedirects?: number; maxRetries?: number; multipart?: any; params?: any; timeout?: number; }): Promise<any>;
  put(url: string, options?: any): Promise<any>;
  storageState(options?: { path?: string; }): Promise<any>;
  [key: string]: any;
}
declare interface APIResponse {
  body(): Promise<any>;
  dispose(): Promise<void>;
  headers(): { [key: string]: string; };
  headersArray(): Array<{ name: string; value: string; }>;
  json(): Promise<any>;
  ok(): boolean;
  status(): number;
  statusText(): string;
  text(): Promise<string>;
  url(): string;
  [key: string]: any;
}
declare interface BrowserServer {
  on(event: 'close', listener: () => any): this;
  once(event: 'close', listener: () => any): this;
  close(): Promise<void>;
  kill(): Promise<void>;
  process(): any;
  wsEndpoint(): string;
  [key: string]: any;
}
declare interface Tracing {
  group(name: string, options?: { location?: { file: string; line?: number; column?: number; }; }): Promise<void>;
  groupEnd(): Promise<void>;
  start(options?: { name?: string; screenshots?: boolean; snapshots?: boolean; sources?: boolean; title?: string; }): Promise<void>;
  startChunk(options?: { name?: string; title?: string; }): Promise<void>;
  stop(options?: { path?: string; }): Promise<void>;
  stopChunk(options?: { path?: string; }): Promise<void>;
  [key: string]: any;
}
declare interface Selectors {
  register(name: string, script: Function | string | { path?: string; content?: string; }, options?: { contentScript?: boolean; }): Promise<void>;
  setTestIdAttribute(attributeName: string): void;
  [key: string]: any;
}
declare interface Logger {
  isEnabled(name: string, severity: "verbose" | "info" | "warning" | "error"): boolean;
  log(name: string, severity: "verbose" | "info" | "warning" | "error", message: string | Error, args: any[], hints: { color?: string; }): void;
  [key: string]: any;
}
declare interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
  partitionKey?: string;
}
declare interface CDPSession {
  detach(): Promise<void>;
  send(method: string, params?: any): Promise<any>;
  [key: string]: any;
}
declare interface WebSocketRoute {
  onMessage(handler: (message: string | any) => any): void;
  onClose(handler: (code?: number, reason?: string) => any): void;
  close(options?: { code?: number; reason?: string; }): Promise<void>;
  connectToServer(): WebSocketRoute;
  send(message: string | any): void;
  url(): string;
  [key: string]: any;
}
// Type aliases
type PageWaitForSelectorOptions = {
  state?: "attached" | "detached" | "visible" | "hidden";
  strict?: boolean;
  timeout?: number;
};
type PageWaitForFunctionOptions = {
  polling?: number | "raf";
  timeout?: number;
};
type PageScreenshotOptions = {
  animations?: "disabled" | "allow";
  caret?: "hide" | "initial";
  clip?: { x: number; y: number; width: number; height: number; };
  fullPage?: boolean;
  mask?: Array<Locator>;
  maskColor?: string;
  omitBackground?: boolean;
  path?: string;
  quality?: number;
  scale?: "css" | "device";
  style?: string;
  timeout?: number;
  type?: "png" | "jpeg";
};
type LocatorScreenshotOptions = {
  animations?: "disabled" | "allow";
  caret?: "hide" | "initial";
  mask?: Array<Locator>;
  maskColor?: string;
  omitBackground?: boolean;
  path?: string;
  quality?: number;
  scale?: "css" | "device";
  style?: string;
  timeout?: number;
  type?: "png" | "jpeg";
};
type ElementHandleWaitForSelectorOptions = {
  state?: "attached" | "detached" | "visible" | "hidden";
  strict?: boolean;
  timeout?: number;
};
type BrowserContextOptions = {
  acceptDownloads?: boolean;
  baseURL?: string;
  bypassCSP?: boolean;
  clientCertificates?: Array<any>;
  colorScheme?: null | "light" | "dark" | "no-preference";
  contrast?: null | "no-preference" | "more";
  deviceScaleFactor?: number;
  extraHTTPHeaders?: { [key: string]: string; };
  forcedColors?: null | "active" | "none";
  geolocation?: Geolocation;
  hasTouch?: boolean;
  httpCredentials?: HTTPCredentials;
  ignoreHTTPSErrors?: boolean;
  isMobile?: boolean;
  javaScriptEnabled?: boolean;
  locale?: string;
  logger?: Logger;
  offline?: boolean;
  permissions?: Array<string>;
  proxy?: { server: string; bypass?: string; username?: string; password?: string; };
  recordHar?: any;
  recordVideo?: any;
  reducedMotion?: null | "reduce" | "no-preference";
  screen?: { width: number; height: number; };
  serviceWorkers?: "allow" | "block";
  storageState?: string | any;
  strictSelectors?: boolean;
  timezoneId?: string;
  userAgent?: string;
  videoSize?: { width: number; height: number; };
  videosPath?: string;
  viewport?: null | ViewportSize;
};
type ViewportSize = {
  width: number;
  height: number;
};
type HTTPCredentials = {
  username: string;
  password: string;
  origin?: string;
  send?: "unauthorized" | "always";
};
type Geolocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};
type LaunchOptions = {
  args?: Array<string>;
  channel?: string;
  chromiumSandbox?: boolean;
  devtools?: boolean;
  downloadsPath?: string;
  env?: { [key: string]: string | undefined; };
  executablePath?: string;
  firefoxUserPrefs?: { [key: string]: string | number | boolean; };
  handleSIGHUP?: boolean;
  handleSIGINT?: boolean;
  handleSIGTERM?: boolean;
  headless?: boolean;
  ignoreDefaultArgs?: boolean | Array<string>;
  logger?: Logger;
  proxy?: { server: string; bypass?: string; username?: string; password?: string; };
  slowMo?: number;
  timeout?: number;
  tracesDir?: string;
};
type ConnectOptions = {
  exposeNetwork?: string;
  headers?: { [key: string]: string; };
  logger?: Logger;
  slowMo?: number;
  timeout?: number;
};
type ConnectOverCDPOptions = {
  endpointURL?: string;
  headers?: { [key: string]: string; };
  logger?: Logger;
  slowMo?: number;
  timeout?: number;
};
type DeviceDescriptor = {
  viewport: ViewportSize;
  userAgent: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  defaultBrowserType: "chromium" | "firefox" | "webkit";
};
type Devices = {
  [key: string]: DeviceDescriptor;
};
type AccessibilitySnapshotOptions = {
  interestingOnly?: boolean;
  root?: ElementHandle;
};
type AccessibilityNode = {
  role: string;
  name: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children?: AccessibilityNode[];
};
// Namespace declarations
declare namespace errors {
  class TimeoutError extends Error {}
}
