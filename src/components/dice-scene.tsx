import type { CSSProperties } from 'react';
import styles from './dice-scene.module.css';

export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6;
export type DicePhase = 'ready' | 'covering' | 'shaking' | 'settled';

interface DiceSceneProps {
  values: readonly DiceValue[];
  lift: number;
  phase: DicePhase;
  dragging: boolean;
}

interface DiePosition { x: number; z: number; angle: number; }
interface DieFaces { top: DiceValue; bottom: DiceValue; front: DiceValue; back: DiceValue; right: DiceValue; left: DiceValue; }
type FaceName = keyof DieFaces;
type SceneStyle = CSSProperties & { '--cup-lift'?: string; '--panel-angle'?: string; '--panel-color'?: string; '--facet-inset'?: string; '--pip-row'?: number; '--pip-column'?: number; };

const PANEL_COUNT = 40;
const PANEL_ANGLES = Array.from({ length: PANEL_COUNT }, (_, index) => index * 360 / PANEL_COUNT);
const CROWN_ANGLES = Array.from({ length: 24 }, (_, index) => index * 360 / 24);
const CROWN_BANDS = Array.from({ length: 6 }, (_, index) => index);
const FACE_NAMES: readonly FaceName[] = ['top', 'bottom', 'front', 'back', 'right', 'left'];
const FACE_VALUES: Readonly<Record<DiceValue, DieFaces>> = {
  1: { top: 1, bottom: 6, front: 2, back: 5, right: 3, left: 4 },
  2: { top: 2, bottom: 5, front: 6, back: 1, right: 3, left: 4 },
  3: { top: 3, bottom: 4, front: 2, back: 5, right: 6, left: 1 },
  4: { top: 4, bottom: 3, front: 2, back: 5, right: 1, left: 6 },
  5: { top: 5, bottom: 2, front: 1, back: 6, right: 3, left: 4 },
  6: { top: 6, bottom: 1, front: 5, back: 2, right: 3, left: 4 },
};
const PIP_POSITIONS: Readonly<Record<DiceValue, readonly (readonly [number, number])[]>> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};
const DIE_POSITIONS: Readonly<Record<number, readonly DiePosition[]>> = {
  1: [{ x: 0, z: 0, angle: -18 }],
  2: [{ x: -30, z: -8, angle: -20 }, { x: 30, z: 10, angle: 18 }],
  3: [{ x: -34, z: -22, angle: -16 }, { x: 34, z: -22, angle: 14 }, { x: 0, z: 34, angle: -7 }],
  4: [{ x: -31, z: -31, angle: -16 }, { x: 31, z: -31, angle: 19 }, { x: -31, z: 31, angle: 12 }, { x: 31, z: 31, angle: -14 }],
  5: [{ x: -40, z: -38, angle: -13 }, { x: 40, z: -38, angle: 17 }, { x: 0, z: 0, angle: -9 }, { x: -40, z: 38, angle: 14 }, { x: 40, z: 38, angle: -15 }],
  6: [{ x: -46, z: -28, angle: -12 }, { x: 0, z: -28, angle: 10 }, { x: 46, z: -28, angle: -15 }, { x: -46, z: 28, angle: 13 }, { x: 0, z: 28, angle: -11 }, { x: 46, z: 28, angle: 15 }],
};

function materialColor(highlight: number): string {
  return `color-mix(in srgb, var(--primary), var(--dice-cup-light) ${highlight}%)`;
}

function panelStyle(angle: number): SceneStyle {
  return { '--panel-angle': `${angle}deg`, '--panel-color': materialColor(40 + Math.cos((angle + 45) * Math.PI / 180) * 15) };
}

