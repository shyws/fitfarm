/**
 * FitFarm - BuildingManager
 * 建筑/花园/农田的升级逻辑与配置
 */

const BuildingManager = {
  // ─── 建筑配置 ──────────────────────────────
  BUILDINGS: {
    house: {
      name: '房屋',
      levels: [
        null, // level 0 不存在
        { label: '小木屋', emoji: '🏠', upgradeCost: null },
        { label: '木屋',   emoji: '🏡', upgradeCost: { coins: 20 } },
        { label: '石屋',   emoji: '🏘️', upgradeCost: { coins: 50, wood: 5 } },
        { label: '城堡',   emoji: '🏰', upgradeCost: { coins: 150, wood: 20 } },
      ],
      maxLevel: 4,
    },
    garden: {
      name: '花园',
      levels: [
        { label: '空地',   emoji: '🟫', upgradeCost: { coins: 5 } },
        { label: '花盆',   emoji: '🪴', upgradeCost: { coins: 15 } },
        { label: '小花园', emoji: '🌷', upgradeCost: { coins: 40 } },
        { label: '大花园', emoji: '🌸', upgradeCost: null },
      ],
      maxLevel: 3,
    },
    field: {
      name: '农田',
      levels: [
        { label: '荒地',   emoji: '🌿', upgradeCost: { coins: 8 } },
        { label: '种植槽', emoji: '🌱', upgradeCost: { coins: 20, seeds: 1 } },
        { label: '小农田', emoji: '🌾', upgradeCost: { coins: 50 } },
        { label: '大农田', emoji: '🌻', upgradeCost: null },
      ],
      maxLevel: 3,
    },
    empty: {
      name: '空地',
      levels: [
        { label: '空地', emoji: '⬜', upgradeCost: null },
      ],
      maxLevel: 0,
    },
  },

  // 解锁新地块费用
  UNLOCK_COST: { wood: 10 },

  /**
   * 获取地块当前配置
   */
  getPlotInfo(plot) {
    const building = this.BUILDINGS[plot.type];
    if (!building) return null;
    const levelData = building.levels[plot.level];
    return {
      ...levelData,
      type: plot.type,
      level: plot.level,
      maxLevel: building.maxLevel,
      name: building.name,
      canUpgrade: plot.level < building.maxLevel && levelData?.upgradeCost !== null,
      nextCost: plot.level < building.maxLevel ? building.levels[plot.level + 1]?.upgradeCost : null,
    };
  },

  /**
   * 升级地块
   * 返回 { success, newPlot } 或 { success: false, reason }
   */
  upgradePlot(state, plotId) {
    const plot = state.farm.plots.find(p => p.id === plotId);
    if (!plot || !plot.unlocked) return { success: false, reason: 'not_unlocked' };

    const building = this.BUILDINGS[plot.type];
    if (!building || plot.level >= building.maxLevel) {
      return { success: false, reason: 'max_level' };
    }

    const nextLevel = building.levels[plot.level + 1];
    if (!nextLevel || !nextLevel.upgradeCost) {
      return { success: false, reason: 'no_upgrade' };
    }

    const spendResult = ResourceManager.spend(state, nextLevel.upgradeCost);
    if (!spendResult.success) {
      return { success: false, reason: 'insufficient_resources', lacking: spendResult.lacking };
    }

    plot.level += 1;
    return { success: true, newPlot: { ...plot } };
  },

  /**
   * 解锁新地块
   */
  unlockPlot(state, plotId) {
    const plot = state.farm.plots.find(p => p.id === plotId);
    if (!plot || plot.unlocked) return { success: false, reason: plot?.unlocked ? 'already_unlocked' : 'not_found' };

    const spendResult = ResourceManager.spend(state, this.UNLOCK_COST);
    if (!spendResult.success) {
      return { success: false, reason: 'insufficient_resources', lacking: spendResult.lacking };
    }

    plot.unlocked = true;
    plot.type = 'garden'; // 默认解锁为花园
    plot.level = 0;
    return { success: true };
  },

  /**
   * 更换地块类型（未来功能，MVP暂不用）
   */
  changePlotType(state, plotId, newType) {
    const plot = state.farm.plots.find(p => p.id === plotId);
    if (!plot || !plot.unlocked) return { success: false };
    if (!this.BUILDINGS[newType]) return { success: false, reason: 'unknown_type' };
    plot.type = newType;
    plot.level = 0;
    return { success: true };
  },
};
