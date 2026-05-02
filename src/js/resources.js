/**
 * FitFarm - ResourceManager v2.0
 * 资源（金币/种子/木材）的计算与兑换逻辑
 * 支持多运动模式，统一以 EP（能量点）为计量单位
 */

const ResourceManager = {
  // 金币换算
  COINS_PER_EP: 0.5,       // 每 1 EP = 0.5 金币

  // 种子类型配置
  SEED_TYPES: {
    tomato: {
      id: 'tomato',
      name: '番茄',
      emoji: '🍅',
      growTime: 60,         // 生长时间（秒）
      rewards: { coins: 8, wood: 0 },
    },
    carrot: {
      id: 'carrot',
      name: '胡萝卜',
      emoji: '🥕',
      growTime: 120,        // 2分钟
      rewards: { coins: 12, wood: 0 },
    },
    corn: {
      id: 'corn',
      name: '玉米',
      emoji: '🌽',
      growTime: 180,        // 3分钟
      rewards: { coins: 15, wood: 1 },
    },
    pumpkin: {
      id: 'pumpkin',
      name: '南瓜',
      emoji: '🎃',
      growTime: 300,        // 5分钟
      rewards: { coins: 25, wood: 2 },
    },
  },

  // 每日任务配置（基于每日总EP）
  DAILY_TASKS: [
    { id: 'ep10',   targetEp: 10,  reward: { seeds: 1 },            label: '消耗10EP',   desc: '奖励：1颗种子 🌱' },
    { id: 'ep50',   targetEp: 50,  reward: { seeds: 3 },            label: '消耗50EP',   desc: '奖励：3颗种子 🌱🌱🌱' },
    { id: 'ep100',  targetEp: 100, reward: { coins: 10, wood: 2 },  label: '消耗100EP',  desc: '奖励：10金币🪙 + 2木材🪵' },
  ],

    // 里程碑（累计EP → 木材奖励）
  MILESTONES: [
    { ep: 50,    wood: 1,  label: '初学者',   emoji: '🌱' },
    { ep: 200,   wood: 3,  label: '健身达人',  emoji: '💪' },
    { ep: 500,   wood: 10, label: '运动狂人',  emoji: '🏃' },
    { ep: 2000,  wood: 30, label: '铁人三项',  emoji: '🏅' },
  ],

  /**
   * 获取玩家当前运动模式的计数
   * @param {Object} state - 游戏状态
   * @param {string} modeId - 运动模式ID
   */
  getModeCount(state, modeId) {
    if (!state.player.modeCounts) state.player.modeCounts = {};
    return state.player.modeCounts[modeId] || 0;
  },

  /**
   * 添加运动计数，统一转换为EP后进行资源结算
   * 同时按运动模式分别计数
   * @param {Object} state  - 游戏状态
   * @param {number} count  - 本次计数（步/下/个）
   * @param {Object} sportDef - SPORT_MODES[mode] 对象，含 epPerCount
   */
  addActivity(state, count, sportDef) {
    const result = { coinsGained: 0, epGained: 0, milestonesTriggered: [], taskCompleted: null };

    const epGained = count * (sportDef?.epPerCount ?? 0.1);
    result.epGained = epGained;

    const prevEp = state.player.totalEp;
    state.player.totalEp      += epGained;
    state.player.todayEp      += epGained;
    state.player.totalCount   += count;
    state.player.todayCount   += count;
    state.player.lastSport     = sportDef?.id || 'walk';

    // 按运动模式分别计数
    if (!state.player.modeCounts) state.player.modeCounts = {};
    const modeId = sportDef?.id || 'walk';
    state.player.modeCounts[modeId] = (state.player.modeCounts[modeId] || 0) + count;

    // EP → 金币（累计整数部分）
    const newCoins = Math.floor(state.player.totalEp * this.COINS_PER_EP)
                   - Math.floor(prevEp * this.COINS_PER_EP);
    if (newCoins > 0) {
      state.resources.coins += newCoins;
      result.coinsGained = newCoins;
    }

    // 每日任务进度
    state.dailyTasks.tasks.forEach(task => {
      if (!task.completed) {
        task.progress = Math.min(state.player.todayEp, task.targetEp);
        if (task.progress >= task.targetEp) {
          task.completed = true;
          result.taskCompleted = task.id;
        }
      }
    });

    // 里程碑
    this.MILESTONES.forEach(m => {
      const alreadyTriggered = state.achievements.milestones.includes(m.ep);
      if (!alreadyTriggered && state.player.totalEp >= m.ep && prevEp < m.ep) {
        state.resources.wood += m.wood;
        state.achievements.milestones.push(m.ep);
        result.milestonesTriggered.push(m);
      }
    });

    return result;
  },

  /**
   * 领取每日任务奖励
   */
  claimTaskReward(state, taskId) {
    const taskDef = this.DAILY_TASKS.find(t => t.id === taskId);
    const task = state.dailyTasks.tasks.find(t => t.id === taskId);
    if (!task || !task.completed || task.claimed) {
      return { success: false, reason: task?.claimed ? 'already_claimed' : 'not_completed' };
    }

    const reward = taskDef?.reward || {};
    if (reward.coins) state.resources.coins += reward.coins;
    if (reward.seeds) state.resources.seeds += reward.seeds;
    if (reward.wood)  state.resources.wood  += reward.wood;
    task.claimed = true;

    return { success: true, reward };
  },

  /**
   * 检查并扣除资源
   */
  spend(state, cost) {
    const keys = Object.keys(cost);
    for (const k of keys) {
      if ((state.resources[k] || 0) < cost[k]) {
        return { success: false, lacking: k };
      }
    }
    keys.forEach(k => { state.resources[k] -= cost[k]; });
    return { success: true };
  },

  /**
   * 在地块上种植种子
   * @param {Object} state - 游戏状态
   * @param {number} plotId - 地块ID
   * @param {string} seedId - 种子ID
   */
  plantSeed(state, plotId, seedId) {
    const plot = state.farm.plots.find(p => p.id === plotId);
    if (!plot || !plot.unlocked) return { success: false, reason: 'not_unlocked' };
    if (plot.type !== 'field') return { success: false, reason: 'not_field' };
    if (plot.planting) return { success: false, reason: 'already_planted' };
    if (plot.level > 0) return { success: false, reason: 'not_wasteland' };

    const seedDef = this.SEED_TYPES[seedId];
    if (!seedDef) return { success: false, reason: 'invalid_seed' };

    if ((state.resources.seeds || 0) < 1) return { success: false, reason: 'no_seeds' };

    // 扣除种子
    state.resources.seeds -= 1;

    // 设置种植状态
    plot.planting = {
      seedId: seedId,
      plantedAt: Date.now(),  // 毫秒时间戳
      growTime: seedDef.growTime * 1000,  // 转换为毫秒
    };

    return { success: true, seedDef };
  },

  /**
   * 检查并收获成熟作物
   * @param {Object} state - 游戏状态
   * @param {number} plotId - 地块ID
   */
  harvest(state, plotId) {
    const plot = state.farm.plots.find(p => p.id === plotId);
    if (!plot || !plot.unlocked) return { success: false, reason: 'not_unlocked' };
    if (!plot.planting) return { success: false, reason: 'not_planted' };

    const seedDef = this.SEED_TYPES[plot.planting.seedId];
    if (!seedDef) return { success: false, reason: 'invalid_seed' };

    // 检查是否成熟
    const elapsed = Date.now() - plot.planting.plantedAt;
    if (elapsed < plot.planting.growTime) {
      const remaining = Math.ceil((plot.planting.growTime - elapsed) / 1000);
      return { success: false, reason: 'not_ready', remaining };
    }

    // 发放奖励
    const rewards = { ...seedDef.rewards };
    state.resources.coins += rewards.coins || 0;
    state.resources.wood += rewards.wood || 0;

    // 清除种植状态
    plot.planting = null;

    return { success: true, seedDef, rewards };
  },

  /**
   * 获取地块种植状态
   * @param {Object} state - 游戏状态
   * @param {number} plotId - 地块ID
   */
  getPlantingStatus(state, plotId) {
    const plot = state.farm.plots.find(p => p.id === plotId);
    if (!plot || !plot.planting) return null;

    const seedDef = this.SEED_TYPES[plot.planting.seedId];
    const elapsed = Date.now() - plot.planting.plantedAt;
    const progress = Math.min(100, (elapsed / plot.planting.growTime) * 100);
    const remaining = Math.max(0, plot.planting.growTime - elapsed);
    const isReady = remaining <= 0;

    return {
      seedId: plot.planting.seedId,
      seedDef,
      progress,
      remaining,
      remainingSeconds: Math.ceil(remaining / 1000),
      isReady,
    };
  },
};
