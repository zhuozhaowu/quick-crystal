import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import {
    ColorPalette,
    ElementData,
    NormalizedControls,
    RegexPatterns,
    RenderConfig,
    SupercellInputIds,
    ViewAngleInputIds,
    ViewShortcutKeys
} from './config.js';
import { UI } from './dom.js';
import { collectMaterials, disposeCollectedResources } from './three-resource-lifecycle.js';

// --- Global state and configuration ---
let scene, camera, renderer, controls, effect;
let ambientLight, dirLight; 
let lightVector = new THREE.Vector3(10, 15, 15).normalize();
const keyLightWorldDirection = new THREE.Vector3();
const keyLightTargetPosition = new THREE.Vector3();
const clock = new THREE.Clock();
let isWebGlContextLost = false;

let frustumSize = 25; 
let atomsGroup = new THREE.Group();
let bondsGroup = new THREE.Group();
let cellGroup = new THREE.Group();
let baseAtomsData = [];
let currentAtomsData = []; 
let currentBondsData = [];
let currentCell = null;
let baseCell = null;
let modelCenter = new THREE.Vector3();

// Interaction state
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedBondIndex = null;
let selectedBondMeshes = [];
let activeColorPickerAnchor = null;

function canonicalElement(symbol) {
    const raw = String(symbol || '').replace(RegexPatterns.quoteWrap, '').trim();
    const match = raw.match(RegexPatterns.elementSymbol);
    if (!match) return 'X';
    return match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
}

function resolveElementRenderingDefaults(symbol) {
    const elementKey = canonicalElement(symbol);
    return ElementData[elementKey] ?? ElementData.default;
}

function parseCifNumber(value) {
    const cleaned = String(value || '').replace(RegexPatterns.quoteWrap, '').replace(RegexPatterns.cifUncertainty, '');
    const parsed = parseFloat(cleaned);
    if (Number.isNaN(parsed)) throw new Error(`Invalid numeric value: ${value}`);
    return parsed;
}

function makeCell(vA, vB, vC) {
    return {
        a: vA.clone(),
        b: vB.clone(),
        c: vC.clone(),
        fracToCart(frac) {
            return new THREE.Vector3()
                .addScaledVector(this.a, frac.x)
                .addScaledVector(this.b, frac.y)
                .addScaledVector(this.c, frac.z);
        },
        offsetToCart(offset) {
            return new THREE.Vector3()
                .addScaledVector(this.a, offset.x)
                .addScaledVector(this.b, offset.y)
                .addScaledVector(this.c, offset.z);
        }
    };
}

function buildCellFromLengthsAngles(a, b, c, alpha, beta, gamma) {
    const rad = Math.PI / 180;
    const al = alpha * rad;
    const be = beta * rad;
    const ga = gamma * rad;
    const volumeFactor = Math.sqrt(Math.max(0, 1 - Math.cos(al) ** 2 - Math.cos(be) ** 2 - Math.cos(ga) ** 2 + 2 * Math.cos(al) * Math.cos(be) * Math.cos(ga)));
    const vA = new THREE.Vector3(a, 0, 0);
    const vB = new THREE.Vector3(b * Math.cos(ga), b * Math.sin(ga), 0);
    const cx = c * Math.cos(be);
    const cy = c * (Math.cos(al) - Math.cos(be) * Math.cos(ga)) / Math.sin(ga);
    const cz = c * volumeFactor / Math.sin(ga);
    return makeCell(vA, vB, new THREE.Vector3(cx, cy, cz));
}

function cloneAtom(atom) {
    return {
        element: canonicalElement(atom.element),
        pos: atom.pos.clone(),
        frac: atom.frac ? atom.frac.clone() : null
    };
}

function clampNormalized(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1, Math.max(0, parsed));
}

function formatNormalized(value) {
    return clampNormalized(value).toFixed(2);
}

function actualToNormalized(id, actualValue) {
    const range = NormalizedControls[id];
    if (!range) return clampNormalized(actualValue);
    return (actualValue - range.min) / (range.max - range.min);
}

function normalizedToActual(id, normalizedValue) {
    const range = NormalizedControls[id];
    const normalized = clampNormalized(normalizedValue);
    if (!range) return normalized;
    return range.min + normalized * (range.max - range.min);
}

function getControlActualValue(id) {
    const range = NormalizedControls[id];
    const input = UI.get(id);
    if (!range) return parseFloat(input?.value || '0');
    const fallback = actualToNormalized(id, range.defaultActual);
    const normalized = input?.value === '' ? fallback : clampNormalized(input?.value);
    return normalizedToActual(id, normalized);
}

function setControlActualValue(id, actualValue) {
    const input = UI.get(id);
    const display = UI.get(`val-${id}`);
    if (!input) return;
    const normalized = formatNormalized(actualToNormalized(id, actualValue));
    input.value = normalized;
    if (display) display.innerText = normalized;
}

function getKeyLightIntensity() {
    return RenderConfig.lighting.keyBaseIntensity * getControlActualValue('light-intensity');
}

function getAmbientLightIntensity() {
    return RenderConfig.lighting.ambientBaseIntensity * getControlActualValue('ambient-intensity');
}

function getOutlineThickness(value = UI.get('outline-size')?.value) {
    return normalizedToActual('outline-size', value);
}

function createOutlineEffect(targetRenderer) {
    return new OutlineEffect(targetRenderer, {
        defaultThickness: getOutlineThickness(),
        defaultColor: RenderConfig.outline.defaultColor,
        defaultAlpha: RenderConfig.outline.defaultAlpha,
        defaultKeepAlive: RenderConfig.outline.defaultKeepAlive
    });
}

function createAmbientSceneLight() {
    return new THREE.AmbientLight(RenderConfig.lighting.color, getAmbientLightIntensity());
}

function createKeySceneLight(distance = RenderConfig.lighting.sceneKeyDistance, options = {}) {
    const light = new THREE.DirectionalLight(RenderConfig.lighting.color, getKeyLightIntensity());
    updateKeyLightPosition(light, distance, options);
    return light;
}

function updateKeyLightPosition(light = dirLight, distance = RenderConfig.lighting.sceneKeyDistance, options = {}) {
    if (!light) return;
    const viewCamera = options.camera || camera;
    if (viewCamera) {
        keyLightWorldDirection.copy(lightVector).applyQuaternion(viewCamera.quaternion).normalize();
    } else {
        keyLightWorldDirection.copy(lightVector);
    }

    if (options.target) {
        keyLightTargetPosition.copy(options.target);
    } else if (controls?.target) {
        keyLightTargetPosition.copy(controls.target);
    } else {
        keyLightTargetPosition.set(0, 0, 0);
    }

    light.position.copy(keyLightTargetPosition).addScaledVector(keyLightWorldDirection, distance);
    light.target.position.copy(keyLightTargetPosition);
    light.target.updateMatrixWorld();
}

function addControlledLighting(targetScene, options = {}) {
    const ambient = createAmbientSceneLight();
    const key = createKeySceneLight(options.keyDistance, {
        camera: options.camera,
        target: options.target
    });
    targetScene.add(ambient);
    targetScene.add(key);
    targetScene.add(key.target);
    return { ambient, key };
}

function syncMainLighting() {
    if (ambientLight) ambientLight.intensity = getAmbientLightIntensity();
    if (dirLight) {
        dirLight.intensity = getKeyLightIntensity();
        updateKeyLightPosition();
    }
}

function applyOutlineThicknessToMaterial(material, thickness) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach(mat => {
        mat.userData.outlineParameters = {
            ...(mat.userData.outlineParameters || {}),
            thickness,
            color: [0, 0, 0],
            alpha: 1.0,
            visible: thickness > 0,
            keepAlive: true
        };
    });
}

function setOutlineThickness(value) {
    const parsed = parseFloat(value);
    const outline = Number.isFinite(parsed) ? parsed : getControlActualValue('outline-size');
    if (!effect) return;
    scene.traverse(object => {
        if (object.isMesh) applyOutlineThicknessToMaterial(object.material, outline);
    });
}

