/**
 * NIKKE 战斗模拟器 — 入口
 */
import { loadAllData } from './data/loader.js';
import { loadAccountFromDev, getAccountSize, loadSettingsFromDev, getAccountSettings } from './data/account-loader.js';
import { renderSquadBuilder, applyGlobalSettings } from './ui/squad-builder.js';
import { renderResults } from './ui/results.js';
import { simulate, simulateMonteCarlo } from './engine/battle.js';
import { computeFinalStats } from './engine/stats.js';

const $loader   = document.getElementById('loader');
const $progress = document.getElementById('loadProgress');
const $app      = document.getElementById('app');
const $builder  = document.getElementById('squadBuilder');
const $results  = document.getElementById('results');

async function init() {
  showLoader('正在加载游戏数据…');

  try {
    await loadAllData((key, done, total) => {
      $progress.textContent = `正在加载 ${key}…（${done}/${total}）`;
    });
    $progress.textContent = '数据加载完成 ✓';
  } catch (err) {
    $progress.textContent = `⚠ 部分数据加载失败：${err.message}。使用备用数据。`;
  }

  $progress.textContent = '正在加载账号数据…';
  const accountLoaded = await loadAccountFromDev();
  if (accountLoaded) {
    $progress.textContent = `账号数据加载完成，共 ${getAccountSize()} 个角色 ✓`;
  } else {
    $progress.textContent = '未找到账号数据，使用手动模式';
  }

  await loadSettingsFromDev();
  applyGlobalSettings(getAccountSettings());

  hideLoader();
  renderSquadBuilder($builder, onSimulate);
}

function onSimulate(state) {
  const activeSlots = state.team.filter(s => s.active && s.resourceId);
  if (!activeSlots.length) {
    alert('请至少启用一个 NIKKE 槽位并选择一个角色。');
    return;
  }

  const $btn = document.getElementById('btnSimulate');
  if ($btn) { $btn.disabled = true; $btn.textContent = '运行中…'; }

  $results.innerHTML = '<p class="loading-text">正在模拟…</p>';
  $results.scrollIntoView({ behavior: 'smooth' });

  const research = {
    general:   state.generalResearch,
    attacker:  state.classResearch.attacker,
    defender:  state.classResearch.defender,
    supporter: state.classResearch.supporter,
    ...state.corpResearch,
  };

  setTimeout(() => {
    try {
      const squadStats = activeSlots.map(slot =>
        computeFinalStats(slot, state.synchroLevel, research)
      );

      // 构建战斗引擎配置
      const config = {
        squad: activeSlots.map((slot, idx) => ({
          characterId:    slot.resourceId,
          name:           slot.name || `NIKKE ${idx+1}`,
          classType:      slot.classType,
          element:        slot.element,
          weaponType:     slot.weaponType,
          burstStep:      slot.burstStep ?? 'Step3',
          level:          state.synchroLevel,
          _computedStats: squadStats[idx],
          _nikkeData:     slot._nikkeData ?? null,
        })),
        enemy:         { maxHp: 10_000_000, def: 500, element: 'Iron', type: 'Normal', hasCore: false, distance: null },
        useMonteCarlo: true,
        iterations:    200,
      };

      // 从 DOM 读取敌人与模拟参数
      const q = id => $builder.querySelector(id);
      const enemyHp   = q('#enemyHp');
      const enemyDef  = q('#enemyDef');
      const enemyEl   = q('#enemyElement');
      const enemyTy   = q('#enemyType');
      const enemyCore = q('#enemyHasCore');
      const distNear  = q('#distNear');
      const distMid   = q('#distMid');
      const distFar   = q('#distFar');
      const mcCheck   = q('#useMonteCarlo');
      const iterInp   = q('#iterations');
      if (enemyHp)   config.enemy.maxHp    = parseInt(enemyHp.value)   || 10_000_000;
      if (enemyDef)  config.enemy.def       = parseInt(enemyDef.value)  || 500;
      if (enemyEl)   config.enemy.element   = enemyEl.value  || 'Iron';
      if (enemyTy)   config.enemy.type      = enemyTy.value  || 'Normal';
      if (enemyCore) config.enemy.hasCore   = enemyCore.checked;
      if (distNear || distMid || distFar) {
        config.enemy.distancePhases = [
          { zone: 'NEAR', durationS: parseInt(distNear?.value) || 0 },
          { zone: 'MID',  durationS: parseInt(distMid?.value)  || 0 },
          { zone: 'FAR',  durationS: parseInt(distFar?.value)  || 0 },
        ].filter(p => p.durationS > 0);
        config.enemy.distance = config.enemy.distancePhases[0]?.zone ?? null;
      }
      if (mcCheck)   config.useMonteCarlo   = mcCheck.checked;
      if (iterInp)   config.iterations      = parseInt(iterInp.value)   || 200;

      const result = config.useMonteCarlo
        ? simulateMonteCarlo(config, config.iterations)
        : simulate(config);

      renderResults($results, result, squadStats, activeSlots);
    } catch (err) {
      $results.innerHTML = `<p class="error">模拟出错：${err.message}</p>`;
      console.error(err);
    } finally {
      if ($btn) { $btn.disabled = false; $btn.textContent = '▶ 开始模拟'; }
    }
  }, 10);
}

function showLoader(msg) {
  $progress.textContent = msg;
  $loader.classList.remove('hidden');
  $app.classList.add('hidden');
}

function hideLoader() {
  $loader.classList.add('hidden');
  $app.classList.remove('hidden');
}

init();