/** 球面纬圈之间以真实倾斜的梯形相连。 / Tilted trapezoids connect adjacent spherical latitude rings. */
function crownFacetStyle(band: number, angle: number): SceneStyle {
  const lowerLatitude = band * Math.PI / (2 * CROWN_BANDS.length);
  const upperLatitude = (band + 1) * Math.PI / (2 * CROWN_BANDS.length);
  const halfSegment = Math.PI / CROWN_ANGLES.length;
  const lowerRadius = 100 * Math.cos(lowerLatitude);
  const upperRadius = 100 * Math.cos(upperLatitude);
  const lowerY = -30 - 100 * Math.sin(lowerLatitude);
  const upperY = -30 - 100 * Math.sin(upperLatitude);
  const lowerZ = lowerRadius * Math.cos(halfSegment);
  const upperZ = upperRadius * Math.cos(halfSegment);
  const tilt = Math.atan2(lowerZ - upperZ, lowerY - upperY);
  const width = 2 * lowerRadius * Math.sin(halfSegment) + .8;
  const upperWidth = band === CROWN_BANDS.length - 1 ? 0 : 2 * upperRadius * Math.sin(halfSegment) + .8;
  const height = Math.hypot(lowerY - upperY, lowerZ - upperZ) + .6;
  const highlight = 40 + 15 * (Math.cos((angle + 45) * Math.PI / 180) * Math.cos(tilt) + Math.sin(tilt));
  return {
    width, height, left: -width / 2, top: -height / 2,
    '--facet-inset': `${(1 - upperWidth / width) * 50}%`,
    '--panel-color': materialColor(highlight),
    transform: `rotateY(${angle}deg) translate3d(0, ${(lowerY + upperY) / 2}px, ${(lowerZ + upperZ) / 2}px) rotateX(${tilt * 180 / Math.PI}deg)`,
  };
}

function Die({ value, position, index }: { value: DiceValue; position: DiePosition; index: number }) {
  return <div className={styles.die} aria-hidden="true" data-testid={`dice-${index}`} data-value={value} style={{ transform: `translate3d(${position.x}px, 62px, ${position.z}px) rotateY(${position.angle}deg)` }}>
    {FACE_NAMES.map(face => {
      const faceValue = FACE_VALUES[value][face];
      return <div key={face} className={`${styles.dieFace} ${styles[face]}`} data-face={face} data-value={faceValue}>
        <div className={`${styles.pips} ${faceValue === 1 || faceValue === 4 ? styles.redPips : ''}`}>
          {PIP_POSITIONS[faceValue].map(([row, column]) => <i key={`${row}-${column}`} className={styles.pip} style={{ '--pip-row': row, '--pip-column': column } as SceneStyle} />)}
        </div>
      </div>;
    })}
  </div>;
}

/** 骰盅和骰子共享三维空间，以实体表面自然遮挡。 / Cup and dice share one 3D space for physical occlusion. */
export function DiceScene({ values, lift, phase, dragging }: DiceSceneProps) {
  const positions = DIE_POSITIONS[values.length];
  if (!positions) throw new RangeError(`Dice scene requires 1–6 dice; received ${values.length}.`);
  return <div id="dice-scene" className={styles.scene} aria-hidden="true" data-phase={phase} data-dragging={dragging} data-lift={lift} style={{ '--cup-lift': `${lift}px` } as SceneStyle}>
    <div className={styles.world}>
      <div className={styles.trayEdge}>
        {PANEL_ANGLES.map(angle => <i key={angle} className={styles.trayPanel} style={panelStyle(angle)} />)}
      </div>
      <div className={styles.tray}><div className={styles.felt} /></div>
      <div className={styles.cupShadow} />
      {values.map((value, index) => {
        const position = positions[index];
        if (!position) throw new RangeError(`Dice position ${index} is missing for ${values.length} dice.`);
        return <Die key={index} value={value} position={position} index={index} />;
      })}
      <div id="dice-cup" className={styles.cupLift}>
        <div className={styles.cupMotion}>
          {PANEL_ANGLES.map(angle => <div key={angle} className={styles.cupPanel} style={panelStyle(angle)}><i className={styles.panelExterior} /><i className={styles.panelInterior} /></div>)}
          {CROWN_BANDS.flatMap(band => CROWN_ANGLES.map(angle => <i key={`${band}-${angle}`} className={styles.crownFacet} style={crownFacetStyle(band, angle)} />))}
          <div className={styles.topRing} />
          <div className={styles.bottomRing} />
          <div className={styles.bottomLip} />
        </div>
      </div>
    </div>
  </div>;
}