function normalizeHexColor(value, fallback = '#ffffff') {
    const raw = String(value || '').trim();
    const match = raw.match(RegexPatterns.hexColor);
    return match ? `#${match[1].toLowerCase()}` : fallback;
}

function clampColorChannel(value) {
    const parsed = Number(value);
    return Math.min(255, Math.max(0, Number.isFinite(parsed) ? Math.round(parsed) : 0));
}

function clampPercent(value) {
    const parsed = Number(value);
    return Math.min(100, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    return {
        r: parseInt(normalized.slice(1, 3), 16),
        g: parseInt(normalized.slice(3, 5), 16),
        b: parseInt(normalized.slice(5, 7), 16)
    };
}

function rgbToHex(r, g, b) {
    return `#${[r, g, b].map(channel => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl(r, g, b) {
    r = clampColorChannel(r) / 255;
    g = clampColorChannel(g) / 255;
    b = clampColorChannel(b) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }

    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
    h = ((Number(h) % 360) + 360) % 360;
    s = clampPercent(s) / 100;
    l = clampPercent(l) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function parseColorValue(value, mode) {
    const raw = String(value || '').trim();
    if (mode === 'rgb') {
        const parts = raw.match(RegexPatterns.colorNumber);
        return parts && parts.length >= 3 ? rgbToHex(parts[0], parts[1], parts[2]) : null;
    }
    if (mode === 'hsl') {
        const parts = raw.match(RegexPatterns.colorNumber);
        return parts && parts.length >= 3 ? hslToHex(parts[0], parts[1], parts[2]) : null;
    }
    return RegexPatterns.hexColor.test(raw) ? normalizeHexColor(raw) : null;
}

function formatColorValue(hex, mode) {
    const rgb = hexToRgb(hex);
    if (mode === 'rgb') return `${rgb.r},${rgb.g},${rgb.b}`;
    if (mode === 'hsl') {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        return `${hsl.h},${hsl.s}%,${hsl.l}%`;
    }
    return normalizeHexColor(hex).toUpperCase();
}

function setBackgroundColor(hex) {
    const normalized = normalizeHexColor(hex, '#ffffff');
    const input = UI.get('bg-color');
    if (input) input.value = normalized;
    scene.background = new THREE.Color(normalized);
    renderer.setClearColor(0xffffff, 1);
}

function closeColorPicker() {
    const existing = UI.get('color-popover');
    if (existing) existing.style.display = 'none';
    activeColorPickerAnchor = null;
}

function getCanvasDisplaySize() {
    const container = UI.get('canvas-container');
    return {
        width: Math.max(1, Math.round(container?.clientWidth || window.innerWidth)),
        height: Math.max(1, Math.round(container?.clientHeight || window.innerHeight))
    };
}

function getRendererPixelRatio() {
    const maxPixelRatio = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? RenderConfig.renderer.mobileMaxPixelRatio
        : RenderConfig.renderer.maxPixelRatio;
    return Math.min(window.devicePixelRatio || 1, maxPixelRatio);
}

function updateCameraFrustumForDisplay(width, height) {
    const size = (width && height) ? { width, height } : getCanvasDisplaySize();
    const aspect = size.width / size.height;
    const viewWidth = frustumSize * aspect;

    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
}

function positionColorPicker(anchor, popover) {
    if (!anchor || !popover || popover.style.display !== 'block') return;

    const margin = 12;
    const gap = 10;
    const rect = anchor.getBoundingClientRect();
    const pickerWidth = popover.offsetWidth;
    const pickerHeight = popover.offsetHeight;

    let left;
    if (rect.left >= pickerWidth + gap + margin) {
        left = rect.left - pickerWidth - gap;
    } else if (window.innerWidth - rect.right >= pickerWidth + gap + margin) {
        left = rect.right + gap;
    } else {
        left = rect.left + (rect.width / 2) - (pickerWidth / 2);
    }

    let top;
    if (rect.bottom + gap + pickerHeight <= window.innerHeight - margin) {
        top = rect.bottom + gap;
    } else if (rect.top - gap - pickerHeight >= margin) {
        top = rect.top - gap - pickerHeight;
    } else {
        top = Math.min(window.innerHeight - pickerHeight - margin, Math.max(margin, rect.top));
    }

    popover.style.left = `${Math.min(window.innerWidth - pickerWidth - margin, Math.max(margin, left))}px`;
    popover.style.top = `${Math.min(window.innerHeight - pickerHeight - margin, Math.max(margin, top))}px`;
}

function repositionActiveColorPicker() {
    const popover = UI.get('color-popover');
    positionColorPicker(activeColorPickerAnchor, popover);
}

function openColorPicker(anchor, initialHex, onApply) {
    let popover = UI.get('color-popover');
    if (!popover) {
        popover = document.createElement('div');
        popover.id = 'color-popover';
        popover.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <div class="text-sm font-black text-gray-800">Color</div>
            <button type="button" id="color-popover-close" aria-label="Close color picker">x</button>
            </div>
            <div class="color-picker-body">
                <div id="color-swatch-grid" class="grid grid-cols-7 gap-2 mb-3"></div>
                <div class="color-input-row">
                    <div id="color-preview" class="w-10 h-10 shrink-0"></div>
                    <select id="color-mode-select" aria-label="Color input mode">
                        <option value="hex">HEX</option>
                        <option value="rgb">RGB</option>
                        <option value="hsl">HSL</option>
                    </select>
                    <input id="color-value-input" type="text" class="border border-gray-300 rounded-lg font-bold outline-none" spellcheck="false" aria-label="Color value">
                </div>
                <button type="button" id="color-apply" class="btn btn-primary mt-3 py-2">Apply</button>
            </div>
        `;
        document.body.appendChild(popover);
        UI.clear();

        popover.querySelector('#color-popover-close').addEventListener('click', closeColorPicker);
        document.addEventListener('pointerdown', (e) => {
            if (popover.style.display !== 'block') return;
            if (popover.contains(e.target) || e.target.closest('.color-chip')) return;
            closeColorPicker();
        });
    }

    const modeSelect = popover.querySelector('#color-mode-select');
    const valueInput = popover.querySelector('#color-value-input');
    const preview = popover.querySelector('#color-preview');
    const grid = popover.querySelector('#color-swatch-grid');
    let currentHex = normalizeHexColor(initialHex);

    const setPickerColor = (hex) => {
        currentHex = normalizeHexColor(hex, currentHex);
        valueInput.value = formatColorValue(currentHex, modeSelect.value);
        preview.style.background = currentHex;
        grid.querySelectorAll('.color-swatch').forEach(btn => {
            btn.classList.toggle('is-selected', btn.dataset.color === currentHex);
        });
    };

    grid.innerHTML = ColorPalette.map(hex => (
        `<button type="button" class="color-swatch" data-color="${hex}" style="background:${hex}" title="${hex}"></button>`
    )).join('');
    grid.querySelectorAll('.color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            setPickerColor(btn.dataset.color);
            onApply(currentHex);
        });
    });
    modeSelect.onchange = () => {
        valueInput.value = formatColorValue(currentHex, modeSelect.value);
        valueInput.focus();
        valueInput.select();
    };
    valueInput.oninput = () => {
        const normalized = parseColorValue(valueInput.value, modeSelect.value);
        if (normalized) {
            setPickerColor(normalized);
            onApply(currentHex);
        }
    };
    popover.querySelector('#color-apply').onclick = () => {
        setPickerColor(parseColorValue(valueInput.value, modeSelect.value) || currentHex);
        onApply(currentHex);
        closeColorPicker();
    };

    setPickerColor(currentHex);
    popover.style.display = 'block';
    activeColorPickerAnchor = anchor;
    positionColorPicker(anchor, popover);
    valueInput.focus();
    valueInput.select();
}

function normalizeStructureOrigin() {
    if (currentAtomsData.length === 0) return;
    const box = new THREE.Box3().setFromPoints(currentAtomsData.map(atom => atom.pos));
    modelCenter = box.getCenter(new THREE.Vector3());
    for (const atom of currentAtomsData) atom.pos.sub(modelCenter);
}

