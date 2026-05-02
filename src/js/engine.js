/**
 * FitFarm - GameEngine v2.0
 * 游戏主引擎：协调各模块，驱动UI更新
 * 支持多运动模式（步行/跑步/跳绳/开合跳/胯下击掌/骑行/游泳）
 */

const GameEngine = (() => {
  let state = null;
  let _uiCallbacks = {};
  let _saveTimer = null;
  const AUTO_SAVE_INTERVAL = 5000;

  // ─── 初始化 ──────────────────────────────────

  function init(uiCallbacks) {
    _uiCallbacks = uiCallbacks || {};
    state = SaveManager.load();
    _scheduleAutoSave();
    return state;
  }

  function _scheduleAutoSave() {
    if (_saveTimer) clearInterval(_saveTimer);
    _saveTimer = setInterval(() => SaveManager.save(state), AUTO_SAVE_INTERVAL);
  }

  // ─── 运动相关 ────────────────────────────────

  /**
   * 切换运动模式（不影响是否正在检测）
   */
  function setSportMode(modeId) {
    MotionEngine.setMode(modeId);
    state.player.lastSport = modeId;
    _uiCallbacks.onSportModeChanged?.(MotionEngine.getCurrentMode());
  }

  /**
   * 启动运动检测
   */
  async function startMotion() {
    const modeId = state.player.lastSport || 'walk';
    const result = await MotionEngine.start(modeId, _onActivity);
    if (result.mode === 'pc') {
      _uiCallbacks.onPcMode?.();
    } else if (result.mode === 'denied') {
      _uiCallbacks.onMotionDenied?.();
    } else {
      _uiCallbacks.onMotionStarted?.();
    }
    return result;
  }

  function stopMotion() {
    MotionEngine.stop();
  }

  /**
   * 运动计数回调（由 MotionEngine 调用）
   * @param {number} count    本次计数
   * @param {Object} sportDef 运动模式定义
   */
  function _onActivity(count, sportDef) {
    const result = ResourceManager.addActivity(state, count, sportDef);

    _uiCallbacks.onActivityUpdate?.(state.player, state.resources, sportDef, count);

    if (result.coinsGained > 0) {
      _uiCallbacks.onCoinsGained?.(result.coinsGained);
    }
    if (result.taskCompleted) {
      _uiCallbacks.onTaskCompleted?.(result.taskCompleted);
    }
    if (result.milestonesTriggered?.length > 0) {
      result.milestonesTriggered.forEach(m => _uiCallbacks.onMilestone?.(m));
    }
  }

  /** PC/模拟：触发一次计数 */
  function simulateActivity(count) {
    MotionEngine.simulateCount(count || 5);
  }

  // ─── 建造相关 ────────────────────────────────

  function upgradePlot(plotId) {
    const result = BuildingManager.upgradePlot(state, plotId);
    if (result.success) {
      _uiCallbacks.onPlotUpgraded?.(result.newPlot, state.resources);
      SaveManager.save(state);
    }
    return result;
  }

  function unlockPlot(plotId) {
    const result = BuildingManager.unlockPlot(state, plotId);
    if (result.success) {
      _uiCallbacks.onPlotUnlocked?.(plotId, state.resources);
      SaveManager.save(state);
    }
    return result;
  }

  // ─── 任务相关 ────────────────────────────────

  function claimTaskReward(taskId) {
    const result = ResourceManager.claimTaskReward(state, taskId);
    if (result.success) {
      _uiCallbacks.onRewardClaimed?.(taskId, result.reward, state.resources);
      SaveManager.save(state);
    }
    return result;
  }

  // ─── 存档相关 ────────────────────────────────

  function resetGame() {
    state = SaveManager.reset();
    _uiCallbacks.onReset?.();
    return state;
  }

  function getState() { return state; }

  return {
    init,
    setSportMode,
    startMotion,
    stopMotion,
    simulateActivity,
    upgradePlot,
    unlockPlot,
    claimTaskReward,
    resetGame,
    getState,
  };
})();

