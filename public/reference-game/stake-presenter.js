// Wallet outcomes select an original-physics shot; original collisions also drive its visuals.
window.installStakePinball = ({ Screen, audio, constants, matter, createSimulation }) => {
  let screen = null;
  let playback = null;
  let muted = true;
  const initialize = Screen.prototype.initialize;
  const update = Screen.prototype.update;
  const updateBaseScreen = Object.getPrototypeOf(Screen.prototype).update;
  const frameStep = 1000 / 60;

  function disposeScene(scene) {
    if (scene.isDisposed) return;
    scene.entities = scene.entities.filter(entity => !entity.isDisposed);
    scene._iterating = false;
    scene.dispose();
  }

  const dividerPositions = [{ x: 690, y: 1190 }, { x: 1030, y: 1390 }];
  function addDividers(machine, onHalf = () => {}) {
    machine.dividerBumpers = dividerPositions.map((position, id) => {
      const bumper = machine.createBumper(position.x, position.y);
      const original = bumper.sensor_onBallEnterSensor;
      bumper.sensor.onBallEnterSensor.remove(original, bumper);
      const hit = function (sensor, ball) {
        // Retain the native bumper collision, impulse, light and sound; it awards no points.
        const score = machine.scoreOnTable;
        machine.scoreOnTable = () => null;
        try { original.call(this, sensor, ball); }
        finally { machine.scoreOnTable = score; }
        onHalf(id);
      };
      bumper.sensor.onBallEnterSensor.add(hit, bumper);
      return bumper;
    });
  }

  function setScoringBumperArt(machine) {
    for (const bumper of machine.bumpers) {
      bumper.display._off.setImage(window.pinballPlusBumperImage);
    }
  }

  function createShot(power, seed) {
    let randomState = seed >>> 0;
    let matterSeed = seed;
    let nextId = 0;
    // Drawing and unrelated page work never consume the shot's random sequence.
    function run(callback) {
      const originalRandom = Math.random;
      const originalSeed = matter.Common._seed;
      const originalId = matter.Common._nextId;
      Math.random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 4294967296;
      };
      matter.Common._seed = matterSeed;
      matter.Common._nextId = nextId;
      try { return callback(); }
      finally {
        matterSeed = matter.Common._seed;
        nextId = matter.Common._nextId;
        Math.random = originalRandom;
        matter.Common._seed = originalSeed;
        matter.Common._nextId = originalId;
      }
    }
    const simulation = run(createSimulation);
    const { scene, machine } = simulation;
    setScoringBumperArt(machine);
    let ball, trigger, hold;
    let bank = 0;
    let creditNumerator = 0n, creditDenominator = 1n;
    const pendingOps = [];
    run(() => {
      for (const method of ['scoreOnTable', 'scoreOffTable']) {
        const original = machine[method];
        machine[method] = function (...args) {
          const previous = this.gameState.score;
          const result = original.apply(this, args);
          const points = this.gameState.score - previous;
          if (points > 0) {
            const amount = Math.max(10, 10 * Math.floor((points + 125) / 250)); // Fixed bonus prices, in hundredths of a stake.
            creditNumerator += BigInt(amount) * creditDenominator;
            bank = Number(creditNumerator) / Number(creditDenominator);
            pendingOps.push({ kind: 'award', points, amount });
          }
          return result;
        };
      }
      addDividers(machine, id => {
        creditDenominator *= 2n;
        bank = Number(creditNumerator) / Number(creditDenominator);
        pendingOps.push({ kind: 'halve', bumper: id });
      });
      machine.input.pollInput = () => {};
      machine.input.plungerInputAllowed = false;
      // Keep the original bonus phases and animations, while retaining one wagered ball.
      machine.multiballSpawner.spawnBall = () => null;
      ball = machine.createBall(5, 1581, 1707, false, false);
      machine.plunger.beginPull();
      machine.plunger.plungerPullSpeedScale = 0;
      machine.plunger.setPull(power / 100);
      for (let i = 0; i < Math.ceil(600 / frameStep); i++) scene.update(frameStep);
      machine.plunger.endPull();
      trigger = 1980 + Math.floor(Math.random() * 105);
      hold = 60 + Math.floor(Math.random() * 65);
    });
    let tick = 0, played = false, gutter = null;
    let leftUntil = -1, rightUntil = -1, leftNext = 0, rightNext = 0;
    return {
      ...simulation,
      ball,
      get played() { return played; },
      get credits() { return [creditNumerator.toString(), creditDenominator.toString()]; },
      get gutter() { return gutter; },
      get time() { return tick * frameStep; },
      sample() {
        return run(() => {
          if (ball.entity.isDisposed) return null;
          const p = ball.body.matterBody.position;
          const v = ball.body.matterBody.velocity;
          if (p.x < 1500 && p.y < 1600) played = true;
          if (played && p.y > 1670 && p.y < 2010) {
            if (p.x < 145) gutter = 'left-gutter';
            if (p.x > 1390 && p.x < 1515) gutter = 'right-gutter';
          }
          const now = tick * frameStep;
          if (played && v.y > 0 && p.y > trigger && p.y < 2160) {
            if (p.x > 450 && p.x < 805 && now >= leftNext) {
              leftUntil = now + hold; leftNext = now + hold + 180;
            }
            if (p.x > 860 && p.x < 1220 && now >= rightNext) {
              rightUntil = now + hold; rightNext = now + hold + 180;
            }
          }
          const left = now < leftUntil, right = now < rightUntil;
          machine.leftFlipperButton.setState(false, left);
          machine.rightFlipperButton.setState(false, right);
          if (played && p.y > 2388) {
            const settled = Number(((creditNumerator + 10n * creditDenominator - 1n) / (10n * creditDenominator)) * 10n);
            if (BigInt(settled) * creditDenominator !== creditNumerator) pendingOps.push({ kind: 'settle', amount: settled });
            bank = settled;
            creditNumerator = BigInt(settled); creditDenominator = 1n;
          }
          return { t: now, x: p.x, y: p.y, floor: ball.floor,
            left, right, score: machine.gameState.score, bank, ops: pendingOps.splice(0) };
        });
      },
      advance() { run(() => scene.update(frameStep)); tick++; },
      dispose() { run(() => disposeScene(scene)); },
    };
  }

  function release() {
    if (!screen) return;
    screen.machine.leftFlipperButton.setState(false, false);
    screen.machine.rightFlipperButton.setState(false, false);
  }
  function finish() {
    const current = playback;
    playback = null;
    release();
    current.resolve();
  }
  Screen.prototype.initialize = function () {
    initialize.call(this);
    screen = this;
    this.controller.next(null);
    setScoringBumperArt(this.machine);
    addDividers(this.machine);
    this.scene.pollInput = () => {};
    this.machine.input.pollInput = () => {};
    this.machine.input.plungerInputAllowed = false;
    this.machine.shootPrompt.setShowing(false, true);
    this.machine.shootPrompt.display.alpha = 0;
    audio.isMuted = muted;
    window.parent.postMessage({ type: 'pinball-ready' }, location.origin);
  };
  Screen.prototype.update = function (elapsed) {
    if (!playback) { update.call(this, elapsed); return; }
    const current = playback;
    try {
      current.elapsed += elapsed;
      const timeline = current.outcome.path;
      while (current.index < timeline.length && current.elapsed + 1e-6 >= timeline[current.index].t) {
        const expected = timeline[current.index];
        const actual = current.shot.sample();
        if (!actual || Math.abs(actual.x - expected.x) > 1e-5 || Math.abs(actual.y - expected.y) > 1e-5 ||
            actual.floor !== expected.floor || actual.score !== expected.score ||
            actual.left !== expected.left || actual.right !== expected.right ||
            actual.bank !== expected.bank || JSON.stringify(actual.ops) !== JSON.stringify(expected.ops)) {
          throw new Error('Original physics replay did not match the saved shot');
        }
        current.onProgress(expected.bank, ...current.shot.credits);
        current.index++;
        if (current.index < timeline.length) current.shot.advance();
      }
      if (current.index >= timeline.length) {
        // A bonus sequence is allowed to finish before the wallet round settles.
        if (this.machine.cutsceneActive || this.machine._bonusBallPhase) current.shot.advance();
        else finish();
      }
      this.scoreDisplay.update(elapsed);
      updateBaseScreen.call(this, elapsed);
    } catch (error) {
      playback = null;
      release();
      current.reject(error);
    }
  };
  window.pinballTable = {
    simulate(power, seed, maxMs = 120000) {
      const shot = createShot(power, seed);
      const path = [];
      let drain = null;
      try {
        while (shot.time <= maxMs) {
          const sample = shot.sample();
          if (!sample) break;
          path.push(sample);
          if (shot.played && sample.y > 2388) { drain = shot.gutter || 'center'; break; }
          if (!shot.played && shot.time > 5000) break;
          shot.advance();
        }
        return { ruleVersion: 3, power, seed, step: constants.Physics.Simulation.StepSize, frameStep,
          drain, played: shot.played, score: shot.machine.gameState.score, bank: path.at(-1)?.bank ?? 0, duration: shot.time, path };
      } finally { shot.dispose(); }
    },
    get ready() { return !!screen; },
    get playing() { return !!playback; },
    get presentation() {
      return screen ? { score: screen.machine.gameState.score,
        cutscene: screen.machine.cutsceneActive,
        bonusVisible: screen.machine.aboveTableDisplay.children.length > 0,
        bank: playback?.outcome.path[Math.max(0, playback.index - 1)]?.bank ?? 0,
        dividers: dividerPositions, measuredFrames: playback?.index ?? 0 } : null;
    },
    setMuted(value) { muted = value; audio.isMuted = value; },
    play(outcome, power, onProgress) {
      if (!screen || playback || outcome.power !== power) return Promise.reject(new Error('Table unavailable'));
      const shot = createShot(power, outcome.seed);
      const oldScene = screen.scene, oldMachine = screen.machine;
      screen.sceneHolder.removeChild(oldScene.display);
      screen.sceneHolder.removeChild(oldMachine.aboveTableDisplay);
      disposeScene(oldScene);
      screen.scene = shot.scene;
      screen.machine = shot.machine;
      screen.controller.gameState = shot.machine.gameState;
      screen.sceneHolder.addChild(shot.scene.display);
      screen.sceneHolder.addChild(shot.machine.aboveTableDisplay);
      shot.scene.pollInput = () => {};
      shot.machine.onScored.add(screen.machine_onScored, screen);
      shot.machine.onBonusBall.add(screen.machine_onBonusBall, screen);
      shot.machine.onMultiplierChanged.add(screen.machine_onMultiplierChanged, screen);
      shot.machine.shootPrompt.setShowing(false, true);
      shot.machine.shootPrompt.display.alpha = 0;
      screen.scoreDisplay.setScore(0, false);
      screen.scoreDisplay.setMultiplier(1, false);
      screen.scoreDisplay.visible = true;
      screen.highScoreDisplay.visible = true;
      screen.anchor();
      return new Promise((resolve, reject) => {
        playback = { shot, outcome, onProgress, resolve, reject, index: 0, reward: 0, elapsed: 0 };
      });
    },
  };
  addEventListener('pagehide', () => {
    release();
    playback?.reject(new Error('Table closed'));
    playback = null;
  });
};
