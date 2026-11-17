/*!
 * anaglyph.js — core dichoptic (anaglyph) renderer.
 *
 * Two full-size offscreen canvases, one per physical eye. Every drawing call
 * is tagged with the eye that should see it, gets rendered into the matching
 * offscreen buffer in that eye's colour channel, and the two buffers are then
 * composited with 'lighter'.
 *
 * "amblyopic" = the weaker eye (its image is drawn at full intensity).
 * "fellow"    = the stronger eye (multiplied by fellowContrast).
 * "both"      = identical content in both eyes (fusion target). Both eyes get
 *               FULL intensity — only the per-eye colour and brightness trims
 *               apply. fellowContrast must NOT dim a "both" element, otherwise
 *               the two eyes would receive unequal luminance and the fusion
 *               target would stop being a fusion target.
 * "left"/"right" = force a physical eye, using that eye's own image colour.
 *               The fellow (stronger) eye's own image is dimmed by
 *               fellowContrast, so these tags describe "what this eye's own
 *               content looks like" rather than an isolated target.
 * "leftFull"/"rightFull" = draw for one physical eye at full intensity: only
 *               that eye's brightness trim applies, never fellowContrast.
 *               Used by the observations / leakage targets, where the point is
 *               whether a target is visible to an eye at all. These tags draw
 *               straight to a physical eye and never mutate persisted settings.
 *
 * Intensity summary (per physical eye):
 *   "both" / "amblyopic" / "leftFull" / "rightFull" -> eyeTrim
 *   "fellow"                                        -> eyeTrim * fellowContrast
 *                                                      (equal mode: eyeTrim)
 *
 * Note on "both": it is drawn in each eye at FULL intensity (per-eye trim
 * only). fellowContrast is applied exclusively to fellow-tagged content; a
 * "both" element must never be dimmed in one eye or it stops being a shared
 * frame/fusion anchor.
 */

import { normalizeSettings } from './store.js';

const EYE_LEFT = 'left';
const EYE_RIGHT = 'right';

const TAG_AMB = 'amblyopic';
const TAG_FELLOW = 'fellow';
const TAG_BOTH = 'both';

