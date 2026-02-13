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
      var tr = document.createElement('tr');
      tr.className = i % 2 === 0 ? 'bg-white group transition-all duration-200' : 'bg-slate-50/30 group transition-all duration-200';
      tr.innerHTML =
        '<td class="px-6 py-4"><input type="checkbox" class="w-5 h-5 rounded border-slate-300 cursor-pointer accent-indigo-600"></td>' +
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
  }

  var classState = {
    initialized: false,
    classes: [],
    tbody: null,
    currentClassId: null
  };

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
      var card = event.target.closest('div.p-4.rounded-xl.border-2.cursor-pointer');
      if (!card) {
        return;
      }

      var cards = Array.prototype.slice.call(document.querySelectorAll('div.p-4.rounded-xl.border-2.cursor-pointer'));
      var idx = cards.indexOf(card);
      var cls = resolveClassFromCard(card, idx >= 0 ? idx : 0);
      if (!cls) {
        return;
      }
      loadStudentsByClass(cls);
    }, true);
  }

  function updateClassCardsMetadata(classes) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('div.p-4.rounded-xl.border-2.cursor-pointer'));
    if (!cards.length || !classes.length) {
      return;
    }

    for (var i = 0; i < cards.length; i += 1) {
      var cls = classes[i];
      if (!cls) {
        continue;
      }

      var titleNode = cards[i].querySelector('p.font-extrabold');
      if (titleNode && cls.name) {
        titleNode.textContent = cls.name;
      }

      var gradeNode = cards[i].querySelector('p.text-\\[10px\\]');
      if (gradeNode) {
        gradeNode.textContent = cls.grade || '';
      }
    }
  }

  async function loadStudentsByClass(cls) {
    if (!cls || !classState.tbody) {
      return;
    }

    classState.currentClassId = cls.id;
    var sRes = await fetch(API_BASE + '/api/classes/' + cls.id + '/students');
    if (!sRes.ok) {
      return;
    }
    var students = await sRes.json();
    renderStudents(classState.tbody, students);
    updateStudentCount(Array.isArray(students) ? students.length : 0);

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
        if (!res.ok) {
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
        bindStudentDeleteHandler();
        return;
      }

      classState.classes = classes;
      classState.tbody = tbody;
      classState.initialized = true;
      updateClassCardsMetadata(classes);
      bindClassSwitchHandler();
      bindStudentDeleteHandler();
      await loadStudentsByClass(classes[0]);
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
  setTimeout(function () { runClassPageOverride(); }, 900);
  setTimeout(function () { runClassPageOverride(); }, 2200);
  setTimeout(function () { runClassPageOverride(); }, 3800);

  window.sqliteBridge = {
    namespace: NAMESPACE,
    apiBase: API_BASE,
    sync: mirrorWholeStorage,
    overrideClassPage: runClassPageOverride
  };
})();
