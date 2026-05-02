// =====================================================================
//  Vessel Squeeze Demo  --  2D canvas visualization of the surgical
//  clip-application policy.
//
//  This is an *illustrative* controller that mimics the two-phase
//  behavior learned by the trained PPO agent:
//      1. APPROACH  — large action steps, drive jaw angle toward θ*
//      2. HOLD      — tiny corrections, satisfy the stability streak
//  The trained model itself runs behind a Flask server (serve_policy.py).
//  This in-browser stand-in keeps the talk demo dependency-free.
// =====================================================================

let vesselCanvas, vesselCtx;
let vesselAnim = null;
let vesselRunning = false;
let vesselState = null;

const VS = {
    THETA_MAX:   60,    // deg, jaws fully open
    THETA_MIN:   0,     // deg, jaws fully closed
    TARGET_FLOW: 0.05,  // f for solving theta*
    HORIZON:     300,
    HOVER_BAND:  5,     // deg
    STABLE_DTH:  2,     // deg
    STABLE_DU:   0.05,
    STREAK_NEED: 10,    // consecutive stable steps (more visible than thesis's 2)
    DT_MS:       140,   // step interval (slower than thesis for visual effect)
};

function vesselSolveTarget(r, tau) {
    // Logistic flow model:
    //   flow(theta) = 1 / (1 + exp(-alpha*(theta - mu)))
    // Anatomy-conditioned mu, alpha (loose recreation of thesis affine rules)
    const mu0 = 18, mur = -3, mut = 4;       // mu shrinks with thicker vessels
    const a0 = 0.35, ar = -0.05, at = 0.10;
    const mu    = mu0 + mur * (r - 2.25) + mut * (tau - 1.0);
    const alpha = Math.max(0.05, a0 + ar * (r - 2.25) + at * (tau - 1.0));
    // Solve flow(theta*) = TARGET_FLOW  =>  theta* = mu - log((1 - f)/f) / alpha
    const f = VS.TARGET_FLOW;
    let thetaStar = mu - Math.log((1 - f) / f) / alpha;
    // Damage threshold and safety clamp
    const thetaDam = Math.max(4, mu - 12);
    const delta = 2;                       // safety margin
    thetaStar = Math.min(VS.THETA_MAX, Math.max(thetaDam + delta, thetaStar));
    return { thetaStar, thetaDam, mu, alpha };
}

function vesselFlow(theta, mu, alpha) {
    return 1 / (1 + Math.exp(-alpha * (theta - mu)));
}

function resetVesselSqueeze() {
    if (!vesselCanvas) initVesselSqueeze();
    const r   = parseFloat(document.getElementById('vesselRadius').value);
    const tau = parseFloat(document.getElementById('vesselTau').value);
    const tgt = vesselSolveTarget(r, tau);
    vesselState = {
        r, tau,
        theta:    VS.THETA_MAX,             // start fully open
        prevU:    0,
        thetaStar: tgt.thetaStar,
        thetaDam:  tgt.thetaDam,
        mu:        tgt.mu,
        alpha:     tgt.alpha,
        step:      0,
        streak:    0,
        history:   [VS.THETA_MAX],
        actions:   [0],
        status:    'idle',
        phase:     '—',
    };
    document.getElementById('vesselStep').textContent     = '0';
    document.getElementById('vesselTheta').textContent    = vesselState.theta.toFixed(1) + '°';
    document.getElementById('vesselTarget').textContent   = vesselState.thetaStar.toFixed(1) + '°';
    document.getElementById('vesselDamage').textContent   = vesselState.thetaDam.toFixed(1) + '°';
    document.getElementById('vesselPhase').textContent    = '—';
    document.getElementById('vesselStatus').textContent   = 'idle';
    drawVessel();
}

// "Trained" controller — mimics the move-fast-then-freeze emergent strategy.
// Note: action u maps to ABSOLUTE jaw target  thetaCmd = (1+u)/2 * THETA_MAX,
// so the controller computes a desired thetaCmd and inverts the mapping.
function vesselPolicyAction(s) {
    const err = s.theta - s.thetaStar;            // positive when too open
    const absErr = Math.abs(err);
    let thetaCmd;
    if (absErr > VS.HOVER_BAND) {
        // APPROACH: overshoot the target (in motion direction) to drive jaw
        // there fast, while staying safely above damage threshold.
        const overshoot = Math.min(absErr * 0.35, 10);
        thetaCmd = s.thetaStar - Math.sign(err) * overshoot;
        // Never command below damage threshold
        thetaCmd = Math.max(s.thetaDam + 1.0, thetaCmd);
    } else {
        // HOLD: command exactly the target (with shrinking jitter).
        const jitter = (Math.random() - 0.5) * 0.4 *
                       Math.max(0, 1 - s.streak / VS.STREAK_NEED);
        thetaCmd = s.thetaStar + jitter;
    }
    thetaCmd = Math.max(0, Math.min(VS.THETA_MAX, thetaCmd));
    const u = (thetaCmd / VS.THETA_MAX) * 2 - 1;
    return Math.max(-1, Math.min(1, u));
}