export class AnaglyphRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    this.left = document.createElement('canvas');
    this.right = document.createElement('canvas');
    this.leftCtx = this.left.getContext('2d');
    this.rightCtx = this.right.getContext('2d');

    // Cached colour strings — never reallocated in the drawing hot path.
    // this._colors  = what each physical eye receives for its own full-strength
    //                 content (the leakage check uses colorFor('left'/'right')).
    // this._tagColors[tag][eye] = colour string used when drawing that tag.
    // this._fullColors = per-eye full-strength strings (trim only), the same
    //                 values the 'leftFull'/'rightFull' tags draw with.
    this._colors = { left: 'rgb(0,0,0)', right: 'rgb(0,0,0)' };
    this._tagColors = {
      left: this._colors,
      right: this._colors,
      both: this._colors,
      amblyopic: this._colors,
      fellow: this._colors
    };
    this._intensity = { left: 1, right: 1 };
    this._intensityFellow = { left: 1, right: 1 };
    this._fullColors = { left: 'rgb(0,0,0)', right: 'rgb(0,0,0)' };

    // Precomputed target lists so eye-tag resolution allocates nothing.
    this._targets = {
      amblyopic: [EYE_LEFT],
      fellow: [EYE_RIGHT],
      both: [EYE_LEFT, EYE_RIGHT],
      left: [EYE_LEFT],
      right: [EYE_RIGHT],
      leftFull: [EYE_LEFT],
      rightFull: [EYE_RIGHT]
    };

    this._cssW = 1;
    this._cssH = 1;
    this._lastCssW = 0;
    this._lastCssH = 0;
    this.redEye = EYE_LEFT;
    this.cyanEye = EYE_RIGHT;
    this.equalMode = false;
    this.amblyopicEye = 'right';
    this.lensOrientation = 'RL';
    this.settings = normalizeSettings({});

    this.configure(this.settings);
  }

  /* ---------- Configuration ---------- */

  configure(settings) {
    const s = normalizeSettings(settings || {});
    this.settings = s;

    // 'RL' → red lens over the left eye, cyan over the right.
    const redEye = s.lensOrientation === 'LR' ? EYE_RIGHT : EYE_LEFT;
    const cyanEye = redEye === EYE_LEFT ? EYE_RIGHT : EYE_LEFT;
    this.redEye = redEye;
    this.cyanEye = cyanEye;
    this.lensOrientation = s.lensOrientation;

    this.equalMode = s.amblyopicEye === 'equal';
    this.amblyopicEye = s.amblyopicEye;

    const amb =
      this.equalMode || s.amblyopicEye === 'left' || s.amblyopicEye === 'right'
        ? s.amblyopicEye
        : 'equal';

    const leftIsAmb = amb === EYE_LEFT;
    // In equal mode there is no dichoptic offset: both eyes at full strength.
    const fellow = this.equalMode ? 1 : s.fellowContrast;
    // The physical eye that carries the "fellow" (dimmed) content, if any.
    const fellowEye = this.equalMode ? null : leftIsAmb ? EYE_RIGHT : EYE_LEFT;

    // Full-intensity factors: per-eye brightness trim only.
    this._intensity.left = s.leftEyeTrim;
    this._intensity.right = s.rightEyeTrim;
    // Fellow-tag factors: trim * fellowContrast in the fellow eye only.
    this._intensityFellow.left = s.leftEyeTrim * (fellowEye === EYE_LEFT ? fellow : 1);
    this._intensityFellow.right = s.rightEyeTrim * (fellowEye === EYE_RIGHT ? fellow : 1);

    const leftColor = redEye === EYE_LEFT ? s.redColor : s.cyanColor;
    const rightColor = redEye === EYE_RIGHT ? s.redColor : s.cyanColor;

    // Full-intensity colour strings ("both" elements and amblyopic content).
    const fullLeft = buildColor(leftColor, this._intensity.left);
    const fullRight = buildColor(rightColor, this._intensity.right);
    // Fellow-tag colour strings (dimmed in the fellow eye, equal mode = full).
    const felLeft = buildColor(leftColor, this._intensityFellow.left);
    const felRight = buildColor(rightColor, this._intensityFellow.right);

    // What each physical eye receives for its own image — the leakage check
    // shows exactly this. The fellow eye is dimmed by fellowContrast.
    this._colors.left = fellowEye === EYE_LEFT ? felLeft : fullLeft;
    this._colors.right = fellowEye === EYE_RIGHT ? felRight : fullRight;

    this._fullColors = { left: fullLeft, right: fullRight };

    this._tagColors = {
      both: { left: fullLeft, right: fullRight },
      amblyopic: { left: fullLeft, right: fullRight },
      fellow: { left: felLeft, right: felRight },
      // Forced physical-eye tags describe the eye's own image.
      left: this._colors,
      right: this._colors,
      // Isolated single-eye targets: trim only, never fellowContrast.
      leftFull: { left: fullLeft, right: fullRight },
      rightFull: { left: fullLeft, right: fullRight }
    };

    // Effective per-eye factors for the forced-eye tags (mirrors _colors).
    this._drawIntensity = {
      left: fellowEye === EYE_LEFT ? this._intensityFellow.left : this._intensity.left,
      right: fellowEye === EYE_RIGHT ? this._intensityFellow.right : this._intensity.right
    };

    this._targets.amblyopic = this.equalMode
      ? this._targets.both
      : [amb === EYE_LEFT ? EYE_LEFT : EYE_RIGHT];
    this._targets.fellow = this.equalMode
      ? this._targets.both
      : [amb === EYE_LEFT ? EYE_RIGHT : EYE_LEFT];

    return this;
  }

  /** Colour table for a tag (single lookup per primitive, not per target). */
  _colorsFor(tag) {
    return this._tagColors[tag] || this._tagColors.both;
  }

  /** Effective brightness for an eye tag (1 = nothing lost). */
  getIntensity(eye) {
    if (eye === EYE_LEFT || eye === EYE_RIGHT) return this._drawIntensity[eye];
    const tag = this._targets[eye] ? eye : TAG_BOTH;
    const targets = this._targets[tag];
    const table = tag === TAG_FELLOW ? this._intensityFellow : this._intensity;
    if (targets.length === 1) return table[targets[0]];
    return Math.min(table.left, table.right);
  }

  /**
   * Public: colour string for the image a *single* physical eye receives.
   *
   * Supported selectors: 'left', 'right', 'leftFull', 'rightFull', and the
   * eye tags a configuration resolves to exactly one eye ('amblyopic',
   * 'fellow' outside equal mode). Those all return the exact string the draw
   * calls use for that eye.
   *
   * A tag drawn to both eyes with two different strings has no single
   * truthful answer. 'both' is always like that (and 'amblyopic'/'fellow' in
   * equal mode can be too), so this returns `null` rather than the colour of
   * one eye — which is what an earlier version did and was misleading. Use
   * the per-eye drawing table (`_colorsFor(tag)` / the eye buffers) when you
   * need both.
   */
  colorFor(eye) {
    const tag = this._tagColors[eye] ? eye : TAG_BOTH;
    const colors = this._colorsFor(tag);
    const targets = this._targets[tag] || this._targets.both;
    if (targets.length === 1) return colors[targets[0]];
    return colors.left === colors.right ? colors.left : null;
  }

  /* ---------- Sizing ---------- */

  _sync() {
    const canvas = this.canvas;
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w < 1 || h < 1) return false;

    const cssW = canvas.clientWidth || w;
    const cssH = canvas.clientHeight || h;
    this._cssW = cssW;
    this._cssH = cssH;

    if (
      this.left.width !== w ||
      this.left.height !== h ||
      this._lastCssW !== cssW ||
      this._lastCssH !== cssH
    ) {
      this.left.width = w;
      this.left.height = h;
      this.right.width = w;
      this.right.height = h;
      const sx = w / cssW;
      const sy = h / cssH;
      this.leftCtx.setTransform(sx, 0, 0, sy, 0, 0);
      this.rightCtx.setTransform(sx, 0, 0, sy, 0, 0);
      // Keep the main context in CSS-pixel coordinates too.
      this.ctx.setTransform(sx, 0, 0, sy, 0, 0);
      this._lastCssW = cssW;
      this._lastCssH = cssH;
    }
    return true;
  }

  clear() {
    if (!this._sync()) return;
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this._cssW, this._cssH);
    this.leftCtx.clearRect(0, 0, this._cssW, this._cssH);
    this.rightCtx.clearRect(0, 0, this._cssW, this._cssH);
  }

  /* ---------- Primitives ---------- */
  // All primitives iterate the (max 2) target eyes inline: no closures, no
  // per-frame allocation, colour strings are reused from this._colors.

  _targetList(tag) {
    return this._targets[tag] || this._targets.both;
  }

  drawRect(x, y, w, h, eye) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (w === 0 || h === 0) return;
    const colors = this._colorsFor(eye || TAG_BOTH);
    const targets = this._targetList(eye || TAG_BOTH);
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      const ctx = e === EYE_LEFT ? this.leftCtx : this.rightCtx;
      ctx.fillStyle = colors[e];
      ctx.fillRect(x, y, w, h);
    }
  }

  drawCircle(cx, cy, r, eye) {
    if (r <= 0) return;
    const colors = this._colorsFor(eye || TAG_BOTH);
    const targets = this._targetList(eye || TAG_BOTH);
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      const ctx = e === EYE_LEFT ? this.leftCtx : this.rightCtx;
      ctx.fillStyle = colors[e];
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Hollow circle (stroke only). Useful for observation targets: a closed
   * thin outline makes edge clarity and ghosting/doubling easier to judge than
   * a solid blob. Thickness is in CSS pixels.
   */
  drawRing(cx, cy, r, thickness, eye) {
    if (r <= 0 || !(thickness > 0)) return;
    const colors = this._colorsFor(eye || TAG_BOTH);
    const targets = this._targetList(eye || TAG_BOTH);
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      const ctx = e === EYE_LEFT ? this.leftCtx : this.rightCtx;
      ctx.strokeStyle = colors[e];
      ctx.lineWidth = thickness;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawText(text, x, y, font, eye, align) {
    const colors = this._colorsFor(eye || TAG_BOTH);
    const targets = this._targetList(eye || TAG_BOTH);
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      const ctx = e === EYE_LEFT ? this.leftCtx : this.rightCtx;
      ctx.font = font || '16px system-ui, sans-serif';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = colors[e];
      ctx.fillText(text, x, y);
    }
  }

  drawLine(x1, y1, x2, y2, lineWidth, eye) {
    const lw = lineWidth || 2;
    const colors = this._colorsFor(eye || TAG_BOTH);
    const targets = this._targetList(eye || TAG_BOTH);
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      const ctx = e === EYE_LEFT ? this.leftCtx : this.rightCtx;
      ctx.strokeStyle = colors[e];
      ctx.lineWidth = lw;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  /** Hollow rectangle made of four thin rects (works with 'lighter'). */
  drawFrame(x, y, w, h, thickness, eye) {
    const t = thickness || 1;
    if (w <= 0 || h <= 0) return;
    this.drawRect(x, y, w, t, eye);
    this.drawRect(x, y + h - t, w, t, eye);
    if (h > t * 2) {
      this.drawRect(x, y + t, t, h - t * 2, eye);
      this.drawRect(x + w - t, y + t, t, h - t * 2, eye);
    }
  }

  /* ---------- Composition ---------- */

  composite() {
    if (!this._sync()) return;
    const ctx = this.ctx;
    const w = this._cssW;
    const h = this._cssH;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.left, 0, 0, w, h);
    ctx.drawImage(this.right, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Convenience: clear + draw + composite in one call. */
  present(drawFn) {
    this.clear();
    drawFn(this);
    this.composite();
  }
}

/* ---------- helpers ---------- */

function buildColor(c, intensity) {
  const i = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  const r = Math.round((c.r || 0) * i);
  const g = Math.round((c.g || 0) * i);
  const b = Math.round((c.b || 0) * i);
  // Cache-friendly: browsers intern identical strings cheaply, but we only
  // build these once per configure() anyway.
  return `rgb(${r},${g},${b})`;
}

/** Which physical eye wears the red lens for a given orientation. */
export function redEyeFor(lensOrientation) {
  return lensOrientation === 'LR' ? EYE_RIGHT : EYE_LEFT;
}

export default AnaglyphRenderer;
