// 分组管理功能模块
(function() {
  'use strict';

  // 打开分组管理页面
  window.openGroupManagement = function() {
    const width = 1600;
    const height = 900;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    window.open(
      '课堂互动分组管理.html',
      'groupManagement',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  // 从localStorage加载分组数据
  window.loadGroupData = function() {
    const data = localStorage.getItem('classroomGroups');
    return data ? JSON.parse(data) : null;
  };

  // 监听分组数据更新
  window.addEventListener('storage', function(e) {
    if (e.key === 'classroomGroups') {
      console.log('分组数据已更新:', e.newValue);
      // 可以在这里触发UI更新
      if (window.onGroupDataUpdated) {
        window.onGroupDataUpdated(JSON.parse(e.newValue));
      }
    }
  });
})();
