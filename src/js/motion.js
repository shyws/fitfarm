/**
 * FitFarm - MotionEngine v2.0
 * 多运动模式识别引擎
 *
 * 支持的运动模式：
 *   walk    - 步行    (加速度计 + 峰值检测)
 *   run     - 跑步    (加速度计 + 高频高幅峰值)
 *   jump    - 跳绳    (加速度计 + 极高频竖直冲击)
 *   jumping_jack - 开合跳 (加速度计 + 双峰间隔检测)
 *   clap_jump    - 胯下击掌 (加速度计 + 冲击+陀螺仪前倾)
 *   cycling - 骑行    (加速度计 + 低幅高频规律震动)
 *   swim    - 游泳    (加速度计+陀螺仪 + 周期性旋转划水)
 *
 * EP换算权重（每次计数的EP值）定义在 SPORT_MODES[mode].epPerCount
 *
 * 传感器数据流：
 *   DeviceMotionEvent  → accelerationIncludingGravity (x,y,z) m/s²
 *   DeviceOrientationEvent → gamma/beta (用于游泳/胯下击掌)
 *
 * 兼容策略：
 *   Android Chrome - DeviceMotion 无需授权
 *   iOS Safari     - DeviceMotion 需要 requestPermission()
 *   PC/桌面        - 降级为模拟模式
 */

