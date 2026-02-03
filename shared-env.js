/**
 * shared-env.js
 * ─────────────
 * Common VR environment logic shared across ALL pages.
 * Includes: bird-flight, follow-camera, audio manager,
 *           VR controller basics, UI recentering.
 * 
 * Each page that uses this must have:
 *   - <a-scene id="vr-scene" cursor="rayOrigin: mouse" raycaster="objects: .interactive">
 *   - Elements with id="rig", id="camera", id="left-controller", id="right-controller"
 *   - A div#loading, div#overlay, div#instructions (standard shell)
 */

// ─── SERVICE WORKER (PWA) ────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registered', reg))
      .catch(err => console.log('SW failed', err));
  });
}

// ─── BIRD FLIGHT COMPONENT ───────────────────────────────────
AFRAME.registerComponent('bird-flight', {
  schema: {
    speed:       { type: 'number', default: 4 },
    radius:      { type: 'number', default: 25 },
    heightRange: { type: 'vec2',   default: {x: 10, y: 20} }
  },
  init: function () {
    const angle = Math.random() * Math.PI * 2;
    const dist  = Math.random() * this.data.radius;
    this.el.object3D.position.set(
      Math.cos(angle) * dist,
      this.data.heightRange.x + Math.random() * (this.data.heightRange.y - this.data.heightRange.x),
      Math.sin(angle) * dist
    );
    this.el.object3D.rotation.y = Math.random() * Math.PI * 2;
    this.turnSpeed       = 0;
    this.targetTurnSpeed = (Math.random() - 0.5) * 0.02;
  },
  tick: function (time, timeDelta) {
    if (!timeDelta) return;
    const dt = timeDelta / 1000;
    this.el.object3D.translateZ(this.data.speed * dt);
    const pos = this.el.object3D.position;
    const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);

    if (dist > this.data.radius) {
      this.turnSpeed = 0.015;
    } else {
      if (Math.random() < 0.01) this.targetTurnSpeed = (Math.random() - 0.5) * 0.02;
      this.turnSpeed += (this.targetTurnSpeed - this.turnSpeed) * 0.1;
    }
    this.el.object3D.rotation.y += this.turnSpeed;
    this.el.object3D.rotation.z  = -this.turnSpeed * 30;
    this.el.object3D.position.y += Math.sin(time / 500) * 0.005;
  }
});

// ─── FOLLOW-CAMERA COMPONENT ─────────────────────────────────
AFRAME.registerComponent('follow-camera', {
  tick: function () {
    if (!this.el.object3D.visible) return;
    const camera = document.getElementById('camera');
    if (!camera) return;

    const camPos = new THREE.Vector3();
    camera.object3D.getWorldPosition(camPos);
    const camRot = new THREE.Euler();
    camRot.setFromQuaternion(camera.object3D.quaternion, 'YXZ');

    const distance = 0.7;
    this.el.object3D.position.lerp(new THREE.Vector3(
      camPos.x - Math.sin(camRot.y) * distance,
      camPos.y - 0.2,
      camPos.z - Math.cos(camRot.y) * distance
    ), 0.05);
    this.el.object3D.lookAt(camPos.x, camPos.y, camPos.z);
  }
});

// ─── AUDIO MANAGER ────────────────────────────────────────────
const AudioManager = {
  waves:  null,
  birds:  null,
  waves2: null,
  timers: [],

  init: function () {
    this.waves  = new Audio('waves.mp3');
    this.birds  = new Audio('birds.mp3');
    this.waves2 = new Audio('waves2.mp3');

    this.waves.loop   = true;
    this.waves.volume = 0.4;
    this.birds.volume = 0.6;
    this.birds.addEventListener('ended', () => this.scheduleNextBird());
    this.waves2.volume = 0;
    this.waves2.loop   = true;
  },

  start: function () {
    if (!this.waves) this.init();
    this.waves.play().catch(() => {});
    this.scheduleNextBird();
    this.scheduleWaves2();
  },

  stop: function () {
    if (this.waves)  this.waves.pause();
    if (this.birds)  this.birds.pause();
    if (this.waves2) this.waves2.pause();
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  },

  scheduleNextBird: function () {
    const t = setTimeout(() => {
      if (this.birds) { this.birds.currentTime = 0; this.birds.play().catch(() => {}); }
    }, Math.random() * 17000 + 8000);
    this.timers.push(t);
  },

  scheduleWaves2: function () {
    const t = setTimeout(() => this.playWaves2Swell(), Math.random() * 20000 + 10000);
    this.timers.push(t);
  },

  playWaves2Swell: function () {
    if (!this.waves2) return;
    this.waves2.currentTime = 0;
    this.waves2.play().catch(() => {});
    const targetVol   = Math.random() * 0.5 + 0.3;
    const duration    = Math.random() * 10000 + 8000;
    const fadeInTime  = Math.random() * 3000 + 2000;
    const fadeOutTime = Math.random() * 3000 + 2000;

    this.fadeAudio(this.waves2, 0, targetVol, fadeInTime, () => {
      const hold = setTimeout(() => {
        this.fadeAudio(this.waves2, targetVol, 0, fadeOutTime, () => {
          this.waves2.pause();
          this.scheduleWaves2();
        });
      }, duration);
      this.timers.push(hold);
    });
  },

  fadeAudio: function (audio, startVol, endVol, duration, cb) {
    const steps    = 60;
    const stepTime = duration / steps;
    const volStep  = (endVol - startVol) / steps;
    let   step     = 0;
    const iv = setInterval(() => {
      step++;
      audio.volume = Math.max(0, Math.min(1, startVol + volStep * step));
      if (step >= steps) { clearInterval(iv); if (cb) cb(); }
    }, stepTime);
    this.timers.push(iv);
  }
};
AudioManager.init();

