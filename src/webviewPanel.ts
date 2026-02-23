import * as vscode from 'vscode';
import * as path from 'path';
import { CategoryGroup } from './types';
import { removeModule, touchModule, removeFileFromModule } from './contextDataProvider';

export class ContextManagerPanel {
  public static currentPanel: ContextManagerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _onDidModifyModule: ((filePath: string) => void) | undefined;
  private _onDidBecomeVisible: (() => void) | undefined;
  private _workspacePath: string | undefined;
  private _contextFolderPath: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri): ContextManagerPanel {
    if (ContextManagerPanel.currentPanel) {
      ContextManagerPanel.currentPanel._panel.reveal();
      return ContextManagerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiContextManager',
      'AI Context Manager',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'media')],
        retainContextWhenHidden: true,
      }
    );

    ContextManagerPanel.currentPanel = new ContextManagerPanel(panel, extensionUri);
    return ContextManagerPanel.currentPanel;
  }

  public onDidModifyModule(cb: (filePath: string) => void): void {
    this._onDidModifyModule = cb;
  }

  public onDidBecomeVisible(cb: () => void): void {
    this._onDidBecomeVisible = cb;
  }

  public setPaths(workspacePath: string, contextFolderPath: string): void {
    this._workspacePath = workspacePath;
    this._contextFolderPath = contextFolderPath;
  }

  private _isInsideContextFolder(filePath: string): boolean {
    if (!this._contextFolderPath) { return false; }
    const resolved = path.resolve(filePath);
    const contextResolved = path.resolve(this._contextFolderPath);
    return resolved.toLowerCase().startsWith(contextResolved.toLowerCase() + path.sep) ||
           resolved.toLowerCase() === contextResolved.toLowerCase();
  }

  private _isInsideWorkspace(filePath: string): boolean {
    if (!this._workspacePath) { return false; }
    const resolved = path.resolve(filePath);
    const workspaceResolved = path.resolve(this._workspacePath);
    return resolved.toLowerCase().startsWith(workspaceResolved.toLowerCase() + path.sep) ||
           resolved.toLowerCase() === workspaceResolved.toLowerCase();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getWebviewContent();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible && this._onDidBecomeVisible) {
          this._onDidBecomeVisible();
        }
      },
      null,
      this._disposables
    );
    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      null,
      this._disposables
    );
  }

  public updateData(
    categories: CategoryGroup[],
    stalenessMap: Record<string, { isStale: boolean; staleFiles: string[]; isUndocumented: boolean }>,
    overviewContent: string = ''
  ): void {
    this._panel.webview.postMessage({ type: 'update', categories, stalenessMap, overviewContent });
  }

  public dispose(): void {
    ContextManagerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  public get visible(): boolean {
    return this._panel.visible;
  }

  public reveal(): void {
    this._panel.reveal();
  }

  private _handleMessage(message: any): void {
    switch (message.type) {
      case 'openModuleFile': {
        if (!this._isInsideContextFolder(message.filePath)) { return; }
        const uri = vscode.Uri.file(message.filePath);
        vscode.window.showTextDocument(uri);
        break;
      }
      case 'openSourceFile': {
        if (!this._workspacePath) { return; }
        const fullPath = path.join(this._workspacePath, message.filePath);
        if (!this._isInsideWorkspace(fullPath)) { return; }
        vscode.window.showTextDocument(vscode.Uri.file(fullPath));
        break;
      }
      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiContextManager');
        break;
      case 'removeModule': {
        if (!this._isInsideContextFolder(message.filePath)) { return; }
        vscode.window.showWarningMessage(
          `Remove module "${message.moduleName}"?`,
          'Remove', 'Cancel'
        ).then(choice => {
          if (choice === 'Remove') {
            removeModule(message.filePath);
            if (this._onDidModifyModule) {
              this._onDidModifyModule(message.filePath);
            }
          }
        });
        break;
      }
      case 'touchModule': {
        if (!this._isInsideContextFolder(message.filePath)) { return; }
        const updated = touchModule(message.filePath);
        if (updated && this._onDidModifyModule) {
          this._onDidModifyModule(message.filePath);
        }
        break;
      }
      case 'removeFile': {
        if (!this._isInsideContextFolder(message.modulePath)) { return; }
        const updated = removeFileFromModule(message.modulePath, message.filePath);
        if (updated && this._onDidModifyModule) {
          this._onDidModifyModule(message.modulePath);
        }
        break;
      }
      case 'runInit':
        vscode.commands.executeCommand('aiContextManager.init');
        break;
      case 'refresh':
        vscode.commands.executeCommand('aiContextManager.refresh');
        break;
      case 'openOverview': {
        if (!this._contextFolderPath) { return; }
        const overviewPath = path.join(this._contextFolderPath, '_overview.md');
        vscode.window.showTextDocument(vscode.Uri.file(overviewPath));
        break;
      }
    }
  }

  private _getWebviewContent(): string {
    const webview = this._panel.webview;
    const mediaPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'media');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'webview.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'webview.js'));

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>AI Context Manager</title>
</head>
<body>
  <div class="panel-container">
    <div class="title-bar">
      <span class="title-text" id="titleText">Context Map</span>
      <div class="title-actions">
        <button class="icon-btn" id="refreshBtn" title="Refresh staleness">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
        <button class="icon-btn" id="settingsBtn" title="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </div>
    <div class="tree-body" id="treeBody">
      <div class="empty-state">
        No .context/ folder found.<br>
        <button class="link-btn" id="initBtn">Scan project and create documentation</button>
      </div>
    </div>
    <div class="summary-bar" id="summaryBar"></div>
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