const MotionEngine = (() => {

  // ─── 运动模式定义 ──────────────────────────────
  const SPORT_MODES = {
    walk: {
      id: 'walk',
      label: '步行',
      emoji: '🚶',
      unit: '步',
      epPerCount: 0.1,           // 每步 0.1 EP
      // 检测参数
      threshold: 12,             // 峰值 m/s²
      minInterval: 300,          // 步伐最短间隔 ms
      maxInterval: 1200,         // 步伐最长间隔（超过则不算步）
      algorithm: 'peak',
    },
    run: {
      id: 'run',
      label: '跑步',
      emoji: '🏃',
      unit: '步',
      epPerCount: 0.2,           // 跑步强度高，每步 0.2 EP
      threshold: 18,             // 跑步振幅更大
      minInterval: 200,
      maxInterval: 600,
      algorithm: 'peak',
    },
    jump_rope: {
      id: 'jump_rope',
      label: '跳绳',
      emoji: '🪢',
      unit: '下',
      epPerCount: 0.5,           // 跳绳强度高，每下 0.5 EP
      threshold: 22,             // 跳绳冲击更强
      minInterval: 150,          // 最快跳绳 ~400次/分钟
      maxInterval: 1000,
      algorithm: 'peak',
    },
    jumping_jack: {
      id: 'jumping_jack',
      label: '开合跳',
      emoji: '⭐',
      unit: '个',
      epPerCount: 0.4,
      // 开合跳：两次峰值（起跳+落地）= 1个，两次峰值间隔200-700ms
      threshold: 16,
      minInterval: 400,          // 完整开合跳最短周期
      maxInterval: 2000,
      peakGap: { min: 200, max: 700 },  // 起跳和落地之间的间隔
      algorithm: 'double_peak',
    },
    clap_jump: {
      id: 'clap_jump',
      label: '胯下击掌',
      emoji: '👏',
      unit: '个',
      epPerCount: 0.6,
      threshold: 20,
      minInterval: 500,
      maxInterval: 3000,
      algorithm: 'peak',         // 简化：以跳起冲击为一次计数
    },
    cycling: {
      id: 'cycling',
      label: '骑行',
      emoji: '🚴',
      unit: '次踏',
      epPerCount: 0.3,
      // 骑行特征：低幅（5-10 m/s²）但规律的周期性震动
      threshold: 6,
      minInterval: 400,          // 踏频最快150rpm → ~400ms
      maxInterval: 2000,
      algorithm: 'cycling',
    },
    swim: {
      id: 'swim',
      label: '游泳',
      emoji: '🏊',
      unit: '划',
      epPerCount: 0.8,           // 游泳强度最高
      threshold: 8,
      minInterval: 500,          // 划水周期
      maxInterval: 3000,
      algorithm: 'swim',
    },
  };

  // ─── 全局状态 ──────────────────────────────────
  let _mode = 'walk';           // 当前运动模式
  let _isRunning = false;
  let _isPc = false;
  let _onCount = null;          // 回调: (count, mode) => void

  // 传感器数据缓冲
  let _accBuffer = [];          // 加速度历史 [{mag, x, y, z, t}]
  const BUFFER_SIZE = 20;       // 保留最近20帧 (~1秒@20Hz)

  // 峰值检测状态
  let _lastPeakTime = 0;
  let _firstPeakTime = 0;       // 用于 double_peak
  let _waitingSecondPeak = false;

  // 骑行/游泳的特殊状态
  let _cyclingAccum = 0;        // 骑行累计能量
  let _swimPhase = 0;           // 游泳相位追踪

  // 陀螺仪数据（用于游泳/胯下击掌辅助）
  let _gyroBuffer = [];
  const GYRO_BUFFER = 10;

  // ─── 公共 API ──────────────────────────────────

  /**
   * 启动运动检测
   * @param {string} mode - SPORT_MODES 的 key
   * @param {Function} onCountCallback - (count, modeDef) => void
   */
  async function start(mode, onCountCallback) {
    if (_isRunning) stop();

    _mode = mode || 'walk';
    _onCount = onCountCallback;
    _isPc = !isMobile();
    _resetState();

    if (_isPc) {
      _isRunning = true;
      return { mode: 'pc', sport: _mode };
    }

    // iOS 权限请求
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm !== 'granted') return { mode: 'denied' };
      } catch (e) {
        return { mode: 'denied', error: e };
      }
    }

    window.addEventListener('devicemotion', _handleMotion, { passive: true });

    // 游泳/胯下击掌需要陀螺仪辅助
    if (_mode === 'swim' || _mode === 'clap_jump') {
      window.addEventListener('deviceorientation', _handleOrientation, { passive: true });
    }

    _isRunning = true;
    return { mode: 'motion', sport: _mode };
  }

  function stop() {
    window.removeEventListener('devicemotion', _handleMotion);
    window.removeEventListener('deviceorientation', _handleOrientation);
    _isRunning = false;
  }

  function setMode(mode) {
    if (SPORT_MODES[mode]) {
      const wasRunning = _isRunning;
      if (wasRunning) stop();
      _mode = mode;
      _resetState();
      if (wasRunning) start(mode, _onCount);
    }
  }

  function getCurrentMode() {
    return SPORT_MODES[_mode];
  }

  function getSportModes() {
    return SPORT_MODES;
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  /** PC/模拟模式：触发一次计数 */
  function simulateCount(count) {
    if (!_onCount) return;
    const def = SPORT_MODES[_mode];
    _onCount(count || 1, def);
  }

  // ─── 传感器数据处理 ────────────────────────────

  function _handleMotion(event) {
    if (!_isRunning) return;
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
    const mag = Math.sqrt(x * x + y * y + z * z);
    const t = Date.now();

    _accBuffer.push({ mag, x, y, z, t });
    if (_accBuffer.length > BUFFER_SIZE) _accBuffer.shift();

    const def = SPORT_MODES[_mode];
    switch (def.algorithm) {
      case 'peak':        _detectPeak(def); break;
      case 'double_peak': _detectDoublePeak(def); break;
      case 'cycling':     _detectCycling(def); break;
      case 'swim':        _detectSwim(def); break;
    }
  }

  function _handleOrientation(event) {
    // gamma: 左右倾斜 ([-90,90])，beta: 前后倾斜 ([-180,180])
    _gyroBuffer.push({ gamma: event.gamma || 0, beta: event.beta || 0, t: Date.now() });
    if (_gyroBuffer.length > GYRO_BUFFER) _gyroBuffer.shift();
  }

  // ─── 算法实现 ──────────────────────────────────

  /**
   * 通用峰值检测
   * 适用于：步行、跑步、跳绳、胯下击掌
   */
  function _detectPeak(def) {
    const smoothed = _getSmoothedMag(5);
    const now = Date.now();

    if (smoothed > def.threshold && now - _lastPeakTime > def.minInterval) {
      // 跑步额外排除：如果振幅不够大（排除慢步混入）
      if (def.id === 'run' && smoothed < def.threshold) return;

      _lastPeakTime = now;
      _onCount?.(1, def);
    }
  }

  /**
   * 双峰检测：开合跳
   * 起跳冲击 → 等待第二次落地冲击 → 确认为1个开合跳
   */
  function _detectDoublePeak(def) {
    const smoothed = _getSmoothedMag(4);
    const now = Date.now();

    if (smoothed > def.threshold) {
      if (!_waitingSecondPeak) {
        // 第一个峰值：确保距上一次完整计数超过最短间隔
        if (now - _lastPeakTime > def.minInterval) {
          _firstPeakTime = now;
          _waitingSecondPeak = true;
        }
      } else {
        // 第二个峰值
        const gap = now - _firstPeakTime;
        if (gap >= def.peakGap.min && gap <= def.peakGap.max) {
          _lastPeakTime = now;
          _waitingSecondPeak = false;
          _onCount?.(1, def);
        } else if (gap > def.peakGap.max) {
          // 超时，重置等待（可能是第二个峰值变成新的第一个峰值）
          _firstPeakTime = now;
        }
      }
    } else if (_waitingSecondPeak && now - _firstPeakTime > def.peakGap.max + 200) {
      // 超时未检测到第二峰，重置
      _waitingSecondPeak = false;
    }
  }

  /**
   * 骑行检测
   * 骑行特征：手机放车把上，低幅高频（路面颠簸）+ 规律节律
   * 算法：累计超阈值事件，每N次等于1次踏频
   */
  function _detectCycling(def) {
    const smoothed = _getSmoothedMag(3);
    const now = Date.now();

    if (smoothed > def.threshold && now - _lastPeakTime > def.minInterval) {
      _lastPeakTime = now;
      _cyclingAccum++;
      // 每3次颠簸计为1次踏频（可调）
      if (_cyclingAccum >= 3) {
        _cyclingAccum = 0;
        _onCount?.(1, def);
      }
    }
  }

  /**
   * 游泳检测
   * 游泳特征：手机放手臂（防水袋），周期性旋转+前推动作
   * 算法：检测加速度峰值 + 陀螺仪方向变化周期
   */
  function _detectSwim(def) {
    const smoothed = _getSmoothedMag(4);
    const now = Date.now();

    // 基础：加速度峰值（每次入水推进）
    if (smoothed > def.threshold && now - _lastPeakTime > def.minInterval) {
      // 辅助：检查陀螺仪是否有旋转特征（gamma变化）
      let gammaVariance = 0;
      if (_gyroBuffer.length >= 3) {
        const gammas = _gyroBuffer.slice(-5).map(g => g.gamma);
        const mean = gammas.reduce((a, b) => a + b, 0) / gammas.length;
        gammaVariance = gammas.reduce((a, b) => a + Math.abs(b - mean), 0) / gammas.length;
      }

      // 游泳时手臂旋转，gamma方差应 > 5°，否则可能只是走路
      const isSwimLike = gammaVariance > 5 || _gyroBuffer.length < 3; // 没有陀螺仪时宽松判断
      if (isSwimLike) {
        _lastPeakTime = now;
        _onCount?.(1, def);
      }
    }
  }

  // ─── 工具函数 ──────────────────────────────────

  /** 对最近N帧取均值（滑动均值滤波） */
  function _getSmoothedMag(n) {
    const frames = _accBuffer.slice(-n);
    if (!frames.length) return 0;
    return frames.reduce((s, f) => s + f.mag, 0) / frames.length;
  }

  function _resetState() {
    _accBuffer = [];
    _gyroBuffer = [];
    _lastPeakTime = 0;
    _firstPeakTime = 0;
    _waitingSecondPeak = false;
    _cyclingAccum = 0;
    _swimPhase = 0;
  }

  // ─── 公开 ──────────────────────────────────────
  return {
    start,
    stop,
    setMode,
    getCurrentMode,
    getSportModes,
    isMobile,
    simulateCount,
    SPORT_MODES,
  };
})();
