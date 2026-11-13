const CACHE = new Map();

async function getMeta(type, id) {
    const cacheKey = `meta_${type}_${id}`;
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    const data = await fetchData(id); // usa tu función de fetch actual

    // Optimizado: paralelo + imágenes w300 + solo url
    const episodes = await Promise.all(
        data.episodes.map(async ep => {
            let poster = ep.poster || data.poster || null;
            if (poster && poster.includes('/original/')) {
                poster = poster.replace('/original/', '/w300/');
            }
            
            return {
                id: ep.id,
                name: ep.name,
                poster: poster, // Kino lo descarga con lazy
                description: ep.overview || ""
            }
        })
    );

    const result = {
        id,
        type,
        name: data.title,
        poster: data.poster?.replace('/original/', '/w300/'),
        background: data.backdrop?.replace('/original/', '/w1280/'),
        description: data.overview,
        episodes
    };

    CACHE.set(cacheKey, result);
    return result;
}