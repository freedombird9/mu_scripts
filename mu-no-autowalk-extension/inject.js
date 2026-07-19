// MU Manual Attack No Autowalk — Chrome MV3 content script (MAIN world, document_start)
// Adapted from manual-attack-no-autowalk.js userscript.
// Injected by the browser BEFORE the page's own index-*.js runs, so the
// appendChild interceptor is guaranteed to be installed before the game
// bundle <script> is appended. This wins the load race that Tampermonkey
// was losing in the cross-origin game iframe.

(function () {
  'use strict';

  // In a MAIN-world content script, `window` IS the page's real window.
  // No unsafeWindow needed.
  const page = window;

  if (!isGameFrame(page.location)) {
    return;
  }

  const PATCH_MARKER = '__MU_MANUAL_NO_AUTOWALK__';
  const STORAGE_KEY = 'mu_manual_no_autowalk_enabled';
  const DEBUG_KEY = 'mu_manual_no_autowalk_debug';
  const BUNDLE_RE = /\/js\/bundle-[\w-]+\.js(?:$|\?)/;

  const TARGET_BRANCH = `else{_0x26afb8[_0x569830(0x6390)](_0x1c7cbb['IsNearTarget'],_0x2c3851['FAILED']);let _0x5254f7=_0x3ca950[_0x569830(0x2bd3)];if(_0x5254f7&&_0x5254f7[_0x569830(0x74f0)](_0x16461a)){let _0x181bf9=_0x5254f7[_0x569830(0x1a82)](_0x16461a)[_0x569830(0x218c)],_0x9c7460=Laya['Point'][_0x569830(0x34a8)];(_0x9c7460['x']=Math[_0x569830(0x174a)](-_0x181bf9['x']),_0x9c7460['y']=Math[_0x569830(0x174a)](_0x181bf9['z']),_0x5254f7)&&(_0x3ca950[_0x569830(0x5ce8)]=_0x9c7460['x'],_0x3ca950['lastMoveY']=_0x9c7460['y'],_0x5bb43c[_0x569830(0x12e4)](_0x599def,_0x9c7460,_0x3ca950['range'])||_0x599def[_0x569830(0x1a82)](_0x2006c8)['setTarget'](null));}_0x188fb2['setStatus'](_0x2c3851[_0x569830(0x4497)]);}`;

  const PATCHED_BRANCH = `else{_0x26afb8[_0x569830(0x6390)](_0x1c7cbb['IsNearTarget'],_0x2c3851['FAILED']);if(window.${PATCH_MARKER}&&window.${PATCH_MARKER}.shouldBlockMove&&window.${PATCH_MARKER}.shouldBlockMove()){window.${PATCH_MARKER}.blockMove&&window.${PATCH_MARKER}.blockMove();_0x188fb2['setStatus'](_0x2c3851['FAILED']);return;}let _0x5254f7=_0x3ca950[_0x569830(0x2bd3)];if(_0x5254f7&&_0x5254f7[_0x569830(0x74f0)](_0x16461a)){let _0x181bf9=_0x5254f7[_0x569830(0x1a82)](_0x16461a)[_0x569830(0x218c)],_0x9c7460=Laya['Point'][_0x569830(0x34a8)];(_0x9c7460['x']=Math[_0x569830(0x174a)](-_0x181bf9['x']),_0x9c7460['y']=Math[_0x569830(0x174a)](_0x181bf9['z']),_0x5254f7)&&(_0x3ca950[_0x569830(0x5ce8)]=_0x9c7460['x'],_0x3ca950['lastMoveY']=_0x9c7460['y'],_0x5bb43c[_0x569830(0x12e4)](_0x599def,_0x9c7460,_0x3ca950['range'])||_0x599def[_0x569830(0x1a82)](_0x2006c8)['setTarget'](null));}_0x188fb2['setStatus'](_0x2c3851[_0x569830(0x4497)]);}`;

  const SPACE_KEYDOWN_TARGET = `case Laya[_0x37fbd1(0x4f2e)][_0x37fbd1(0x6125)]:_0x39616f['vm'](_0x3f63d8)[_0x37fbd1(0x5491)][_0x37fbd1(0x3007)]();break;`;

  const SPACE_KEYDOWN_PATCHED = `case Laya[_0x37fbd1(0x4f2e)][_0x37fbd1(0x6125)]:if(window.${PATCH_MARKER}&&window.${PATCH_MARKER}.handleSpaceKeyDown&&window.${PATCH_MARKER}.handleSpaceKeyDown(!!(typeof _0x342def!='undefined'&&_0x39616f[_0x37fbd1(0x4502)](_0x342def)&&_0x39616f[_0x37fbd1(0x4502)](_0x342def)['isAutoFight']),()=>_0x39616f['vm'](_0x3f63d8)[_0x37fbd1(0x5491)][_0x37fbd1(0x3007)](),()=>_0x5bb43c['setCommonAutoFight'](!0x1))){}else _0x39616f['vm'](_0x3f63d8)[_0x37fbd1(0x5491)][_0x37fbd1(0x3007)]();break;`;

  const SPACE_KEYUP_TARGET = `case Laya[_0x4cf0d6(0x4f2e)]['D']:case Laya[_0x4cf0d6(0x4f2e)][_0x4cf0d6(0x5fdf)]:this[_0x4cf0d6(0x463e)]['D']=!0x1,this[_0x4cf0d6(0x463e)][_0x4cf0d6(0x583a)]=!0x0;}`;

  const SPACE_KEYUP_PATCHED = `case Laya[_0x4cf0d6(0x4f2e)]['D']:case Laya[_0x4cf0d6(0x4f2e)][_0x4cf0d6(0x5fdf)]:this[_0x4cf0d6(0x463e)]['D']=!0x1,this[_0x4cf0d6(0x463e)][_0x4cf0d6(0x583a)]=!0x0;break;case Laya[_0x4cf0d6(0x4f2e)][_0x4cf0d6(0x6125)]:window.${PATCH_MARKER}&&window.${PATCH_MARKER}.handleSpaceKeyUp&&window.${PATCH_MARKER}.handleSpaceKeyUp(()=>_0x5bb43c['setCommonAutoFight'](!0x1));}`;

  const state = {
    enabled: readBool(STORAGE_KEY, true),
    debug: readBool(DEBUG_KEY, false),
    manualBlockActive: false,
    spaceManualActive: false,
    spacePausedByDirection: false,
    spaceStartAttack: null,
    spaceStopAttack: null,
    pressedDirections: new Set(),
    lastHintAt: 0,
    beepedForCurrentManualAttack: false,
    audioContext: null,
    status: {
      version: '0.5.0',
      pageInjectedAt: new Date().toISOString(),
      injectionMode: 'chrome-extension-main-world',
      interceptorInstalled: false,
      manualKeyCaptureInstalled: false,
      interceptedBundle: false,
      patchedBundle: false,
      patchedSpaceKeyDown: false,
      patchedSpaceKeyUp: false,
      fallbackLoaded: false,
      lastReason: '',
      lastBundleUrl: '',
      manualKeyCount: 0,
      manualBlockActive: false,
      manualBlockStartedAt: 0,
      manualAttackUntil: 0,
      blockCount: 0,
      beepCount: 0,
      spaceKeyDownCount: 0,
      spaceStartCount: 0,
      spaceStopCount: 0,
      spaceDirectionPauseCount: 0,
      spaceDirectionResumeCount: 0,
      spaceManualActive: false,
      spacePausedByDirection: false,
    },
  };

  installHelper();
  captureManualAttackKey();
  installBundleInterceptor();

  function isGameFrame(locationLike) {
    return locationLike.hostname === 'cdn.qj2h5.jiuxiaokj.cn'
      && locationLike.pathname.includes('/mu2h5/h5-data/mu-release/');
  }

  function installHelper() {
    page[PATCH_MARKER] = {
      version: state.status.version,
      status: state.status,
      get enabled() {
        return state.enabled;
      },
      setEnabled(value) {
        state.enabled = Boolean(value);
        writeBool(STORAGE_KEY, state.enabled);
        showHint(state.enabled ? '手动攻击防自动移动：开启' : '手动攻击防自动移动：关闭', false);
        log('enabled =', state.enabled);
      },
      get debug() {
        return state.debug;
      },
      setDebug(value) {
        state.debug = Boolean(value);
        writeBool(DEBUG_KEY, state.debug);
        log('debug =', state.debug);
      },
      shouldBlockMove() {
        return state.enabled && state.manualBlockActive;
      },
      blockMove() {
        const now = Date.now();
        state.status.blockCount += 1;
        if (!state.beepedForCurrentManualAttack) {
          state.beepedForCurrentManualAttack = true;
          state.status.beepCount += 1;
          state.lastHintAt = now;
          showHint('距离过远', true);
          log('blocked manual out-of-range auto move');
          return;
        }

        if (now - state.lastHintAt < 1800) {
          return;
        }

        state.lastHintAt = now;
        showHint('距离过远', false);
        log('blocked manual out-of-range auto move');
      },
      handleSpaceKeyDown(isAutoHunt, startAttack, stopAttack) {
        if (!state.enabled || isAutoHunt) {
          return false;
        }
        if (typeof startAttack !== 'function' || typeof stopAttack !== 'function') {
          return false;
        }

        state.status.spaceKeyDownCount += 1;
        state.spaceStartAttack = startAttack;
        state.spaceStopAttack = stopAttack;

        if (state.spaceManualActive) {
          return true;
        }

        state.spaceManualActive = true;
        state.spacePausedByDirection = false;
        state.status.spaceManualActive = true;
        state.status.lastReason = 'space manual attack started';
        startSpaceAttack('space keydown');
        return true;
      },
      handleSpaceKeyUp(stopAttack) {
        if (!state.spaceManualActive) {
          return false;
        }
        if (typeof stopAttack === 'function') {
          state.spaceStopAttack = stopAttack;
        }

        stopSpaceAttack('space keyup');
        state.spaceManualActive = false;
        state.spacePausedByDirection = false;
        state.pressedDirections.clear();
        state.status.spaceManualActive = false;
        state.status.spacePausedByDirection = false;
        state.status.lastReason = 'space manual attack stopped';
        return true;
      },
    };
  }

  function captureManualAttackKey() {
    page.addEventListener('keydown', (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (isMovementKey(event)) {
        markDirectionKey(event);
        pauseSpaceAttackForDirection();
        return;
      }

      if (isManualAttackKey(event)) {
        markManualAttack(event.code || event.key || '');
        return;
      }

      if ((event.key || '').toLowerCase() === 'z' || event.code === 'KeyZ') {
        clearManualBlock('Z auto-hunt key captured');
      }
    }, true);

    page.addEventListener('keyup', (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (!isMovementKey(event)) {
        return;
      }

      unmarkDirectionKey(event);
      resumeSpaceAttackAfterDirection();
    }, true);
    state.status.manualKeyCaptureInstalled = true;
    log('manual attack key capture installed');
  }

  function installBundleInterceptor() {
    if (page.Node.prototype.appendChild.__muNoAutowalkPatched) {
      state.status.interceptorInstalled = true;
      state.status.lastReason = 'appendChild already patched';
      return;
    }

    const originalAppendChild = page.Node.prototype.appendChild;

    page.Node.prototype.appendChild = function patchedAppendChild(node) {
      if (isBundleScript(node)) {
        replaceBundleScript(node, this, originalAppendChild);
        return node;
      }

      return originalAppendChild.call(this, node);
    };

    Object.defineProperty(page.Node.prototype.appendChild, '__muNoAutowalkPatched', {
      value: true,
      configurable: false,
    });
    state.status.interceptorInstalled = true;
    log('Node.prototype.appendChild interceptor installed');
  }

  function isManualAttackKey(event) {
    if (event.code === 'Space' || event.key === ' ') {
      return true;
    }

    const skillCodes = [
      'Digit1', 'Digit2', 'Digit3', 'Digit4',
      'Digit5', 'Digit6', 'Digit7', 'Digit8',
      'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
      'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8',
    ];

    if (skillCodes.includes(event.code)) {
      return true;
    }

    return /^[1-8]$/.test(event.key || '');
  }

  function markManualAttack(key) {
    const now = Date.now();
    state.manualBlockActive = true;
    state.beepedForCurrentManualAttack = false;
    state.status.manualBlockActive = true;
    state.status.manualBlockStartedAt = now;
    state.status.manualAttackUntil = 'persistent until Z auto-hunt';
    state.status.manualKeyCount += 1;
    state.status.lastReason = `manual attack key captured: ${key}`;
    log(state.status.lastReason);
  }

  function clearManualBlock(reason) {
    state.manualBlockActive = false;
    state.beepedForCurrentManualAttack = false;
    state.status.manualBlockActive = false;
    state.status.manualBlockStartedAt = 0;
    state.status.manualAttackUntil = 0;
    state.status.lastReason = reason;
    log(reason);
  }

  function startSpaceAttack(reason) {
    if (!state.spaceManualActive || state.spacePausedByDirection || state.pressedDirections.size > 0) {
      return;
    }
    try {
      state.spaceStartAttack();
      state.status.spaceStartCount += 1;
      state.status.lastReason = reason;
      log(reason);
    } catch (error) {
      state.status.lastReason = `space attack start failed: ${error && error.message ? error.message : error}`;
      log('space attack start failed:', error);
    }
  }

  function stopSpaceAttack(reason) {
    if (typeof state.spaceStopAttack !== 'function') {
      return;
    }
    try {
      state.spaceStopAttack();
      state.status.spaceStopCount += 1;
      state.status.lastReason = reason;
      log(reason);
    } catch (error) {
      state.status.lastReason = `space attack stop failed: ${error && error.message ? error.message : error}`;
      log('space attack stop failed:', error);
    }
  }

  function pauseSpaceAttackForDirection() {
    if (!state.spaceManualActive || state.spacePausedByDirection) {
      return;
    }
    state.spacePausedByDirection = true;
    state.status.spacePausedByDirection = true;
    state.status.spaceDirectionPauseCount += 1;
    stopSpaceAttack('space attack paused by movement key');
  }

  function resumeSpaceAttackAfterDirection() {
    if (!state.spaceManualActive || !state.spacePausedByDirection || state.pressedDirections.size > 0) {
      return;
    }
    state.spacePausedByDirection = false;
    state.status.spacePausedByDirection = false;
    state.status.spaceDirectionResumeCount += 1;
    startSpaceAttack('space attack resumed after movement key release');
  }

  function markDirectionKey(event) {
    const key = normalizeMovementKey(event);
    if (key) {
      state.pressedDirections.add(key);
    }
  }

  function unmarkDirectionKey(event) {
    const key = normalizeMovementKey(event);
    if (key) {
      state.pressedDirections.delete(key);
    }
  }

  function isMovementKey(event) {
    return Boolean(normalizeMovementKey(event));
  }

  function normalizeMovementKey(event) {
    const code = event && event.code;
    const key = ((event && event.key) || '').toLowerCase();
    if (code === 'ArrowUp' || key === 'arrowup' || code === 'KeyW' || key === 'w') return 'up';
    if (code === 'ArrowDown' || key === 'arrowdown' || code === 'KeyS' || key === 's') return 'down';
    if (code === 'ArrowLeft' || key === 'arrowleft' || code === 'KeyA' || key === 'a') return 'left';
    if (code === 'ArrowRight' || key === 'arrowright' || code === 'KeyD' || key === 'd') return 'right';
    return '';
  }

  function isEditableTarget(target) {
    if (!target) {
      return false;
    }

    const tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function isBundleScript(node) {
    return node && node.tagName === 'SCRIPT' && typeof node.src === 'string' && BUNDLE_RE.test(node.src);
  }

  async function replaceBundleScript(script, parent, append) {
    const originalSrc = script.src;
    state.status.interceptedBundle = true;
    state.status.lastBundleUrl = sanitizeUrl(originalSrc);
    state.status.lastReason = 'bundle intercepted';

    try {
      log('fetching bundle', sanitizeUrl(originalSrc));
      const response = await page.fetch(originalSrc, { credentials: 'include', cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const source = await response.text();
      const result = patchBundleSource(source);
      if (!result.applied) {
        state.status.lastReason = result.reason;
        showHint(`防自动移动补丁未生效：${result.reason}`, false);
        log('patch skipped:', result.reason);
        append.call(parent, script);
        return;
      }

      const blob = new page.Blob([result.source], { type: 'application/javascript' });
      const blobUrl = page.URL.createObjectURL(blob);
      const fallback = makeFallbackScript(originalSrc);

      script.onerror = function onPatchedScriptError() {
        state.status.fallbackLoaded = true;
        state.status.lastReason = 'patched blob failed; fallback loaded';
        showHint('补丁脚本加载失败，已回退原始脚本', false);
        log('patched blob failed; falling back');
        append.call(parent, fallback);
      };

      script.src = blobUrl;
      script.dataset.muManualNoAutowalk = 'patched';
      state.status.patchedBundle = true;
      state.status.lastReason = result.reason;
      append.call(parent, script);
      showHint('手动攻击防自动移动：已加载', false);
      log('patched bundle loaded');
    } catch (error) {
      state.status.fallbackLoaded = true;
      state.status.lastReason = `patch failed: ${error && error.message ? error.message : error}`;
      showHint('防自动移动补丁加载失败，已回退原始脚本', false);
      log('patch failed:', error);
      append.call(parent, script);
    }
  }

  function makeFallbackScript(src) {
    const fallback = document.createElement('script');
    fallback.async = false;
    fallback.src = src;
    fallback.dataset.muManualNoAutowalk = 'fallback';
    return fallback;
  }

  function patchBundleSource(source) {
    if (source.includes(PATCH_MARKER)) {
      return { source, applied: false, reason: 'already patched' };
    }

    let patched = source;
    const manualOk = patched.includes(TARGET_BRANCH);
    const spaceDownOk = patched.includes(SPACE_KEYDOWN_TARGET);
    const spaceUpOk = patched.includes(SPACE_KEYUP_TARGET);

    if (manualOk) {
      patched = patched.replace(TARGET_BRANCH, PATCHED_BRANCH);
    }
    if (spaceDownOk) {
      patched = patched.replace(SPACE_KEYDOWN_TARGET, SPACE_KEYDOWN_PATCHED);
    }
    if (spaceUpOk) {
      patched = patched.replace(SPACE_KEYUP_TARGET, SPACE_KEYUP_PATCHED);
    }

    state.status.patchedBundle = manualOk || spaceDownOk || spaceUpOk;
    state.status.patchedSpaceKeyDown = spaceDownOk;
    state.status.patchedSpaceKeyUp = spaceUpOk;

    if (!state.status.patchedBundle) {
      return { source, applied: false, reason: 'target branches not found' };
    }

    return {
      source: patched,
      applied: true,
      reason: [
        manualOk ? 'manual-move✓' : 'manual-move✗',
        spaceDownOk ? 'space-down✓' : 'space-down✗',
        spaceUpOk ? 'space-up✓' : 'space-up✗',
      ].join(' '),
    };
  }

  function showHint(text, withBeep) {
    const render = () => {
      const el = getHintElement();
      el.textContent = text;
      el.style.opacity = '1';
      page.clearTimeout(el.__hideTimer);
      el.__hideTimer = page.setTimeout(() => {
        el.style.opacity = '0';
      }, 900);
      if (withBeep) {
        beep();
      }
    };

    if (document.body) {
      render();
    } else {
      document.addEventListener('DOMContentLoaded', render, { once: true });
    }
  }

  function getHintElement() {
    let el = document.getElementById('mu-manual-no-autowalk-hint');
    if (el) {
      return el;
    }

    el = document.createElement('div');
    el.id = 'mu-manual-no-autowalk-hint';
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:22%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'padding:8px 14px',
      'border-radius:4px',
      'background:rgba(0,0,0,.72)',
      'color:#ffd56a',
      'font:600 18px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'text-shadow:0 1px 2px #000',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity .12s ease',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function beep() {
    try {
      const AudioContextCtor = page.AudioContext || page.webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      state.audioContext = state.audioContext || new AudioContextCtor();
      const ctx = state.audioContext;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch (error) {
      log('beep failed:', error);
    }
  }

  function readBool(key, fallback) {
    try {
      const value = page.localStorage.getItem(key);
      if (value === null) {
        return fallback;
      }
      return value === '1';
    } catch (error) {
      return fallback;
    }
  }

  function writeBool(key, value) {
    try {
      page.localStorage.setItem(key, value ? '1' : '0');
    } catch (error) {
      log('localStorage write failed:', error);
    }
  }

  function sanitizeUrl(url) {
    try {
      const parsed = new page.URL(url);
      parsed.search = '';
      return parsed.toString();
    } catch (error) {
      return url.split('?')[0];
    }
  }

  function log(...args) {
    if (state.debug) {
      console.log('[MU no-autowalk]', ...args);
    }
  }
})();
