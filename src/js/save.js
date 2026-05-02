/**
 * FitFarm - SaveManager
 * 负责 localStorage 存档的读写与初始化
 */

const SAVE_KEY = 'fitfarm_save';
const SAVE_VERSION = '2.0.0';

const DEFAULT_SAVE = {
  version: SAVE_VERSION,
  lastSaved: null,
  player: {
    // v2: 改用 EP 为通用单位，兼容所有运动
    totalEp: 0,          // 累计能量点（所有运动折算）
    todayEp: 0,          // 今日能量点
    totalCount: 0,       // 累计计数（步/下/个，仅展示用）
    todayCount: 0,       // 今日计数
    lastSport: 'walk',   // 最后选择的运动类型
    lastActivityDate: getTodayStr(),
  },
  resources: {
    coins: 10,
    seeds: 3,
    wood: 0,
  },
  farm: {
    plots: [
      { id: 0, type: 'house',  level: 1, unlocked: true },
      { id: 1, type: 'garden', level: 0, unlocked: true },
      { id: 2, type: 'field',  level: 0, unlocked: true },
      { id: 3, type: 'empty',  level: 0, unlocked: false },
      { id: 4, type: 'empty',  level: 0, unlocked: false },
      { id: 5, type: 'empty',  level: 0, unlocked: false },
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
    milestones: [],   // 存储已触发的 ep 里程碑值
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
      // 每日重置检查
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
    // v1 → v2 迁移：步数转EP
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
      };
      // 任务也迁移为EP任务
      data.dailyTasks = this._deepClone(DEFAULT_SAVE.dailyTasks);
      data.version = SAVE_VERSION;
    }
    // 补全缺失字段（防止新增字段导致undefined）
    if (data.player.lastSport === undefined) data.player.lastSport = 'walk';
    if (data.player.totalCount === undefined) data.player.totalCount = 0;
    if (data.player.todayCount === undefined) data.player.todayCount = 0;
    return data;
  },

  _checkDailyReset(save) {
    const today = getTodayStr();
    if (save.dailyTasks.date !== today) {
      save.dailyTasks.date = today;
      // 重置任务进度
      save.dailyTasks.tasks = this._deepClone(DEFAULT_SAVE.dailyTasks.tasks);
      save.player.todayEp = 0;
      save.player.todayCount = 0;
      save.player.lastActivityDate = today;
    }
  },

  _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },
};
