# Changelog

## 1.2.0

### Added

- `LOGOS_TOP_K` env var (1–50, default 5) controls automatic memory injection size and the default `logos_recall` `top_k`

## 1.1.0

### Added

- Hybrid search and `logos_recall` hybrid parameter

## 1.0.2

### Fixed

- Reject pending LogosDB MCP JSON-RPC calls immediately when `logosdb-mcp-server` exits, instead of waiting for the 60s request timeout ([#1](https://github.com/jose-compu/pi-semantic-memory/issues/1))

## 1.0.1

### Fixed

- Parse `logosdb_list` JSON response correctly (compat with logosdb 0.11.0)

## 1.0.0

- Initial release