function getSupercellDims() {
    const readAxis = (id) => {
        const input = UI.get(id);
        const value = Math.round(parseFloat(input?.value || '1'));
        const clamped = Math.min(8, Math.max(1, Number.isFinite(value) ? value : 1));
        if (input) input.value = clamped;
        return clamped;
    };
    return {
        x: readAxis('supercell-x'),
        y: readAxis('supercell-y'),
        z: readAxis('supercell-z')
    };
}

function applySupercell() {
    const dims = getSupercellDims();
    currentBondsData = [];
    if (!baseCell || baseAtomsData.length === 0 || baseAtomsData.some(a => !a.frac)) {
        currentCell = baseCell;
        currentAtomsData = baseAtomsData.map(cloneAtom);
        normalizeStructureOrigin();
        return;
    }

    currentCell = makeCell(
        baseCell.a.clone().multiplyScalar(dims.x),
        baseCell.b.clone().multiplyScalar(dims.y),
        baseCell.c.clone().multiplyScalar(dims.z)
    );

    currentAtomsData = [];
    for (let ix = 0; ix < dims.x; ix++) {
        for (let iy = 0; iy < dims.y; iy++) {
            for (let iz = 0; iz < dims.z; iz++) {
                baseAtomsData.forEach(atom => {
                    const frac = new THREE.Vector3(
                        (atom.frac.x + ix) / dims.x,
                        (atom.frac.y + iy) / dims.y,
                        (atom.frac.z + iz) / dims.z
                    );
                    currentAtomsData.push({
                        element: atom.element,
                        frac,
                        pos: currentCell.fracToCart(frac)
                    });
                });
            }
        }
    }
    normalizeStructureOrigin();
}

function updateStructureStats() {
    const stats = UI.get('structure-stats');
    if (!stats) return;
    const elements = [...new Set(currentAtomsData.map(a => canonicalElement(a.element)))].sort().join(', ');
    stats.textContent = `${currentAtomsData.length} atoms | ${currentBondsData.length} bonds${elements ? ` | ${elements}` : ''}`;
}

function rebuildElementEditor() {
    const container = UI.get('dynamic-elements-ui');
    container.innerHTML = '';

    const uniqueElements = [...new Set(currentAtomsData.map(a => {
        return canonicalElement(a.element);
    }))];

    if (uniqueElements.length === 0) {
        container.innerHTML = '<div class="empty-state">No element data loaded</div>';
        return;
    }

    uniqueElements.forEach(el => {
        if (!ElementData[el]) ElementData[el] = { ...ElementData['default'] };
        const data = ElementData[el];
        const hexColor = "#" + data.color.toString(16).padStart(6, '0');

        const row = document.createElement('div');
        row.className = 'element-row';
        row.innerHTML = `
            <div class="element-symbol">${el}</div>
            <div class="element-radius-control">
                <label title="Bonding radius">R(A)</label>
                <input type="number" step="0.05" min="0.1" max="3.0" class="element-radius-input" value="${data.radius}" title="Change ${el} bonding radius">
            </div>
            <button type="button" class="color-chip element-color-chip !w-9 !h-9 !rounded-md" style="background:${hexColor}" title="Change ${el} color"></button>
        `;

        row.querySelector('.element-color-chip').addEventListener('click', (e) => {
            const chip = e.currentTarget;
            const currentHex = "#" + ElementData[el].color.toString(16).padStart(6, '0');
            openColorPicker(chip, currentHex, (hex) => {
                ElementData[el].color = parseInt(hex.replace('#', '0x'));
                chip.style.background = hex;
                rebuildSceneGraph();
            });
        });

        row.querySelector('.element-color-chip').addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const chip = e.currentTarget;
            const currentHex = "#" + ElementData[el].color.toString(16).padStart(6, '0');
            openColorPicker(chip, currentHex, (hex) => {
                ElementData[el].color = parseInt(hex.replace('#', '0x'));
                chip.style.background = hex;
                rebuildSceneGraph();
            });
        });

        row.querySelector('input[type="number"]').addEventListener('change', (e) => {
            let newRadius = parseFloat(e.target.value);
            if(isNaN(newRadius) || newRadius <= 0) newRadius = 0.1;
            ElementData[el].radius = newRadius;
            refreshBondTopology();
            rebuildSceneGraph();
        });

        container.appendChild(row);
    });
}

function bootCrystalWorkbench() {
    const container = UI.get('canvas-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(UI.get('bg-color').value);

    const canvasSize = getCanvasDisplaySize();
    const aspect = canvasSize.width / canvasSize.height;
    camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2, frustumSize * aspect / 2,
        frustumSize / 2, -frustumSize / 2,
        0.1, 1000
    );
    updateCameraFrustumForDisplay();
    camera.position.set(0, 0, 50);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(canvasSize.width, canvasSize.height);
    renderer.setPixelRatio(getRendererPixelRatio());
    renderer.setClearColor(0xffffff, 1);
    container.appendChild(renderer.domElement);
    setupWebGLContextHandlers();

    effect = createOutlineEffect(renderer);

    const mainLighting = addControlledLighting(scene);
    ambientLight = mainLighting.ambient;
    dirLight = mainLighting.key;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableRotate = true;
    // Native OrbitControls handle free rotation, right-drag panning, and wheel zoom.
    controls.autoRotate = false;
    controls.autoRotateSpeed = 2.0;

    scene.add(atomsGroup);
    scene.add(bondsGroup);
    scene.add(cellGroup);

    seedDemoStructure();
    window.addEventListener('resize', resizeRenderingSurface);
    window.addEventListener('beforeunload', disposeApp);
    attachInterfaceHandlers();
    clock.start();
    renderer.setAnimationLoop(drawFrame);
}

function buildOutlinedAtomMaterial(colorHex) {
    const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(colorHex),
        shininess: RenderConfig.atomMaterial.shininess,
        specular: RenderConfig.atomMaterial.specular
    });
    applyOutlineThicknessToMaterial(material, getOutlineThickness());
    return material;
}

function clearRenderedGroups() {
    const geometries = new Set();
    const materials = new Set();
    [atomsGroup, bondsGroup, cellGroup].forEach(group => {
        group.traverse(object => {
            if (object.geometry && typeof object.geometry.dispose === 'function') geometries.add(object.geometry);
            collectMaterials(object.material, materials);
            collectMaterials(object.userData?.originalMaterial, materials);
        });
        group.clear();
    });
    disposeCollectedResources(geometries, materials);
    selectedBondMeshes = [];
    selectedBondIndex = null;
}

function renderUnitCell() {
    cellGroup.clear();
    if (!currentCell || !UI.get('show-cell')?.checked) return;

    const corners = [
        new THREE.Vector3(0, 0, 0),
        currentCell.a.clone(),
        currentCell.b.clone(),
        currentCell.c.clone(),
        currentCell.a.clone().add(currentCell.b),
        currentCell.a.clone().add(currentCell.c),
        currentCell.b.clone().add(currentCell.c),
        currentCell.a.clone().add(currentCell.b).add(currentCell.c)
    ].map(p => p.sub(modelCenter));

    const edgePairs = [
        [0, 1], [0, 2], [0, 3],
        [1, 4], [1, 5],
        [2, 4], [2, 6],
        [3, 5], [3, 6],
        [4, 7], [5, 7], [6, 7]
    ];
    const points = [];
    edgePairs.forEach(([i, j]) => points.push(corners[i], corners[j]));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x111827, linewidth: 2 });
    cellGroup.add(new THREE.LineSegments(geometry, material));
}

function createRenderCaches(atomScale) {
    const elementStyles = new Map();
    const materials = new Map();
    const styleFor = (element) => {
        const symbol = canonicalElement(element);
        if (!elementStyles.has(symbol)) elementStyles.set(symbol, resolveElementRenderingDefaults(symbol));
        return elementStyles.get(symbol);
    };
    const materialFor = (element) => {
        const symbol = canonicalElement(element);
        if (!materials.has(symbol)) materials.set(symbol, buildOutlinedAtomMaterial(styleFor(symbol).color));
        return materials.get(symbol);
    };
    return { atomScale, styleFor, materialFor };
}

