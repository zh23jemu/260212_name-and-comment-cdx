(function () {
  'use strict';

  var BRIDGE_FLAG = '__sqliteBridgeInstalled__';
  if (window[BRIDGE_FLAG]) {
    return;
  }
  window[BRIDGE_FLAG] = true;

  function getNamespace() {
    return 'smart_classroom_global';
  }

  function getApiBase() {
    // 1. If we are explicitly configured (e.g. injected by shell), use it
    if (window.__API_BASE__) {
      return window.__API_BASE__;
    }

    // 2. Production Environment Check (Heuristic)
    // If we are on a domain that is NOT localhost/127.0.0.1 and starts with http, assume same-origin API
    if (location.protocol.startsWith('http') &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1' &&
      location.origin !== 'null') {
      return location.origin;
    }

    // 3. Local Development / File Protocol Fallback
    // For local file usage (file://) or localhost development, always point to the known backend port.
    return 'http://127.0.0.1:3000';
  }

  var NAMESPACE = getNamespace();
  var API_BASE = getApiBase();

  function postJson(path, payload) {
    if (!API_BASE) {
      return Promise.resolve(null);
    }
    var headers = { 'Content-Type': 'application/json' };
    var auth = getAuthHeader();
    Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

    return fetch(API_BASE + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      credentials: 'include'
    }).catch(function () {
      return null;
    });
  }

  function bootstrapFromServer() {
    if (!API_BASE) {
      return;
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', API_BASE + '/api/kv/snapshot?namespace=' + encodeURIComponent(NAMESPACE), false);
      xhr.send(null);

      if (xhr.status < 200 || xhr.status >= 300) {
        return;
      }

      var body = JSON.parse(xhr.responseText || '{}');
      var items = body.items || {};
      Object.keys(items).forEach(function (key) {
        var value = items[key];
        if (typeof value === 'string') {
          // Do not overwrite existing token/user during bootstrap to avoid race conditions
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, value);
          }
        }
      });
    } catch (_) { }
  }

  function mirrorWholeStorage() {
    var onceKey = '__sqlite_bridge_mirrored__' + NAMESPACE;
    if (sessionStorage.getItem(onceKey) === '1') {
      return;
    }

    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (!key) {
          continue;
        }
        var value = localStorage.getItem(key);
        if (typeof value === 'string') {
          postJson('/api/kv/upsert', { namespace: NAMESPACE, key: key, value: value });
        }
      }
      sessionStorage.setItem(onceKey, '1');
    } catch (_) { }
  }

  function detectClassManagementPage() {
    return (document.title || '').indexOf('班级学生管理') >= 0;
  }

  function detectTeacherManagementPage() {
    return (document.title || '').indexOf('教师与权限管理') >= 0;
  }

  function detectAdminDashboardPage() {
    return (document.title || '').indexOf('管理后台仪表盘') >= 0;
  }

  function detectLoginPage() {
    return (document.title || '').indexOf('教师登录') >= 0;
  }

  function getAuthHeader() {
    var token = localStorage.getItem('token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
  }

  function findCardValueByTitle(titleText) {
    var titles = Array.prototype.slice.call(document.querySelectorAll('h3'));
    for (var i = 0; i < titles.length; i += 1) {
      var t = (titles[i].innerText || '').replace(/\s+/g, '');
      if (t.indexOf(titleText) >= 0) {
        var card = titles[i].closest('div.rounded-xl, div.rounded-lg, div.border');
        if (!card) {
          card = titles[i].parentElement && titles[i].parentElement.parentElement ? titles[i].parentElement.parentElement : null;
        }
        if (!card) {
          continue;
        }
        var valueEl = card.querySelector('div.text-3xl.font-bold.tracking-tight');
        if (valueEl) {
          return valueEl;
        }
      }
    }
    return null;
  }

  function findDashboardRefreshButton() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < buttons.length; i += 1) {
      var txt = (buttons[i].innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('刷新数据') >= 0) {
        return buttons[i];
      }
    }
    return null;
  }

  async function fetchDashboardStats() {
    var classes = [];
    var teachers = [];
    try {
      var cRes = await fetch(API_BASE + '/api/classes', { headers: getAuthHeader() });
      if (cRes.ok) {
        classes = await cRes.json();
      }
    } catch (_) { }

    try {
      var tRes = await fetch(API_BASE + '/api/teachers', { headers: getAuthHeader() });
      if (tRes.ok) {
        teachers = await tRes.json();
      }
    } catch (_) { }

    if (!Array.isArray(classes)) {
      classes = [];
    }
    if (!Array.isArray(teachers)) {
      teachers = [];
    }

    var students = 0;
    for (var i = 0; i < classes.length; i += 1) {
      var cid = classes[i] && classes[i].id;
      if (!cid) {
        continue;
      }
      try {
        var sRes = await fetch(API_BASE + '/api/classes/' + cid + '/students', { headers: getAuthHeader() });
        if (!sRes.ok) {
          continue;
        }
        var arr = await sRes.json();
        if (Array.isArray(arr)) {
          students += arr.length;
        }
      } catch (_) { }
    }

    return {
      teachers: teachers.filter(function (t) { return t && t.role === 'teacher'; }).length,
      classes: classes.length,
      students: students
    };
  }

  async function runDashboardOverride() {
    if (!detectAdminDashboardPage() || !API_BASE) {
      return;
    }

    try {
      var stats = await fetchDashboardStats();
      var teacherEl = findCardValueByTitle('活跃教师');
      if (teacherEl) {
        teacherEl.textContent = String(stats.teachers);
      }
      var studentEl = findCardValueByTitle('学生总数');
      if (studentEl) {
        studentEl.textContent = String(stats.students);
      }
    } catch (_) { }
  }

  function bindDashboardRefreshHandler() {
    if (document.body.getAttribute('data-db-dashboard-refresh-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-dashboard-refresh-bound', '1');

    document.body.addEventListener('click', function (event) {
      if (!detectAdminDashboardPage()) {
        return;
      }
      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var refreshBtn = findDashboardRefreshButton();
      if (!refreshBtn || btn !== refreshBtn) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      runDashboardOverride();
    }, true);
  }

  var teacherState = {
    initialized: false,
    teachers: []
  };

  function getTeacherTableBody() {
    var tables = Array.prototype.slice.call(document.querySelectorAll('table'));
    for (var i = 0; i < tables.length; i += 1) {
      var headerText = (tables[i].querySelector('thead') ? tables[i].querySelector('thead').innerText : '') || '';
      if (headerText.indexOf('用户名') >= 0 && headerText.indexOf('姓名') >= 0) {
        return tables[i].querySelector('tbody');
      }
    }
    return null;
  }

  function updateTeacherStats(teachers) {
    var stats = {};
    var cards = Array.prototype.slice.call(document.querySelectorAll('p'));
    for (var i = 0; i < cards.length; i += 1) {
      var key = (cards[i].innerText || '').replace(/\s+/g, '');
      if (key.indexOf('总教师数') >= 0) stats.total = cards[i];
      if (key.indexOf('已分配权限') >= 0) stats.assigned = cards[i];
      if (key.indexOf('班级总数') >= 0) stats.classes = cards[i];
    }

    function setNumberAfterLabel(labelNode, value) {
      if (!labelNode) return;
      var box = labelNode.parentElement;
      if (!box) return;
      var num = box.querySelector('div.text-4xl');
      if (num) {
        num.textContent = String(value);
      }
    }

    setNumberAfterLabel(stats.total, Array.isArray(teachers) ? teachers.length : 0);
    var assignedCount = 0;
    if (Array.isArray(teachers)) {
      for (var i = 0; i < teachers.length; i += 1) {
        var t = teachers[i];
        if (t && Array.isArray(t.assignedClasses) && t.assignedClasses.length > 0) {
          assignedCount += 1;
        }
      }
    }
    setNumberAfterLabel(stats.assigned, assignedCount);
  }

  async function updateTeacherClassStats() {
    var classesCount = 0;
    try {
      var cRes = await fetch(API_BASE + '/api/classes');
      if (cRes.ok) {
        var cls = await cRes.json();
        classesCount = Array.isArray(cls) ? cls.length : 0;
      }
    } catch (_) { }

    var cards = Array.prototype.slice.call(document.querySelectorAll('p'));
    for (var i = 0; i < cards.length; i += 1) {
      var key = (cards[i].innerText || '').replace(/\s+/g, '');
      if (key.indexOf('班级总数') >= 0) {
        var box = cards[i].parentElement;
        var num = box ? box.querySelector('div.text-4xl') : null;
        if (num) {
          num.textContent = String(classesCount);
        }
        break;
      }
    }
  }

  function renderTeachers(tbody, teachers) {
    if (!tbody) {
      return;
    }

    tbody.innerHTML = '';
    if (!teachers || !teachers.length) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="6" class="px-4 py-8 text-center text-slate-400">暂无教师数据</td>';
      tbody.appendChild(empty);
      return;
    }

    for (var i = 0; i < teachers.length; i += 1) {
      var t = teachers[i];
      var created = String(t.createdAt || '').slice(0, 10);
      var roleBadge = t.role === 'admin'
        ? '<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600">管理员</span>'
        : '<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-indigo-700 bg-indigo-100">教师</span>';
      var deleteBtn = t.role === 'admin'
        ? ''
        : '<button type="button" class="delete-teacher-btn inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium hover:text-accent-foreground size-9 text-rose-500 hover:bg-rose-50 h-9 w-9 rounded-xl" data-teacher-id="' + t.id + '" title="删除教师">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>' +
        '</button>';
      var tr = document.createElement('tr');
      tr.setAttribute('data-teacher-id', String(t.id));
      var assigned = Array.isArray(t.assignedClasses) ? t.assignedClasses : [];
      var assignedHtml = '';
      if (!assigned.length) {
        assignedHtml = '<span class="text-slate-400 font-medium">尚未分配</span>';
      } else {
        for (var a = 0; a < assigned.length; a += 1) {
          assignedHtml += '<span class="inline-flex items-center rounded-full px-2 py-0.5 mr-1 mb-1 text-xs font-semibold text-indigo-700 border border-indigo-200 bg-indigo-50">' + (assigned[a].name || ('班级' + assigned[a].id)) + '</span>';
        }
      }
      tr.className = 'transition-colors border-b border-indigo-50 hover:bg-indigo-50/20';
      tr.innerHTML =
        '<td class="p-4 align-middle font-semibold text-indigo-700">' + (t.username || '-') + '</td>' +
        '<td class="p-4 align-middle font-semibold text-slate-900">' + (t.name || '-') + '</td>' +
        '<td class="p-4 align-middle">' + roleBadge + '</td>' +
        '<td class="p-4 align-middle">' + assignedHtml + '</td>' +
        '<td class="p-4 align-middle text-slate-400 font-semibold">' + (created || '-') + '</td>' +
        '<td class="p-4 align-middle text-right">' +
        '<div class="inline-flex items-center justify-end gap-2 whitespace-nowrap">' +
        '<button type="button" class="perm-teacher-btn inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium hover:text-accent-foreground size-9 text-amber-600 hover:bg-amber-50 h-9 w-9 rounded-xl" data-teacher-id="' + t.id + '" title="管理权限">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path><path d="m9 12 2 2 4-4"></path></svg>' +
        '</button>' +
        '<button type="button" class="edit-teacher-btn inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium hover:text-accent-foreground size-9 text-indigo-600 hover:bg-indigo-50 h-9 w-9 rounded-xl" data-teacher-id="' + t.id + '" title="编辑基本信息">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>' +
        '</button>' +
        deleteBtn +
        '</div>' +
        '</td>';
      tbody.appendChild(tr);
    }
  }

  function findTeacherById(teacherId) {
    for (var i = 0; i < teacherState.teachers.length; i += 1) {
      if (Number(teacherState.teachers[i].id) === Number(teacherId)) {
        return teacherState.teachers[i];
      }
    }
    return null;
  }

  async function runTeacherPageOverride() {
    if (!detectTeacherManagementPage() || !API_BASE) {
      return;
    }

    var tbody = getTeacherTableBody();
    if (!tbody) {
      return;
    }

    try {
      var res = await fetch(API_BASE + '/api/teachers', { headers: getAuthHeader() });
      if (!res.ok) {
        return;
      }
      var teachers = await res.json();
      if (Array.isArray(teachers)) {
        teachers.sort(function (a, b) {
          var aAdmin = a && a.role === 'admin' ? 1 : 0;
          var bAdmin = b && b.role === 'admin' ? 1 : 0;
          if (aAdmin !== bAdmin) {
            return bAdmin - aAdmin;
          }
          return Number(a && a.id ? a.id : 0) - Number(b && b.id ? b.id : 0);
        });
      }
      teacherState.initialized = true;
      teacherState.teachers = Array.isArray(teachers) ? teachers : [];
      renderTeachers(tbody, teacherState.teachers);
      updateTeacherStats(teacherState.teachers);
      updateTeacherClassStats();
    } catch (_) { }
  }

  function bindTeacherCreateHandler() {
    if (document.body.getAttribute('data-db-create-teacher-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-create-teacher-bound', '1');

    function findDialogRoot(fromEl) {
      var node = fromEl;
      while (node && node !== document.body) {
        var txt = node.innerText || '';
        if (txt.indexOf('新增教师账号') >= 0 && txt.indexOf('保存修改') >= 0) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function pickInput(root, hints, fallbackIndex) {
      var inputs = Array.prototype.slice.call(root.querySelectorAll('input'));
      for (var i = 0; i < inputs.length; i += 1) {
        var ph = String(inputs[i].getAttribute('placeholder') || '');
        for (var j = 0; j < hints.length; j += 1) {
          if (ph.indexOf(hints[j]) >= 0) {
            return inputs[i];
          }
        }
      }
      return inputs[fallbackIndex] || null;
    }

    document.body.addEventListener('click', async function (event) {
      if (!detectTeacherManagementPage()) {
        return;
      }
      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var txt = (btn.innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('保存修改') < 0) {
        return;
      }

      var dialog = findDialogRoot(btn);
      if (!dialog) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var usernameInput = pickInput(dialog, ['用户名'], 0);
      var nameInput = pickInput(dialog, ['教师姓名', '姓名'], 1);
      var passwordInput = pickInput(dialog, ['输入密码'], 2);
      var confirmInput = pickInput(dialog, ['再次输入密码', '确认密码'], 3);

      var username = usernameInput ? String(usernameInput.value || '').trim() : '';
      var name = nameInput ? String(nameInput.value || '').trim() : '';
      var password = passwordInput ? String(passwordInput.value || '').trim() : '';
      var confirmPassword = confirmInput ? String(confirmInput.value || '').trim() : '';

      if (!username || !name || !password || !confirmPassword) {
        window.alert('请完整填写用户名、姓名、密码和确认密码。');
        return;
      }
      if (password !== confirmPassword) {
        window.alert('两次密码不一致，请重新输入。');
        return;
      }

      try {
        var headers = { 'Content-Type': 'application/json' };
        var auth = getAuthHeader();
        Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

        var res = await fetch(API_BASE + '/api/teachers', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            username: username,
            name: name,
            password: password,
            role: 'teacher'
          })
        });
        if (res.status === 409) {
          window.alert('用户名已存在，请更换后重试。');
          return;
        }
        if (!res.ok) {
          window.alert('新增教师失败，请稍后重试。');
          return;
        }

        await runTeacherPageOverride();
        var buttons = Array.prototype.slice.call(dialog.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i += 1) {
          var btxt = (buttons[i].innerText || '').replace(/\s+/g, '');
          if (btxt.indexOf('取消') >= 0 || btxt === '×' || btxt === '✕') {
            buttons[i].click();
            break;
          }
        }
      } catch (_) {
        window.alert('新增教师失败，请检查网络后重试。');
      }
    }, true);
  }

  function bindTeacherDeleteHandler() {
    if (document.body.getAttribute('data-db-delete-teacher-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-delete-teacher-bound', '1');

    document.body.addEventListener('click', async function (event) {
      var btn = event.target.closest('.delete-teacher-btn');
      if (!btn) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var teacherId = Number(btn.getAttribute('data-teacher-id'));
      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        return;
      }

      var ok = window.confirm('确认删除该教师账号？');
      if (!ok) {
        return;
      }
      try {
        var res = await fetch(API_BASE + '/api/teachers/' + teacherId, {
          method: 'DELETE',
          headers: getAuthHeader()
        });
        if (!res.ok) {
          window.alert('删除教师失败，请稍后重试。');
          return;
        }
        await runTeacherPageOverride();
      } catch (_) {
        window.alert('删除教师失败，请检查网络后重试。');
      }
    }, true);
  }

  function bindTeacherActionHandler() {
    if (document.body.getAttribute('data-db-teacher-action-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-teacher-action-bound', '1');

    document.body.addEventListener('click', async function (event) {
      var permBtn = event.target.closest('.perm-teacher-btn');
      var editBtn = event.target.closest('.edit-teacher-btn');
      if (!permBtn && !editBtn) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var teacherId = Number((permBtn || editBtn).getAttribute('data-teacher-id'));
      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        return;
      }
      var teacher = findTeacherById(teacherId);
      if (!teacher) {
        return;
      }

      if (permBtn) {
        var anchorRow = permBtn.closest('tr[data-teacher-id]');
        if (!anchorRow) {
          anchorRow = document.querySelector('tr[data-teacher-id="' + teacherId + '"]');
        }
        var selectedClassIds = await openTeacherPermissionDialog(teacher, anchorRow);
        if (!selectedClassIds) {
          return;
        }
        try {
          var headers = { 'Content-Type': 'application/json' };
          var auth = getAuthHeader();
          Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

          var resPerm = await fetch(API_BASE + '/api/teachers/' + teacherId + '/class-permissions', {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({ classIds: selectedClassIds })
          });
          if (!resPerm.ok) {
            window.alert('更新权限失败，请稍后重试。');
            return;
          }
          await runTeacherPageOverride();
        } catch (_) {
          window.alert('更新权限失败，请检查网络后重试。');
        }
        return;
      }

      if (editBtn) {
        var dialogResult = await openTeacherEditDialog(teacher);
        if (!dialogResult || !dialogResult.ok) {
          return;
        }

        var payload = { name: dialogResult.name };
        if (dialogResult.password) {
          payload.password = dialogResult.password;
        }

        try {
          var headers = { 'Content-Type': 'application/json' };
          var auth = getAuthHeader();
          Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

          var resEdit = await fetch(API_BASE + '/api/teachers/' + teacherId, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(payload)
          });
          if (!resEdit.ok) {
            window.alert('更新教师信息失败，请稍后重试。');
            return;
          }
          await runTeacherPageOverride();
        } catch (_) {
          window.alert('更新教师信息失败，请检查网络后重试。');
        }
      }
    }, true);
  }

  function openTeacherPermissionDialog(teacher, anchorRow) {
    return new Promise(async function (resolve) {
      var old = document.getElementById('db-teacher-perm-inline-row');
      if (old && old.parentElement) {
        old.parentElement.removeChild(old);
      }

      var classes = [];
      try {
        var cRes = await fetch(API_BASE + '/api/classes', { headers: getAuthHeader() });
        if (cRes.ok) {
          classes = await cRes.json();
        }
      } catch (_) { }
      if (!Array.isArray(classes)) {
        classes = [];
      }

      var selectedSet = {};
      var assignedClasses = Array.isArray(teacher && teacher.assignedClasses) ? teacher.assignedClasses : [];
      for (var i = 0; i < assignedClasses.length; i += 1) {
        selectedSet[Number(assignedClasses[i].id)] = true;
      }

      if (!anchorRow || !anchorRow.parentElement) {
        resolve(null);
        return;
      }

      var inlineRow = document.createElement('tr');
      inlineRow.id = 'db-teacher-perm-inline-row';
      inlineRow.className = 'bg-indigo-50/40';
      var inlineCell = document.createElement('td');
      inlineCell.colSpan = 6;
      inlineCell.className = 'p-3';
      inlineRow.appendChild(inlineCell);
      anchorRow.insertAdjacentElement('afterend', inlineRow);

      var card = document.createElement('div');
      card.className = 'rounded-xl bg-slate-50 shadow-lg border border-indigo-100 overflow-hidden';
      card.style.width = '96%';
      card.style.minWidth = '0';
      card.style.maxWidth = 'none';
      card.style.margin = '0 auto';

      var gradeMap = {};
      for (var c = 0; c < classes.length; c += 1) {
        var cls = classes[c];
        var grade = (cls && cls.grade ? String(cls.grade).trim() : '') || '未分组';
        if (!gradeMap[grade]) {
          gradeMap[grade] = [];
        }
        gradeMap[grade].push(cls);
      }
      var gradeList = Object.keys(gradeMap);

      var gradeOptions = '<option value="">全部年级</option>';
      for (var g = 0; g < gradeList.length; g += 1) {
        gradeOptions += '<option value="' + gradeList[g] + '">' + gradeList[g] + '</option>';
      }

      card.innerHTML =
        '<div class="px-6 py-4 bg-white border-b border-indigo-100 flex items-center justify-between">' +
        '<div class="flex items-center gap-3">' +
        '<div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">🛡</div>' +
        '<div>' +
        '<div class="text-base font-extrabold text-slate-900">给' + (teacher.name || teacher.username || '教师') + ' 分配班级权限</div>' +
        '<div class="text-sm text-indigo-500 font-semibold">当前已选 <span class="db-selected-count">0</span> 个教学班级</div>' +
        '</div>' +
        '</div>' +
        '<div class="flex items-center gap-3">' +
        '<select class="db-grade-filter h-9 px-2 rounded-lg border border-indigo-100 text-indigo-700 bg-white text-xs font-semibold">' + gradeOptions + '</select>' +
        '<button type="button" class="db-perm-cancel text-slate-500 text-base font-semibold">取消</button>' +
        '<button type="button" class="db-perm-save h-9 px-3 rounded-lg text-white text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 shadow-md">保存</button>' +
        '<button type="button" class="db-perm-close text-2xl leading-none text-slate-400 hover:text-slate-700">×</button>' +
        '</div>' +
        '</div>' +
        '<div class="p-4 max-h-[52vh] overflow-auto">' +
        '<div class="db-perm-groups space-y-6"></div>' +
        '</div>';

      inlineCell.appendChild(card);

      var groupsHost = card.querySelector('.db-perm-groups');
      var countNode = card.querySelector('.db-selected-count');
      var filterNode = card.querySelector('.db-grade-filter');

      function selectedCount() {
        var n = 0;
        var keys = Object.keys(selectedSet);
        for (var si = 0; si < keys.length; si += 1) {
          if (selectedSet[keys[si]]) n += 1;
        }
        return n;
      }

      function classCardHtml(cls, selected) {
        return (
          '<button type="button" class="db-perm-class-card relative text-left p-4 rounded-2xl border transition-all ' +
          (selected
            ? 'bg-gradient-to-br from-indigo-600 to-purple-500 text-white border-indigo-400 shadow-lg shadow-indigo-200'
            : 'bg-white text-indigo-900 border-indigo-100 hover:border-indigo-300 hover:shadow-sm') +
          '" data-class-id="' + cls.id + '">' +
          '<div class="text-xs tracking-widest uppercase opacity-80 font-bold">CLASS</div>' +
          '<div class="mt-1 text-2xl font-extrabold">' + (cls.name || ('班级' + cls.id)) + '</div>' +
          '<div class="mt-2 h-1.5 w-10 rounded-full ' + (selected ? 'bg-white/35' : 'bg-indigo-100') + '"></div>' +
          (selected ? '<div class="absolute right-3 top-3 text-sm">✓</div>' : '') +
          '</button>'
        );
      }

      function renderGroups() {
        var filterGrade = filterNode ? String(filterNode.value || '') : '';
        var html = '';
        for (var gi = 0; gi < gradeList.length; gi += 1) {
          var grade = gradeList[gi];
          if (filterGrade && grade !== filterGrade) {
            continue;
          }
          var arr = gradeMap[grade] || [];
          var cards = '';
          for (var ai = 0; ai < arr.length; ai += 1) {
            var cls2 = arr[ai];
            var sid = Number(cls2.id);
            cards += classCardHtml(cls2, !!selectedSet[sid]);
          }
          html +=
            '<section class="space-y-3">' +
            '<div class="flex items-center justify-between">' +
            '<div class="inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold text-white bg-gradient-to-r from-indigo-600 to-purple-500">' + grade + '</div>' +
            '<div class="text-xs text-indigo-300 font-semibold">共 ' + arr.length + ' 个班级</div>' +
            '</div>' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + cards + '</div>' +
            '</section>';
        }
        groupsHost.innerHTML = html || '<div class="text-slate-400">暂无可分配班级</div>';
        if (countNode) {
          countNode.textContent = String(selectedCount());
        }
      }

      renderGroups();

      groupsHost.addEventListener('click', function (e) {
        var btn = e.target.closest('.db-perm-class-card');
        if (!btn) {
          return;
        }
        var cid = Number(btn.getAttribute('data-class-id'));
        if (!Number.isInteger(cid) || cid <= 0) {
          return;
        }
        selectedSet[cid] = !selectedSet[cid];
        renderGroups();
      });
      if (filterNode) {
        filterNode.addEventListener('change', renderGroups);
      }

      var closed = false;
      function close(result) {
        if (closed) return;
        closed = true;
        if (inlineRow && inlineRow.parentElement) inlineRow.parentElement.removeChild(inlineRow);
        resolve(result || null);
      }

      function onCancel() {
        close(null);
      }
      function onSave() {
        var ids = [];
        var keys = Object.keys(selectedSet);
        for (var k = 0; k < keys.length; k += 1) {
          if (selectedSet[keys[k]]) {
            var id = Number(keys[k]);
            if (Number.isInteger(id) && id > 0) ids.push(id);
          }
        }
        close(ids);
      }

      var closeBtn = card.querySelector('.db-perm-close');
      var cancelBtn = card.querySelector('.db-perm-cancel');
      var saveBtn = card.querySelector('.db-perm-save');
      if (closeBtn) closeBtn.addEventListener('click', onCancel);
      if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
      if (saveBtn) saveBtn.addEventListener('click', onSave);
    });
  }

  function openTeacherEditDialog(teacher) {
    return new Promise(function (resolve) {
      var old = document.getElementById('db-edit-teacher-overlay');
      if (old && old.parentElement) {
        old.parentElement.removeChild(old);
      }

      var overlay = document.createElement('div');
      overlay.id = 'db-edit-teacher-overlay';
      overlay.className = 'fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4';
      overlay.style.padding = '24px';
      overlay.style.backdropFilter = 'blur(2px)';

      var card = document.createElement('div');
      card.className = 'rounded-xl overflow-hidden bg-white shadow-2xl';
      card.style.width = '860px';
      card.style.maxWidth = '92vw';
      card.style.border = '1px solid rgba(99,102,241,0.22)';
      card.style.boxShadow = '0 24px 48px rgba(15,23,42,0.30)';
      card.innerHTML =
        '<div class="h-16 px-6 flex items-center justify-between bg-gradient-to-r from-indigo-600 to-purple-600 text-white">' +
        '<div class="text-lg leading-none mr-2">○</div>' +
        '<div class="flex-1 text-[34px] font-extrabold tracking-tight">编辑教师信息</div>' +
        '<button type="button" class="db-edit-teacher-close text-[24px] leading-none opacity-80 hover:opacity-100">×</button>' +
        '</div>' +
        '<div class="p-6 bg-slate-50/70 border-t border-indigo-100">' +
        '<div class="rounded-xl border border-slate-200 bg-white p-5">' +
        '<div class="text-[34px] font-bold text-slate-800 mb-4">基本身份信息</div>' +
        '<div class="grid grid-cols-2 gap-4">' +
        '<div>' +
        '<label class="block text-[30px] font-semibold text-slate-700 mb-2">用户名 <span class="text-rose-500">*</span></label>' +
        '<input class="db-edit-username w-full h-14 rounded-lg border border-slate-300 px-4 text-[24px] bg-slate-100 text-slate-600" type="text" readonly>' +
        '</div>' +
        '<div>' +
        '<label class="block text-[30px] font-semibold text-slate-700 mb-2">姓名 <span class="text-rose-500">*</span></label>' +
        '<input class="db-edit-name w-full h-14 rounded-lg border border-slate-300 px-4 text-[24px] bg-white" type="text">' +
        '</div>' +
        '<div>' +
        '<label class="block text-[30px] font-semibold text-slate-700 mb-2">新密码(留空则不修改)</label>' +
        '<input class="db-edit-password w-full h-14 rounded-lg border border-slate-300 px-4 text-[24px] bg-white" type="password" placeholder="输入密码">' +
        '</div>' +
        '<div>' +
        '<label class="block text-[30px] font-semibold text-slate-700 mb-2">确认密码</label>' +
        '<input class="db-edit-confirm w-full h-14 rounded-lg border border-slate-300 px-4 text-[24px] bg-white" type="password" placeholder="再次输入密码">' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="h-24 px-7 bg-white border-t border-slate-200 flex items-center justify-end gap-8">' +
        '<button type="button" class="db-edit-teacher-cancel text-slate-500 text-[30px] font-semibold">取消</button>' +
        '<button type="button" class="db-edit-teacher-save h-14 px-10 rounded-xl text-white text-[30px] font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg shadow-indigo-200">保存修改</button>' +
        '</div>';

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      var usernameInput = card.querySelector('.db-edit-username');
      var nameInput = card.querySelector('.db-edit-name');
      var passwordInput = card.querySelector('.db-edit-password');
      var confirmInput = card.querySelector('.db-edit-confirm');
      if (usernameInput) {
        usernameInput.value = teacher && teacher.username ? teacher.username : '';
      }
      if (nameInput) {
        nameInput.value = teacher && teacher.name ? teacher.name : '';
      }

      var closed = false;
      function close(result) {
        if (closed) {
          return;
        }
        closed = true;
        if (overlay && overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
        }
        resolve(result || { ok: false });
      }

      function onCancel() {
        close({ ok: false });
      }

      function onSave() {
        var name = nameInput ? String(nameInput.value || '').trim() : '';
        var password = passwordInput ? String(passwordInput.value || '').trim() : '';
        var confirmPassword = confirmInput ? String(confirmInput.value || '').trim() : '';

        if (!name) {
          window.alert('姓名不能为空。');
          return;
        }
        if ((password || confirmPassword) && password !== confirmPassword) {
          window.alert('两次密码不一致，请重新输入。');
          return;
        }
        close({ ok: true, name: name, password: password });
      }

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          onCancel();
        }
      });
      var closeBtn = card.querySelector('.db-edit-teacher-close');
      var cancelBtn = card.querySelector('.db-edit-teacher-cancel');
      var saveBtn = card.querySelector('.db-edit-teacher-save');
      if (closeBtn) closeBtn.addEventListener('click', onCancel);
      if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
      if (saveBtn) saveBtn.addEventListener('click', onSave);
    });
  }

  function getStudentTableBody() {
    return document.querySelector('tbody[data-source-file*="StudentClassManagementPage.vue"][class*="divide-y"]');
  }

  function updateStudentCount(count) {
    var pNodes = Array.prototype.slice.call(document.querySelectorAll('p'));
    for (var i = 0; i < pNodes.length; i += 1) {
      var txt = pNodes[i].textContent || '';
      if (txt.indexOf('当前班级共有') >= 0 && txt.indexOf('名学生') >= 0) {
        var num = pNodes[i].querySelector('span.font-bold.text-indigo-600');
        if (num) {
          num.textContent = String(count);
        } else {
          pNodes[i].textContent = '当前班级共有 ' + count + ' 名学生';
        }
        return;
      }
    }
  }

  function renderStudents(tbody, students) {
    if (!tbody) {
      return;
    }

    tbody.innerHTML = '';
    if (!students || !students.length) {
      var empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="5" class="px-8 py-8 text-center text-slate-400">暂无学生数据</td>';
      tbody.appendChild(empty);
      return;
    }

    for (var i = 0; i < students.length; i += 1) {
      var s = students[i];
      var checked = classState.selectedStudentIds[s.id] ? ' checked' : '';
      var tr = document.createElement('tr');
      tr.className = i % 2 === 0 ? 'bg-white group transition-all duration-200' : 'bg-slate-50/30 group transition-all duration-200';
      tr.innerHTML =
        '<td class="px-6 py-4"><input type="checkbox" class="student-row-checkbox w-5 h-5 rounded border-slate-300 cursor-pointer accent-indigo-600" data-student-id="' + s.id + '"' + checked + '></td>' +
        '<td class="px-4 py-4"><div class="w-10 h-10 flex items-center justify-center rounded-xl font-bold shadow-sm bg-indigo-500 text-white">' + (s.studentNo || (i + 1)) + '</div></td>' +
        '<td class="px-8 py-4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">' + String((s.name || '?')).slice(0, 1) + '</div><span class="font-bold text-slate-900 group-hover:text-indigo-700 text-base antialiased text-sharp">' + (s.name || '-') + '</span></div></td>' +
        '<td class="px-8 py-4"><div class="inline-flex gap-1 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-emerald-100 text-emerald-600 bg-emerald-50/30">在读</div></td>' +
        '<td class="px-8 py-4 text-right">' +
        '<button type="button" class="delete-student-btn inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium hover:text-accent-foreground size-9 text-rose-500 hover:bg-rose-50 h-9 w-9 rounded-xl" data-student-id="' + s.id + '" title="删除学生" aria-label="删除学生">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-minus-icon lucide-user-minus">' +
        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="22" x2="16" y1="11" y2="11"></line>' +
        '</svg>' +
        '</button>' +
        '</td>';
      tbody.appendChild(tr);
    }

    updateBatchDeleteButtonState();
  }

  var classState = {
    initialized: false,
    classes: [],
    tbody: null,
    currentClassId: null,
    classCounts: {},
    selectedStudentIds: {},
    selectedClassIds: {}
  };
  var classListRenderLock = false;

  function normalizeText(v) {
    return String(v || '').replace(/\s+/g, '').trim();
  }

  function resolveClassFromCard(card, index) {
    var classes = classState.classes;
    if (!classes.length) {
      return null;
    }

    var cardText = normalizeText(card ? card.innerText : '');
    for (var i = 0; i < classes.length; i += 1) {
      var cname = normalizeText(classes[i].name);
      if (cname && cardText.indexOf(cname) >= 0) {
        return classes[i];
      }
    }

    var m = cardText.match(/(\d+)班/);
    if (m) {
      for (var j = 0; j < classes.length; j += 1) {
        var n = normalizeText(classes[j].name);
        if (n.indexOf(m[1] + '班') >= 0 || n.indexOf('(' + m[1] + ')班') >= 0) {
          return classes[j];
        }
      }
    }

    return classes[index] || classes[0];
  }

  function bindClassSwitchHandler() {
    if (document.body.getAttribute('data-db-class-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-class-bound', '1');

    document.body.addEventListener('click', function (event) {
      if (!detectClassManagementPage() || !classState.initialized) {
        return;
      }
      // Keep checkbox/button interactions independent from class switching.
      if (
        event.target.closest('input[type="checkbox"]') ||
        event.target.closest('button[data-class-action]')
      ) {
        return;
      }
      var card = event.target.closest('div.p-4.rounded-xl.border-2.cursor-pointer[data-class-id]');
      if (!card) {
        return;
      }
      var classId = Number(card.getAttribute('data-class-id'));
      var cls = null;
      for (var i = 0; i < classState.classes.length; i += 1) {
        if (Number(classState.classes[i].id) === classId) {
          cls = classState.classes[i];
          break;
        }
      }
      if (!cls) {
        return;
      }
      loadStudentsByClass(cls);
    }, true);
  }

  function updateBatchDeleteButtonState() {
    var btn = document.getElementById('batch-delete-students-btn');
    if (!btn) {
      return;
    }
    var count = Object.keys(classState.selectedStudentIds).length;
    if (count <= 0) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.textContent = '批量删除';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.textContent = '批量删除(' + count + ')';
    }
  }

  function ensureBatchDeleteButton() {
    if (!detectClassManagementPage()) {
      return;
    }
    if (document.getElementById('batch-delete-students-btn')) {
      updateBatchDeleteButtonState();
      return;
    }

    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var addBtn = null;
    for (var i = 0; i < buttons.length; i += 1) {
      var txt = (buttons[i].innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('添加学生') >= 0) {
        addBtn = buttons[i];
        break;
      }
    }
    if (!addBtn || !addBtn.parentElement) {
      return;
    }

    var btn = document.createElement('button');
    btn.id = 'batch-delete-students-btn';
    btn.type = 'button';
    btn.className = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold ring-offset-background transition-colors border bg-transparent h-10 px-4 py-2 border-rose-200 text-rose-600 hover:bg-rose-50';
    btn.textContent = '批量删除';
    btn.disabled = true;
    btn.style.opacity = '0.5';
    addBtn.parentElement.appendChild(btn);
  }

  function markMasterCheckbox() {
    var thCb = document.querySelector('thead input[type="checkbox"]');
    if (thCb && !thCb.classList.contains('student-master-checkbox')) {
      thCb.classList.add('student-master-checkbox');
    }
  }

  function bindStudentCheckboxHandler() {
    if (document.body.getAttribute('data-db-student-select-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-student-select-bound', '1');

    document.body.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox' || !classState.tbody) {
        return;
      }

      var studentTable = classState.tbody.closest('table');
      var targetTable = target.closest('table');
      if (!studentTable || !targetTable || studentTable !== targetTable) {
        return;
      }

      var rowCb = target.closest('.student-row-checkbox');
      if (rowCb) {
        var sid = Number(rowCb.getAttribute('data-student-id'));
        if (Number.isInteger(sid) && sid > 0) {
          if (rowCb.checked) {
            classState.selectedStudentIds[sid] = true;
          } else {
            delete classState.selectedStudentIds[sid];
          }
          updateBatchDeleteButtonState();
        }
        return;
      }

      var masterInHeader = target.closest('thead') ? target : null;
      if (masterInHeader) {
        var rows = Array.prototype.slice.call(document.querySelectorAll('.student-row-checkbox'));
        classState.selectedStudentIds = {};
        for (var i = 0; i < rows.length; i += 1) {
          rows[i].checked = masterInHeader.checked;
          var id = Number(rows[i].getAttribute('data-student-id'));
          if (masterInHeader.checked && Number.isInteger(id) && id > 0) {
            classState.selectedStudentIds[id] = true;
          }
        }
        updateBatchDeleteButtonState();
      }
    }, true);
  }

  function bindBatchDeleteHandler() {
    if (document.body.getAttribute('data-db-batch-delete-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-batch-delete-bound', '1');

    document.body.addEventListener('click', async function (event) {
      var btn = event.target.closest('#batch-delete-students-btn');
      if (!btn || !classState.currentClassId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      var ids = Object.keys(classState.selectedStudentIds).map(function (k) { return Number(k); }).filter(Boolean);
      if (!ids.length) {
        return;
      }

      var ok = window.confirm('确认批量删除已勾选的 ' + ids.length + ' 名学生？此操作不可恢复。');
      if (!ok) {
        return;
      }

      try {
        var headers = { 'Content-Type': 'application/json' };
        var auth = getAuthHeader();
        Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

        var res = await fetch(API_BASE + '/api/students/batch-delete', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ studentIds: ids })
        });
        if (!res.ok) {
          window.alert('批量删除失败，请稍后重试。');
          return;
        }

        classState.selectedStudentIds = {};
        var cls = null;
        for (var i = 0; i < classState.classes.length; i += 1) {
          if (Number(classState.classes[i].id) === Number(classState.currentClassId)) {
            cls = classState.classes[i];
            break;
          }
        }
        if (cls) {
          await loadStudentsByClass(cls);
        }
      } catch (_) {
        window.alert('批量删除失败，请检查网络后重试。');
      }
    }, true);
  }

  function getClassListContainer() {
    return document.querySelector('div.space-y-3[data-source-file*="ClassListPanel.vue"]');
  }

  function renderClassCardsFromDb(classes) {
    var container = getClassListContainer();
    if (!container) {
      return;
    }

    classListRenderLock = true;
    container.innerHTML = '';
    for (var i = 0; i < classes.length; i += 1) {
      var cls = classes[i];
      var active = Number(cls.id) === Number(classState.currentClassId);
      var count = classState.classCounts[cls.id] || 0;
      var card = document.createElement('div');
      card.className =
        'p-4 rounded-xl border-2 cursor-pointer transition-all duration-300 relative group overflow-hidden antialiased text-sharp ' +
        (active ? 'border-indigo-500 bg-white shadow-premium ring-2 ring-indigo-100 scale-[1.02]' : 'border-indigo-100 bg-white/80 hover:bg-white');
      card.setAttribute('data-class-id', String(cls.id));
      card.innerHTML =
        '<div class="flex items-start justify-between mb-2">' +
        '<div class="flex gap-3">' +
        '<input type="checkbox" class="class-row-checkbox w-5 h-5 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600" data-class-id="' + cls.id + '"' + (classState.selectedClassIds[cls.id] ? ' checked' : '') + '>' +
        '<div><p class="font-extrabold text-sm antialiased text-indigo-900">' + (cls.name || '') + '</p><p class="text-[10px] uppercase font-bold tracking-widest text-slate-500 antialiased">' + (cls.grade || '') + '</p></div>' +
        '</div>' +
        '<div class="inline-flex gap-1 items-center border py-0.5 text-xs rounded-lg px-2 h-5 font-bold bg-indigo-50 text-indigo-700">' + count + '</div>' +
        '</div>' +
        (active
          ? '<div class="flex gap-4 pt-3 mt-1 border-t border-indigo-100/50">' +
          '<button type="button" data-class-action="edit" data-class-id="' + cls.id + '" class="inline-flex items-center gap-1 text-indigo-600 text-sm font-bold">编辑</button>' +
          '<button type="button" data-class-action="delete" data-class-id="' + cls.id + '" class="inline-flex items-center gap-1 text-rose-500 text-sm font-bold">删除</button>' +
          '</div>'
          : '');
      container.appendChild(card);
    }

    updateClassMasterCheckboxState();
    setTimeout(function () { classListRenderLock = false; }, 0);
  }

  function ensureClassListObserver() {
    if (document.body.getAttribute('data-db-class-list-observer-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-class-list-observer-bound', '1');

    var container = getClassListContainer();
    if (!container) {
      return;
    }

    var observer = new MutationObserver(function () {
      if (classListRenderLock || !classState.initialized || !classState.classes.length) {
        return;
      }
      // If component re-renders back to demo data, force DB list again.
      renderClassCardsFromDb(classState.classes);
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  function getClassMasterCheckbox() {
    var panels = Array.prototype.slice.call(document.querySelectorAll('div[data-source-file*="ClassListPanel.vue"]'));
    var panel = null;
    for (var p = 0; p < panels.length; p += 1) {
      var txt = panels[p].innerText || '';
      if (txt.indexOf('班级名册') >= 0) {
        panel = panels[p];
        break;
      }
    }
    if (!panel) {
      return null;
    }

    var boxes = Array.prototype.slice.call(panel.querySelectorAll('input[type="checkbox"]'));
    for (var i = 0; i < boxes.length; i += 1) {
      if (!boxes[i].closest('[data-class-id]')) {
        return boxes[i];
      }
    }
    return null;
  }

  function updateClassMasterCheckboxState() {
    var master = getClassMasterCheckbox();
    if (!master) {
      return;
    }
    var classIds = classState.classes.map(function (c) { return Number(c.id); });
    if (!classIds.length) {
      master.checked = false;
      master.indeterminate = false;
      return;
    }
    var selectedCount = 0;
    for (var i = 0; i < classIds.length; i += 1) {
      if (classState.selectedClassIds[classIds[i]]) {
        selectedCount += 1;
      }
    }
    master.checked = selectedCount > 0 && selectedCount === classIds.length;
    master.indeterminate = selectedCount > 0 && selectedCount < classIds.length;
  }

  function bindClassCheckboxHandler() {
    if (document.body.getAttribute('data-db-class-checkbox-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-class-checkbox-bound', '1');

    document.body.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox') {
        return;
      }
      var inClassPanel = !!target.closest('div[data-source-file*="ClassListPanel.vue"]');
      if (!inClassPanel) {
        return;
      }

      var rowCb = target.closest('.class-row-checkbox');
      if (rowCb) {
        var cid = Number(rowCb.getAttribute('data-class-id'));
        if (Number.isInteger(cid) && cid > 0) {
          if (rowCb.checked) {
            classState.selectedClassIds[cid] = true;
          } else {
            delete classState.selectedClassIds[cid];
          }
          updateClassMasterCheckboxState();
        }
        return;
      }

      // Any class-panel checkbox that is not inside a class card is treated as master checkbox.
      if (!target.closest('[data-class-id]')) {
        var checked = target.checked;
        classState.selectedClassIds = {};
        for (var i = 0; i < classState.classes.length; i += 1) {
          var cid2 = Number(classState.classes[i].id);
          if (checked) {
            classState.selectedClassIds[cid2] = true;
          }
        }
        var rowBoxes = Array.prototype.slice.call(document.querySelectorAll('.class-row-checkbox'));
        for (var j = 0; j < rowBoxes.length; j += 1) {
          rowBoxes[j].checked = checked;
        }
        target.indeterminate = false;
        updateClassMasterCheckboxState();
      }
    }, true);
  }

  async function refreshClassCounts() {
    var counts = {};
    for (var i = 0; i < classState.classes.length; i += 1) {
      var cls = classState.classes[i];
      try {
        var res = await fetch(API_BASE + '/api/classes/' + cls.id + '/students', { headers: getAuthHeader() });
        if (!res.ok) {
          counts[cls.id] = 0;
          continue;
        }
        var arr = await res.json();
        counts[cls.id] = Array.isArray(arr) ? arr.length : 0;
      } catch (_) {
        counts[cls.id] = 0;
      }
    }
    classState.classCounts = counts;
  }

  function bindClassCreateHandler() {
    if (document.body.getAttribute('data-db-create-class-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-create-class-bound', '1');

    function findCreateClassDialog(fromEl) {
      var node = fromEl;
      while (node && node !== document.body) {
        var txt = node.innerText || '';
        if (txt.indexOf('创建新班级') >= 0 && txt.indexOf('确认并保存') >= 0) {
          return node;
        }
        node = node.parentElement;
      }

      var candidates = Array.prototype.slice.call(document.querySelectorAll('div[role="dialog"], div.fixed, div'));
      for (var i = 0; i < candidates.length; i += 1) {
        var t = candidates[i].innerText || '';
        if (t.indexOf('创建新班级') >= 0 && t.indexOf('确认并保存') >= 0) {
          return candidates[i];
        }
      }
      return null;
    }

    function readCreateClassForm(dialogRoot) {
      var inputs = Array.prototype.slice.call(dialogRoot.querySelectorAll('input'));
      var gradeInput = null;
      var nameInput = null;

      for (var i = 0; i < inputs.length; i += 1) {
        var ph = String(inputs[i].getAttribute('placeholder') || '');
        if (!gradeInput && (ph.indexOf('年级') >= 0 || ph.indexOf('高一') >= 0 || ph.indexOf('一年级') >= 0)) {
          gradeInput = inputs[i];
          continue;
        }
        if (!nameInput && (ph.indexOf('班级') >= 0 || ph.indexOf('1班') >= 0 || ph.indexOf('示例') >= 0)) {
          nameInput = inputs[i];
          continue;
        }
      }

      if (!nameInput && inputs.length >= 2) {
        gradeInput = gradeInput || inputs[0];
        nameInput = inputs[1];
      }

      return {
        grade: gradeInput ? String(gradeInput.value || '').trim() : '',
        name: nameInput ? String(nameInput.value || '').trim() : ''
      };
    }

    document.body.addEventListener('click', async function (event) {
      if (!detectClassManagementPage()) {
        return;
      }

      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var txt = (btn.innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('确认并保存') < 0) {
        return;
      }

      var dialog = findCreateClassDialog(btn);
      if (!dialog) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var form = readCreateClassForm(dialog);
      if (!form.name) {
        window.alert('请输入班级名称');
        return;
      }

      try {
        var headers = { 'Content-Type': 'application/json' };
        var auth = getAuthHeader();
        Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

        var res = await fetch(API_BASE + '/api/classes', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ name: form.name, grade: form.grade })
        });
        if (!res.ok) {
          window.alert('创建班级失败，请稍后重试。');
          return;
        }

        await runClassPageOverride();

        // Try closing the dialog using cancel/close button.
        var closeBtn = null;
        var buttons = Array.prototype.slice.call(dialog.querySelectorAll('button'));
        for (var j = 0; j < buttons.length; j += 1) {
          var t = (buttons[j].innerText || '').replace(/\s+/g, '');
          if (t.indexOf('取消') >= 0 || t === '×' || t === '✕') {
            closeBtn = buttons[j];
            break;
          }
        }
        if (closeBtn) {
          closeBtn.click();
        }
      } catch (_) {
        window.alert('创建班级失败，请检查网络后重试。');
      }
    }, true);
  }

  function bindClassEditDeleteHandler() {
    if (document.body.getAttribute('data-db-edit-class-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-edit-class-bound', '1');

    document.body.addEventListener('click', async function (event) {
      var btn = event.target.closest('button[data-class-action]');
      if (!btn) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var action = btn.getAttribute('data-class-action');
      var classId = Number(btn.getAttribute('data-class-id'));
      if (!Number.isInteger(classId) || classId <= 0) {
        return;
      }

      if (action === 'edit') {
        var cls = null;
        for (var i = 0; i < classState.classes.length; i += 1) {
          if (Number(classState.classes[i].id) === classId) {
            cls = classState.classes[i];
            break;
          }
        }
        if (!cls) {
          return;
        }

        var name = window.prompt('请输入班级名称', cls.name || '');
        if (!name || !name.trim()) {
          return;
        }
        name = name.trim();
        var grade = window.prompt('请输入年级', cls.grade || '');
        if (grade == null) {
          return;
        }

        try {
          var headers = { 'Content-Type': 'application/json' };
          var auth = getAuthHeader();
          Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

          var resEdit = await fetch(API_BASE + '/api/classes/' + classId, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({ name: name, grade: String(grade).trim() })
          });
          if (!resEdit.ok) {
            window.alert('编辑班级失败，请稍后重试。');
            return;
          }
          await runClassPageOverride();
        } catch (_) {
          window.alert('编辑班级失败，请检查网络后重试。');
        }
        return;
      }

      if (action === 'delete') {
        var confirmed = window.confirm('确认删除该班级？该班学生及关联记录也会被删除。');
        if (!confirmed) {
          return;
        }
        try {
          var resDel = await fetch(API_BASE + '/api/classes/' + classId, {
            method: 'DELETE',
            headers: getAuthHeader()
          });
          if (!resDel.ok) {
            window.alert('删除班级失败，请稍后重试。');
            return;
          }
          if (Number(classState.currentClassId) === classId) {
            classState.currentClassId = null;
          }
          await runClassPageOverride();
        } catch (_) {
          window.alert('删除班级失败，请检查网络后重试。');
        }
      }
    }, true);
  }

  async function loadStudentsByClass(cls) {
    if (!cls || !classState.tbody) {
      return;
    }

    classState.currentClassId = cls.id;
    classState.selectedStudentIds = {};
    var sRes = await fetch(API_BASE + '/api/classes/' + cls.id + '/students', { headers: getAuthHeader() });
    if (!sRes.ok) {
      return;
    }
    var students = await sRes.json();
    renderStudents(classState.tbody, students);
    updateStudentCount(Array.isArray(students) ? students.length : 0);
    classState.classCounts[cls.id] = Array.isArray(students) ? students.length : 0;

    var title = document.querySelector('h2.text-3xl');
    if (title && cls.name) {
      title.textContent = cls.name;
    }

    // Update top grade badge near class title (e.g. "一年级" -> "高一").
    var titlePanel = title ? title.parentElement : null;
    if (titlePanel) {
      var gradeBadge = titlePanel.querySelector('div.inline-flex.gap-1.items-center.rounded-full.border.px-2\\.5.py-0\\.5.text-xs.font-semibold');
      if (gradeBadge) {
        gradeBadge.textContent = cls.grade || '';
      }
    }

    renderClassCardsFromDb(classState.classes);
    markMasterCheckbox();
    ensureBatchDeleteButton();
    updateBatchDeleteButtonState();
  }

  function bindStudentDeleteHandler() {
    if (document.body.getAttribute('data-db-delete-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-delete-bound', '1');

    document.body.addEventListener('click', async function (event) {
      var btn = event.target.closest('.delete-student-btn');
      if (!btn || !classState.currentClassId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      var studentId = Number(btn.getAttribute('data-student-id'));
      if (!Number.isInteger(studentId) || studentId <= 0) {
        return;
      }

      var confirmed = window.confirm('确认删除该学生？此操作不可恢复。');
      if (!confirmed) {
        return;
      }

      try {
        var res = await fetch(API_BASE + '/api/students/' + studentId, {
          method: 'DELETE',
          headers: getAuthHeader()
        });
        // Treat 404 as already deleted to keep UX idempotent.
        if (!res.ok && res.status !== 404) {
          return;
        }

        var cls = null;
        for (var i = 0; i < classState.classes.length; i += 1) {
          if (Number(classState.classes[i].id) === Number(classState.currentClassId)) {
            cls = classState.classes[i];
            break;
          }
        }
        if (!cls && classState.classes.length) {
          cls = classState.classes[0];
        }
        if (cls) {
          await loadStudentsByClass(cls);
        }
      } catch (_) { }
    }, true);
  }

  function bindStudentAddHandler() {
    if (document.body.getAttribute('data-db-add-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-add-bound', '1');

    function findDialogRoot(fromEl) {
      var node = fromEl;
      while (node && node !== document.body) {
        if (
          node.getAttribute &&
          (node.getAttribute('role') === 'dialog' ||
            (node.className && String(node.className).indexOf('fixed') >= 0 && String(node.className).indexOf('inset') >= 0))
        ) {
          return node;
        }
        node = node.parentElement;
      }

      var overlays = Array.prototype.slice.call(document.querySelectorAll('div'));
      for (var i = 0; i < overlays.length; i += 1) {
        var txt = overlays[i].innerText || '';
        if (txt.indexOf('录入新学生') >= 0 && txt.indexOf('保存记录') >= 0) {
          return overlays[i];
        }
      }
      return document.body;
    }

    function readStudentFormValues(root) {
      var seatInput =
        root.querySelector('input[type="number"]') ||
        root.querySelector('input[placeholder*="座号"]') ||
        root.querySelector('input[inputmode="numeric"]');

      var textInputs = Array.prototype.slice.call(
        root.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[type="url"]')
      );

      var nameInput = null;
      for (var i = 0; i < textInputs.length; i += 1) {
        var ph = String(textInputs[i].getAttribute('placeholder') || '');
        if (ph.indexOf('姓名') >= 0 || ph.indexOf('张') >= 0 || ph.indexOf('例如') >= 0) {
          nameInput = textInputs[i];
          break;
        }
      }
      if (!nameInput && textInputs.length) {
        nameInput = textInputs[0];
      }

      return {
        studentNo: seatInput ? String(seatInput.value || '').trim() : '',
        name: nameInput ? String(nameInput.value || '').trim() : ''
      };
    }

    document.body.addEventListener('click', async function (event) {
      if (!classState.currentClassId) {
        return;
      }

      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var txt = (btn.innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('保存记录') < 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var root = findDialogRoot(btn);
      var form = readStudentFormValues(root);
      if (!form.name) {
        window.alert('请输入学生姓名');
        return;
      }

      try {
        var headers = { 'Content-Type': 'application/json' };
        var auth = getAuthHeader();
        Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

        var res = await fetch(API_BASE + '/api/students', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            classId: classState.currentClassId,
            name: form.name,
            studentNo: form.studentNo,
            status: 'active'
          })
        });

        if (res.status === 409) {
          window.alert('座号已存在，请更换后重试。');
          return;
        }
        if (!res.ok) {
          window.alert('添加学生失败，请稍后重试。');
          return;
        }

        var cls = null;
        for (var i = 0; i < classState.classes.length; i += 1) {
          if (Number(classState.classes[i].id) === Number(classState.currentClassId)) {
            cls = classState.classes[i];
            break;
          }
        }
        if (cls) {
          await loadStudentsByClass(cls);
        }

        // Try to close dialog via cancel/close button if present.
        var closeBtn = root.querySelector('button[aria-label*="关闭"], button[aria-label*="close"]');
        if (!closeBtn) {
          var buttons = Array.prototype.slice.call(root.querySelectorAll('button'));
          for (var j = 0; j < buttons.length; j += 1) {
            var btxt = (buttons[j].innerText || '').replace(/\s+/g, '');
            if (btxt.indexOf('取消') >= 0 || btxt === '×' || btxt === '✕') {
              closeBtn = buttons[j];
              break;
            }
          }
        }
        if (closeBtn) {
          closeBtn.click();
        }
      } catch (_) {
        window.alert('添加学生失败，请检查网络后重试。');
      }
    }, true);
  }

  function parseCsvLine(line) {
    var out = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i += 1) {
      var ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function decodeCsvBuffer(arrayBuffer) {
    var decoders = ['utf-8', 'gb18030', 'gbk'];
    var candidates = [];

    for (var i = 0; i < decoders.length; i += 1) {
      try {
        var text = new TextDecoder(decoders[i]).decode(arrayBuffer);
        candidates.push(text);
      } catch (_) { }
    }

    if (!candidates.length) {
      return '';
    }

    function score(text) {
      var s = 0;
      if (text.indexOf('学生姓名') >= 0) s += 5;
      if (text.indexOf('姓名') >= 0) s += 3;
      if (text.indexOf('座号') >= 0) s += 5;
      if (text.indexOf('年级') >= 0) s += 2;
      if (text.indexOf('班级') >= 0) s += 2;
      if (text.indexOf('\ufffd') >= 0) s -= 5;
      return s;
    }

    var best = candidates[0];
    var bestScore = score(best);
    for (var j = 1; j < candidates.length; j += 1) {
      var sc = score(candidates[j]);
      if (sc > bestScore) {
        best = candidates[j];
        bestScore = sc;
      }
    }
    return best;
  }

  function parseStudentsCsvText(text) {
    var normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var lines = normalized.split('\n').filter(function (line) {
      return String(line || '').trim() !== '';
    });
    if (!lines.length) {
      return [];
    }

    var headers = parseCsvLine(lines[0]).map(function (h) {
      return String(h || '').replace(/^\uFEFF/, '').trim();
    });
    var normalizedHeaders = headers.map(function (h) {
      return h.replace(/\s+/g, '');
    });

    function findIndex(names) {
      for (var i = 0; i < normalizedHeaders.length; i += 1) {
        for (var j = 0; j < names.length; j += 1) {
          if (normalizedHeaders[i] === names[j]) {
            return i;
          }
        }
      }
      return -1;
    }

    var seatIndex = findIndex(['座号', '学号', 'studentNo', 'studentno', 'seatNo', 'seatno']);
    var nameIndex = findIndex(['学生姓名', '姓名', 'name', 'studentName', 'studentname']);
    var gradeIndex = findIndex(['年级', 'grade']);
    var classNameIndex = findIndex(['班级名称', '班级', 'className', 'classname']);

    // Fallback: two-column CSV like "座号,学生姓名" or "学生姓名,座号".
    if (nameIndex < 0 && headers.length >= 2) {
      nameIndex = 1;
      if (normalizedHeaders[0] && normalizedHeaders[0].indexOf('姓名') >= 0) {
        nameIndex = 0;
      }
    }
    if (seatIndex < 0 && headers.length >= 2) {
      seatIndex = nameIndex === 0 ? 1 : 0;
    }

    var rows = [];
    for (var k = 1; k < lines.length; k += 1) {
      var cols = parseCsvLine(lines[k]);
      var name = nameIndex >= 0 ? String(cols[nameIndex] || '').trim() : '';
      var studentNo = seatIndex >= 0 ? String(cols[seatIndex] || '').trim() : '';
      var grade = gradeIndex >= 0 ? String(cols[gradeIndex] || '').trim() : '';
      var className = classNameIndex >= 0 ? String(cols[classNameIndex] || '').trim() : '';
      if (!name && !studentNo) {
        continue;
      }
      rows.push({
        name: name,
        studentNo: studentNo,
        grade: grade,
        className: className
      });
    }
    return rows;
  }

  function bindBatchImportHandler() {
    if (document.body.getAttribute('data-db-batch-import-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-batch-import-bound', '1');

    var fileInput = document.getElementById('db-batch-import-input');
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.id = 'db-batch-import-input';
      fileInput.type = 'file';
      fileInput.accept = '.csv,text/csv,application/vnd.ms-excel';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
    }

    document.body.addEventListener('click', function (event) {
      if (!detectClassManagementPage()) {
        return;
      }
      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var txt = (btn.innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('批量导入') < 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!classState.currentClassId) {
        window.alert('请先选择班级后再导入。');
        return;
      }

      fileInput.value = '';
      fileInput.click();
    }, true);

    fileInput.addEventListener('change', async function () {
      if (!classState.currentClassId || !fileInput.files || !fileInput.files[0]) {
        return;
      }

      var cls = null;
      for (var i = 0; i < classState.classes.length; i += 1) {
        if (Number(classState.classes[i].id) === Number(classState.currentClassId)) {
          cls = classState.classes[i];
          break;
        }
      }
      if (!cls) {
        window.alert('未找到当前班级，请刷新页面后重试。');
        return;
      }

      try {
        var file = fileInput.files[0];
        var arrayBuffer = await file.arrayBuffer();
        var text = decodeCsvBuffer(arrayBuffer);
        var rows = parseStudentsCsvText(text);
        if (!rows.length) {
          window.alert('CSV 解析失败或没有可导入的数据，请检查文件格式。');
          return;
        }

        var requested = 0;
        var inserted = 0;
        var duplicated = 0;
        var skipped = 0;
        var failed = 0;

        for (var r = 0; r < rows.length; r += 1) {
          var row = rows[r];
          if (!row.name) {
            skipped += 1;
            continue;
          }

          if (row.className && String(row.className).trim() !== String(cls.name || '').trim()) {
            skipped += 1;
            continue;
          }
          if (row.grade && String(row.grade).trim() !== String(cls.grade || '').trim()) {
            skipped += 1;
            continue;
          }

          requested += 1;
          try {
            var headers = { 'Content-Type': 'application/json' };
            var auth = getAuthHeader();
            Object.keys(auth).forEach(function (k) { headers[k] = auth[k]; });

            var res = await fetch(API_BASE + '/api/students', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({
                classId: classState.currentClassId,
                name: row.name,
                studentNo: row.studentNo || '',
                status: 'active'
              })
            });
            if (res.status === 409) {
              duplicated += 1;
            } else if (res.ok) {
              inserted += 1;
            } else {
              failed += 1;
            }
          } catch (_) {
            failed += 1;
          }
        }

        await loadStudentsByClass(cls);
        await refreshClassCounts();
        renderClassCardsFromDb(classState.classes);

        window.alert(
          '导入完成：成功 ' + inserted +
          '，重复座号 ' + duplicated +
          '，跳过 ' + skipped +
          '，失败 ' + failed +
          '。'
        );
      } catch (_) {
        window.alert('批量导入失败，请检查 CSV 编码和格式后重试。');
      }
    }, true);
  }

  async function runClassPageOverride() {
    if (!detectClassManagementPage() || !API_BASE) {
      return;
    }

    var tbody = getStudentTableBody() || classState.tbody;
    if (!tbody) {
      return;
    }

    try {
      var cRes = await fetch(API_BASE + '/api/classes', { headers: getAuthHeader() });
      if (!cRes.ok) {
        return;
      }
      var classes = await cRes.json();
      if (!Array.isArray(classes) || !classes.length) {
        renderStudents(tbody, []);
        updateStudentCount(0);
        classState.initialized = true;
        classState.classes = [];
        classState.tbody = tbody;
        bindClassSwitchHandler();
        bindClassCheckboxHandler();
        bindClassEditDeleteHandler();
        bindStudentDeleteHandler();
        bindStudentAddHandler();
        bindStudentCheckboxHandler();
        bindBatchDeleteHandler();
        bindBatchImportHandler();
        bindClassCreateHandler();
        ensureBatchDeleteButton();
        updateBatchDeleteButtonState();
        return;
      }

      if (!classState.currentClassId) {
        classState.currentClassId = classes[0].id;
      } else {
        var exists = false;
        for (var i = 0; i < classes.length; i += 1) {
          if (Number(classes[i].id) === Number(classState.currentClassId)) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          classState.currentClassId = classes[0].id;
        }
      }

      classState.classes = classes;
      classState.tbody = tbody;
      classState.initialized = true;
      await refreshClassCounts();
      renderClassCardsFromDb(classes);
      bindClassSwitchHandler();
      bindClassCheckboxHandler();
      bindClassEditDeleteHandler();
      bindClassCreateHandler();
      bindStudentDeleteHandler();
      bindStudentAddHandler();
      bindStudentCheckboxHandler();
      bindBatchDeleteHandler();
      bindBatchImportHandler();
      ensureBatchDeleteButton();
      ensureClassListObserver();
      var target = classes[0];
      for (var j = 0; j < classes.length; j += 1) {
        if (Number(classes[j].id) === Number(classState.currentClassId)) {
          target = classes[j];
          break;
        }
      }
      await loadStudentsByClass(target);
    } catch (_) { }
  }

  var rawSetItem = localStorage.setItem.bind(localStorage);
  var rawRemoveItem = localStorage.removeItem.bind(localStorage);
  var rawClear = localStorage.clear.bind(localStorage);

  localStorage.setItem = function (key, value) {
    rawSetItem(key, value);
    postJson('/api/kv/upsert', { namespace: NAMESPACE, key: String(key), value: String(value) });
  };

  localStorage.removeItem = function (key) {
    rawRemoveItem(key);
    postJson('/api/kv/delete', { namespace: NAMESPACE, key: String(key) });
  };

  localStorage.clear = function () {
    rawClear();
    postJson('/api/kv/clear', { namespace: NAMESPACE });
  };

  function bindLoginHandler() {
    if (document.body.getAttribute('data-db-login-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-login-bound', '1');

    document.body.addEventListener('click', async function (event) {
      if (!detectLoginPage()) {
        return;
      }
      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var txt = (btn.innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('开启智慧课堂') < 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var usernameInput = document.querySelector('input[placeholder="教职工账号"]');
      var passwordInput = document.querySelector('input[placeholder="登录密码"]');

      var username = usernameInput ? String(usernameInput.value || '').trim() : '';
      var password = passwordInput ? String(passwordInput.value || '').trim() : '';

      if (!username || !password) {
        window.alert('请输入账号和密码。');
        return;
      }

      try {
        var res = await fetch(API_BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password })
        });

        if (!res.ok) {
          window.alert('登录失败，请检查账号密码。');
          return;
        }

        var data = await res.json();
        localStorage.setItem('token', String(data.token));
        localStorage.setItem('user', JSON.stringify(data.user));

        // CRITICAL: Force sync to backend KV store before navigation to ensure persistence
        // regardless of browser localStorage behavior or race conditions.
        try {
          await postJson('/api/kv/upsert', { namespace: NAMESPACE, key: 'token', value: String(data.token) });
          await postJson('/api/kv/upsert', { namespace: NAMESPACE, key: 'user', value: JSON.stringify(data.user) });
        } catch (e) { }

        if (window.parent) {
          var targetId = data.user && data.user.role === 'admin' ? 'admin_dashboard' : 'teacher_classroom_main';
          window.parent.postMessage({
            type: 'iframeNavigation',
            targetPageId: targetId
          }, '*');
        } else {
          if (data.user && data.user.role === 'admin') {
            window.location.href = '管理后台仪表盘.html';
          } else {
            window.location.href = '课堂教学主界面.html';
          }
        }
      } catch (_) {
        window.alert('登录请求失败，请检查网络。');
      }
    }, true);
  }

  function runUserInfoOverride() {
    var userStr = localStorage.getItem('user');
    if (!userStr) {
      return;
    }
    try {
      var user = JSON.parse(userStr);
      if (!user || !user.name) {
        return;
      }

      var labels = Array.prototype.slice.call(document.querySelectorAll('span, div, p, h1, h2, h3'));
      for (var i = 0; i < labels.length; i += 1) {
        var node = labels[i];
        if (node.children.length === 0) {
          var t = (node.textContent || '').trim();
          if (t === '教师' || t === '徐汉初' || t === '未登录教师') {
            node.textContent = user.name;
          }
        }
      }
    } catch (_) { }
  }

  function bindLogoutHandler() {
    if (document.body.getAttribute('data-db-logout-bound') === '1') {
      return;
    }
    document.body.setAttribute('data-db-logout-bound', '1');

    document.body.addEventListener('click', function (event) {
      var btn = event.target.closest('button');
      if (!btn) {
        return;
      }
      var txt = (btn.innerText || '').replace(/\s+/g, '');
      if (txt.indexOf('退出') >= 0) {
        event.preventDefault();
        event.stopPropagation();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (window.parent) {
          window.parent.postMessage({
            type: 'iframeNavigation',
            targetPageId: 'login_page'
          }, '*');
        } else {
          window.location.href = '教师登录页.html';
        }
      }
    }, true);
  }

  function checkAuthSession() {
    if (detectLoginPage()) {
      return;
    }

    async function performCheck() {
      // 1. Local Check
      var token = localStorage.getItem('token');
      if (token) return;

      // 2. Parent Check
      if (window.parent && window.parent !== window) {
        try {
          token = window.parent.localStorage.getItem('token');
          if (token) {
            localStorage.setItem('token', token);
            var userStr = window.parent.localStorage.getItem('user');
            if (userStr) localStorage.setItem('user', userStr);
            return;
          }
        } catch (_) { }
      }

      // 3. Server Recovery (Last Resort)
      try {
        // Explicitly try to fetch the latest state from server
        var res = await fetch(API_BASE + '/api/kv/snapshot?namespace=' + encodeURIComponent(NAMESPACE));
        if (res.ok) {
          var body = await res.json();
          var items = body.items || {};
          if (items.token) {
            localStorage.setItem('token', items.token);
            if (items.user) {
              localStorage.setItem('user', items.user);
            }
            // Recovered successfully, no need to redirect
            return;
          }
        }
      } catch (_) { }

      // 4. Final Check & Redirect
      // Re-read token after attempts
      token = localStorage.getItem('token');

      var dashboardPage = detectAdminDashboardPage();
      var teacherPage = detectTeacherManagementPage();
      var classPage = detectClassManagementPage();

      if (!token && (dashboardPage || teacherPage || classPage)) {
        // Only allow the top-level window to perform authentication redirects.
        // Inner iframes (especially srcdoc) might have restricted access to storage
        // and shouldn't trigger a full page logout if the shell is already authenticated.
        if (window === window.top) {
          console.warn('Redirecting to login due to missing token in Top Window');
          window.location.href = '教师登录页.html';
        } else {
          console.warn('Authentication check failed in iframe, but suppressing redirect.');
        }
      }
    }

    // Increase delay to ensure server sync has settled if coming from a fast redirect
    setTimeout(performCheck, 600);
  }

  // 找到「班级出勤」显示元素，更新为 学生数 / 学生数 人
  function updateAttendanceDisplay(studentCount) {
    // 在所有可能的 document 里查找
    var docs = [document];
    try {
      var ifrEl = document.getElementById('dynamicIframe');
      if (ifrEl && ifrEl.contentDocument) docs.push(ifrEl.contentDocument);
    } catch (_) { }
    try {
      if (window.parent && window.parent !== window) {
        var pIfr = window.parent.document.getElementById('dynamicIframe');
        if (pIfr && pIfr.contentDocument) docs.push(pIfr.contentDocument);
        if (window.parent.document !== document) docs.push(window.parent.document);
      }
    } catch (_) { }

    for (var di = 0; di < docs.length; di++) {
      var d = docs[di];
      if (!d) continue;
      // 匹配包含「/ X 人」或「0 / 0」格式的 span
      var allSpans = d.querySelectorAll('span.font-bold, span[class*="font-bold"]');
      for (var si = 0; si < allSpans.length; si++) {
        var sp = allSpans[si];
        // 直接子节点中有 人 span 的元素才是目标
        var personSpan = sp.querySelector('span');
        if (!personSpan) continue;
        if ((personSpan.textContent || '').trim() !== '人') continue;
        // 并且外层文本包含 / 分隔符
        var rawTxt = sp.childNodes[0] ? (sp.childNodes[0].textContent || '') : '';
        if (rawTxt.indexOf('/') < 0 && (sp.textContent || '').indexOf('/') < 0) continue;

        // 找到了，更新文本节点
        // 保留内部 <span>人</span>，只更新前面的文本节点
        var textNode = null;
        for (var ni = 0; ni < sp.childNodes.length; ni++) {
          if (sp.childNodes[ni].nodeType === 3) { // Text node
            textNode = sp.childNodes[ni];
            break;
          }
        }
        var newText = studentCount + ' / ' + studentCount + ' ';
        if (textNode) {
          textNode.textContent = newText;
        } else {
          sp.insertBefore(document.createTextNode(newText), sp.firstChild);
        }
        console.log('[attendance] Updated attendance display to:', studentCount, '/', studentCount);
        return; // 找到了就退出
      }
    }
    console.warn('[attendance] Could not find attendance display element');
  }

  // 获取指定班级学生数并更新出勤显示
  async function fetchAndUpdateAttendance(cls) {
    if (!cls || !cls.id) return;
    try {
      var res = await fetch(API_BASE + '/api/classes/' + cls.id + '/students', {
        headers: getAuthHeader()
      });
      if (!res.ok) return;
      var students = await res.json();
      var activeCount = (students || []).length;
      updateAttendanceDisplay(activeCount);
    } catch (e) {
      console.warn('[attendance] Error fetching students:', e);
    }
  }

  async function loadTeacherClasses() {
    // Only run on teacher classroom page
    if ((document.title || '').indexOf('课堂教学主界面') < 0) {
      return;
    }

    try {
      // Get current user
      var userStr = localStorage.getItem('user');
      if (!userStr) {
        console.warn('[loadTeacherClasses] No user found in localStorage');
        return;
      }

      var user = JSON.parse(userStr);
      if (!user.id || user.role !== 'teacher') {
        console.warn('[loadTeacherClasses] User is not a teacher or has no ID');
        return;
      }

      console.log('[loadTeacherClasses] Loading classes for teacher:', user.username, 'ID:', user.id);

      // Fetch teacher's class permissions
      var res = await fetch(API_BASE + '/api/teachers/' + user.id + '/class-permissions', {
        headers: getAuthHeader()
      });

      if (!res.ok) {
        console.error('[loadTeacherClasses] Failed to fetch class permissions:', res.status);
        return;
      }

      var data = await res.json();
      var classIds = data.classIds || [];

      console.log('[loadTeacherClasses] Teacher has access to class IDs:', classIds);

      if (classIds.length === 0) {
        console.warn('[loadTeacherClasses] Teacher has no accessible classes');
        return;
      }

      // Fetch all classes to get their names
      var classesRes = await fetch(API_BASE + '/api/classes', {
        headers: getAuthHeader()
      });

      if (!classesRes.ok) {
        console.error('[loadTeacherClasses] Failed to fetch classes:', classesRes.status);
        return;
      }

      var allClasses = await classesRes.json();
      var accessibleClasses = allClasses.filter(function (cls) {
        return classIds.indexOf(cls.id) >= 0;
      });

      console.log('[loadTeacherClasses] Accessible classes:', accessibleClasses.map(function (c) { return c.name; }).join(', '));

      if (accessibleClasses.length === 0) {
        console.warn('[loadTeacherClasses] No matching classes found');
        return;
      }

      // Store the accessible classes in a global variable for later use
      window.__teacherAccessibleClasses__ = accessibleClasses;

      // Try multiple selectors to find the class dropdown
      var selectButton = document.querySelector('button[role="combobox"][data-placeholder]') ||
        document.querySelector('button[role="combobox"]') ||
        document.querySelector('button[data-state="closed"]');

      if (!selectButton) {
        console.warn('[loadTeacherClasses] Class selector button not found, trying iframe...');

        // Try to find it in the iframe
        var iframe = document.getElementById('dynamicIframe');
        if (iframe && iframe.contentDocument) {
          selectButton = iframe.contentDocument.querySelector('button[role="combobox"][data-placeholder]') ||
            iframe.contentDocument.querySelector('button[role="combobox"]') ||
            iframe.contentDocument.querySelector('button[data-state="closed"]');
        }
      }

      if (!selectButton) {
        console.error('[loadTeacherClasses] Could not find class selector button in main document or iframe');
        return;
      }

      console.log('[loadTeacherClasses] Found select button:', selectButton);

      // Remove disabled attribute
      selectButton.removeAttribute('disabled');
      selectButton.removeAttribute('data-disabled');
      selectButton.setAttribute('aria-disabled', 'false');

      // Update the placeholder text with the first class
      var firstClass = accessibleClasses[0];
      var valueSpan = selectButton.querySelector('span[data-placeholder]') ||
        selectButton.querySelector('span[style*="pointer-events"]');

      function updateStatusPanel(className) {
        var doc = selectButton.ownerDocument || document;
        var bookIcon = doc.querySelector('.lucide-book-open');
        if (bookIcon) {
          var panel = bookIcon.closest('div.rounded-xl');
          if (panel) {
            var span = panel.querySelector('span.font-bold');
            if (span) {
              span.textContent = className;
              panel.classList.remove('text-slate-500', 'bg-slate-50', 'border-dashed', 'border-slate-200');
              panel.classList.add('text-indigo-600', 'bg-indigo-50', 'border-indigo-100');
            }
          }
        }
      }

      if (valueSpan) {
        valueSpan.textContent = firstClass.name;
        valueSpan.removeAttribute('data-placeholder');
        updateStatusPanel(firstClass.name);
        console.log('[loadTeacherClasses] Updated dropdown text to:', firstClass.name);
      } else {
        console.warn('[loadTeacherClasses] Could not find value span to update');
      }

      // Create dropdown content if it doesn't exist
      var dropdownId = selectButton.getAttribute('aria-controls');
      var existingDropdown = (selectButton.ownerDocument || document).getElementById(dropdownId);

      if (!existingDropdown && dropdownId) {
        console.log('[loadTeacherClasses] Creating dropdown menu with ID:', dropdownId);

        // Create the dropdown container
        var dropdown = document.createElement('div');
        dropdown.id = dropdownId;
        dropdown.setAttribute('role', 'listbox');
        dropdown.setAttribute('data-state', 'closed');
        dropdown.style.cssText = 'position: absolute; z-index: 50; min-width: 160px; overflow: hidden; border-radius: 0.375rem; border: 1px solid #e2e8f0; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); display: none;';

        // Create options for each class
        accessibleClasses.forEach(function (cls, index) {
          var option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.setAttribute('data-value', cls.id);
          option.className = 'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-indigo-50 hover:text-indigo-600';
          option.textContent = cls.name;

          // Add click handler
          option.addEventListener('click', function () {
            if (valueSpan) {
              valueSpan.textContent = cls.name;
            }
            updateStatusPanel(cls.name);
            dropdown.style.display = 'none';
            selectButton.setAttribute('data-state', 'closed');
            selectButton.setAttribute('aria-expanded', 'false');

            // Store selected class on BOTH outer shell window and iframe window
            // so fetchStudentsForCurrentClass can find it regardless of context
            window.__selectedClass__ = cls;
            try {
              if (window.parent && window.parent !== window) {
                window.parent.__selectedClass__ = cls;
              }
            } catch (_) { }
            // Also push into iframe if we are in the shell
            try {
              var iframeWin = (document.getElementById('dynamicIframe') || {}).contentWindow;
              if (iframeWin && iframeWin !== window) {
                iframeWin.__selectedClass__ = cls;
              }
            } catch (_) { }
            console.log('[loadTeacherClasses] Selected class:', cls.name, '(synced to all windows)');
            // 切换班级时同步更新出勤人数
            fetchAndUpdateAttendance(cls);
          });

          dropdown.appendChild(option);
        });

        // Insert dropdown after the button
        selectButton.parentNode.insertBefore(dropdown, selectButton.nextSibling);

        // Add click handler to button to toggle dropdown
        selectButton.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();

          var isOpen = dropdown.style.display === 'block';
          if (isOpen) {
            dropdown.style.display = 'none';
            selectButton.setAttribute('data-state', 'closed');
            selectButton.setAttribute('aria-expanded', 'false');
          } else {
            // Position dropdown below button
            var rect = selectButton.getBoundingClientRect();
            dropdown.style.position = 'absolute';
            dropdown.style.top = (rect.bottom + 4) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = rect.width + 'px';
            dropdown.style.display = 'block';
            selectButton.setAttribute('data-state', 'open');
            selectButton.setAttribute('aria-expanded', 'true');
          }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', function (e) {
          if (!selectButton.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
            selectButton.setAttribute('data-state', 'closed');
            selectButton.setAttribute('aria-expanded', 'false');
          }
        });

        console.log('[loadTeacherClasses] Dropdown menu created with', accessibleClasses.length, 'options');
      }

      // 初始加载时更新默认班级（第一个班级）的出勤人数
      fetchAndUpdateAttendance(firstClass);
      console.log('[loadTeacherClasses] Successfully loaded ' + accessibleClasses.length + ' classes');
    } catch (error) {
      console.error('[loadTeacherClasses] Error:', error);
    }
  }

  // ─── 随机点名模块 ───────────────────────────────────────────────
  var randomCallState = {
    isRolling: false,
    rollTimer: null,
    students: [],
    usedInSession: [],
    sessionCount: 0
  };

  function detectTeacherClassroomPage() {
    return (document.title || '').indexOf('课堂教学主界面') >= 0;
  }

  // 获取课堂主界面的 document（可能在 iframe 内）
  function getClassroomDoc() {
    // bridge.js 注入在 iframe 内部时，document 就是课堂页面
    if (detectTeacherClassroomPage()) {
      return document;
    }
    // bridge.js 注入在外层 shell 时，尝试读取 iframe
    var iframe = document.getElementById('dynamicIframe');
    if (iframe && iframe.contentDocument &&
      (iframe.contentDocument.title || '').indexOf('课堂教学主界面') >= 0) {
      return iframe.contentDocument;
    }
    return null;
  }

  // 找到随机显示区域中的大文字元素（显示 ??? 或学生姓名）
  function findRandomDisplayEl(doc) {
    if (!doc) return null;
    // 特征：animate-float + text-[12rem] + 包含 ??? 或姓名
    var els = doc.querySelectorAll('div.animate-float');
    if (els.length) return els[0];
    // 备选：通过文字内容找
    var all = doc.querySelectorAll('div');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if ((el.className || '').indexOf('animate-float') >= 0) return el;
    }
    return null;
  }

  // 找到副标题元素（优先用 data-roll-subtitle 锚点，否则多重回退匹配）
  function findRandomSubtitleEl(doc) {
    if (!doc) return null;
    // 已被标记的元素（最可靠）
    var marked = doc.querySelector('[data-roll-subtitle]');
    if (marked) return marked;
    // 通过初始或已知文字精确匹配
    var all = doc.querySelectorAll('div');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var txt = (el.textContent || '').trim();
      if (el.children.length === 0 && (
        txt === '\u7b49\u5f85\u62bd\u53d6' || txt === '\u6b63\u5728\u62bd\u53d6...' ||
        txt === '\u70b9\u51fb\u4efb\u610f\u5904\u505c\u6b62' ||
        txt === '\u2728 \u88ab\u70b9\u5230\u4e86\uff01'
      )) {
        return el;
      }
    }
    // 宽松匹配：tracking + font-bold 无子元素
    for (var j = 0; j < all.length; j++) {
      var e2 = all[j];
      if ((e2.className || '').indexOf('tracking-') >= 0 &&
        (e2.className || '').indexOf('font-bold') >= 0 &&
        e2.children.length === 0) {
        return e2;
      }
    }
    return null;
  }

  // 找到顶部"当堂点名总计"统计卡片内的数字元素
  function findCallCountEl(doc) {
    if (!doc) return null;
    // 优先用锚点（已找到并标记过的）
    var cached = doc.querySelector('[data-call-count]');
    if (cached) return cached;

    // 方法1：通过卡片背景色 class 直接定位（最可靠）
    // "当堂点名总计"是第一张蓝色卡片，class 包含 bg-vibrant-blue
    var blueCard = doc.querySelector('.bg-vibrant-blue');
    if (blueCard) {
      var numEl = blueCard.querySelector('[class*="text-3xl"]');
      if (numEl) {
        numEl.setAttribute('data-call-count', '1');
        console.log('[randomCall] Found via bg-vibrant-blue:', numEl.textContent);
        return numEl;
      }
    }

    // 方法2：通过 data-source-file 属性找 StatsCard 内的 text-3xl（第一个）
    var allTextEl = doc.querySelectorAll('[class*="text-3xl"][class*="font-bold"][class*="tracking-tight"]');
    for (var j = 0; j < allTextEl.length; j++) {
      var el = allTextEl[j];
      // 找到其祖先 Card，检查 Card 内是否有"当堂点名总计"文字
      var parentCard = el.parentElement;
      for (var k = 0; k < 5 && parentCard; k++) {
        if ((parentCard.textContent || '').indexOf('\u5f53\u5821\u70b9\u540d\u603b\u8ba1') >= 0) {
          el.setAttribute('data-call-count', '1');
          console.log('[randomCall] Found via text-3xl scan:', el.textContent);
          return el;
        }
        parentCard = parentCard.parentElement;
      }
    }

    console.warn('[randomCall] Could not find call count element in:', doc.title);
    return null;
  }

  // 更新显示文字，并为副标题打上锚点标记（方便后续查找）
  function setRandomDisplay(doc, nameText, subtitleText) {
    var nameEl = findRandomDisplayEl(doc);
    if (nameEl) {
      nameEl.textContent = nameText;
    }
    var subEl = findRandomSubtitleEl(doc);
    if (subEl) {
      subEl.setAttribute('data-roll-subtitle', '1');
      subEl.textContent = subtitleText;
    }
  }

  // 更新顶部"当堂点名总计"统计卡片数字
  // 在所有可能的 document 中查找并更新，覆盖 shell/iframe 两种上下文
  function updateCallCountCard(doc) {
    var count = String(randomCallState.sessionCount);
    var updated = false;

    // 候选 document 列表：传入的 doc + 各种跨 window 查找
    var docs = [doc];
    try {
      if (document !== doc) docs.push(document);
    } catch (_) { }
    try {
      var iframeEl = document.getElementById('dynamicIframe');
      if (iframeEl && iframeEl.contentDocument) docs.push(iframeEl.contentDocument);
    } catch (_) { }
    try {
      if (window.parent && window.parent !== window) {
        var shellIframe = window.parent.document.getElementById('dynamicIframe');
        if (shellIframe && shellIframe.contentDocument) docs.push(shellIframe.contentDocument);
      }
    } catch (_) { }

    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d) continue;
      var numEl = findCallCountEl(d);
      if (numEl) {
        numEl.textContent = count;
        console.log('[randomCall] Updated call count to', count, 'in doc:', d.title);
        updated = true;
        break;
      }
    }

    if (!updated) {
      console.warn('[randomCall] updateCallCountCard: element not found in any document');
    }
  }

  // 为副标题打上锚点标记（保持显示"等待抽取"）
  function initSubtitleDisplay() {
    var doc = getClassroomDoc();
    if (!doc) return;
    var subEl = findRandomSubtitleEl(doc);
    if (subEl && !subEl.getAttribute('data-roll-subtitle')) {
      subEl.setAttribute('data-roll-subtitle', '1');
      // 副标题保持原有"等待抽取"文字不变
    }
  }

  // 获取当前班级的学生列表（通过 API）
  async function fetchStudentsForCurrentClass() {
    // 优先使用已选班级——跨 window 查找（bridge.js 同时运行在 shell 和 iframe 两个 window 中）
    var cls = window.__selectedClass__ ||
      (function () {
        // 当前是 iframe，尝试从 parent shell 读
        try {
          if (window.parent && window.parent !== window && window.parent.__selectedClass__) {
            return window.parent.__selectedClass__;
          }
        } catch (_) { }
        // 当前是 shell，尝试从 iframe 读
        try {
          var iw = (document.getElementById('dynamicIframe') || {}).contentWindow;
          if (iw && iw.__selectedClass__) return iw.__selectedClass__;
        } catch (_) { }
        return null;
      }()) ||
      (window.__teacherAccessibleClasses__ && window.__teacherAccessibleClasses__[0]) ||
      (function () {
        try {
          if (window.parent && window.parent !== window && window.parent.__teacherAccessibleClasses__) {
            return window.parent.__teacherAccessibleClasses__[0];
          }
        } catch (_) { }
        return null;
      }());

    // 终极 fallback：直接从 API 获取班级列表取第一个
    if (!cls) {
      try {
        console.warn('[randomCall] No class in window, fetching from API...');
        var clsRes = await fetch(API_BASE + '/api/classes', { headers: getAuthHeader() });
        if (clsRes.ok) {
          var allCls = await clsRes.json();
          if (Array.isArray(allCls) && allCls.length) {
            cls = allCls[0];
            console.log('[randomCall] Fallback class:', cls.name);
          }
        }
      } catch (_) { }
    }

    if (!cls) {
      console.warn('[randomCall] No class available at all');
      return [];
    }

    console.log('[randomCall] Fetching students for class:', cls.name, 'id:', cls.id);

    try {
      // 正确的 API 路径：/api/classes/:id/students
      var res = await fetch(API_BASE + '/api/classes/' + cls.id + '/students', {
        headers: getAuthHeader()
      });
      if (!res.ok) {
        console.error('[randomCall] API error:', res.status);
        return [];
      }
      var students = await res.json();
      console.log('[randomCall] Got', students.length, 'students from API');
      return Array.isArray(students) ? students.filter(function (s) {
        return s.status !== 'inactive' && s.name;
      }) : [];
    } catch (err) {
      console.error('[randomCall] fetch error:', err);
      return [];
    }
  }

  // 停止随机滚动，确定最终结果
  function stopRandomRoll(doc) {
    if (!randomCallState.isRolling) return;
    randomCallState.isRolling = false;

    if (randomCallState.rollTimer) {
      clearInterval(randomCallState.rollTimer);
      randomCallState.rollTimer = null;
    }

    var students = randomCallState.students;
    if (!students.length) {
      setRandomDisplay(doc, '???', '无学生数据');
      return;
    }

    // 从未用过的学生中随机选（不重复模式），全用完则重置
    var available = students.filter(function (s) {
      return randomCallState.usedInSession.indexOf(s.id) < 0;
    });
    if (!available.length) {
      randomCallState.usedInSession = [];
      available = students;
    }

    var picked = available[Math.floor(Math.random() * available.length)];
    randomCallState.usedInSession.push(picked.id);
    randomCallState.sessionCount += 1;

    setRandomDisplay(doc, picked.name, '\u2728 \u88ab\u70b9\u5230\u4e86\uff01');
    updateCallCountCard(doc);

    // 4秒后副标题恢复为"等待抽取"
    setTimeout(function () {
      var d = getClassroomDoc();
      if (!d) return;
      var subEl = findRandomSubtitleEl(d);
      if (subEl && subEl.textContent === '\u2728 \u88ab\u70b9\u5230\u4e86\uff01') {
        subEl.textContent = '\u7b49\u5f85\u62bd\u53d6';
      }
    }, 4000);

    console.log('[randomCall] Picked:', picked.name, '| Total today:', randomCallState.sessionCount);

    // 解绑 stopHandler（也推迟，避免影响本次事件传播）
    var _doc = doc;
    var _stopH = randomCallState._stopHandler;
    randomCallState._stopHandler = null;

    // ⚠️ 关键：将按钮恢复推迟到当前事件传播全部结束后
    // 这样本次点击事件链里，按钮文字仍是"停止 抽取"，
    // bindRandomCallHandler 不会误认为是"开始"而重新启动
    setTimeout(function () {
      if (_stopH) {
        var bd = getClassroomDoc() || document;
        bd.removeEventListener('click', _stopH, true);
      }
      setStartButtonRolling(_doc, false);
    }, 0);
  }

  // 切换"开始随机抽取"按钮的状态
  function setStartButtonRolling(doc, isRolling) {
    var docs = [doc, document];
    try {
      var ifrEl = document.getElementById('dynamicIframe');
      if (ifrEl && ifrEl.contentDocument) docs.push(ifrEl.contentDocument);
    } catch (_) { }
    try {
      if (window.parent && window.parent !== window) {
        var pIfr = window.parent.document.getElementById('dynamicIframe');
        if (pIfr && pIfr.contentDocument) docs.push(pIfr.contentDocument);
      }
    } catch (_) { }

    for (var di = 0; di < docs.length; di++) {
      var d = docs[di];
      if (!d) continue;
      var buttons = d.querySelectorAll('button');
      for (var bi = 0; bi < buttons.length; bi++) {
        var btn = buttons[bi];
        var txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
        var isStart = txt.indexOf('\u5f00\u59cb\u968f\u673a\u62bd\u53d6') >= 0 || txt.indexOf('\u5f00\u59cb\u968f\u673a') >= 0;
        var isStop = txt.indexOf('\u505c\u6b62\u62bd\u53d6') >= 0;
        if (!isStart && !isStop) continue;

        if (isRolling) {
          // 变为红色“停止 抽取”按钮
          btn.setAttribute('data-original-class', btn.className);
          btn.style.cssText = 'background: linear-gradient(135deg, #ef4444, #dc2626); color: white; ' +
            'border: none; box-shadow: 0 4px 15px rgba(239,68,68,0.4); transition: all 0.3s;';
          // 换图标和文字
          var svgEl = btn.querySelector('svg');
          if (svgEl) {
            svgEl.classList.remove('animate-bounce');
            // 替换为停止图标 (square stop)
            svgEl.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>';
          }
          // 更改文字节点
          var textNode = null;
          for (var ni = 0; ni < btn.childNodes.length; ni++) {
            if (btn.childNodes[ni].nodeType === 3 && (btn.childNodes[ni].textContent || '').trim()) {
              textNode = btn.childNodes[ni];
            }
          }
          if (textNode) {
            textNode.textContent = ' \u505c\u6b62 \u62bd\u53d6';
          }
          btn.setAttribute('data-rolling-state', '1');
        } else {
          // 恢复原始样式
          btn.style.cssText = '';
          var origClass = btn.getAttribute('data-original-class');
          if (origClass) btn.className = origClass;
          btn.removeAttribute('data-original-class');
          btn.removeAttribute('data-rolling-state');
          var svgEl2 = btn.querySelector('svg');
          if (svgEl2) {
            svgEl2.classList.add('animate-bounce');
            // 恢复 sparkle 图标
            svgEl2.innerHTML = '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>';
          }
          var textNode2 = null;
          for (var ni2 = 0; ni2 < btn.childNodes.length; ni2++) {
            if (btn.childNodes[ni2].nodeType === 3 && (btn.childNodes[ni2].textContent || '').trim()) {
              textNode2 = btn.childNodes[ni2];
            }
          }
          if (textNode2) {
            textNode2.textContent = ' \u5f00\u59cb \u968f\u673a\u62bd\u53d6';
          }
        }
        return; // 找到并处理了第一个，退出
      }
    }
  }

  // 开始随机滚动动画
  async function startRandomRoll(doc) {
    if (randomCallState.isRolling) {
      // 已在滚动中 -> 停止
      stopRandomRoll(doc);
      return;
    }

    var students = await fetchStudentsForCurrentClass();
    if (!students.length) {
      window.alert('当前班级暂无学生数据，请先在「班级学生管理」中录入学生。');
      return;
    }

    randomCallState.students = students;
    randomCallState.isRolling = true;
    setStartButtonRolling(doc, true); // 按钮变为停止状态

    setRandomDisplay(doc, students[0].name, '\u6b63\u5728\u62bd\u53d6...');

    var idx = 0;
    var speed = 80; // ms
    randomCallState.rollTimer = setInterval(function () {
      idx = (idx + 1) % students.length;
      var nameEl = findRandomDisplayEl(doc);
      if (nameEl) nameEl.textContent = students[idx].name;
    }, speed);

    // 绑定点击任意处停止（排除「开始随机抽取」按钮自身，防止竞争）
    var stopHandler = function (e) {
      var btn = e.target ? e.target.closest('button') : null;
      if (btn) {
        var btnTxt = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
        // 如果点的是“停止抽取”按钮，允许并主动调用停止
        if (btnTxt.indexOf('\u505c\u6b62\u62bd\u53d6') >= 0) {
          stopRandomRoll(doc);
          return;
        }
        // 如果点的是按钮且文字包含开始随机（已变成停止前的残留），跳过
        if (btnTxt.indexOf('\u5f00\u59cb\u968f\u673a\u62bd\u53d6') >= 0 || btnTxt.indexOf('\u5f00\u59cb\u968f\u673a') >= 0) {
          return;
        }
      }
      stopRandomRoll(doc);
    };
    randomCallState._stopHandler = stopHandler;
    doc.addEventListener('click', stopHandler, true);
  }

  function bindRandomCallHandler() {
    if (document.body.getAttribute('data-random-call-bound') === '1') return;
    document.body.setAttribute('data-random-call-bound', '1');

    document.body.addEventListener('click', function (event) {
      var doc = getClassroomDoc();
      if (!doc) return;

      var btn = event.target.closest('button');
      if (!btn) return;

      var txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
      if (txt.indexOf('\u5f00\u59cb\u968f\u673a\u62bd\u53d6') >= 0 || txt.indexOf('\u5f00\u59cb\u968f\u673a') >= 0) {
        if (randomCallState._stoppingNow) { event.preventDefault(); event.stopPropagation(); return; }
        event.preventDefault();
        event.stopPropagation();
        startRandomRoll(doc);
        return;
      }
      // \u201c\u505c\u6b62\u62bd\u53d6\u201d\u6309\u9215\u4e5f\u89e6\u53d1\u505c\u6b62
      if (txt.indexOf('\u505c\u6b62\u62bd\u53d6') >= 0) {
        event.preventDefault();
        event.stopPropagation();
        stopRandomRoll(doc);
        return;
      }
    }, true);

    // 同时监听 iframe 内部的点击（bridge 注入在 iframe 内时）
    // 通过在 iframe document 上也绑定按钮监听
    setTimeout(function () {
      var doc = getClassroomDoc();
      if (!doc || doc === document) return;
      if (doc.body.getAttribute('data-random-call-bound-inner') === '1') return;
      doc.body.setAttribute('data-random-call-bound-inner', '1');

      doc.body.addEventListener('click', function (event) {
        var btn = event.target.closest('button');
        if (!btn) return;
        var txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
        if (txt.indexOf('\u5f00\u59cb\u968f\u673a\u62bd\u53d6') >= 0 || txt.indexOf('\u5f00\u59cb\u968f\u673a') >= 0) {
          if (randomCallState._stoppingNow) { event.preventDefault(); event.stopPropagation(); return; }
          event.preventDefault();
          event.stopPropagation();
          startRandomRoll(doc);
          return;
        }
        if (txt.indexOf('\u505c\u6b62\u62bd\u53d6') >= 0) {
          event.preventDefault();
          event.stopPropagation();
          stopRandomRoll(doc);
        }
      }, true);

      // 页面已就绪，初始化副标题为"当堂点名总计 0 次"
      initSubtitleDisplay();
    }, 1200);
  }
  // ─── 随机点名模块 END ─────────────────────────────────────────────

  bootstrapFromServer();
  checkAuthSession();
  mirrorWholeStorage();
  bindTeacherCreateHandler();
  bindTeacherActionHandler();
  bindTeacherDeleteHandler();
  bindDashboardRefreshHandler();
  bindLoginHandler();
  bindLogoutHandler();
  bindRandomCallHandler();
  setTimeout(function () { runUserInfoOverride(); }, 500);
  setTimeout(function () { runUserInfoOverride(); }, 1500);
  setTimeout(function () { runUserInfoOverride(); }, 3000);
  setTimeout(function () { runTeacherPageOverride(); }, 700);
  setTimeout(function () { runTeacherPageOverride(); }, 1800);
  setTimeout(function () { runDashboardOverride(); }, 700);
  setTimeout(function () { runDashboardOverride(); }, 1800);
  setTimeout(function () { runClassPageOverride(); }, 900);
  setTimeout(function () { runClassPageOverride(); }, 2200);
  setTimeout(function () { runClassPageOverride(); }, 3800);
  setTimeout(function () { loadTeacherClasses(); }, 1000);
  setTimeout(function () { loadTeacherClasses(); }, 2000);
  setTimeout(function () { loadTeacherClasses(); }, 3500);
  setTimeout(function () { bindRandomCallHandler(); }, 1500);
  setTimeout(function () { bindRandomCallHandler(); }, 3000);
  setTimeout(function () { initSubtitleDisplay(); }, 1500);
  setTimeout(function () { initSubtitleDisplay(); }, 2500);
  setTimeout(function () { initSubtitleDisplay(); }, 4000);

  window.sqliteBridge = {
    namespace: NAMESPACE,
    apiBase: API_BASE,
    sync: mirrorWholeStorage,
    overrideClassPage: runClassPageOverride,
    overrideDashboardPage: runDashboardOverride,
    overrideTeacherPage: runTeacherPageOverride
  };
})();
