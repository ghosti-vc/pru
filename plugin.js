const BASE_URL = "https://tu-api-aqui.com"; // <- CAMBIA ESTO por tu API
const CACHE = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

// Utilidad para fetch con cache
async function fetchData(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return await res.json();
}

function optimizeImage(url, size = "w300") {
    if (!url) return null;
    return url.includes('/original/') ? url.replace('/original/', `/${size}/`) : url;
}

// 1. CATALOGO
async function getCatalog(type, id) {
    const cacheKey = `catalog_${type}_${id}`;
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    const data = await fetchData(`${BASE_URL}/${type}?page=1`);
    
    const metas = data.results.map(item => ({
        id: item.id,
        type: type,
        name: item.title || item.name,
        poster: optimizeImage(item.poster_path),
        description: item.overview
    }));

    CACHE.set(cacheKey, metas);
    return metas;
}

// 2. BUSQUEDA
async function search(query) {
    const data = await fetchData(`${BASE_URL}/search?query=${encodeURIComponent(query)}`);
    
    return data.results.map(item => ({
        id: item.id,
        type: item.media_type,
        name: item.title || item.name,
        poster: optimizeImage(item.poster_path),
        description: item.overview
    }));
}

// 3. META - ESTA ES LA QUE HACE LENTO TODO
async function getMeta(type, id)