import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorRoot = join(root, 'vendor');

const paths = {
    three: {
        version: '0.160.0',
        root: join(root, 'node_modules', 'three')
    },
    phosphor: {
        version: '2.1.2',
        root: join(root, 'node_modules', '@phosphor-icons', 'web')
    },
    firaSans: {
        root: join(root, 'node_modules', '@fontsource', 'fira-sans')
    },
    firaCode: {
        root: join(root, 'node_modules', '@fontsource', 'fira-code')
    }
};

async function copyFile(source, target) {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
}

async function copyLicense(packageRoot, target) {
    await copyFile(join(packageRoot, 'LICENSE'), target);
}

async function buildThreeVendor() {
    const targetRoot = join(vendorRoot, 'three', paths.three.version);
    await copyFile(
        join(paths.three.root, 'build', 'three.module.js'),
        join(targetRoot, 'build', 'three.module.js')
    );
    await copyFile(
        join(paths.three.root, 'examples', 'jsm', 'controls', 'OrbitControls.js'),
        join(targetRoot, 'examples', 'jsm', 'controls', 'OrbitControls.js')
    );
    await copyFile(
        join(paths.three.root, 'examples', 'jsm', 'effects', 'OutlineEffect.js'),
        join(targetRoot, 'examples', 'jsm', 'effects', 'OutlineEffect.js')
    );
    await copyLicense(paths.three.root, join(targetRoot, 'LICENSE'));
}

async function buildPhosphorVendor() {
    const sourceRoot = join(paths.phosphor.root, 'src', 'regular');
    const targetRoot = join(vendorRoot, 'phosphor', paths.phosphor.version, 'regular');
    for (const filename of ['style.css', 'Phosphor.woff2', 'Phosphor.woff', 'Phosphor.ttf', 'Phosphor.svg']) {
        await copyFile(join(sourceRoot, filename), join(targetRoot, filename));
    }
    await copyLicense(paths.phosphor.root, join(vendorRoot, 'phosphor', paths.phosphor.version, 'LICENSE'));
}

async function buildFontVendor() {
    const targetRoot = join(vendorRoot, 'fonts');
    const firaSansWeights = ['400', '500', '600', '700', '800'];
    const firaCodeWeights = ['500', '600', '700'];

    for (const weight of firaSansWeights) {
        const filename = `fira-sans-latin-${weight}-normal.woff2`;
        await copyFile(join(paths.firaSans.root, 'files', filename), join(targetRoot, 'fira-sans', filename));
    }
    for (const weight of firaCodeWeights) {
        const filename = `fira-code-latin-${weight}-normal.woff2`;
        await copyFile(join(paths.firaCode.root, 'files', filename), join(targetRoot, 'fira-code', filename));
    }

    const css = [
        ...firaSansWeights.map(weight => [
            '@font-face {',
            '  font-family: "Fira Sans";',
            `  src: url("./fira-sans/fira-sans-latin-${weight}-normal.woff2") format("woff2");`,
            `  font-weight: ${weight};`,
            '  font-style: normal;',
            '  font-display: swap;',
            '}'
        ].join('\n')),
        ...firaCodeWeights.map(weight => [
            '@font-face {',
            '  font-family: "Fira Code";',
            `  src: url("./fira-code/fira-code-latin-${weight}-normal.woff2") format("woff2");`,
            `  font-weight: ${weight};`,
            '  font-style: normal;',
            '  font-display: swap;',
            '}'
        ].join('\n'))
    ].join('\n\n');

    await writeFile(join(targetRoot, 'fira.css'), `${css}\n`, 'utf8');
    await copyLicense(paths.firaSans.root, join(targetRoot, 'fira-sans-LICENSE'));
    await copyLicense(paths.firaCode.root, join(targetRoot, 'fira-code-LICENSE'));
}

async function buildVendorReadme() {
    const phosphorPackage = JSON.parse(await readFile(join(paths.phosphor.root, 'package.json'), 'utf8'));
    const firaSansPackage = JSON.parse(await readFile(join(paths.firaSans.root, 'package.json'), 'utf8'));
    const firaCodePackage = JSON.parse(await readFile(join(paths.firaCode.root, 'package.json'), 'utf8'));
    const content = `# Vendored Runtime Assets

This folder contains the browser runtime assets required for offline use.

- Three.js ${paths.three.version}: core module, OrbitControls, and OutlineEffect.
- @phosphor-icons/web ${phosphorPackage.version}: regular icon font CSS and font files.
- @fontsource/fira-sans ${firaSansPackage.version}: local Fira Sans font files used by the UI.
- @fontsource/fira-code ${firaCodePackage.version}: local Fira Code font files used by controls.

Run \`npm install\` and \`npm run build:vendor\` after changing these dependencies.
`;
    await writeFile(join(vendorRoot, 'README.md'), content, 'utf8');
}

await rm(vendorRoot, { recursive: true, force: true });
await buildThreeVendor();
await buildPhosphorVendor();
await buildFontVendor();
await buildVendorReadme();

console.log(`Vendor assets written to ${vendorRoot}`);
