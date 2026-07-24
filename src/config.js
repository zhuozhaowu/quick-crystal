export const RenderConfig = {
    lighting: {
        color: 0xffffff,
        keyBaseIntensity: 2.0,
        ambientBaseIntensity: 1.5,
        sceneKeyDistance: 50,
        atomPreviewKeyDistance: 20
    },
    outline: {
        defaultColor: [0, 0, 0],
        defaultAlpha: 1.0,
        defaultKeepAlive: true
    },
    atomMaterial: {
        shininess: 300,
        specular: 0xffffff
    },
    atomPreview: {
        size: 512,
        pixelRatio: 1,
        cameraZ: 12,
        near: 0.1,
        far: 100,
        sphereSegments: 48,
        minFrame: 1.2,
        radiusFrameScale: 1.85
    },
    renderer: {
        maxPixelRatio: 2,
        mobileMaxPixelRatio: 1.5
    }
};

export const ElementData = {
    H:  { color: 0xFFFFFF, radius: 0.32 },
    C:  { color: 0x57B1AB, radius: 0.75 },
    N:  { color: 0xED7D31, radius: 0.71 },
    O:  { color: 0xFF8080, radius: 0.63 },
    F:  { color: 0x00FF00, radius: 0.64 },
    Si: { color: 0xDAA520, radius: 1.11 },
    P:  { color: 0xFFA500, radius: 1.07 },
    S:  { color: 0xFFFF00, radius: 1.03 },
    Cl: { color: 0x00FF00, radius: 0.99 },
    Fe: { color: 0x8080C0, radius: 1.32 },
    Co: { color: 0xF08080, radius: 1.26 },
    Ni: { color: 0x3CB371, radius: 1.24 },
    Cu: { color: 0xC88033, radius: 1.32 },
    Ru: { color: 0x008080, radius: 1.46 },
    Rh: { color: 0x008B8B, radius: 1.42 },
    Pd: { color: 0x006994, radius: 1.39 },
    Pt: { color: 0xD0D0E0, radius: 1.36 },
    Au: { color: 0xFFD700, radius: 1.36 },
    default: { color: 0xAA66CC, radius: 1.0 }
};

export const ColorPalette = [
    '#B4E2F9', '#C4505A', '#E4E7EE', '#77839A', '#609FD1', '#FFFFFF', '#F6FBFE',
    '#8BC7E6', '#3E6F9E', '#E7F1F1', '#B7DDDB', '#7FC4BE', '#4EA59E', '#638E89', '#4B586E',
    '#EFF0DC', '#D6D49A', '#BDB760', '#D6AD65', '#C78655', '#A76552', '#744A44',
    '#F2E1E4', '#E7B8BE', '#D98893', '#9A3B4E', '#7B385C', '#56405F'
];

export const OrderedElementDefaultColors = [
    0xB4E2F9,
    0xC4505A,
    0xE4E7EE,
    0x77839A,
    0x609FD1
];

export const RegexPatterns = {
    quoteWrap: /^['"]|['"]$/g,
    elementSymbol: /[A-Z][a-z]?|[a-z]/,
    cifUncertainty: /\([^\)]*\)/g,
    hexColor: /^#?([0-9a-fA-F]{6})$/,
    colorNumber: /-?\d+(?:\.\d+)?/g,
    cifLineComment: /\s+#.*$/,
    cifToken: /'([^']*)'|"([^"]*)"|(\S+)/g,
    firstNumber: /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/g,
    whitespace: /\s+/,
    lineBreak: /\r?\n/,
    vestaSection: /^[A-Z][A-Z0-9_]*$/
};

export const NormalizedControls = {
    'atom-size': { min: 0.2, max: 2.5, defaultActual: 0.775 },
    'bond-size': { min: 0.05, max: 0.5, defaultActual: 0.095 },
    'bond-tol': { min: 0.8, max: 1.5, defaultActual: 1.15 },
    'outline-size': { min: 0.0, max: 0.010, defaultActual: 0.003 },
    'light-intensity': { min: 0.0, max: 2.5, defaultActual: 1.0 },
    'ambient-intensity': { min: 0.0, max: 2.0, defaultActual: 1.0 },
    'highlight-size': { min: 300, max: 45, defaultActual: 172.5 }
};

export const ViewAngleInputIds = ['view-x', 'view-y', 'view-z'];
export const SupercellInputIds = ['supercell-x', 'supercell-y', 'supercell-z'];
export const ViewShortcutKeys = new Set(['x', 'y', 'z']);