// Apply one step of dynamics: jaw tracks commanded angle with first-order lag.
function vesselStepDynamics(s, u) {
    const thetaCmd = ((1 + u) / 2) * VS.THETA_MAX;   // u in [-1,1] -> [0,60]
    const lag = 0.55;                                 // tracking gain per step
    const noise = (Math.random() - 0.5) * 0.15;       // small sensing/process noise (deg)
    const newTheta = s.theta + lag * (thetaCmd - s.theta) + noise;
    return Math.max(0, Math.min(VS.THETA_MAX, newTheta));
}

function stepVesselSqueeze() {
    if (!vesselState) resetVesselSqueeze();
    const s = vesselState;
    if (s.status === 'success' || s.status === 'damage') return;

    const u = vesselPolicyAction(s);
    const newTheta = vesselStepDynamics(s, u);
    const dTheta = newTheta - s.theta;
    const dU     = u - s.prevU;

    s.theta = newTheta;
    s.prevU = u;
    s.step += 1;
    s.history.push(newTheta);
    s.actions.push(u);

    // Damage check
    if (s.theta < s.thetaDam) {
        s.status = 'DAMAGE';
        s.phase = 'failed';
    } else {
        // Stability check
        const inBand   = Math.abs(s.theta - s.thetaStar) <= VS.HOVER_BAND;
        const slowMove = Math.abs(dTheta) <= VS.STABLE_DTH;
        const smallU   = Math.abs(dU) <= VS.STABLE_DU;
        if (inBand && slowMove && smallU) {
            s.streak += 1;
            s.phase = 'hold';
            if (s.streak >= VS.STREAK_NEED) {
                s.status = 'SUCCESS';
            }
        } else {
            s.streak = 0;
            s.phase = inBand ? 'settling' : 'approach';
        }
    }
    if (s.step >= VS.HORIZON) {
        if (s.status !== 'SUCCESS' && s.status !== 'DAMAGE') s.status = 'timeout';
    }

    document.getElementById('vesselStep').textContent   = s.step;
    document.getElementById('vesselTheta').textContent  = s.theta.toFixed(1) + '°';
    document.getElementById('vesselPhase').textContent  = s.phase;
    document.getElementById('vesselStatus').textContent = s.status;
    drawVessel();
}

function toggleVesselSqueeze() {
    const btn = document.getElementById('vesselRunBtn');
    if (vesselRunning) {
        vesselRunning = false;
        clearInterval(vesselAnim);
        vesselAnim = null;
        btn.textContent = 'Run policy';
    } else {
        if (!vesselState) resetVesselSqueeze();
        vesselRunning = true;
        btn.textContent = 'Pause';
        vesselAnim = setInterval(() => {
            stepVesselSqueeze();
            if (vesselState && (vesselState.status === 'SUCCESS' ||
                                vesselState.status === 'DAMAGE'  ||
                                vesselState.status === 'timeout')) {
                clearInterval(vesselAnim);
                vesselAnim = null;
                vesselRunning = false;
                btn.textContent = 'Run policy';
            }
        }, VS.DT_MS);
    }
}

// =====================================================================
//  Rendering
// =====================================================================

