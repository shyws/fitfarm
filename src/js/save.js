/**
 * FitFarm - SaveManager
 * 负责 localStorage 存档的读写与初始化
 */

const SAVE_KEY = 'fitfarm_save';
const SAVE_VERSION = '2.1.0';

const DEFAULT_SAVE = {
  version: SAVE_VERSION,
  lastSaved: null,
  player: {
    totalEp: 0,
    todayEp: 0,
    totalCount: 0,
    todayCount: 0,
    lastSport: 'walk',
    lastActivityDate: getTodayStr(),
    modeCounts: {},
  },
  resources: {
    coins: 10,
    seeds: 3,
    wood: 0,
  },
  farm: {
    plots: [
      // 花园地块（默认可用，可升级建筑、合成种子）
      { id: 0, type: 'garden', subtype: 'garden',  level: 1, unlocked: true },
      { id: 1, type: 'garden', subtype: 'cottage', level: 1, unlocked: true },

      // 荒地地块（用木材解锁，用于种植）
      { id: 2, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 3 }, planting: null },
      { id: 3, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 3 }, planting: null },
      { id: 4, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 5 }, planting: null },
      { id: 5, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 5 }, planting: null },
      { id: 6, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 8 }, planting: null },
      { id: 7, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 8 }, planting: null },
      { id: 8, type: 'wasteland', level: 0, unlocked: false, unlockCost: { wood: 10 }, planting: null },
    ],
  },
  dailyTasks: {
    date: getTodayStr(),
    tasks: [
      { id: 'ep10',  targetEp: 10,  progress: 0, completed: false, claimed: false },
      { id: 'ep50',  targetEp: 50,  progress: 0, completed: false, claimed: false },
      { id: 'ep100', targetEp: 100, progress: 0, completed: false, claimed: false },
    ],
  },
  achievements: {
    milestones: [],
  },
};

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

const SaveManager = {
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this._deepClone(DEFAULT_SAVE);
      const data = JSON.parse(raw);
      const save = this._migrate(data);
      this._checkDailyReset(save);
      return save;
    } catch (e) {
      console.warn('[SaveManager] Load failed, using default.', e);
      return this._deepClone(DEFAULT_SAVE);
    }
  },

  save(state) {
    try {
      state.lastSaved = new Date().toISOString();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('[SaveManager] Save failed.', e);
    }
  },

  reset() {
    localStorage.removeItem(SAVE_KEY);
    return this._deepClone(DEFAULT_SAVE);
  },

  _migrate(data) {
    if (!data.version || data.version === '1.0.0') {
      const steps = data.player?.totalSteps || 0;
      const ep = data.player?.energyPoints || steps * 0.1;
      data.player = {
        totalEp: ep,
        todayEp: (data.player?.todaySteps || 0) * 0.1,
        totalCount: steps,
        todayCount: data.player?.todaySteps || 0,
        lastSport: 'walk',
        lastActivityDate: data.player?.lastStepDate || getTodayStr(),
        modeCounts: {},
      };
      data.dailyTasks = this._deepClone(DEFAULT_SAVE.dailyTasks);
      data.version = SAVE_VERSION;
    }
    if (data.player.lastSport === undefined) data.player.lastSport = 'walk';
    if (data.player.totalCount === undefined) data.player.totalCount = 0;
    if (data.player.todayCount === undefined) data.player.todayCount = 0;
    if (!data.player.modeCounts) data.player.modeCounts = {};

    // 为旧存档补充 farm.plots 的 unlockCost 和 subtype
    if (data.farm && Array.isArray(data.farm.plots)) {
      const defaultPlots = DEFAULT_SAVE.farm.plots;
      data.farm.plots.forEach((plot, idx) => {
        // 补充 unlockCost
        if (plot.unlockCost === undefined && defaultPlots[idx]) {
          plot.unlockCost = defaultPlots[idx].unlockCost;
        }
        // 确保 wasteland 类型有正确的结构
        if (plot.type === 'wasteland') {
          if (!plot.unlockCost) plot.unlockCost = { wood: 5 };
          if (plot.planting === undefined) plot.planting = null;
        }
        // 确保 garden 类型有 subtype
        if (plot.type === 'garden' && !plot.subtype) {
          plot.subtype = idx === 0 ? 'garden' : (idx === 1 ? 'cottage' : 'garden');
        }
      });
    }

    return data;
  },

  _checkDailyReset(save) {
    const today = getTodayStr();
    if (save.dailyTasks.date !== today) {
      save.dailyTasks.date = today;
      save.dailyTasks.tasks = this._deepClone(DEFAULT_SAVE.dailyTasks.tasks);
      save.player.todayEp = 0;
      save.player.todayCount = 0;
      save.player.lastActivityDate = today;
      save.player.modeCounts = {};
    }
  },

  _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },
};