function makeAtomGlyph(atom, sphereGeometry, caches) {
    const mesh = new THREE.Mesh(sphereGeometry, caches.materialFor(atom.element));
    mesh.position.copy(atom.pos);
    mesh.scale.setScalar(caches.styleFor(atom.element).radius * caches.atomScale);
    return mesh;
}

function addBondHalf({ from, to, colorElement, splitStart, splitEnd, radius, cylinderGeometry, caches, quaternion, index }) {
    const length = from.distanceTo(to) * (splitEnd - splitStart);
    if (length <= 1e-8) return;

    const mesh = new THREE.Mesh(cylinderGeometry, caches.materialFor(colorElement));
    mesh.position.copy(from).lerp(to, (splitStart + splitEnd) / 2);
    mesh.scale.set(radius, length, radius);
    mesh.quaternion.copy(quaternion);
    mesh.userData = { isBond: true, bondIndex: index };
    bondsGroup.add(mesh);
}

function rebuildSceneGraph() {
    clearRenderedGroups();
    const atomScale = getControlActualValue('atom-size');
    const bondRadius = getControlActualValue('bond-size');
    const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
    const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 32);
    const caches = createRenderCaches(atomScale);
    const unitY = new THREE.Vector3(0, 1, 0);

    for (const atom of currentAtomsData) atomsGroup.add(makeAtomGlyph(atom, sphereGeo, caches));
    currentBondsData.forEach((bond, index) => {
        const atom1 = currentAtomsData[bond.i];
        const atom2 = currentAtomsData[bond.j];
        const start = atom1.pos;
        const periodicOffset = bond.offset && currentCell
            ? currentCell.offsetToCart(new THREE.Vector3(...bond.offset))
            : new THREE.Vector3();
        const end = atom2.pos.clone().add(periodicOffset);
        const direction = end.clone().sub(start);
        if (direction.lengthSq() < 1e-12) return;

        const radius1 = caches.styleFor(atom1.element).radius * atomScale;
        const radius2 = caches.styleFor(atom2.element).radius * atomScale;
        const split = (radius1 + radius2) > 0 ? radius1 / (radius1 + radius2) : 0.5;
        const quaternion = new THREE.Quaternion().setFromUnitVectors(unitY, direction.normalize());

        addBondHalf({
            from: start,
            to: end,
            colorElement: atom1.element,
            splitStart: 0,
            splitEnd: split,
            radius: bondRadius,
            cylinderGeometry: cylinderGeo,
            caches,
            quaternion,
            index
        });
        addBondHalf({
            from: start,
            to: end,
            colorElement: atom2.element,
            splitStart: split,
            splitEnd: 1,
            radius: bondRadius,
            cylinderGeometry: cylinderGeo,
            caches,
            quaternion,
            index
        });
    });

    renderUnitCell();
    updateStructureStats();
}

function getBondVector(atomA, atomB) {
    return {
        distance: atomA.pos.distanceTo(atomB.pos),
        offset: [0, 0, 0]
    };
}

function refreshBondTopology() {
    currentBondsData = [];
    const tolerance = getControlActualValue('bond-tol');
    const minDistance = 0.4;

    currentAtomsData.forEach((atomA, i) => {
        const styleA = resolveElementRenderingDefaults(atomA.element);
        for (let j = i + 1; j < currentAtomsData.length; j += 1) {
            const atomB = currentAtomsData[j];
            const cutoff = (styleA.radius + resolveElementRenderingDefaults(atomB.element).radius) * tolerance;
            const candidate = getBondVector(atomA, atomB);
            if (candidate.distance <= minDistance || candidate.distance >= cutoff) continue;
            currentBondsData.push({ i, j, offset: candidate.offset });
        }
    });
    updateStructureStats();
}

function cartToFrac(pos, cell) {
    const matrix = new THREE.Matrix3().set(
        cell.a.x, cell.b.x, cell.c.x,
        cell.a.y, cell.b.y, cell.c.y,
        cell.a.z, cell.b.z, cell.c.z
    );
    return pos.clone().applyMatrix3(matrix.invert());
}

function tokenizeCifLine(line) {
    const withoutComment = line.replace(RegexPatterns.cifLineComment, '');
    const tokens = [];
    const re = RegexPatterns.cifToken;
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(withoutComment)) !== null) {
        tokens.push(match[1] ?? match[2] ?? match[3]);
    }
    return tokens;
}

function firstNumbers(line) {
    return (line.match(RegexPatterns.firstNumber) || []).map(Number);
}

function parseVESTA(content) {
    const lines = content.split(RegexPatterns.lineBreak);
    let cellParams = null;
    let inCell = false;
    let inStruc = false;
    const atoms = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        if (line === 'CELLP') {
            inCell = true;
            inStruc = false;
            continue;
        }
        if (line === 'STRUC') {
            inStruc = true;
            inCell = false;
            continue;
        }
        if (RegexPatterns.vestaSection.test(line) && line !== 'CELLP' && line !== 'STRUC') {
            inCell = false;
            inStruc = false;
        }

        if (inCell && !cellParams) {
            const nums = firstNumbers(line);
            if (nums.length >= 6) {
                cellParams = nums.slice(0, 6);
                baseCell = buildCellFromLengthsAngles(...cellParams);
            }
            continue;
        }

        if (!inStruc) continue;

        const tokens = line.split(RegexPatterns.whitespace);
        if (tokens.length < 7) continue;
        const id = parseInt(tokens[0], 10);
        if (!Number.isFinite(id) || id <= 0) continue;

        const element = canonicalElement(tokens[1]);
        if (element === 'X') continue;

        let coords = null;
        if ([tokens[4], tokens[5], tokens[6]].every(v => Number.isFinite(parseFloat(v)))) {
            coords = tokens.slice(4, 7).map(Number);
        } else if ([tokens[3], tokens[4], tokens[5]].every(v => Number.isFinite(parseFloat(v)))) {
            coords = tokens.slice(3, 6).map(Number);
        } else {
            const nums = firstNumbers(line);
            if (nums.length >= 5) coords = nums.slice(2, 5);
        }

        if (!coords || coords.some(v => !Number.isFinite(v))) continue;
        const frac = new THREE.Vector3(
            ((coords[0] % 1) + 1) % 1,
            ((coords[1] % 1) + 1) % 1,
            ((coords[2] % 1) + 1) % 1
        );
        atoms.push({ element, frac, pos: null });
    }

    if (!baseCell) throw new Error('Unsupported VESTA file: CELLP cell parameters were not found');
    if (atoms.length === 0) throw new Error('Unsupported VESTA file: STRUC atoms were not found');

    atoms.forEach(atom => {
        atom.pos = baseCell.fracToCart(atom.frac);
    });
    return atoms;
}

function parseVaspText(content) {
    const records = content
        .split(RegexPatterns.lineBreak)
        .map(line => line.trim())
        .filter(Boolean);
    if (records.length < 8) throw new Error('Invalid POSCAR/VASP file');

    const fields = (index) => records[index]?.split(RegexPatterns.whitespace) ?? [];
    const parseVector = (index) => {
        const values = fields(index).slice(0, 3).map(Number);
        if (values.length !== 3 || values.some(value => !Number.isFinite(value))) {
            throw new Error(`Invalid lattice vector at POSCAR line ${index + 1}`);
        }
        return new THREE.Vector3(values[0], values[1], values[2]);
    };

    const scaleValue = parseFloat(fields(1)[0]);
    const latticeScale = Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
    baseCell = makeCell(
        parseVector(2).multiplyScalar(latticeScale),
        parseVector(3).multiplyScalar(latticeScale),
        parseVector(4).multiplyScalar(latticeScale)
    );

    const fifthLine = fields(5);
    const hasElementLine = fifthLine.some(token => Number.isNaN(Number.parseInt(token, 10)));
    const elements = hasElementLine
        ? fifthLine.map(canonicalElement)
        : fifthLine.map((_, index) => `X${index + 1}`);
    const countLineIndex = hasElementLine ? 6 : 5;
    const counts = fields(countLineIndex).map(value => Number.parseInt(value, 10));
    if (counts.length === 0 || counts.some(count => !Number.isFinite(count) || count < 0)) {
        throw new Error('Invalid POSCAR/VASP atom counts');
    }

    let coordinateModeIndex = countLineIndex + 1;
    if (/^s/i.test(fields(coordinateModeIndex)[0] ?? '')) coordinateModeIndex += 1;
    const directCoordinates = /^d/i.test(fields(coordinateModeIndex)[0] ?? '');
    let coordinateLine = coordinateModeIndex + 1;
    const atoms = [];

    for (const [elementIndex, element] of elements.entries()) {
        const atomCount = counts[elementIndex] ?? 0;
        for (let n = 0; n < atomCount; n += 1) {
            const xyz = fields(coordinateLine++).slice(0, 3).map(Number);
            if (xyz.length !== 3 || xyz.some(value => !Number.isFinite(value))) {
                throw new Error(`Invalid POSCAR/VASP coordinate near line ${coordinateLine}`);
            }

            let frac = new THREE.Vector3(xyz[0], xyz[1], xyz[2]);
            let pos = baseCell.fracToCart(frac);
            if (!directCoordinates) {
                pos = new THREE.Vector3(xyz[0], xyz[1], xyz[2]).multiplyScalar(latticeScale);
                frac = cartToFrac(pos, baseCell);
            }
            atoms.push({ element: canonicalElement(element), pos, frac });
        }
    }
    return atoms;
}

