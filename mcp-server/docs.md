# BinaSmart MCP server

**Endpoint:** `https://bina.et/mcp` (Streamable HTTP, stateless, no auth) · **Health:** `https://bina.et/mcp/health`

BinaSmart (bina.et) is Ethiopia's all-in-one digital platform: fixed-price ride-hailing in Addis Ababa, a directory of buildings, hotels, hospitals and shops, events, and bilingual Digital Ethiopia guides. This server lets AI assistants (Claude, ChatGPT, Gemini) use it.

## Tools
| Tool | What it does | Writes? |
|---|---|---|
| `quote_ride` | fixed ETB fare for every tier between two Addis places | no |
| `request_ride` | books a ride (name + Ethiopian phone); dispatcher confirms by phone | **yes** |
| `get_ride_status` | status, driver, plate for a ride id + phone | no |
| `cancel_ride` | cancel before the trip starts | **yes** |
| `search_places` | buildings, hotels, hospitals, shops (cafés, restaurants, pharmacies, banks…) | no |
| `get_hotel_rooms` | room types and nightly prices | no |
| `get_hospital_departments` | departments, fees, slots left | no |
| `list_events` | upcoming films, concerts and events on sale, prices, seats left | no |
| `list_films` | Amharic films to watch online: free or 48-hour rental, watch url | no |
| `get_ethiopia_guide` | 24 step-by-step guides: Fayda, telebirr, TIN, VAT, eVisa, driving licence… | no |
| `search_knowledge` | semantic search over every BinaSmart service, its rules, the guides and practical Addis Ababa knowledge; returns passages + source_url | no |
| `list_pool_corridors` | BinaPool shared-commute corridors open now, stops, live seat-price ladder, cars filling | no |
| `find_pool_groups` | cars filling within ~2.5 km of a point: seats left, price, women-only, share url | no |

## Connect
- **Claude Code:** `claude mcp add --transport http binasmart https://bina.et/mcp`
- **Gemini (Spark):** gemini.google.com → Settings → Connected apps → Custom apps → `https://bina.et/mcp`
- **Any client:** `POST https://bina.et/mcp` with `Accept: application/json, text/event-stream`

## Limits
Rides: 5 requests per 10 minutes per phone; 30 tool calls/min and 10 bookings/hour per session. Addis Ababa only. Fares are fixed at quote time — no surge.

Questions: https://bina.et · WhatsApp https://wa.me/251911244344