// ─── SHARED GLOBALS ──────────────────────────────────────────
window.isLeftGripHeld = false;

// ─── MODULE-PAGE CONTROLLER (simpler than index — no model rotate/scale) ──
// Index page registers its OWN vr-controller with full model logic.
// Module pages use this lighter version: grip-recenters UI, trigger clicks UI,
// joystick look/move, X = scenery toggle.
// We only register if NOT already registered (index registers its own).
if (!AFRAME.components['vr-controller-module']) {
  AFRAME.registerComponent('vr-controller-module', {
    schema: { hand: { type: 'string', default: 'left' } },
    init: function () {
      this.sceneryMode = false;
      this.onTriggerDown   = this.onTriggerDown.bind(this);
      this.onGripDown      = this.onGripDown.bind(this);
      this.onGripUp        = this.onGripUp.bind(this);
      this.onButtonDown    = this.onButtonDown.bind(this);
      this.onAxisMove      = this.onAxisMove.bind(this);

      this.el.addEventListener('triggerdown',  this.onTriggerDown);
      this.el.addEventListener('gripdown',     this.onGripDown);
      this.el.addEventListener('gripup',       this.onGripUp);
      this.el.addEventListener('abuttondown',  this.onButtonDown);
      this.el.addEventListener('bbuttondown',  this.onButtonDown);
      this.el.addEventListener('xbuttondown',  this.onButtonDown);
      this.el.addEventListener('ybuttondown',  this.onButtonDown);
      this.el.addEventListener('axismove',     this.onAxisMove);
    },

    onAxisMove: function (evt) {
      if (this.data.hand === 'left') {
        const axis = evt.detail.axis;
        if (!axis || axis.length < 2) return;
        const x = axis[2] !== undefined ? axis[2] : axis[0];
        if (Math.abs(x) > 0.1) {
          const rig = document.getElementById('rig');
          if (rig) rig.object3D.rotation.y -= x * 0.03;
        }
      }
    },

    onGripDown: function () {
      if (this.data.hand === 'left') {
        window.isLeftGripHeld = true;
        this.el.emit('hapticpulse', { intensity: 0.5, duration: 100 });
      }
      if (this.data.hand === 'right') this.recenterUI();
    },

    onGripUp: function () {
      if (this.data.hand === 'left') window.isLeftGripHeld = false;
    },

    onTriggerDown: function () {
      if (this.sceneryMode) return;
      const raycaster = this.el.components.raycaster;
      if (!raycaster) return;
      const hits = raycaster.intersectedEls;
      for (let i = 0; i < hits.length; i++) {
        if (hits[i].classList.contains('interactive')) {
          hits[i].emit('click');
          this.el.emit('hapticpulse', { intensity: 0.5, duration: 50 });
          break;
        }
      }
    },

    onButtonDown: function (evt) {
      if (evt.type === 'xbuttondown') { this.toggleScenery(); return; }
    },

    toggleScenery: function () {
      this.sceneryMode = !this.sceneryMode;
      const ids = ['exercise-container','nav-back-btn','toggle-panel-btn','control-panel','help-card','modules-card'];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('visible', !this.sceneryMode);
      });
      this.el.emit('hapticpulse', { intensity: this.sceneryMode ? 0.8 : 0.3, duration: this.sceneryMode ? 300 : 100 });
    },

    recenterUI: function () {
      if (this.sceneryMode) return;
      const camera = document.getElementById('camera');
      if (!camera) return;
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.object3D.getWorldPosition(camPos);
      camera.object3D.getWorldDirection(camDir);
      camDir.y = 0; camDir.normalize();

      const target = new THREE.Vector3().copy(camPos).add(camDir.multiplyScalar(0.6));
      target.y = camPos.y;

      ['toggle-panel-btn','control-panel','help-card','modules-card'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.object3D.position.copy(target); el.object3D.lookAt(camPos); }
      });

      const tp = document.getElementById('toggle-panel-btn');
      const cp = document.getElementById('control-panel');
      const hc = document.getElementById('help-card');
      const mc = document.getElementById('modules-card');
      if (tp && cp && hc && mc && !cp.getAttribute('visible') && !hc.getAttribute('visible') && !mc.getAttribute('visible')) {
        tp.setAttribute('visible', true);
      }
      this.el.emit('hapticpulse', { intensity: 0.8, duration: 150 });
    }
  });
}