function parseCifText(content) {
    const cell = {
        a: 1,
        b: 1,
        c: 1,
        alpha: 90,
        beta: 90,
        gamma: 90
    };
    const atomRows = [];
    let activeHeaders = [];
    let atomHeaders = [];

    const cellFieldMap = new Map([
        ['_cell_length_a', 'a'],
        ['_cell_length_b', 'b'],
        ['_cell_length_c', 'c'],
        ['_cell_angle_alpha', 'alpha'],
        ['_cell_angle_beta', 'beta'],
        ['_cell_angle_gamma', 'gamma']
    ]);

    for (const rawLine of content.split(RegexPatterns.lineBreak)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const tokens = tokenizeCifLine(line);
        const keyword = tokens[0]?.toLowerCase();
        if (cellFieldMap.has(keyword)) {
            cell[cellFieldMap.get(keyword)] = parseCifNumber(tokens[1]);
            continue;
        }

        if (keyword === 'loop_') {
            activeHeaders = [];
            continue;
        }

        if (keyword?.startsWith('_')) {
            if (keyword.startsWith('_atom_site_')) activeHeaders.push(keyword);
            else activeHeaders = [];
            continue;
        }

        if (activeHeaders.length === 0 || tokens.length < activeHeaders.length) continue;
        atomHeaders = activeHeaders.slice();
        atomRows.push(tokens);
    }

    baseCell = buildCellFromLengthsAngles(cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma);
    const fieldIndex = (needle) => atomHeaders.findIndex(header => header.includes(needle));
    const elementIndex = fieldIndex('type_symbol') !== -1 ? fieldIndex('type_symbol') : fieldIndex('label');
    const coordIndexes = ['fract_x', 'fract_y', 'fract_z'].map(fieldIndex);
    if (elementIndex === -1 || coordIndexes.some(index => index === -1)) {
        throw new Error('Unsupported CIF: atom symbols or fractional coordinates were not found');
    }

    return atomRows.map(row => {
        const frac = new THREE.Vector3(
            parseCifNumber(row[coordIndexes[0]]),
            parseCifNumber(row[coordIndexes[1]]),
            parseCifNumber(row[coordIndexes[2]])
        );
        return {
            element: canonicalElement(row[elementIndex]),
            frac,
            pos: baseCell.fracToCart(frac)
        };
    });
}

// ---------- Centering and camera reset ----------
function frameActiveStructure() {
    if (currentAtomsData.length === 0) return;

    const bounds = new THREE.Box3().setFromPoints(currentAtomsData.map(atom => atom.pos));
    const extents = bounds.getSize(new THREE.Vector3());
    const longestEdge = Math.max(extents.x, extents.y, extents.z);
    atomsGroup.position.set(0, 0, 0);
    bondsGroup.position.set(0, 0, 0);
    cellGroup.position.set(0, 0, 0);

    if (longestEdge > 0) camera.zoom = frustumSize / (longestEdge * 1.4);
    updateCameraFrustumForDisplay();

    const viewDirection = camera.position.clone().sub(controls.target);
    if (viewDirection.lengthSq() < 1e-6) viewDirection.set(0, 0, 1);
    camera.position.copy(viewDirection.normalize().multiplyScalar(50));
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
}

function resetModelRotation() {
    atomsGroup.quaternion.identity();
    bondsGroup.quaternion.identity();
    cellGroup.quaternion.identity();
}

function rotateModel(axis, angle) {
    if (!axis || axis.lengthSq() < 1e-10 || Math.abs(angle) < 1e-8) return;
    const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
    atomsGroup.quaternion.premultiply(q);
    bondsGroup.quaternion.premultiply(q);
    cellGroup.quaternion.premultiply(q);
}

function setCameraFromDirection(direction, preferredUp = new THREE.Vector3(0, 0, 1), rollDeg = 0) {
    if (!direction || direction.lengthSq() < 1e-10) return;
    resetModelRotation();

    const viewDir = direction.clone().normalize();
    let up = preferredUp.clone();
    if (Math.abs(up.normalize().dot(viewDir)) > 0.98) {
        up = Math.abs(viewDir.dot(new THREE.Vector3(0, 1, 0))) > 0.98
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 1, 0);
    }
    up.sub(viewDir.clone().multiplyScalar(up.dot(viewDir))).normalize();

    if (rollDeg !== 0) {
        up.applyAxisAngle(viewDir, THREE.MathUtils.degToRad(rollDeg)).normalize();
    }

    camera.position.copy(viewDir.multiplyScalar(50));
    camera.up.copy(up);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    frameActiveStructure();
}

function snapCameraToAxis(axis) {
    const presets = {
        x: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
        y: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
        z: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]
    };
    const preset = presets[axis];
    if (preset) setCameraFromDirection(preset[0], preset[1]);
}

function applyXyzView() {
    const rx = THREE.MathUtils.degToRad(parseFloat(UI.get('view-x')?.value) || 0);
    const ry = THREE.MathUtils.degToRad(parseFloat(UI.get('view-y')?.value) || 0);
    const rz = THREE.MathUtils.degToRad(parseFloat(UI.get('view-z')?.value) || 0);
    const rotation = new THREE.Euler(rx, ry, rz, 'XYZ');
    const direction = new THREE.Vector3(0, 0, 1).applyEuler(rotation);
    const up = new THREE.Vector3(0, 1, 0).applyEuler(rotation);
    setCameraFromDirection(direction, up);
}

function getReciprocalBasis(cell) {
    const volume = cell.a.dot(cell.b.clone().cross(cell.c));
    if (Math.abs(volume) < 1e-8) return null;
    return {
        a: cell.b.clone().cross(cell.c).divideScalar(volume),
        b: cell.c.clone().cross(cell.a).divideScalar(volume),
        c: cell.a.clone().cross(cell.b).divideScalar(volume)
    };
}

function applyHklView() {
    const h = parseFloat(UI.get('view-h')?.value) || 0;
    const k = parseFloat(UI.get('view-k')?.value) || 0;
    const l = parseFloat(UI.get('view-l')?.value) || 0;
    if (h === 0 && k === 0 && l === 0) {
        alert('Please enter a non-zero hkl direction.');
        return;
    }
    if (!currentCell) {
        alert('Load a crystal structure with unit-cell data before using hkl view.');
        return;
    }
    const reciprocal = getReciprocalBasis(currentCell);
    if (!reciprocal) {
        alert('Cannot compute reciprocal cell for the current structure.');
        return;
    }
    const direction = new THREE.Vector3()
        .addScaledVector(reciprocal.a, h)
        .addScaledVector(reciprocal.b, k)
        .addScaledVector(reciprocal.c, l);
    const preferredUp = Math.abs(direction.clone().normalize().dot(currentCell.c.clone().normalize())) > 0.95
        ? currentCell.b
        : currentCell.c;
    setCameraFromDirection(direction, preferredUp);
}

