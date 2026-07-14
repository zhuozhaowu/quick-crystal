const TextureKeys = [
    'map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap',
    'envMap', 'alphaMap', 'aoMap', 'displacementMap',
    'emissiveMap', 'gradientMap', 'metalnessMap', 'roughnessMap',
    'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
    'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap',
    'sheenRoughnessMap', 'transmissionMap', 'thicknessMap'
];

export function collectMaterials(material, materialSet) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach(mat => {
        if (mat && typeof mat.dispose === 'function') materialSet.add(mat);
    });
}

export function disposeMaterial(material) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach(mat => {
        if (!mat) return;
        TextureKeys.forEach(key => {
            if (mat[key] && typeof mat[key].dispose === 'function') mat[key].dispose();
        });
        if (typeof mat.dispose === 'function') mat.dispose();
    });
}

export function disposeCollectedResources(geometries, materials) {
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => disposeMaterial(material));
}
