require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const POLLING_INTERVAL_MS = Number(process.env.POLLING_INTERVAL_MS || 120000);
const API_BASE = 'https://lite-api.jup.ag/tokens/v2/toptrending';
const INTERVALS = ['5m', '1h', '6h', '24h'];

let latestAggregatedData = [];

async function withExponentialBackoff(apiCall, maxRetries = 3, baseDelay = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (err) {
            const isRateLimit = String(err.message || '').includes('429');
            let multiplier = 2;
            if (isRateLimit) multiplier = 5;
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
    let tokens = body;
    if (!Array.isArray(body)) {
        tokens = body.data;
    }
    if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('No tokens');
    return tokens;
}

function transformToken(t) {
    let id = t.id;
    if (!id) id = t.mint;
    if (!id) id = 'unknown';
    
    let symbol = t.symbol || '';
    symbol = symbol.toUpperCase();
    if (!symbol) symbol = 'N/A';
    
    let name = t.name;
    if (!name) name = 'Unknown';
    
    let price = Number(t.usdPrice);
    if (!price) price = Number(t.priceUsd);
    if (!price) price = 0;
    
    let image = t.icon;
    if (!image) image = '';
    
    let liquidity = Number(t.liquidity);
    if (!liquidity) liquidity = 0;
    
    let marketCap = Number(t.mcap);
    if (!marketCap) marketCap = 0;
    
    let priceChange24h = 0;
    if (t.stats24h && t.stats24h.priceChange) {
        priceChange24h = Number(t.stats24h.priceChange);
    }
    
    let buyVol = 0;
    let sellVol = 0;
    if (t.stats24h) {
        buyVol = t.stats24h.buyVolume || 0;
        sellVol = t.stats24h.sellVolume || 0;
    }
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

async function startPolling() {
    try {
        const promises = INTERVALS.map(iv => withExponentialBackoff(() => fetchTokens(iv, 400)));
        const results = await Promise.allSettled(promises);
        let collected = [];
        for (const r of results) {
            if (r.status === 'fulfilled') {
                collected.push(...r.value.map(t => transformToken(t)));
            }
        }
        if (collected.length === 0) throw new Error('No data');
        latestAggregatedData = mergeTokens(collected);
    } catch (err) {}
    finally { setTimeout(startPolling, POLLING_INTERVAL_MS); }
}

function filterAndSortTokens(tokens, opts = {}) {
    let sortBy = opts.sortBy || 'volume';
    let order = opts.order || 'desc';
    let limit = opts.limit || 50;
    let cursor = opts.cursor || null;
    
    let filtered = [];
    for (const t of tokens) {
        if (t.price >= 0) {
            filtered.push(t);
        }
    }
    
    filtered.sort((a, b) => {
        let aVal;
        let bVal;
        if (sortBy === 'price') {
            aVal = a.price || 0;
            bVal = b.price || 0;
        } else {
            aVal = a.volume24h || 0;
            bVal = b.volume24h || 0;
        }
        if (order === 'asc') {
            return aVal - bVal;
        } else {
            return bVal - aVal;
        }
    });
    
    let start = 0;
    if (cursor) {
        try {
            const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
            start = decoded.offset || 0;
        } catch (e) {
            start = 0;
        }
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
    let sortBy = req.query.sortBy || 'volume';
    let timeWindow = req.query.timeWindow || '24h';
    let order = req.query.order || 'desc';
    let limit = parseInt(req.query.limit) || 50;
    let cursor = req.query.cursor || null;
    
    const opts = { sortBy, timeWindow, order, limit, cursor };
    res.json(filterAndSortTokens(latestAggregatedData, opts));
});

wss.on('connection', ws => {
    if (latestAggregatedData.length > 0) {
        const msg = JSON.stringify({ type: 'INITIAL_LOAD', tokens: latestAggregatedData, ts: Date.now() });
        ws.send(msg);
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
