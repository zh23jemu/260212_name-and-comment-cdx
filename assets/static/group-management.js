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

  // 从数据库加载分组数据
  window.loadGroupData = async function() {
    try {
      const currentClassId = localStorage.getItem('currentClassId');
      if (!currentClassId) {
        console.warn('未选择班级，无法加载分组数据');
        return null;
      }

      // 从数据库获取分组数据
      const namespace = `class_${currentClassId}_groups`;
      const response = await fetch(`/api/kv/snapshot?namespace=${encodeURIComponent(namespace)}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        console.warn('获取分组数据失败:', response.status);
        return null;
      }

      const result = await response.json();
      const saved = result.items?.groupData;
      
      if (saved) {
        return JSON.parse(saved);
      }
      
      return null;
    } catch (error) {
      console.error('加载分组数据失败:', error);
      return null;
    }
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