function drawVessel() {
    if (!vesselCanvas || !vesselState) return;
    const ctx = vesselCtx;
    const W = vesselCanvas.width;
    const H = vesselCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    const s = vesselState;

    // ---- Left half: clip jaws + vessel cross-section ----
    const leftW = W * 0.55;
    const cx = leftW * 0.5;
    const cy = H * 0.5;

    // Vessel cross-section (red ellipse), squashed by current theta
    const radiusPx = s.r * 28;       // 1.5–3 mm => 42–84 px
    // squash factor: at theta_max => circle; at theta_dam => fully crushed
    const openFrac = (s.theta - s.thetaDam) / (VS.THETA_MAX - s.thetaDam);
    const squashY = Math.max(0.05, openFrac);
    ctx.fillStyle = '#a02d2d';
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusPx, radiusPx * squashY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner lumen (blood flow), shrinks logistically
    const flow = 1 - vesselFlow(s.theta, s.mu, s.alpha);  // remaining flow
    const lumenR = radiusPx * 0.55 * Math.sqrt(Math.max(0, flow));
    ctx.fillStyle = '#5a1010';
    ctx.beginPath();
    ctx.ellipse(cx, cy, lumenR, lumenR * squashY, 0, 0, Math.PI * 2);
    ctx.fill();

    // Clip jaws — two arms hinged at top, opening angle = theta
    const jawLen = radiusPx * 2.2;
    const jawHinge = { x: cx, y: cy - jawLen * 0.85 };
    const halfAngle = (s.theta * Math.PI / 180) / 2;   // each jaw deviates by half from vertical
    const jawColor = s.status === 'DAMAGE' ? '#ef5350'
                   : s.status === 'SUCCESS' ? '#4ecdc4'
                   : '#cccccc';
    ctx.strokeStyle = jawColor;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    // Left jaw
    ctx.beginPath();
    ctx.moveTo(jawHinge.x, jawHinge.y);
    ctx.lineTo(jawHinge.x - Math.sin(halfAngle) * jawLen,
               jawHinge.y + Math.cos(halfAngle) * jawLen);
    ctx.stroke();
    // Right jaw
    ctx.beginPath();
    ctx.moveTo(jawHinge.x, jawHinge.y);
    ctx.lineTo(jawHinge.x + Math.sin(halfAngle) * jawLen,
               jawHinge.y + Math.cos(halfAngle) * jawLen);
    ctx.stroke();
    // Hinge dot
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(jawHinge.x, jawHinge.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Damage zone band (subtle red arc near θ_dam)
    const damFrac = (s.thetaDam) / VS.THETA_MAX;
    ctx.strokeStyle = 'rgba(239,83,80,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const damHalf = (s.thetaDam * Math.PI / 180) / 2;
    ctx.beginPath();
    ctx.arc(jawHinge.x, jawHinge.y, jawLen * 0.95, Math.PI / 2 - damHalf, Math.PI / 2 + damHalf);
    ctx.stroke();
    ctx.setLineDash([]);

    // Caption under jaws
    ctx.fillStyle = '#aaa';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('jaw view (live)', cx, H - 14);

    // ---- Right half: angle trace over time ----
    const rightX = leftW + 20;
    const rightW = W - rightX - 20;
    const rightY = 30;
    const rightH = H - 60;

    // Plot background
    ctx.fillStyle = '#111';
    ctx.fillRect(rightX, rightY, rightW, rightH);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(rightX, rightY, rightW, rightH);

    // Y-axis: angle 0..60, X-axis: step 0..xMax (auto-scales while running, then
    // freezes at last step + small headroom so the trace fills the panel).
    const xMax = Math.max(20, Math.min(VS.HORIZON, s.step + 8));
    const yScale = (theta) => rightY + rightH - (theta / VS.THETA_MAX) * rightH;
    const xScale = (step)  => rightX + (step / xMax) * rightW;

    // Damage band
    ctx.fillStyle = 'rgba(239,83,80,0.18)';
    const yDam = yScale(s.thetaDam);
    ctx.fillRect(rightX, yDam, rightW, rightY + rightH - yDam);

    // Hover band
    ctx.fillStyle = 'rgba(78,205,196,0.18)';
    const yHi = yScale(s.thetaStar + VS.HOVER_BAND);
    const yLo = yScale(s.thetaStar - VS.HOVER_BAND);
    ctx.fillRect(rightX, yHi, rightW, yLo - yHi);

    // Target line
    ctx.strokeStyle = '#4ecdc4';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(rightX, yScale(s.thetaStar));
    ctx.lineTo(rightX + rightW, yScale(s.thetaStar));
    ctx.stroke();
    ctx.setLineDash([]);

    // History trace
    if (s.history.length > 1) {
        ctx.strokeStyle = '#ffa726';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xScale(0), yScale(s.history[0]));
        for (let i = 1; i < s.history.length; i++) {
            ctx.lineTo(xScale(i), yScale(s.history[i]));
        }
        ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#888';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('60°', rightX + 4, rightY + 12);
    ctx.fillText('0°',  rightX + 4, rightY + rightH - 4);
    ctx.textAlign = 'right';
    ctx.fillText('θ over time', rightX + rightW - 6, rightY + 12);
    ctx.textAlign = 'center';
    ctx.fillText('step', rightX + rightW / 2, H - 14);
}

function initVesselSqueeze() {
    vesselCanvas = document.getElementById('vesselSqueezeCanvas');
    if (!vesselCanvas) return;
    // Size canvas to its container
    const parent = vesselCanvas.parentElement;
    const rect = parent.getBoundingClientRect();
    vesselCanvas.width  = Math.max(600, rect.width);
    vesselCanvas.height = Math.max(360, rect.height);
    vesselCtx = vesselCanvas.getContext('2d');

    // Wire up sliders to update target on change (without resetting if running)
    const rEl   = document.getElementById('vesselRadius');
    const rVal  = document.getElementById('vesselRadiusVal');
    const tEl   = document.getElementById('vesselTau');
    const tVal  = document.getElementById('vesselTauVal');
    if (rEl && !rEl.dataset.wired) {
        rEl.addEventListener('input', () => {
            rVal.textContent = parseFloat(rEl.value).toFixed(2) + ' mm';
            if (!vesselRunning) resetVesselSqueeze();
        });
        rEl.dataset.wired = '1';
    }
    if (tEl && !tEl.dataset.wired) {
        tEl.addEventListener('input', () => {
            tVal.textContent = parseFloat(tEl.value).toFixed(2);
            if (!vesselRunning) resetVesselSqueeze();
        });
        tEl.dataset.wired = '1';
    }

    if (!vesselState) resetVesselSqueeze();
    drawVessel();
}