function resizeRenderingSurface() {
    const canvasSize = getCanvasDisplaySize();
    updateCameraFrustumForDisplay(canvasSize.width, canvasSize.height);
    renderer.setPixelRatio(getRendererPixelRatio());
    renderer.setSize(canvasSize.width, canvasSize.height);
    if(effect) effect.setSize(canvasSize.width, canvasSize.height);
    repositionActiveColorPicker();
}

function setupWebGLContextHandlers() {
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        isWebGlContextLost = true;
        renderer.setAnimationLoop(null);
        UI.get('loading-overlay')?.classList.remove('hidden');
        console.warn('WebGL context lost. Rendering paused until the browser restores it.');
    });

    renderer.domElement.addEventListener('webglcontextrestored', () => {
        isWebGlContextLost = false;
        UI.get('loading-overlay')?.classList.add('hidden');
        clearRenderedGroups();
        rebuildSceneGraph();
        clock.start();
        renderer.setAnimationLoop(drawFrame);
        console.info('WebGL context restored. Scene resources were rebuilt.');
    });
}

function drawFrame() {
    if (isWebGlContextLost) return;
    const delta = clock.getDelta();
    controls.update(delta);
    updateKeyLightPosition();
    updateAxisWidget();
    effect.render(scene, camera);
}

function disposeApp() {
    renderer?.setAnimationLoop(null);
    clearRenderedGroups();
    controls?.dispose();
    renderer?.dispose();
}

function updateAxisWidget() {
    if (!camera || !atomsGroup) return;
    const origin = { x: 58, y: 58 };
    const axisLength = 32;
    const backLength = 14;
    const cameraInverse = camera.quaternion.clone().invert();
    const clampLabel = (value) => Math.min(103, Math.max(13, value));
    [
        { id: 'axis-x', vector: new THREE.Vector3(1, 0, 0), fallback: { x: 1, y: 0 } },
        { id: 'axis-y', vector: new THREE.Vector3(0, 1, 0), fallback: { x: 0, y: -1 } },
        { id: 'axis-z', vector: new THREE.Vector3(0, 0, 1), fallback: { x: 1, y: 1 } }
    ].forEach(axis => {
        const local = axis.vector
            .applyQuaternion(atomsGroup.quaternion)
            .applyQuaternion(cameraInverse)
            .normalize();
        const projectedLength = Math.hypot(local.x, local.y);
        const fallbackScale = projectedLength < 0.12 ? 8 : axisLength;
        const visualX = projectedLength < 0.12 ? axis.fallback.x : local.x;
        const visualY = projectedLength < 0.12 ? axis.fallback.y : -local.y;
        const labelOffset = projectedLength < 0.12 ? 16 : 10;
        const endX = origin.x + visualX * fallbackScale;
        const endY = origin.y + visualY * fallbackScale;
        const backX = origin.x - visualX * backLength;
        const backY = origin.y - visualY * backLength;
        const labelX = clampLabel(endX + visualX * labelOffset);
        const labelY = clampLabel(endY + visualY * labelOffset);
        const frontOpacity = (0.58 + Math.max(0, local.z) * 0.42).toFixed(2);
        const group = UI.get(axis.id);
        if (!group) return;
        const line = group.querySelector('.axis-line');
        const back = group.querySelector('.axis-back');
        const dot = group.querySelector('.axis-dot');
        const label = group.querySelector('text');
        back.setAttribute('x1', origin.x);
        back.setAttribute('y1', origin.y);
        back.setAttribute('x2', backX.toFixed(1));
        back.setAttribute('y2', backY.toFixed(1));
        line.setAttribute('x1', origin.x);
        line.setAttribute('y1', origin.y);
        line.setAttribute('x2', endX.toFixed(1));
        line.setAttribute('y2', endY.toFixed(1));
        line.style.opacity = frontOpacity;
        dot.setAttribute('cx', endX.toFixed(1));
        dot.setAttribute('cy', endY.toFixed(1));
        dot.style.opacity = frontOpacity;
        label.setAttribute('x', labelX.toFixed(1));
        label.setAttribute('y', labelY.toFixed(1));
        label.style.opacity = frontOpacity;
    });
}

function renderLightPad() {
    const canvas = UI.get('light-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    const r = w / 2 - 9; const cx = w / 2; const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    const padGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, r + 8);
    padGrad.addColorStop(0, '#ffffff');
    padGrad.addColorStop(1, '#eef2f7');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = padGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = '#dbe3ee';
    ctx.lineWidth = 1;
    [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + x * r, cy + y * r);
        ctx.stroke();
    });
    [0.45, 0.72].forEach(scale => {
        ctx.beginPath();
        ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#64748b';
    ctx.fill();

    const lx = cx + lightVector.x * r;
    const ly = cy - lightVector.y * r;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(lx, ly);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2563eb';
    ctx.stroke();

    const glow = ctx.createRadialGradient(lx - 2, ly - 2, 1, lx, ly, 10);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.35, '#fde68a');
    glow.addColorStop(1, '#f59e0b');
    ctx.beginPath();
    ctx.arc(lx, ly, 8, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#b45309';
    ctx.stroke();
}

function uniqueCurrentElements() {
    return [...new Set(currentAtomsData.map(atom => canonicalElement(atom.element)))].sort();
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Could not create PNG blob'));
        }, 'image/png', 1.0);
    });
}

async function renderElementAtomPngs(elements) {
    const size = RenderConfig.atomPreview.size;
    const offRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    offRenderer.setPixelRatio(RenderConfig.atomPreview.pixelRatio);
    offRenderer.setSize(size, size, false);
    offRenderer.setClearColor(0x000000, 0);

    const offEffect = createOutlineEffect(offRenderer);
    const offCamera = new THREE.OrthographicCamera(
        -2.4,
        2.4,
        2.4,
        -2.4,
        RenderConfig.atomPreview.near,
        RenderConfig.atomPreview.far
    );
    offCamera.position.set(0, 0, RenderConfig.atomPreview.cameraZ);
    offCamera.lookAt(0, 0, 0);

    const atomScale = getControlActualValue('atom-size');
    const sphereGeo = new THREE.SphereGeometry(
        1,
        RenderConfig.atomPreview.sphereSegments,
        RenderConfig.atomPreview.sphereSegments
    );
    const results = [];
    const atomPreviewLightTarget = new THREE.Vector3(0, 0, 0);

    for (const element of elements) {
        const displayRadius = resolveElementRenderingDefaults(element).radius * atomScale;
        const frame = Math.max(
            RenderConfig.atomPreview.minFrame,
            displayRadius * RenderConfig.atomPreview.radiusFrameScale
        );
        offCamera.left = -frame;
        offCamera.right = frame;
        offCamera.top = frame;
        offCamera.bottom = -frame;
        offCamera.updateProjectionMatrix();

        const offScene = new THREE.Scene();
        offScene.background = null;
        addControlledLighting(offScene, {
            keyDistance: RenderConfig.lighting.atomPreviewKeyDistance,
            camera: offCamera,
            target: atomPreviewLightTarget
        });

        const material = buildOutlinedAtomMaterial(resolveElementRenderingDefaults(element).color);
        const mesh = new THREE.Mesh(sphereGeo, material);
        mesh.scale.setScalar(displayRadius);
        offScene.add(mesh);

        offEffect.render(offScene, offCamera);
        results.push({
            name: `atom_${element}.png`,
            blob: await canvasToBlob(offRenderer.domElement)
        });

        material.dispose();
    }

    sphereGeo.dispose();
    offRenderer.dispose();
    return results;
}

function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
}

const Crc32Table = makeCrc32Table();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = Crc32Table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: dosDate };
}

function appendU16(parts, value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    parts.push(bytes);
}

function appendU32(parts, value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    parts.push(bytes);
}

