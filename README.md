# Token Aggregator

Real-time token aggregation service that fetches and displays trending tokens from Jupiter API with live updates.

## Features

- Real-time token data aggregation from DexScreener API
- WebSocket-based live updates
- Responsive web interface with filtering and sorting
- Support for multiple time windows (5m, 1h, 6h, 24h)
- Automatic polling with exponential backoff for API rate limits
- Pagination support for large datasets

## Tech Stack

- Backend: Node.js, Express, WebSocket
- Frontend: HTML, CSS, JavaScript
- API: Jupiter Token API

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

## Configuration

Create a `.env` file in the root directory:

```
PORT=3000
POLLING_INTERVAL_MS=120000
```

## Running

Development mode with auto-reload:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The application will be available at `http://localhost:3000`

## Deployment

Deploy link: [Add your deployment URL here]

## API Endpoints

- `GET /` - Serves the frontend interface
- `WS /` - WebSocket connection for real-time token updates

## License

MIT
