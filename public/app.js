/**
 * Achu Coding Agent — Frontend Workspace Controller
 * Connects the Stitch UI to the existing Express + WebSocket backend.
 */

class AchuWorkspace {
  constructor() {
    this.ws = null;
    this.currentProject = null;
    this.currentFile = null;
    this.currentDiffFile = null;
    this.taskHistory = [];
    this.terminalBuffer = "";
    this.activityBuffer = [];
    this.changedFiles = [];
    this.reviewState = "NOT_REQUIRED";
    this.verificationStatus = "NOT_REQUESTED";
    this.buildStatus = "NOT_RUN";
    this.browserStatus = "NOT_RUN";
    this.sessionId = null;
    this.taskId = null;
    this.previewUrl = null;
    this.browsePath = null;
    this.selectedBrowsePath = null;
    this.maxActivityEntries = 500;
    this.maxTerminalLines = 2500;
    this.currentStep = 0;
    this.totalSteps = 6;
    this.stepNames = [
      "Ready to build",
      "Understanding your idea",
      "Planning the project",
      "Writing the code",
      "Running checks",
      "Testing in browser",
      "Preparing preview"
    ];

    this.initElements();
    this.bindEvents();
    this.connect();
    this.initDefaultProject();
  }

  el(id) {
    return document.getElementById(id);
  }

  toCamel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  initElements() {
    const ids = [
      'sidebar-toggle', 'sidebar', 'new-project-btn', 'project-search', 'projects-list',
      'project-path', 'select-project', 'clear-project', 'project-display', 'current-project',
      'browse-workspace', 'refresh-file-tree', 'file-tree', 'file-tree-empty',
      'folder-browser', 'folder-browser-close', 'folder-browser-up', 'folder-browser-path',
      'folder-browser-list', 'folder-browser-selected', 'folder-browser-select', 'folder-browser-error',
      'task-input', 'run-task', 'run-task-text', 'stop-task', 'task-status',
      'attach-btn', 'attach-input', 'attach-note', 'app-type-select', 'model-selector',
      'current-step-name', 'project-progress-fill', 'status-steps-list',
      'tab-preview', 'tab-terminal',
      'pane-preview', 'pane-terminal',
      'preview-url-bar', 'preview-live-dot', 'preview-refresh', 'open-preview', 'preview-fullscreen',
      'live-preview', 'live-preview-empty', 'live-preview-iframe',
      'changed-count', 'changed-count-badge', 'changed-files-summary', 'changed-files',
      'review-panel', 'review-state', 'review-summary', 'approve-btn', 'reject-btn',
      'viewer-file-path', 'diff-change-type', 'open-diff', 'diff-truncated',
      'file-viewer', 'diff-viewer',
      'verification-status', 'verification-details', 'browser-activity-log', 'browser-tab-dot',
      'subtab-terminal', 'subtab-activity', 'subtab-result', 'clear-terminal',
      'terminal-output', 'activity-log', 'final-result',
      'connection-status', 'connection-status-text'
    ];

    this.elements = {};
    for (const id of ids) {
      this.elements[this.toCamel(id)] = this.el(id);
    }
  }

  on(elm, evt, fn) {
    if (elm) elm.addEventListener(evt, fn);
  }

  bindEvents() {
    const e = this.elements;

    // Sidebar & Workspace
    this.on(e.sidebarToggle, 'click', () => this.toggleMobileSidebar());
    this.on(e.newProjectBtn, 'click', () => this.newProject());
    this.on(e.projectSearch, 'input', (ev) => this.filterProjects(ev.target.value));
    this.on(e.selectProject, 'click', () => this.selectCustomProject());
    this.on(e.projectPath, 'keypress', (ev) => { if (ev.key === 'Enter') this.selectCustomProject(); });
    this.on(e.clearProject, 'click', () => this.clearProject());

    // Workspace folder browser (server-backed)
    this.on(e.browseWorkspace, 'click', () => this.openFolderBrowser());
    this.on(e.refreshFileTree, 'click', () => this.refreshFileTree());
    this.on(e.folderBrowserClose, 'click', () => this.closeFolderBrowser());
    this.on(e.folderBrowserUp, 'click', () => this.browseTo(this.browseParent));
    this.on(e.folderBrowserSelect, 'click', () => this.confirmFolderSelection());
    if (e.folderBrowser) {
      e.folderBrowser.addEventListener('click', (ev) => {
        if (ev.target === e.folderBrowser) this.closeFolderBrowser();
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && !e.folderBrowser.classList.contains('hidden')) {
          this.closeFolderBrowser();
        }
      });
    }