async function createStoredZip(files) {
    const encoder = new TextEncoder();
    const now = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const data = new Uint8Array(await file.blob.arrayBuffer());
        const name = encoder.encode(file.name);
        const checksum = crc32(data);

        const local = [];
        appendU32(local, 0x04034b50);
        appendU16(local, 20);
        appendU16(local, 0x0800);
        appendU16(local, 0);
        appendU16(local, now.time);
        appendU16(local, now.date);
        appendU32(local, checksum);
        appendU32(local, data.length);
        appendU32(local, data.length);
        appendU16(local, name.length);
        appendU16(local, 0);
        local.push(name, data);
        localParts.push(...local);

        const central = [];
        appendU32(central, 0x02014b50);
        appendU16(central, 20);
        appendU16(central, 20);
        appendU16(central, 0x0800);
        appendU16(central, 0);
        appendU16(central, now.time);
        appendU16(central, now.date);
        appendU32(central, checksum);
        appendU32(central, data.length);
        appendU32(central, data.length);
        appendU16(central, name.length);
        appendU16(central, 0);
        appendU16(central, 0);
        appendU16(central, 0);
        appendU16(central, 0);
        appendU32(central, 0);
        appendU32(central, offset);
        central.push(name);
        centralParts.push(...central);

        offset += 30 + name.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = [];
    appendU32(end, 0x06054b50);
    appendU16(end, 0);
    appendU16(end, 0);
    appendU16(end, files.length);
    appendU16(end, files.length);
    appendU32(end, centralSize);
    appendU32(end, offset);
    appendU16(end, 0);

    return new Blob([...localParts, ...centralParts, ...end], { type: 'application/zip' });
}

async function exportElementAtomZip() {
    const elements = uniqueCurrentElements();
    if (elements.length === 0) {
        alert('No elements are loaded yet.');
        return;
    }

    const button = UI.get('btn-export-elements');
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="ph ph-spinner-gap text-xl"></i> Exporting...';
    try {
        const pngFiles = await renderElementAtomPngs(elements);
        const zipBlob = await createStoredZip(pngFiles);
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'element_atom_renders.zip';
        link.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        alert(`Failed to export element atom images: ${err.message}`);
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

function parseStructureFile(filename, content) {
    const normalizedName = String(filename || '').toLowerCase();
    if (normalizedName.endsWith('.cif')) return parseCifText(content);
    if (normalizedName.endsWith('.vesta')) return parseVESTA(content);
    return parseVaspText(content);
}

function resetLoadedStructureControls() {
    setControlActualValue('atom-size', NormalizedControls['atom-size'].defaultActual);
    setControlActualValue('bond-size', NormalizedControls['bond-size'].defaultActual);
}

function refreshStructureAfterDataChange({ updateElements = false, resetView = false } = {}) {
    applySupercell();
    if (updateElements) rebuildElementEditor();
    refreshBondTopology();
    rebuildSceneGraph();
    if (resetView) {
        resetModelRotation();
        frameActiveStructure();
    }
}

function bindNormalizedInput(id, callback) {
    const input = UI.get(id);
    const valDisplay = UI.get(`val-${id}`);
    if (!input) return;

    const sync = () => {
        const fallback = actualToNormalized(id, NormalizedControls[id].defaultActual);
        const normalized = formatNormalized(input.value === '' ? fallback : input.value);
        input.value = normalized;
        if (valDisplay) valDisplay.innerText = normalized;
        callback(getControlActualValue(id));
    };

    sync();
    input.addEventListener('change', sync);
    input.addEventListener('input', () => {
        const normalized = clampNormalized(input.value);
        if (valDisplay) valDisplay.innerText = formatNormalized(normalized);
        callback(getControlActualValue(id));
    });
}

function bindPanelScrollReposition() {
    UI.get('ui-container')?.addEventListener('scroll', repositionActiveColorPicker, { passive: true });
    UI.get('dynamic-elements-ui')?.addEventListener('scroll', repositionActiveColorPicker, { passive: true });
}

function bindRenderControls() {
    bindNormalizedInput('atom-size', rebuildSceneGraph);
    bindNormalizedInput('bond-size', rebuildSceneGraph);
    bindNormalizedInput('bond-tol', () => {
        refreshBondTopology();
        rebuildSceneGraph();
    });
    bindNormalizedInput('outline-size', setOutlineThickness);
}

function bindHelpPopover() {
    const helpButton = UI.get('btn-help');
    const helpPopover = UI.get('help-popover');
    if (!helpButton || !helpPopover) return;

    const setHelpOpen = (isOpen) => {
        helpPopover.classList.toggle('is-open', isOpen);
        helpButton.setAttribute('aria-expanded', String(isOpen));
    };

    helpButton.addEventListener('click', (e) => {
        e.stopPropagation();
        setHelpOpen(!helpPopover.classList.contains('is-open'));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setHelpOpen(false);
    });
    UI.get('canvas-container')?.addEventListener('pointerdown', () => setHelpOpen(false));
}

function setViewInputMode(mode) {
    const isXyz = mode === 'xyz';
    UI.get('view-mode-xyz-panel')?.classList.toggle('is-active', isXyz);
    UI.get('view-mode-hkl-panel')?.classList.toggle('is-active', !isXyz);
}

function isEditingTarget(target) {
    const tag = target?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
}

function bindViewControls() {
    UI.get('btn-view-mode-xyz')?.addEventListener('click', () => setViewInputMode('xyz'));
    UI.get('btn-view-mode-hkl')?.addEventListener('click', () => setViewInputMode('hkl'));
    UI.get('btn-view-xyz')?.addEventListener('click', applyXyzView);
    UI.get('btn-view-hkl')?.addEventListener('click', applyHklView);

    document.addEventListener('keydown', (e) => {
        if (isEditingTarget(e.target)) return;
        const key = e.key.toLowerCase();
        if (!ViewShortcutKeys.has(key)) return;
        snapCameraToAxis(key);
        e.preventDefault();
    });

    ViewAngleInputIds.forEach(id => UI.get(id)?.addEventListener('change', applyXyzView));
    UI.get('show-cell')?.addEventListener('change', rebuildSceneGraph);
    SupercellInputIds.forEach(id => {
        UI.get(id)?.addEventListener('change', () => {
            refreshStructureAfterDataChange({ updateElements: true, resetView: true });
        });
    });
}

function bindLightControls() {
    const lightCanvas = UI.get('light-canvas');
    if (!lightCanvas) return;

    const updateLightDirectionFromPointer = (e) => {
        if (e.buttons !== 1) return;
        const rect = lightCanvas.getBoundingClientRect();
        const cx = lightCanvas.width / 2;
        const cy = lightCanvas.height / 2;
        const r = lightCanvas.width / 2 - 9;
        let mx = e.clientX - rect.left - cx;
        let my = e.clientY - rect.top - cy;
        const dist = Math.sqrt(mx * mx + my * my);
        if (dist > r) {
            mx = (mx / dist) * r;
            my = (my / dist) * r;
        }
        const z = Math.sqrt(Math.max(0, r * r - mx * mx - my * my));
        lightVector.set(mx / r, -my / r, z / r).normalize();
        updateKeyLightPosition();
        renderLightPad();
    };

    renderLightPad();
    bindNormalizedInput('light-intensity', syncMainLighting);
    bindNormalizedInput('ambient-intensity', syncMainLighting);
    lightCanvas.addEventListener('mousedown', updateLightDirectionFromPointer);
    lightCanvas.addEventListener('mousemove', updateLightDirectionFromPointer);
}

function clearBondSelection() {
    selectedBondMeshes.forEach(mesh => {
        if (mesh.userData.originalMaterial) mesh.material = mesh.userData.originalMaterial;
    });
    selectedBondMeshes = [];
    selectedBondIndex = null;
}

function selectBondByIndex(bondIndex) {
    selectedBondIndex = bondIndex;
    bondsGroup.children.forEach(mesh => {
        if (mesh.userData.bondIndex !== selectedBondIndex) return;
        mesh.userData.originalMaterial = mesh.material;
        mesh.material = mesh.material.clone();
        mesh.material.emissive.setHex(0xaa3333);
        selectedBondMeshes.push(mesh);
    });
}

function bindBondPicking() {
    const mouseDownPos = new THREE.Vector2();
    const pointerUpPos = new THREE.Vector2();

    renderer.domElement.addEventListener('pointerdown', (e) => {
        mouseDownPos.set(e.clientX, e.clientY);
    });

    renderer.domElement.addEventListener('pointerup', (e) => {
        pointerUpPos.set(e.clientX, e.clientY);
        if (mouseDownPos.distanceTo(pointerUpPos) > 5) return;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(bondsGroup.children);
        clearBondSelection();

        if (intersects.length === 0) return;
        const object = intersects[0].object;
        if (object.userData.isBond) selectBondByIndex(object.userData.bondIndex);
    });

    renderer.domElement.addEventListener('pointercancel', () => {
        mouseDownPos.set(-9999, -9999);
    });
}

function bindDeletionShortcut() {
    window.addEventListener('keydown', (e) => {
        if (isEditingTarget(e.target)) return;
        if ((e.key !== 'Delete' && e.key !== 'Backspace') || selectedBondIndex === null) return;
        currentBondsData.splice(selectedBondIndex, 1);
        clearBondSelection();
        rebuildSceneGraph();
    });
}

function bindFileControls() {
    UI.get('btn-open-file')?.addEventListener('click', () => UI.get('file-input')?.click());
    UI.get('file-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const loader = UI.get('loading-overlay');
        if (loader) loader.style.display = 'flex';

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                baseCell = null;
                currentCell = null;
                baseAtomsData = parseStructureFile(file.name, event.target.result);
                resetLoadedStructureControls();
                refreshStructureAfterDataChange({ updateElements: true, resetView: true });
            } catch (err) {
                alert("Failed to parse file: " + err.message);
                console.error(err);
            } finally {
                if (loader) loader.style.display = 'none';
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    });
}

function setExportModalOpen(isOpen) {
    const exportModal = UI.get('export-modal');
    exportModal?.classList.toggle('is-open', isOpen);
    if (isOpen) UI.get('export-scale')?.focus();
}

function exportStructurePng(scale, transparentExport) {
    const displaySize = renderer.getSize(new THREE.Vector2());
    const originalPixelRatio = renderer.getPixelRatio();
    const originalStyleWidth = renderer.domElement.style.width;
    const originalStyleHeight = renderer.domElement.style.height;
    const originalSceneBackground = scene.background?.clone ? scene.background.clone() : scene.background;
    const originalClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const originalClearAlpha = renderer.getClearAlpha();
    const cameraState = {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
        zoom: camera.zoom,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        up: camera.up.clone(),
        target: controls.target.clone()
    };

    const width = Math.round(displaySize.x * scale);
    const height = Math.round(displaySize.y * scale);

    try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        effect.setSize(width, height);
        if (transparentExport) {
            scene.background = null;
            renderer.setClearColor(0x000000, 0);
        } else {
            scene.background = new THREE.Color('#ffffff');
            renderer.setClearColor(0xffffff, 1);
        }

        const aspect = width / height;
        camera.left = -frustumSize * aspect / 2;
        camera.right = frustumSize * aspect / 2;
        camera.top = frustumSize / 2;
        camera.bottom = -frustumSize / 2;
        camera.updateProjectionMatrix();

        updateKeyLightPosition();
        effect.render(scene, camera);
        const link = document.createElement('a');
        link.download = 'structure_cartoon_export.png';
        link.href = renderer.domElement.toDataURL('image/png', 1.0);
        link.click();
    } finally {
        scene.background = originalSceneBackground;
        renderer.setClearColor(originalClearColor, originalClearAlpha);
        renderer.setPixelRatio(originalPixelRatio);
        renderer.setSize(displaySize.x, displaySize.y, false);
        effect.setSize(displaySize.x, displaySize.y);
        renderer.domElement.style.width = originalStyleWidth;
        renderer.domElement.style.height = originalStyleHeight;

        camera.left = cameraState.left;
        camera.right = cameraState.right;
        camera.top = cameraState.top;
        camera.bottom = cameraState.bottom;
        camera.zoom = cameraState.zoom;
        camera.position.copy(cameraState.position);
        camera.quaternion.copy(cameraState.quaternion);
        camera.up.copy(cameraState.up);
        controls.target.copy(cameraState.target);
        camera.updateProjectionMatrix();
        controls.update();
        updateKeyLightPosition();
        effect.render(scene, camera);
    }
}

