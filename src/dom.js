export const UI = {
    cache: new Map(),
    get(id) {
        if (!this.cache.has(id)) this.cache.set(id, document.getElementById(id));
        return this.cache.get(id);
    },
    clear() {
        this.cache.clear();
    }
};