    // Project items in list open the folder browser (no fake auto-selection)
    if (e.projectsList) {
      e.projectsList.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('click', () => this.openFolderBrowser());
        item.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            this.openFolderBrowser();
          }
        });
      });
    }

    // Task Composer
    this.on(e.runTask, 'click', () => this.runTask());
    this.on(e.stopTask, 'click', () => this.stopTask());
    this.on(e.taskInput, 'input', () => this.updateRunButton());
    this.on(e.taskInput, 'keydown', (ev) => this.handleTaskKeydown(ev));
    this.on(e.attachBtn, 'click', () => { if (e.attachInput) e.attachInput.click(); });
    this.on(e.attachInput, 'change', () => this.handleAttach());

    // Workspace Tabs (2 Tabs)
    const tabs = [
      { btn: e.tabPreview, pane: e.panePreview, name: 'preview' },
      { btn: e.tabTerminal, pane: e.paneTerminal, name: 'terminal' }
    ];

    tabs.forEach(t => {
      this.on(t.btn, 'click', () => this.switchWorkspaceTab(t.name));
    });

    // Terminal Sub-tabs
    const subtabs = [
      { btn: e.subtabTerminal, target: e.terminalOutput },
      { btn: e.subtabActivity, target: e.activityLog },
      { btn: e.subtabResult, target: e.finalResult }
    ];

    subtabs.forEach(st => {
      this.on(st.btn, 'click', () => {
        subtabs.forEach(s => {
          if (s.btn) s.btn.classList.toggle('active', s === st);
          if (s.target) s.target.style.display = (s === st) ? 'block' : 'none';
        });
      });
    });

    this.on(e.clearTerminal, 'click', () => this.clearTerminal());

    // Preview Actions
    this.on(e.previewRefresh, 'click', () => this.refreshPreview());
    this.on(e.openPreview, 'click', () => this.openPreviewInNewTab());
    this.on(e.previewFullscreen, 'click', () => this.fullscreenPreview());

    // Code Tab Actions
    this.on(e.approveBtn, 'click', () => this.approveChanges());
    this.on(e.rejectBtn, 'click', () => this.rejectChanges());
    this.on(e.openDiff, 'click', () => this.showDiffViewer());
  }

  // ---------- Default Project Initialization ----------
  initDefaultProject() {
    // Do NOT auto-select a workspace. Selecting a workspace must be an
    // explicit user action; silently falling back to a sample directory would
    // run tasks against the wrong project.
    this.updateRunButton();
    this.renderFileTreeEmpty('No workspace selected. Use Browse… or Open to load a project folder.');
  }

  selectCustomProject() {
    const pathVal = this.elements.projectPath && this.elements.projectPath.value.trim();
    if (!pathVal) return;
    this.send('select_project', { path: pathVal });
  }

  onProjectSelected(path) {
    this.currentProject = path;
    if (this.elements.projectDisplay) {
      this.elements.projectDisplay.textContent = path;
      this.elements.projectDisplay.title = path;
    }
    if (this.elements.currentProject) {
      this.elements.currentProject.classList.remove('hidden');
    }
    if (this.elements.projectPath) {
      this.elements.projectPath.value = path;
    }
    document.querySelectorAll('.project-item').forEach(i => i.classList.remove('active'));
    this.updateRunButton();
    this.closeFolderBrowser();
    this.addActivity('success', `Workspace opened: ${path}`);
    this.renderFileTreeEmpty('Loading files…');
  }

  onProjectError(path, message) {
    // Never silently fall back: keep the previous workspace untouched and
    // surface the exact failure so the user can correct the path.
    this.addActivity('error', `Workspace error${path ? ` (${path})` : ''}: ${message}`);
    if (this.elements.projectPath && path) {
      this.elements.projectPath.value = path;
    }
    this.updateRunButton();
  }

  clearProject() {
    this.currentProject = null;
    this.currentFile = null;
    this.currentDiffFile = null;
    this.changedFiles = [];
    this.reviewState = "NOT_REQUIRED";
    if (this.elements.currentProject) this.elements.currentProject.classList.add('hidden');
    if (this.elements.projectDisplay) this.elements.projectDisplay.textContent = '';
    if (this.elements.projectPath) this.elements.projectPath.value = '';
    if (this.elements.changedFiles) {
      this.elements.changedFiles.innerHTML = '<li class="empty-files-hint">No files changed yet.</li>';
    }
    if (this.elements.changedCount) this.elements.changedCount.textContent = '0';
    if (this.elements.changedCountBadge) this.elements.changedCountBadge.textContent = '0';
    if (this.elements.reviewPanel) this.elements.reviewPanel.classList.add('hidden');
    this.renderFileTreeEmpty('No workspace selected. Use Browse… or Open to load a project folder.');
    this.resetPreview();
    this.updateRunButton();
    this.addActivity('info', 'Workspace cleared');
  }

  // ---------- Workspace File Tree ----------
  refreshFileTree() {
    if (!this.currentProject) {
      this.renderFileTreeEmpty('No workspace selected. Use Browse… or Open to load a project folder.');
      return;
    }
    this.send('get_file_tree', {});
  }

  renderFileTreeEmpty(message) {
    if (!this.elements.fileTree) return;
    this.elements.fileTree.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'file-tree-empty';
    empty.textContent = message;
    this.elements.fileTree.appendChild(empty);
  }

  onFileTree(tree) {
    if (!this.elements.fileTree) return;
    this.elements.fileTree.innerHTML = '';

    if (!Array.isArray(tree) || tree.length === 0) {
      this.renderFileTreeEmpty('This workspace is empty.');
      return;
    }

    const root = document.createElement('ul');
    root.className = 'file-tree-root';
    this.renderTreeNodes(tree, root, 0);
    this.elements.fileTree.appendChild(root);
  }

  renderTreeNodes(nodes, parentEl, depth) {
    for (const node of nodes) {
      const li = document.createElement('li');
      li.className = `file-tree-node ${node.type}`;
      li.style.paddingLeft = `${depth * 12}px`;

      if (node.truncated && !node.path) {
        li.classList.add('truncated');
        li.innerHTML = '<span class="file-tree-name">… more files not shown</span>';
        parentEl.appendChild(li);
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-tree-row';

      if (node.type === 'directory') {
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        button.innerHTML =
          `<span class="file-tree-caret${hasChildren ? '' : ' empty'}">${hasChildren ? '▸' : '•'}</span>` +
          `<span class="file-tree-icon">📁</span>` +
          `<span class="file-tree-name">${this.escapeHtml(node.name)}</span>`;
        li.appendChild(button);

        if (hasChildren) {
          const childWrap = document.createElement('ul');
          childWrap.className = 'file-tree-children collapsed';
          this.renderTreeNodes(node.children, childWrap, depth + 1);
          li.appendChild(childWrap);
          button.addEventListener('click', () => {
            const isCollapsed = childWrap.classList.toggle('collapsed');
            const caret = button.querySelector('.file-tree-caret');
            if (caret) caret.textContent = isCollapsed ? '▸' : '▾';
          });
        }
      } else {
        button.innerHTML =
          `<span class="file-tree-caret empty"></span>` +
          `<span class="file-tree-icon">${this.fileIcon(node.name)}</span>` +
          `<span class="file-tree-name">${this.escapeHtml(node.name)}</span>`;
        button.addEventListener('click', () => this.requestDiff(node.path));
        li.appendChild(button);
      }

      parentEl.appendChild(li);
    }
  }

  fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      ts: '🟦', tsx: '🟦', js: '🟨', jsx: '🟨', json: '🔧',
      css: '🎨', scss: '🎨', html: '📄', md: '📝', txt: '📄',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
      env: '🔒', yml: '⚙️', yaml: '⚙️', lock: '🔒',
    };
    return map[ext] || '📄';
  }

  // ---------- Folder Browser ----------
  openFolderBrowser() {
    if (!this.elements.folderBrowser) return;
    this.elements.folderBrowser.classList.remove('hidden');
    this.setBrowseError('');
    this.browseTo(this.currentProject || null);
  }

  closeFolderBrowser() {
    if (this.elements.folderBrowser) {
      this.elements.folderBrowser.classList.add('hidden');
    }
    this.selectedBrowsePath = null;
  }

  browseTo(path) {
    this.selectedBrowsePath = path || null;
    const label = this.elements.folderBrowserSelected;
    if (label) {
      label.textContent = path ? path : 'No folder selected';
    }
    if (this.elements.folderBrowserSelect) {
      this.elements.folderBrowserSelect.disabled = !path;
    }
    this.send('browse_directory', path ? { path } : {});
  }

  onDirectoryBrowsed(data) {
    this.browsePath = data.path;
    this.browseParent = data.parent;
    if (this.elements.folderBrowserPath) {
      this.elements.folderBrowserPath.textContent = data.path || 'This PC';
      this.elements.folderBrowserPath.title = data.path || 'This PC';
    }
    if (this.elements.folderBrowserUp) {
      this.elements.folderBrowserUp.disabled = !data.parent && !data.path;
    }
    const list = this.elements.folderBrowserList;
    if (!list) return;
    list.innerHTML = '';
    const dirs = Array.isArray(data.directories) ? data.directories : [];
    if (dirs.length === 0) {
      list.innerHTML = '<li class="folder-browser-empty">No subfolders here.</li>';
      return;
    }
    for (const dir of dirs) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'folder-browser-item';
      button.innerHTML = `<span class="folder-browser-icon">📁</span><span class="folder-browser-name">${this.escapeHtml(dir.name)}</span>`;
      button.addEventListener('click', () => this.browseTo(dir.path));
      li.appendChild(button);
      list.appendChild(li);
    }
    // Allow selecting the currently browsed directory itself.
    this.selectedBrowsePath = data.path || null;
    if (this.elements.folderBrowserSelected) {
      this.elements.folderBrowserSelected.textContent = data.path || 'Select a drive';
    }
    if (this.elements.folderBrowserSelect) {
      this.elements.folderBrowserSelect.disabled = !data.path;
    }
  }

  onBrowseError(message) {
    this.setBrowseError(message);
  }

  setBrowseError(message) {
    const el = this.elements.folderBrowserError;
    if (!el) return;
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.classList.remove('hidden');
    el.textContent = message;
  }

  confirmFolderSelection() {
    const target = this.selectedBrowsePath || this.browsePath;
    if (!target) return;
    this.send('select_project', { path: target });
  }

  newProject() {
    if (this.elements.taskInput) {
      this.elements.taskInput.value = '';
      this.elements.taskInput.focus();
    }
    this.setStep(0);
    this.updateRunButton();
  }

  filterProjects(query) {
    const q = (query || '').toLowerCase().trim();
    document.querySelectorAll('.project-item').forEach(item => {
      const name = item.querySelector('.project-item-name')?.textContent.toLowerCase() || '';
      const meta = item.querySelector('.project-item-meta')?.textContent.toLowerCase() || '';
      const match = name.includes(q) || meta.includes(q);
      item.style.display = match ? 'flex' : 'none';
    });
  }

  toggleMobileSidebar() {
    if (this.elements.sidebar) {
      this.elements.sidebar.classList.toggle('open');
    }
  }

  // ---------- WebSocket Connection ----------
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => this.setConnectionStatus(true);
    this.ws.onclose = () => {
      this.setConnectionStatus(false);
      setTimeout(() => this.connect(), 3000);
    };
    this.ws.onerror = (err) => console.error('WebSocket error:', err);
    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };
  }

  setConnectionStatus(connected) {
    const el = this.elements.connectionStatus;
    const txt = this.elements.connectionStatusText;
    if (!el) return;

    if (connected) {
      el.className = 'header-status ready';
      if (txt) txt.textContent = 'Ready';
    } else {
      el.className = 'header-status disconnected';
      if (txt) txt.textContent = 'Offline';
    }
    this.updateRunButton();
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  handleMessage(message) {
    const { type, timestamp, ...data } = message;
    switch (type) {
      case 'connected':
        this.addActivity('info', data.message || 'Connected to Achu Workspace');
        break;
      case 'app_url':
        if (data && data.url) {
          this.updatePreviewUrl(data.url);
          this.setStep(6);
        }
        break;
      case 'project_selected':
        this.onProjectSelected(data.path);
        break;
      case 'project_error':
        this.onProjectError(data.path, data.message);
        break;
      case 'file_tree':
        this.onFileTree(data.tree);
        break;
      case 'directory_browsed':
        this.onDirectoryBrowsed(data);
        break;
      case 'browse_error':
        this.onBrowseError(data.message);
        break;
      case 'file_created':
      case 'file_edited':
        this.addActivity('success', data.message || `File operation succeeded: ${data.path}`);
        break;
      case 'file_operation_error':
        this.addActivity('error', data.message || 'File operation failed');
        break;
      case 'file_read':
        this.showFileContent(data.path, data.content);
        break;
      case 'session_created':
        this.sessionId = data.sessionId;
        this.taskId = data.taskId;
        this.addActivity('info', `Session started: ${data.sessionId}`);
        break;
      case 'task_started':
        this.onTaskStarted(data.taskId, data.task, data.sessionId);
        break;
      case 'agent_output':
        this.onAgentOutput(data);
        break;
      case 'task_completed':
        this.onTaskCompleted(data);
        break;
      case 'task_failed':
        this.onTaskFailed(data);
        break;
      case 'task_stopped':
        this.onTaskStopped(data);
        break;
      case 'task_status':
        this.onTaskStatus(data);
        break;
      case 'review_available':
        this.onReviewAvailable(data);
        break;
      case 'diff_result':
        this.onDiffResult(data);
        break;
      case 'verification_status':
        this.onVerificationStatus(data);
        break;
      case 'approval_changed':
        this.onApprovalChanged(data);
        break;
      case 'error':
        this.addActivity('error', data.message);
        break;
    }
  }

  // ---------- Task Execution & Progression ----------
  updateRunButton() {
    if (!this.elements.runTask) return;
    const hasTask = this.elements.taskInput && this.elements.taskInput.value.trim().length > 0;
    const connected = this.elements.connectionStatus && this.elements.connectionStatus.classList.contains('ready');
    const running = this.elements.runTask.classList.contains('running');
    // A workspace must be open: tasks are always executed against an explicit,
    // user-selected project directory.
    const hasWorkspace = !!this.currentProject;
    this.elements.runTask.disabled = !hasTask || running || !connected || !hasWorkspace;
  }

  handleTaskKeydown(e) {
    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === 'Enter' && !e.shiftKey && e.target.value.trim())) {
      e.preventDefault();
      if (this.elements.runTask && !this.elements.runTask.disabled) {
        this.runTask();
      }
    }
  }

  runTask() {
    const task = this.elements.taskInput && this.elements.taskInput.value.trim();
    if (!task) return;

    // A workspace must be explicitly selected. Never fall back to a sample
    // directory: doing so would run the task against the wrong project.
    if (!this.currentProject) {
      this.addActivity('error', 'No workspace selected. Open a project folder before running a task.');
      this.updateRunButton();
      return;
    }

    const appType = this.elements.appTypeSelect ? this.elements.appTypeSelect.value : 'webapp';
    const model = 'auto';

    this.changedFiles = [];
    this.reviewState = "NOT_REQUIRED";
    this.verificationStatus = "NOT_REQUESTED";
    this.buildStatus = "NOT_RUN";
    this.browserStatus = "NOT_RUN";
    this.previewUrl = null;
    this.currentDiffFile = null;
    this.resetPreview();

    // Reset Workspace state
    if (this.elements.changedFiles) {
      this.elements.changedFiles.innerHTML = '<li class="empty-files-hint">Executing task...</li>';
    }
    if (this.elements.changedCount) this.elements.changedCount.textContent = '0';
    if (this.elements.changedCountBadge) this.elements.changedCountBadge.textContent = '0';
    if (this.elements.changedFilesSummary) this.elements.changedFilesSummary.innerHTML = '';
    if (this.elements.terminalOutput) this.elements.terminalOutput.textContent = '';
    if (this.elements.activityLog) this.elements.activityLog.innerHTML = '';
    this.terminalBuffer = "";

    // Set UI to Running State
    if (this.elements.taskStatus) {
      this.elements.taskStatus.textContent = 'RUNNING';
      this.elements.taskStatus.className = 'status-pill-indicator running';
    }
    if (this.elements.runTask) {
      this.elements.runTask.disabled = true;
      this.elements.runTask.classList.add('running');
    }
    if (this.elements.runTaskText) {
      this.elements.runTaskText.textContent = 'Building...';
    }
    if (this.elements.stopTask) {
      this.elements.stopTask.classList.remove('hidden');
    }
    if (this.elements.reviewPanel) {
      this.elements.reviewPanel.classList.add('hidden');
    }

    this.setStep(1); // Understanding your idea
    this.addActivity('info', `Building task: "${task}"`);

    this.send('run_task', { task, model, appType });
  }

  stopTask() {
    this.send('stop_task', {});
  }

  setStep(stepNum) {
    this.currentStep = stepNum;
    const name = this.stepNames[stepNum] || "In progress";
    
    if (this.elements.currentStepName) {
      this.elements.currentStepName.textContent = name;
    }

    // Progress Bar (0 to 100%)
    if (this.elements.projectProgressFill) {
      const pct = Math.round((stepNum / this.totalSteps) * 100);
      this.elements.projectProgressFill.style.width = `${pct}%`;
    }

    // Step Items in right panel
    for (let i = 1; i <= 6; i++) {
      const stepEl = this.el(`step-item-${i}`);
      if (!stepEl) continue;

      stepEl.classList.remove('active', 'completed');
      if (i < stepNum) {
        stepEl.classList.add('completed');
      } else if (i === stepNum) {
        stepEl.classList.add('active');
      }
    }
  }

  onTaskStarted(taskId, task, sessionId) {
    this.taskId = taskId;
    this.sessionId = sessionId;
    this.setStep(1);
  }

  onTaskStatus(data) {
    const status = data.status;
    if (this.elements.taskStatus) {
      this.elements.taskStatus.textContent = status;
      this.elements.taskStatus.className = `status-pill-indicator ${status.toLowerCase()}`;
    }

    if (status === 'RUNNING') {
      if (this.elements.runTask) {
        this.elements.runTask.disabled = true;
        this.elements.runTask.classList.add('running');
      }
      if (this.elements.stopTask) this.elements.stopTask.classList.remove('hidden');
    } else {
      if (this.elements.runTask) {
        this.elements.runTask.disabled = false;
        this.elements.runTask.classList.remove('running');
      }
      if (this.elements.runTaskText) {
        this.elements.runTaskText.textContent = 'Build with Achu';
      }
      if (this.elements.stopTask) this.elements.stopTask.classList.add('hidden');
      if (status === 'COMPLETED') {
        this.setStep(6);
      }
      this.updateRunButton();
    }
  }

  // ---------- Streamed Output & Activity ----------
  onAgentOutput(data) {
    const { stream, content } = data;
    this.terminalBuffer += content;
    const lines = this.terminalBuffer.split('\n');
    if (lines.length > this.maxTerminalLines) {
      this.terminalBuffer = lines.slice(-this.maxTerminalLines).join('\n');
    }

    if (this.elements.terminalOutput) {
      this.elements.terminalOutput.textContent = this.terminalBuffer;
      this.elements.terminalOutput.scrollTop = this.elements.terminalOutput.scrollHeight;
    }

    // Live preview detection: Look for localhost URL in terminal output
    const urlMatch = content.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)(?:\/[^\s"'`]*)?/i);
    if (urlMatch) {
      if (!this.previewUrl || urlMatch[0] !== this.previewUrl) {
        this.updatePreviewUrl(urlMatch[0]);
      }
      this.setStep(6); // Preparing preview
    }

    // Categorize activity for step progress and activity log
    if (stream === 'stdout') {
      for (const line of content.split('\n')) {
        if (line.trim()) this.categorizeActivity(line.trim());
      }
    }
  }

  categorizeActivity(line) {
    let type = 'info';

    if (/Reading:|Searching:|Listing:|Navigating:/i.test(line)) {
      type = 'info';
      if (this.currentStep < 2) this.setStep(2); // Planning the project
    } else if (/Editing:|Creating:|Writing code/i.test(line)) {
      type = 'info';
      if (this.currentStep < 3) this.setStep(3); // Writing the code
    } else if (/Running:|Verification command:|Building:|Compiling:/i.test(line)) {
      type = 'info';
      if (this.currentStep < 4) this.setStep(4); // Running checks
    } else if (/Opening browser|Browser session|Browser verification/i.test(line)) {
      type = 'browser';
      if (this.currentStep < 5) this.setStep(5); // Testing in browser
      this.addBrowserLog(line);
    } else if (/Starting application|Starting app|localhost:/i.test(line)) {
      type = 'info';
      if (this.currentStep < 6) this.setStep(6); // Preparing preview
    } else if (/Successfully edited|Successfully created/i.test(line)) {
      type = 'success';
    } else if (/Error|FAILED|failed/i.test(line)) {
      type = 'error';
    } else if (/Warning|warning/i.test(line)) {
      type = 'warning';
    }

    if (line.length > 200) line = line.slice(0, 200) + '…';
    if (/api key|secret|token/i.test(line)) return; // Security filter

    this.addActivity(type, line);
  }

  addActivity(type, message) {
    if (!this.elements.activityLog) return;
    const entry = document.createElement('div');
    entry.className = `activity-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    const icons = { info: '●', success: '✓', warning: '⚠', error: '✕', browser: '🌐' };
    const icon = icons[type] || '●';
    entry.innerHTML = `<span class="icon">${icon}</span><span class="timestamp">[${time}]</span><span class="message">${this.escapeHtml(message)}</span>`;
    this.elements.activityLog.appendChild(entry);
    this.activityBuffer.push(entry);
    if (this.activityBuffer.length > this.maxActivityEntries) {
      const old = this.activityBuffer.shift();
      if (old.parentNode) old.parentNode.removeChild(old);
    }
    this.elements.activityLog.scrollTop = this.elements.activityLog.scrollHeight;
  }

  addBrowserLog(line) {
    if (!this.elements.browserActivityLog) return;
    const placeholder = this.elements.browserActivityLog.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const div = document.createElement('div');
    div.className = 'activity-entry browser';
    const time = new Date().toLocaleTimeString();
    div.innerHTML = `<span class="icon">🌐</span><span class="timestamp">[${time}]</span><span class="message">${this.escapeHtml(line)}</span>`;
    this.elements.browserActivityLog.appendChild(div);
    this.elements.browserActivityLog.scrollTop = this.elements.browserActivityLog.scrollHeight;
  }

  clearTerminal() {
    this.terminalBuffer = "";
    if (this.elements.terminalOutput) this.elements.terminalOutput.textContent = '';
  }

  // ---------- Live Preview Controls ----------
  updatePreviewUrl(url) {
    this.previewUrl = url;
    if (!url) return;
    if (this.elements.previewUrlBar) this.elements.previewUrlBar.textContent = url;
    if (this.elements.previewLiveDot) this.elements.previewLiveDot.classList.remove('hidden');
    if (this.elements.livePreviewEmpty) this.elements.livePreviewEmpty.classList.add('hidden');
    if (this.elements.livePreviewIframe) {
      this.elements.livePreviewIframe.classList.remove('hidden');
      this.elements.livePreviewIframe.src = url;
    }
  }

  resetPreview() {
    this.previewUrl = null;
    if (this.elements.previewUrlBar) this.elements.previewUrlBar.textContent = 'No app running';
    if (this.elements.previewLiveDot) this.elements.previewLiveDot.classList.add('hidden');
    if (this.elements.livePreviewEmpty) this.elements.livePreviewEmpty.classList.remove('hidden');
    if (this.elements.livePreviewIframe) {
      this.elements.livePreviewIframe.classList.add('hidden');
      this.elements.livePreviewIframe.removeAttribute('src');
    }
  }

  refreshPreview() {
    if (this.elements.livePreviewIframe && this.previewUrl) {
      this.elements.livePreviewIframe.src = this.previewUrl;
      this.addActivity('info', 'Preview reloaded');
    }
  }

  openPreviewInNewTab() {
    if (this.previewUrl) {
      window.open(this.previewUrl, '_blank');
    }
  }

  fullscreenPreview() {
    const el = this.elements.livePreview;
    if (el && el.requestFullscreen) {
      el.requestFullscreen();
    }
  }

  // ---------- Workspace Tabs Switching ----------
  switchWorkspaceTab(tabName) {
    const map = {
      preview: { btn: this.elements.tabPreview, pane: this.elements.panePreview },
      terminal: { btn: this.elements.tabTerminal, pane: this.elements.paneTerminal }
    };

    Object.entries(map).forEach(([name, { btn, pane }]) => {
      const active = (name === tabName);
      if (btn) {
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      }
      if (pane) {
        pane.classList.toggle('active', active);
      }
    });
  }

  // ---------- Task Completion & Verification ----------
  onTaskCompleted(data) {
    this.setStep(6);
    this.updateChangedFiles(data.changedFiles);
    this.renderFinalResult(data, 'success');
    this.addActivity('success', 'Build task completed successfully!');
    // Reflect files the task created/edited in the workspace tree.
    this.refreshFileTree();
  }

  onTaskFailed(data) {
    this.updateChangedFiles(data.changedFiles);
    this.renderFinalResult(data, 'error');
    this.addActivity('error', `Task failed: ${data.error || 'Execution error'}`);
  }

  onTaskStopped(data) {
    this.renderFinalResult(data, 'stopped');
    this.addActivity('warning', 'Task stopped by user');
  }

  onReviewAvailable(data) {
    this.changedFiles = data.changedFiles || [];
    this.reviewState = "REVIEW_AVAILABLE";
    if (this.elements.reviewPanel) this.elements.reviewPanel.classList.remove('hidden');
    if (this.elements.reviewState) this.elements.reviewState.textContent = 'REVIEW AVAILABLE';
    this.updateChangedFiles(this.changedFiles);
    this.renderReviewSummary();
  }

  onVerificationStatus(data) {
    this.verificationStatus = data.verification || 'NOT_REQUESTED';
    this.buildStatus = data.build || 'NOT_RUN';
    this.browserStatus = data.browser || 'NOT_RUN';

    const overall = (this.verificationStatus === 'PASSED' || this.browserStatus === 'PASSED' || this.buildStatus === 'PASSED')
      ? 'PASSED'
      : (this.verificationStatus === 'FAILED' || this.browserStatus === 'FAILED' || this.buildStatus === 'FAILED')
      ? 'FAILED' : 'IDLE';

    if (this.elements.verificationStatus) {
      this.elements.verificationStatus.className = `verification-badge ${overall.toLowerCase()}`;
      this.elements.verificationStatus.innerHTML = `<span class="dot"></span><span>${overall === 'PASSED' ? 'Passed' : overall === 'FAILED' ? 'Failed' : 'Not Requested'}</span>`;
    }

    if (this.elements.browserTabDot) {
      this.elements.browserTabDot.className = `tab-status-dot ${overall.toLowerCase()}`;
    }

    this.renderVerificationDetails();
  }

  renderVerificationDetails() {
    if (!this.elements.verificationDetails) return;
    const items = [];
    if (this.buildStatus && this.buildStatus !== 'NOT_RUN') {
      items.push({ label: 'Build Check', val: this.buildStatus });
    }
    if (this.browserStatus && this.browserStatus !== 'NOT_RUN') {
      items.push({ label: 'Browser E2E', val: this.browserStatus });
    }
    if (this.verificationStatus && this.verificationStatus !== 'NOT_REQUESTED') {
      items.push({ label: 'Verification', val: this.verificationStatus });
    }

    if (items.length === 0) {
      this.elements.verificationDetails.innerHTML = '<div class="test-detail-empty">Verification will run automatically during test phase.</div>';
      return;
    }

    this.elements.verificationDetails.innerHTML = items.map(item => `
      <div class="verification-item">
        <span class="label">${this.escapeHtml(item.label)}</span>
        <span class="value ${item.val.toLowerCase()}">● ${this.escapeHtml(item.val)}</span>
      </div>
    `).join('');
  }

  // ---------- Code / Diff Handling ----------
  updateChangedFiles(files) {
    if (files && files.length > 0) this.changedFiles = files;
    const count = this.changedFiles.length;

    if (this.elements.changedCount) this.elements.changedCount.textContent = String(count);
    if (this.elements.changedCountBadge) this.elements.changedCountBadge.textContent = String(count);

    if (!this.elements.changedFiles) return;
    this.elements.changedFiles.innerHTML = '';

    if (count === 0) {
      this.elements.changedFiles.innerHTML = '<li class="empty-files-hint">No files changed.</li>';
      if (this.elements.changedFilesSummary) this.elements.changedFilesSummary.innerHTML = '';
      return;
    }

    const added = this.changedFiles.filter(f => f.changeType === 'ADDED').length;
    const modified = this.changedFiles.filter(f => f.changeType === 'MODIFIED').length;
    const deleted = this.changedFiles.filter(f => f.changeType === 'DELETED').length;

    if (this.elements.changedFilesSummary) {
      this.elements.changedFilesSummary.innerHTML = `
        <span class="stat added">+${added}</span>
        <span class="stat modified">~${modified}</span>
        <span class="stat deleted">-${deleted}</span>
      `;
    }

    for (const file of this.changedFiles) {
      const li = document.createElement('li');
      const ct = (file.changeType || 'MODIFIED').toLowerCase();
      li.className = ct;
      const initial = (file.changeType || 'M')[0];
      li.innerHTML = `
        <span class="status">${initial}</span>
        <span class="path">${this.escapeHtml(file.path)}</span>
      `;
      li.addEventListener('click', () => this.requestDiff(file.path));
      this.elements.changedFiles.appendChild(li);
    }
  }

  requestDiff(filePath) {
    this.currentDiffFile = filePath;
    this.send('get_diff', { path: filePath });
    this.send('read_file', { path: filePath });
  }

  showFileContent(path, content) {
    this.currentFile = path;
    if (this.elements.viewerFilePath) this.elements.viewerFilePath.textContent = path;
    if (this.elements.diffViewer) this.elements.diffViewer.classList.add('hidden');
    if (this.elements.fileViewer) {
      this.elements.fileViewer.classList.remove('hidden');
      this.elements.fileViewer.innerHTML = `<code>${this.escapeHtml(content)}</code>`;
    }
  }

  onDiffResult(data) {
    if (this.elements.viewerFilePath) this.elements.viewerFilePath.textContent = data.path;
    if (this.elements.diffChangeType) {
      this.elements.diffChangeType.textContent = data.changeType || 'MODIFIED';
      this.elements.diffChangeType.className = `change-badge ${(data.changeType || 'modified').toLowerCase()}`;
    }

    if (this.elements.diffViewer && data.diff) {
      let html = '';
      for (const line of data.diff) {
        const typeClass = line.type === 'context' ? 'context' : line.type;
        html += `<div class="diff-line ${typeClass}"><span class="line-nums"><span>${line.oldLineNum || ''}</span><span>${line.newLineNum || ''}</span></span><span>${this.escapeHtml(line.content || '')}</span></div>`;
      }
      this.elements.diffViewer.innerHTML = html;
      this.elements.diffViewer.classList.remove('hidden');
      if (this.elements.fileViewer) this.elements.fileViewer.classList.add('hidden');
    }
  }

  showDiffViewer() {
    if (this.elements.diffViewer) this.elements.diffViewer.classList.remove('hidden');
    if (this.elements.fileViewer) this.elements.fileViewer.classList.add('hidden');
  }

  approveChanges() {
    this.send('approve_changes', {});
  }

  rejectChanges() {
    this.send('reject_changes', {});
  }

  onApprovalChanged(data) {
    this.reviewState = data.state;
    if (this.elements.reviewState) this.elements.reviewState.textContent = data.state;
    this.addActivity('info', `Changes ${data.state.toLowerCase()} by user`);
  }

  renderReviewSummary() {
    if (!this.elements.reviewSummary) return;
    this.elements.reviewSummary.innerHTML = `
      <div>Files modified: <b>${this.changedFiles.length}</b></div>
      <div>Review Status: <b>${this.reviewState}</b></div>
    `;
  }

  renderFinalResult(data, status) {
    if (!this.elements.finalResult) return;
    const msg = status === 'success' ? 'Task completed successfully' : (data.error || 'Execution finished');
    this.elements.finalResult.innerHTML = `
      <div class="result-summary-card">
        <div class="res-title">Task Result (${status.toUpperCase()})</div>
        <div class="res-content">${this.escapeHtml(msg)}</div>
        <div class="res-content">Files Changed: ${this.changedFiles.length}</div>
      </div>
    `;
  }

  handleAttach() {
    const input = this.elements.attachInput;
    if (!input || !input.files || input.files.length === 0) return;
    const names = Array.from(input.files).map(f => f.name).join(', ');
    if (this.elements.attachNote) {
      this.elements.attachNote.textContent = `Attached: ${names}`;
    }
    if (this.elements.taskInput) {
      const cur = this.elements.taskInput.value;
      this.elements.taskInput.value = cur + (cur ? '\n' : '') + `[context: ${names}] `;
      this.updateRunButton();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.achuApp = new AchuWorkspace();
});
