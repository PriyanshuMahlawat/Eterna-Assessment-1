# Token Aggregator

Real-time token aggregation service that fetches and displays trending tokens from Jupiter API with live updates.

**Deployment**: Free deployment(temporary) on replit. Check the video attached for proper demonstation.

## Features

- Real-time token data aggregation from Jupiter API
- WebSocket-based live updates
- Responsive web interface with filtering and sorting
- Support for multiple time windows (5m, 1h, 6h, 24h)
- Automatic polling with exponential backoff for API rate limits
- Pagination support for large datasets

## Tech Stack

- Backend: Node.js, Express, WebSocket
- Frontend: HTML, CSS, JavaScript
- API: Jupiter Token API

## How It Works

### Backend Process

1. **API Source**: The backend uses the Jupiter Token API at `https://lite-api.jup.ag/tokens/v2/toptrending/{interval}?limit=400` to fetch trending tokens.

   The API returns token data including:
   - Token ID and symbol
   - Current USD price
   - 24h price change percentage
   - Trading volume (buy and sell)
   - Market capitalization
   - Liquidity information
   - Token icon/image

2. **Polling Service**: The backend continuously polls this API every 2 minutes (configurable) across four time windows: 5m, 1h, 6h, and 24h intervals.

3. **Token Aggregation**: Data from all intervals is collected and merged to create a comprehensive token list. Duplicate tokens are consolidated, with values like price, volume, liquidity, and market cap being aggregated.

4. **Error Handling**: The service implements exponential backoff to gracefully handle API rate limits and network failures, automatically retrying failed requests with increasing delays.

5. **Data Transformation**: Raw API responses are normalized into a consistent format with properties like symbol, price, volume, liquidity, market cap, and price change metrics.

6. **WebSocket Broadcasting**: Connected clients receive the latest aggregated token data through WebSocket connections in real-time when data updates occur.

### Frontend Interface

1. **Live Display**: The web interface receives real-time token updates and displays them in a sortable, filterable table.

2. **Sorting Options**: Users can sort by volume or price in ascending or descending order.

3. **Time Window Filtering**: Users can select different time windows (5m, 1h, 6h, 24h) to view trending tokens for those periods.

4. **Pagination**: Large datasets are paginated with next/previous navigation to browse through all available tokens.

5. **Status Indicator**: Connection status is displayed, showing when the WebSocket is active or disconnected.