function bindExportControls() {
    UI.get('btn-export-elements')?.addEventListener('click', exportElementAtomZip);
    UI.get('btn-export')?.addEventListener('click', () => setExportModalOpen(true));
    UI.get('export-modal-close')?.addEventListener('click', () => setExportModalOpen(false));
    UI.get('export-modal-cancel')?.addEventListener('click', () => setExportModalOpen(false));
    UI.get('export-modal')?.addEventListener('pointerdown', (e) => {
        if (e.target === UI.get('export-modal')) setExportModalOpen(false);
    });
    UI.get('export-modal-ok')?.addEventListener('click', () => {
        const scaleInput = UI.get('export-scale');
        const rawScale = parseInt(scaleInput?.value, 10);
        const scale = Math.min(4, Math.max(1, Number.isFinite(rawScale) ? rawScale : 2));
        const transparentExport = Boolean(UI.get('bg-transparent')?.checked);
        if (scaleInput) scaleInput.value = scale;
        setExportModalOpen(false);
        exportStructurePng(scale, transparentExport);
    });
}

function attachInterfaceHandlers() {
    bindPanelScrollReposition();
    bindRenderControls();
    bindHelpPopover();
    bindViewControls();
    bindLightControls();
    bindBondPicking();
    bindDeletionShortcut();
    bindFileControls();
    bindExportControls();
}

function seedDemoStructure() {
    const demoCell = {
        lengths: [10.23619605, 5.97075510, 4.65491719],
        angles: [90, 90, 90]
    };
    baseCell = buildCellFromLengthsAngles(...demoCell.lengths, ...demoCell.angles);
    currentCell = null;

    const demoSites = [
        ['Li', 0.00000000, 0.00000000, 0.00000000],
        ['Li', 0.00000000, 0.50000000, 0.00000000],
        ['Li', 0.50000000, 0.00000000, 0.50000000],
        ['Li', 0.50000000, 0.50000000, 0.50000000],
        ['Fe', 0.21884873, 0.25000000, 0.52986573],
        ['Fe', 0.28115127, 0.75000000, 0.02986573],
        ['Fe', 0.71884873, 0.25000000, 0.97013427],
        ['Fe', 0.78115127, 0.75000000, 0.47013427],
        ['P', 0.09386630, 0.75000000, 0.58137743],
        ['P', 0.40613370, 0.25000000, 0.08137743],
        ['P', 0.59386630, 0.75000000, 0.91862257],
        ['P', 0.90613370, 0.25000000, 0.41862257],
        ['O', 0.04430856, 0.25000000, 0.29013555],
        ['O', 0.09423067, 0.75000000, 0.25521344],
        ['O', 0.16584548, 0.54555803, 0.71373534],
        ['O', 0.16584548, 0.95444197, 0.71373534],
        ['O', 0.33415452, 0.04555803, 0.21373534],
        ['O', 0.33415452, 0.45444197, 0.21373534],
        ['O', 0.40576933, 0.25000000, 0.75521344],
        ['O', 0.45569144, 0.75000000, 0.79013555],
        ['O', 0.54430856, 0.25000000, 0.20986445],
        ['O', 0.59423067, 0.75000000, 0.24478656],
        ['O', 0.66584548, 0.54555803, 0.78626466],
        ['O', 0.66584548, 0.95444197, 0.78626466],
        ['O', 0.83415452, 0.04555803, 0.28626466],
        ['O', 0.83415452, 0.45444197, 0.28626466],
        ['O', 0.90576933, 0.25000000, 0.74478656],
        ['O', 0.95569144, 0.75000000, 0.70986445]
    ];
    baseAtomsData = demoSites.map(([element, x, y, z]) => {
        const frac = new THREE.Vector3(x, y, z);
        return {
            element,
            frac,
            pos: baseCell.fracToCart(frac)
        };
    });
    applySupercell();
    rebuildElementEditor(); 
    refreshBondTopology();
    rebuildSceneGraph();
    frameActiveStructure(); 
}

bootCrystalWorkbench();


