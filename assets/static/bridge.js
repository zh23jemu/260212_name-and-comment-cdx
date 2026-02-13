(function () {
  'use strict';

  var BRIDGE_FLAG = '__sqliteBridgeInstalled__';
  if (window[BRIDGE_FLAG]) {
    return;
  }
  window[BRIDGE_FLAG] = true;

  function getNamespace() {
    var base = location.pathname || '/';
    if (base === '/blank' || base === 'blank' || base === '/' || base === '') {
      try {
        if (document.referrer) {
          base = new URL(document.referrer).pathname || base;
        }
      } catch (_) {}
    }
    return base.replace(/[^a-zA-Z0-9_-]/g, '_') || 'global';
  }

  function getApiBase() {
    if (location.origin && location.origin !== 'null') {
      return location.origin;
    }

    try {
      if (window.parent && window.parent.location && window.parent.location.origin && window.parent.location.origin !== 'null') {
        return window.parent.location.origin;
      }
    } catch (_) {}

    try {
      if (document.referrer) {
        var ref = new URL(document.referrer);
        if (ref.origin && ref.origin !== 'null') {
          return ref.origin;
        }
      }
    } catch (_) {}

    return '';
  }

  var NAMESPACE = getNamespace();
  var API_BASE = getApiBase();

  function postJson(path, payload) {
    if (!API_BASE) {
      return Promise.resolve(null);
    }
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
          localStorage.setItem(key, value);
        }
      });
    } catch (_) {}
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
    } catch (_) {}
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
    try {
      var cRes = await fetch(API_BASE + '/api/classes');
      if (cRes.ok) {
        classes = await cRes.json();
      }
    } catch (_) {}

    if (!Array.isArray(classes)) {
      classes = [];
    }

    var students = 0;
    for (var i = 0; i < classes.length; i += 1) {
      var cid = classes[i] && classes[i].id;
      if (!cid) {
        continue;
      }
      try {
        var sRes = await fetch(API_BASE + '/api/classes/' + cid + '/students');
        if (!sRes.ok) {
          continue;
        }
        var arr = await sRes.json();
        if (Array.isArray(arr)) {
          students += arr.length;
        }
      } catch (_) {}
    }

    return {
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
      var studentEl = findCardValueByTitle('学生总数');
      if (studentEl) {
        studentEl.textContent = String(stats.students);
      }
    } catch (_) {}
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
    setNumberAfterLabel(stats.assigned, Array.isArray(teachers) ? teachers.length : 0);
  }

  async function updateTeacherClassStats() {
    var classesCount = 0;
    try {
      var cRes = await fetch(API_BASE + '/api/classes');
      if (cRes.ok) {
        var cls = await cRes.json();
        classesCount = Array.isArray(cls) ? cls.length : 0;
      }
    } catch (_) {}

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
      tr.className = 'transition-colors border-b border-indigo-50 hover:bg-indigo-50/20';
      tr.innerHTML =
        '<td class="p-4 align-middle font-semibold text-indigo-700">' + (t.username || '-') + '</td>' +
        '<td class="p-4 align-middle font-semibold text-slate-900">' + (t.name || '-') + '</td>' +
        '<td class="p-4 align-middle">' + roleBadge + '</td>' +
        '<td class="p-4 align-middle text-slate-400 font-medium">尚未分配</td>' +
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
      var res = await fetch(API_BASE + '/api/teachers');
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
    } catch (_) {}
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
        var res = await fetch(API_BASE + '/api/teachers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        var res = await fetch(API_BASE + '/api/teachers/' + teacherId, { method: 'DELETE' });
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
        var nextRole = teacher.role === 'admin' ? 'teacher' : 'admin';
        var roleText = nextRole === 'admin' ? '管理员' : '教师';
        var ok = window.confirm('将账号 [' + (teacher.username || '') + '] 权限改为“' + roleText + '”？');
        if (!ok) {
          return;
        }
        try {
          var resPerm = await fetch(API_BASE + '/api/teachers/' + teacherId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: nextRole })
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
          var resEdit = await fetch(API_BASE + '/api/teachers/' + teacherId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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
        var res = await fetch(API_BASE + '/api/students/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        var res = await fetch(API_BASE + '/api/classes/' + cls.id + '/students');
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
        var res = await fetch(API_BASE + '/api/classes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
          var resEdit = await fetch(API_BASE + '/api/classes/' + classId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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
          var resDel = await fetch(API_BASE + '/api/classes/' + classId, { method: 'DELETE' });
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
    var sRes = await fetch(API_BASE + '/api/classes/' + cls.id + '/students');
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
        var res = await fetch(API_BASE + '/api/students/' + studentId, { method: 'DELETE' });
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
      } catch (_) {}
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
        var res = await fetch(API_BASE + '/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      } catch (_) {}
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
            var res = await fetch(API_BASE + '/api/students', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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
      var cRes = await fetch(API_BASE + '/api/classes');
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
    } catch (_) {}
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

  bootstrapFromServer();
  mirrorWholeStorage();
  bindTeacherCreateHandler();
  bindTeacherActionHandler();
  bindTeacherDeleteHandler();
  bindDashboardRefreshHandler();
  setTimeout(function () { runTeacherPageOverride(); }, 700);
  setTimeout(function () { runTeacherPageOverride(); }, 1800);
  setTimeout(function () { runDashboardOverride(); }, 700);
  setTimeout(function () { runDashboardOverride(); }, 1800);
  setTimeout(function () { runClassPageOverride(); }, 900);
  setTimeout(function () { runClassPageOverride(); }, 2200);
  setTimeout(function () { runClassPageOverride(); }, 3800);

  window.sqliteBridge = {
    namespace: NAMESPACE,
    apiBase: API_BASE,
    sync: mirrorWholeStorage,
    overrideClassPage: runClassPageOverride,
    overrideDashboardPage: runDashboardOverride,
    overrideTeacherPage: runTeacherPageOverride
  };
})();
