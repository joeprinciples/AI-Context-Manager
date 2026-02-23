// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();

  let categories = [];
  let stalenessMap = {};
  let overviewContent = '';
  let expandedCategories = new Set();
  let expandedModules = new Set();

  const treeBody = document.getElementById('treeBody');
  const summaryBar = document.getElementById('summaryBar');
  const settingsBtn = document.getElementById('settingsBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const initBtn = document.getElementById('initBtn');

  const icons = {
    chevronRight: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`,
    folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    fileText: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`,
    file: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`,
    checkCircle: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>`,
    alertTriangle: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    book: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Parse _overview.md into a simple display: title + bullet points
  function renderOverviewSection(fragment) {
    if (!overviewContent) return;

    const lines = overviewContent.split('\n');
    let title = '';
    const sections = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!title && trimmed.startsWith('# ')) {
        title = trimmed.slice(2).trim();
      } else if (trimmed.startsWith('## ')) {
        sections.push({ heading: trimmed.slice(3).trim(), items: [] });
      } else if (trimmed.startsWith('- ') && sections.length > 0) {
        sections[sections.length - 1].items.push(trimmed.slice(2).trim());
      }
    }

    if (!title && !sections.length) return;

    // Overview header
    const overviewRow = document.createElement('div');
    overviewRow.className = 'overview-section';

    let html = '';
    if (title) {
      html += `<div class="overview-title">${icons.book} ${escapeHtml(title)}</div>`;
    }

    for (const section of sections) {
      if (section.heading === 'Modules') continue; // Skip — that's the tree below
      if (section.items.length === 0) continue;
      html += `<div class="overview-heading">${escapeHtml(section.heading)}</div>`;
      html += `<div class="overview-items">`;
      for (const item of section.items) {
        // Strip [AI: ...] placeholders
        if (/^\[AI:/.test(item)) continue;
        html += `<div class="overview-item">${escapeHtml(item)}</div>`;
      }
      html += `</div>`;
    }

    overviewRow.innerHTML = html;

    // Click to open _overview.md
    overviewRow.addEventListener('click', () => {
      vscode.postMessage({ type: 'openOverview' });
    });

    fragment.appendChild(overviewRow);
  }

  function renderTree() {
    if (!categories.length && !overviewContent) {
      treeBody.innerHTML = `<div class="empty-state">
        No .context/ folder found.<br>
        <button class="link-btn" id="initBtn">Scan project and create documentation</button>
      </div>`;
      const btn = treeBody.querySelector('#initBtn');
      if (btn) btn.addEventListener('click', () => vscode.postMessage({ type: 'runInit' }));
      return;
    }

    const fragment = document.createDocumentFragment();

    // Overview section at top
    renderOverviewSection(fragment);

    // Separator between overview and tree
    if (overviewContent && categories.length) {
      const sep = document.createElement('div');
      sep.className = 'tree-separator';
      fragment.appendChild(sep);
    }

    for (const category of categories) {
      const catExpanded = expandedCategories.has(category.name);
      const moduleCount = category.modules.length;
      const staleInCat = category.modules.filter(m => {
        const info = stalenessMap[m.filePath];
        return info && info.isStale;
      }).length;

      let catStatus = '';
      if (staleInCat > 0) { catStatus = ` \u00b7 ${staleInCat} stale`; }

      // Category row
      const catRow = document.createElement('div');
      catRow.className = 'tree-item tree-category';
      catRow.innerHTML = `
        <span class="chevron ${catExpanded ? 'expanded' : ''}">${icons.chevronRight}</span>
        <span class="tree-item-icon">${icons.folder}</span>
        <span class="tree-item-label">${escapeHtml(category.name)}</span>
        <span class="tree-item-badge">${moduleCount} module${moduleCount !== 1 ? 's' : ''}${catStatus}</span>
      `;
      catRow.addEventListener('click', () => {
        if (catExpanded) {
          expandedCategories.delete(category.name);
        } else {
          expandedCategories.add(category.name);
        }
        renderTree();
      });
      fragment.appendChild(catRow);

      if (!catExpanded) continue;

      // Module rows
      for (const mod of category.modules) {
        const modExpanded = expandedModules.has(mod.filePath);
        const info = stalenessMap[mod.filePath];
        const isStale = info && info.isStale;
        const staleFiles = (info && info.staleFiles) || [];
        const fileCount = mod.data.files.length;

        if (mod.parseError) {
          const errorRow = document.createElement('div');
          errorRow.className = 'tree-item tree-module';
          errorRow.innerHTML = `
            <span class="tree-item-icon">${icons.fileText}</span>
            <span class="tree-item-label">${escapeHtml(mod.fileName)}</span>
          `;
          fragment.appendChild(errorRow);

          const errorMsg = document.createElement('div');
          errorMsg.className = 'parse-error';
          errorMsg.textContent = mod.parseError;
          fragment.appendChild(errorMsg);
          continue;
        }

        let statusIndicator = '';
        if (isStale) {
          statusIndicator = `<span class="staleness-indicator staleness-stale" title="${staleFiles.length} file(s) changed since last update">${icons.alertTriangle}</span>`;
        } else {
          statusIndicator = `<span class="staleness-indicator staleness-fresh" title="Up to date">${icons.checkCircle}</span>`;
        }

        const modRow = document.createElement('div');
        modRow.className = 'tree-item tree-module';
        modRow.innerHTML = `
          <span class="chevron ${modExpanded ? 'expanded' : ''}">${icons.chevronRight}</span>
          <span class="tree-item-icon">${icons.fileText}</span>
          <span class="tree-item-label">${escapeHtml(mod.data.module)}</span>
          ${statusIndicator}
          <span class="tree-item-badge">${fileCount} file${fileCount !== 1 ? 's' : ''}</span>
          <span class="module-filename" title="Open ${escapeHtml(mod.fileName)}">${escapeHtml(mod.fileName)}</span>
        `;

        modRow.addEventListener('click', (e) => {
          // Clicking the filename opens the .md file instead of toggling expand
          if (e.target.closest('.module-filename')) {
            e.stopPropagation();
            vscode.postMessage({ type: 'openModuleFile', filePath: mod.filePath });
            return;
          }
          if (modExpanded) {
            expandedModules.delete(mod.filePath);
          } else {
            expandedModules.add(mod.filePath);
          }
          renderTree();
        });

        modRow.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showModuleContextMenu(e.clientX, e.clientY, mod);
        });

        fragment.appendChild(modRow);

        // Module description (only show if it's real content, not a placeholder)
        if (modExpanded && mod.data.description && !/^\[AI:/.test(mod.data.description)) {
          const descRow = document.createElement('div');
          descRow.className = 'module-description';
          descRow.textContent = mod.data.description;
          fragment.appendChild(descRow);
        }

        if (!modExpanded) continue;

        // File rows
        for (const file of mod.data.files) {
          const isFileStale = staleFiles.includes(file.path);
          const fileName = file.path.split('/').pop() || file.path;
          const dirPath = file.path.substring(0, file.path.length - fileName.length);

          const fileRow = document.createElement('div');
          fileRow.className = 'tree-item tree-file';
          fileRow.innerHTML = `
            <span class="tree-item-icon">${icons.file}</span>
            <span class="tree-file-name">${escapeHtml(fileName)}</span>
            <span class="tree-file-dir">${escapeHtml(dirPath)}</span>
            ${isFileStale ? `<span class="staleness-indicator staleness-stale" title="Modified since last context update">${icons.alertTriangle}</span>` : ''}
          `;
          fileRow.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'openSourceFile', filePath: file.path });
          });
          fileRow.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showFileContextMenu(e.clientX, e.clientY, mod.filePath, file.path);
          });
          fragment.appendChild(fileRow);
        }
      }
    }

    treeBody.innerHTML = '';
    treeBody.appendChild(fragment);
  }

  // --- Context menu ---
  let contextMenu = null;

  function showContextMenu(x, y, items) {
    hideContextMenu();

    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';

    for (const item of items) {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        contextMenu.appendChild(sep);
        continue;
      }

      const el = document.createElement('div');
      el.className = 'context-menu-item';
      if (item.destructive) el.classList.add('context-menu-destructive');
      el.textContent = item.label;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        item.action();
      });
      contextMenu.appendChild(el);
    }

    document.body.appendChild(contextMenu);
    positionMenu(x, y);
  }

  function showModuleContextMenu(x, y, mod) {
    showContextMenu(x, y, [
      { label: 'Open module file', action: () => vscode.postMessage({ type: 'openModuleFile', filePath: mod.filePath }) },
      { label: 'Mark as updated', action: () => vscode.postMessage({ type: 'touchModule', filePath: mod.filePath }) },
      { type: 'separator' },
      { label: 'Remove module', action: () => vscode.postMessage({ type: 'removeModule', filePath: mod.filePath, moduleName: mod.data.module }), destructive: true },
    ]);
  }

  function showFileContextMenu(x, y, modulePath, filePath) {
    showContextMenu(x, y, [
      { label: 'Open file', action: () => vscode.postMessage({ type: 'openSourceFile', filePath }) },
      { type: 'separator' },
      { label: 'Remove from module', action: () => vscode.postMessage({ type: 'removeFile', modulePath, filePath }), destructive: true },
    ]);
  }

  function positionMenu(x, y) {
    if (!contextMenu) return;
    const menuRect = contextMenu.getBoundingClientRect();
    const maxX = window.innerWidth - menuRect.width - 4;
    const maxY = window.innerHeight - menuRect.height - 4;
    contextMenu.style.left = Math.min(x, maxX) + 'px';
    contextMenu.style.top = Math.min(y, maxY) + 'px';
  }

  function hideContextMenu() {
    if (contextMenu) {
      contextMenu.remove();
      contextMenu = null;
    }
  }

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.tree-module') && !e.target.closest('.tree-file')) {
      e.preventDefault();
      hideContextMenu();
    }
  });

  function updateSummaryBar() {
    const totalModules = categories.reduce((sum, c) => sum + c.modules.length, 0);
    const totalCategories = categories.length;
    const staleCount = Object.values(stalenessMap).filter(s => s.isStale).length;
    const totalFiles = categories.reduce((sum, c) =>
      sum + c.modules.reduce((mSum, m) => mSum + (m.data.files ? m.data.files.length : 0), 0), 0);

    const parts = [];
    parts.push(`${totalModules} module${totalModules !== 1 ? 's' : ''}`);
    parts.push(`${totalCategories} categor${totalCategories !== 1 ? 'ies' : 'y'}`);
    parts.push(`${totalFiles} file${totalFiles !== 1 ? 's' : ''}`);
    if (staleCount > 0) {
      parts.push(`${staleCount} stale`);
    } else if (totalModules > 0) {
      parts.push('all fresh');
    }

    summaryBar.textContent = parts.join('  \u00b7  ');
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
  }

  if (initBtn) {
    initBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'runInit' });
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'update') {
      categories = message.categories || [];
      stalenessMap = message.stalenessMap || {};
      overviewContent = message.overviewContent || '';

      // Auto-expand all categories on first load
      if (expandedCategories.size === 0 && categories.length > 0) {
        for (const cat of categories) {
          expandedCategories.add(cat.name);
        }
      }

      renderTree();
      updateSummaryBar();
    }
  });

  renderTree();
  updateSummaryBar();
})();
