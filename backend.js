require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const POLLING_INTERVAL_MS = Number(process.env.POLLING_INTERVAL_MS || 3000);
const API_BASE = 'https://lite-api.jup.ag/tokens/v2/toptrending';
const INTERVALS = ['5m', '1h', '6h', '24h'];

let latestAggregatedData = [];



async function withExponentialBackoff(apiCall, maxRetries = 3, baseDelay = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (err) {
            const isRateLimit = String(err.message || '').includes('429');
            let multiplier = isRateLimit ? 5 : 2;
            const delay = baseDelay * Math.pow(multiplier, i);
            if (i === maxRetries - 1) throw err;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}



async function fetchTokens(interval = '1h', limit = 400) {
    const url = `${API_BASE}/${interval}?limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const body = await res.json();
    
    let tokens = Array.isArray(body) ? body : body.data;
    if (!tokens || tokens.length === 0) throw new Error('No tokens');
    return tokens;
}


function transformToken(t) {
    let id = t.id || t.mint || 'unknown';
    
    let symbol = (t.symbol || '').toUpperCase() || 'N/A';
    let name = t.name || 'Unknown';
    
    let price = Number(t.usdPrice || t.priceUsd || 0);
    let image = t.icon || '';
    let liquidity = Number(t.liquidity || 0);
    let marketCap = Number(t.mcap || 0);

    let priceChange24h = t.stats24h?.priceChange || 0;

    let buyVol = t.stats24h?.buyVolume || 0;
    let sellVol = t.stats24h?.sellVolume || 0;
    let volume24h = Number(buyVol + sellVol);

    return {
        id,
        symbol,
        name,
        price,
        image,
        liquidity,
        marketCap,
        priceChange24h,
        volume24h
    };
}



function mergeTokens(allTokens) {
    const map = new Map();

    for (const tok of allTokens) {
        const key = (tok.symbol || tok.id).toLowerCase();

        if (!map.has(key)) {
            map.set(key, tok);
            continue;
        }

        const ex = map.get(key);

        if (tok.price && (!ex.price || tok.price > ex.price)) ex.price = tok.price;

        ex.volume24h = (ex.volume24h || 0) + (tok.volume24h || 0);
        ex.liquidity = Math.max(ex.liquidity || 0, tok.liquidity || 0);
        ex.marketCap = Math.max(ex.marketCap || 0, tok.marketCap || 0);
    }

    return Array.from(map.values());
}



function broadcast(data) {
    const msg = JSON.stringify(data);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}



async function startPolling() {
    console.log(`\n=== Starting polling at ${new Date().toLocaleTimeString()} ===`);

    try {
        const promises = INTERVALS.map(iv =>
            withExponentialBackoff(() => fetchTokens(iv, 400)).then(
                data => ({ interval: iv, data }),
                err => ({ interval: iv, error: err })
            )
        );

        const results = await Promise.all(promises);
        let collected = [];

        for (const r of results) {
            if (r.error) {
                console.log(`[ERROR] Interval ${r.interval}:`, r.error.message);
                continue;
            }

            console.log(`[FETCHED] Interval ${r.interval}: ${r.data.length} tokens`);
            collected.push(...r.data.map(t => transformToken(t)));
        }

        if (collected.length === 0) throw new Error("No data collected");

        latestAggregatedData = mergeTokens(collected);

        console.log(`[MERGED] Total tokens: ${latestAggregatedData.length}`);

        
        broadcast({
            type: "UPDATE",
            tokens: latestAggregatedData,
            ts: Date.now()
        });

    } catch (err) {
        console.log("[POLL ERROR]", err.message);
    } finally {
        console.log("=== Polling complete ===\n");
        setTimeout(startPolling, POLLING_INTERVAL_MS);
    }
}



function filterAndSortTokens(tokens, opts = {}) {
    let sortBy = opts.sortBy || 'volume';
    let order = opts.order || 'desc';
    let limit = opts.limit || 50;
    let cursor = opts.cursor || null;

    let filtered = tokens.filter(t => t.price >= 0);

    filtered.sort((a, b) => {
        let aVal = sortBy === 'price' ? a.price : a.volume24h;
        let bVal = sortBy === 'price' ? b.price : b.volume24h;
        return order === 'asc' ? aVal - bVal : bVal - aVal;
    });

    let start = 0;
    if (cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
            start = decoded.offset || 0;
        } catch {}
    }

    const sliced = filtered.slice(start, start + limit);

    let nextCursor = null;
    if (start + limit < filtered.length) {
        nextCursor = Buffer.from(JSON.stringify({ offset: start + limit })).toString('base64');
    }

    return { tokens: sliced, nextCursor, total: filtered.length, limit };
}



const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/tokens', (req, res) => {
    let opts = {
        sortBy: req.query.sortBy || 'volume',
        timeWindow: req.query.timeWindow || '24h',
        order: req.query.order || 'desc',
        limit: parseInt(req.query.limit) || 50,
        cursor: req.query.cursor || null
    };

    res.json(filterAndSortTokens(latestAggregatedData, opts));
});

wss.on('connection', ws => {
    if (latestAggregatedData.length > 0) {
        ws.send(JSON.stringify({
            type: 'INITIAL_LOAD',
            tokens: latestAggregatedData,
            ts: Date.now()
        }));
    }
});


server.listen(PORT, () => {
    startPolling();
});



const shutdown = () => {
    wss.close();
    server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
